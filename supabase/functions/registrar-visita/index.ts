// =====================================================================
// Edge Function: registrar-visita (pública)
// 1. Valida los datos del formulario.
// 2. Guarda la visita (service_role).
// 3. Genera un código QR con los datos y el horario registrado.
// 4. Envía el pase por correo al visitante (y copia a recepción si está activado).
// =====================================================================
import QRCode from "npm:qrcode@1.5.4";
import { json, leerJson, prepararPeticion } from "../_shared/http.ts";
import { clienteServicio } from "../_shared/supabase.ts";
import { EMAIL_RE, enviarCorreo, escapar } from "../_shared/correo.ts";
import { formatoFecha, formatoHora, huellaPase } from "../_shared/formato.ts";
import { filtroAuditoria } from "../_shared/auth.ts";

const MOTIVOS = ["Reunión", "Entrevista", "Proveedor o servicio", "Entrega o paquetería", "Otro"];
const IDENTIFICACIONES = ["INE", "Licencia", "Pasaporte", "ID empresa", "Otro"];
const MAX_FOTO_BYTES = 3 * 1024 * 1024;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HORA_MS = 60 * 60 * 1000;
const AVISO_URL = "https://www.hixsa.com/sobre-nosotros/aviso-de-privacidad/";

interface Entrada {
  nombre?: string;
  apellidos?: string;
  empresa_visita_id?: string;
  empresa?: string;
  correo?: string;
  telefono?: string;
  persona_visita?: string;
  motivo?: string;
  comentarios?: string | null;
  entrada?: string;
  salida?: string;
  acepta_aviso?: boolean;
  anfitrion_id?: string | null;
  tipo_identificacion?: string;
  identificacion_detalle?: string | null;
  foto_identificacion?: string; // data URL (JPEG, PNG o WebP)
  sitio_web?: string; // trampa anti-bots
}

function validar(b: Entrada) {
  const campos: Record<string, string> = {};
  const txt = (v: unknown) => String(v ?? "").trim().replace(/\s+/g, " ");

  const nombreSolo = txt(b.nombre);
  const apellidos = txt(b.apellidos);
  const nombre = `${nombreSolo} ${apellidos}`.trim();
  const empresaVisita = txt(b.empresa_visita_id);
  const empresa = txt(b.empresa);
  const correo = txt(b.correo).toLowerCase();
  const telefonoCrudo = txt(b.telefono);
  const telefono = (telefonoCrudo.startsWith("+") ? "+" : "") + telefonoCrudo.replace(/\D/g, "");
  const persona = txt(b.persona_visita);
  const motivo = txt(b.motivo);
  const comentarios = txt(b.comentarios) || null;

  if (nombreSolo.length < 1 || nombreSolo.length > 60) campos.nombre = "Escribe tu nombre.";
  if (apellidos.length < 2 || apellidos.length > 80) campos.apellidos = "Escribe tus apellidos.";
  if (!UUID_RE.test(empresaVisita)) campos.empresa_visita = "Elige la empresa que visitas.";
  if (empresa.length < 2 || empresa.length > 120) campos.empresa = "Escribe el nombre de tu empresa.";
  if (!EMAIL_RE.test(correo) || correo.length > 254) campos.correo = "Revisa el formato del correo.";
  if (!/^\+?[0-9]{10,15}$/.test(telefono)) campos.telefono = "Escribe un teléfono de 10 a 15 dígitos.";
  const anfitrionId = txt(b.anfitrion_id);
  if (anfitrionId && !UUID_RE.test(anfitrionId)) campos.persona_visita = "Elige a quién visitas.";
  if (!anfitrionId && (persona.length < 3 || persona.length > 120)) campos.persona_visita = "Escribe a quién visitas.";
  const tipoId = txt(b.tipo_identificacion);
  const detalleId = txt(b.identificacion_detalle) || null;
  if (!IDENTIFICACIONES.includes(tipoId)) campos.tipo_identificacion = "Elige el tipo de identificación.";
  if (tipoId === "Otro" && (!detalleId || detalleId.length > 60)) campos.identificacion_detalle = "Escribe qué identificación es.";
  const foto = leerFoto(String(b.foto_identificacion ?? ""));
  if (typeof foto === "string") campos.foto_identificacion = foto;
  if (!MOTIVOS.includes(motivo)) campos.motivo = "Elige un motivo válido.";
  if (comentarios && comentarios.length > 500) campos.comentarios = "Máximo 500 caracteres.";
  if (b.acepta_aviso !== true) campos.acepta_aviso = "Debes aceptar el aviso de privacidad.";

  const entrada = new Date(String(b.entrada ?? ""));
  const salida = new Date(String(b.salida ?? ""));
  const ahora = Date.now();
  if (isNaN(entrada.getTime())) campos.entrada = "Elige la fecha y hora de entrada.";
  else if (entrada.getTime() < ahora - 2 * HORA_MS) campos.entrada = "La entrada no puede ser en el pasado.";
  else if (entrada.getTime() > ahora + 90 * 24 * HORA_MS) campos.entrada = "Solo se aceptan visitas en los próximos 90 días.";
  if (isNaN(salida.getTime())) campos.salida = "Elige la fecha y hora de salida.";
  else if (!campos.entrada && salida <= entrada) campos.salida = "La salida debe ser después de la entrada.";
  else if (!campos.entrada && salida.getTime() - entrada.getTime() > 7 * 24 * HORA_MS) {
    campos.salida = "La visita puede durar máximo 7 días.";
  }

  return {
    campos,
    datos: {
      nombre_completo: nombre,
      nombre: nombreSolo,
      apellidos,
      empresa_visita_id: empresaVisita,
      empresa,
      correo,
      telefono,
      persona_visita: persona,
      anfitrion_id: anfitrionId || null,
      tipo_identificacion: tipoId,
      identificacion_detalle: tipoId === "Otro" ? detalleId : null,
      motivo,
      comentarios,
      entrada: isNaN(entrada.getTime()) ? null : entrada.toISOString(),
      salida: isNaN(salida.getTime()) ? null : salida.toISOString(),
      acepta_aviso: true,
    },
    foto: typeof foto === "string" ? null : foto,
  };
}

/** Valida la foto (data URL): tipo real por sus primeros bytes y tamaño máximo. */
function leerFoto(dataUrl: string): { bytes: Uint8Array; tipo: string; ext: string } | string {
  const m = dataUrl.match(/^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/);
  if (!m) return "Toma o adjunta la foto de tu identificación.";
  let bytes: Uint8Array;
  try {
    bytes = Uint8Array.from(atob(m[2]), (c) => c.charCodeAt(0));
  } catch {
    return "La foto no se pudo leer. Intenta de nuevo.";
  }
  if (bytes.length > MAX_FOTO_BYTES) return "La foto pesa demasiado (máximo 3 MB).";
  const firma = Array.from(bytes.slice(0, 12));
  const esJpeg = firma[0] === 0xff && firma[1] === 0xd8 && firma[2] === 0xff;
  const esPng = firma[0] === 0x89 && firma[1] === 0x50 && firma[2] === 0x4e && firma[3] === 0x47;
  const esWebp = String.fromCharCode(...firma.slice(0, 4)) === "RIFF" && String.fromCharCode(...firma.slice(8, 12)) === "WEBP";
  if (esJpeg) return { bytes, tipo: "image/jpeg", ext: "jpg" };
  if (esPng) return { bytes, tipo: "image/png", ext: "png" };
  if (esWebp) return { bytes, tipo: "image/webp", ext: "webp" };
  return "El archivo no es una imagen válida.";
}

function plantillaCorreo(v: Record<string, string>, folio: string, empresaVisita: string, logo: string) {
  const fila = (k: string, val: string) =>
    `<tr><td style="padding:6px 0;color:#5B6B7F;width:140px;vertical-align:top">${k}</td>` +
    `<td style="padding:6px 0;color:#1C2A3A;font-weight:600">${escapar(val)}</td></tr>`;
  const mismaFecha = formatoFecha(v.entrada) === formatoFecha(v.salida);
  return `<!doctype html><html lang="es"><body style="margin:0;background:#F4F7FA;font-family:Arial,Helvetica,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F4F7FA;padding:24px 12px">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#FFFFFF;border-radius:12px;overflow:hidden;border:1px solid #D3DCE6">
<tr><td style="padding:22px 28px 14px;border-bottom:4px solid #0047BA">
  ${logo ? `<img src="${escapar(logo)}" alt="HIXSA" height="44" style="display:block;height:44px;width:auto;border:0">`
    : `<div style="font-size:22px;font-weight:800;letter-spacing:2px;color:#0047BA">HIXSA</div>`}
  <div style="font-size:15px;color:#5B6B7F;margin-top:8px">Tu pase de visita</div>
</td></tr>
<tr><td style="padding:28px">
  <p style="margin:0 0 16px;font-size:16px;color:#1C2A3A">Hola ${escapar(v.nombre_completo.split(" ")[0])}, tu visita quedó registrada. Muestra este código en recepción al llegar.</p>
  <div style="text-align:center;margin:20px 0">
    <img src="cid:qr-pase" width="220" height="220" alt="Código QR del pase ${escapar(folio)}" style="display:inline-block;border:1px solid #D3DCE6;border-radius:8px">
    <div style="font-family:'Courier New',monospace;font-size:18px;font-weight:700;color:#12365F;margin-top:10px">${escapar(folio)}</div>
  </div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:14px">
    ${fila("Entrada", `${formatoFecha(v.entrada)}, ${formatoHora(v.entrada)} h`)}
    ${fila("Salida", mismaFecha ? `${formatoHora(v.salida)} h` : `${formatoFecha(v.salida)}, ${formatoHora(v.salida)} h`)}
    ${fila("Empresa a visitar", empresaVisita)}
    ${fila("Visitas a", v.persona_visita)}
    ${fila("Motivo", v.motivo)}
    ${fila("Tu empresa", v.empresa)}
  </table>
  <p style="margin:22px 0 0;font-size:13px;color:#5B6B7F;line-height:1.5">
    Torre Mitikah, piso 17. Av. Río Churubusco 601, Xoco, Benito Juárez, CDMX.<br>
    Si no puedes ver la imagen, abre el archivo adjunto <b>pase-${escapar(folio)}.png</b>.
  </p>
</td></tr>
<tr><td style="padding:16px 28px;background:#F4F7FA;font-size:12px;color:#5B6B7F">
  Tus datos se tratan conforme al <a href="${AVISO_URL}" style="color:#12365F">aviso de privacidad de HIXSA</a>.
</td></tr>
</table></td></tr></table></body></html>`;
}

Deno.serve(async (req) => {
  const previo = prepararPeticion(req);
  if (previo) return previo;

  const body = await leerJson<Entrada>(req);
  if (!body) return json({ error: "Solicitud inválida." }, 400);

  // Trampa anti-bots: respuesta aparentemente exitosa, sin guardar nada.
  if (body.sitio_web) return json({ ok: true, folio: "HX-000000-00000", correo_enviado: false }, 201);

  const { campos, datos, foto } = validar(body);
  if (Object.keys(campos).length) return json({ error: "Revisa los datos marcados.", campos }, 422);

  const db = clienteServicio();

  // Límite simple contra abuso: máximo 5 registros por correo cada 10 minutos.
  const { count } = await db
    .from("visitantes")
    .select("id", { count: "exact", head: true })
    .eq("correo", datos.correo)
    .gte("created_at", new Date(Date.now() - 10 * 60 * 1000).toISOString());
  if ((count ?? 0) >= 5) return json({ error: "Demasiados registros seguidos. Espera unos minutos." }, 429);

  // Empresa a visitar: activa y visible (en modo auditoría solo la principal)
  const { data: empresa } = await db.from("empresas").select("id, nombre, activa, logo_url").eq("id", datos.empresa_visita_id).maybeSingle();
  const soloEmpresa = await filtroAuditoria(db);
  if (!empresa || !empresa.activa || (soloEmpresa && empresa.id !== soloEmpresa)) {
    return json({ error: "Revisa los datos marcados.", campos: { empresa_visita: "Elige una empresa válida." } }, 422);
  }

  // Anfitrión del directorio: el nombre se toma del servidor, no del navegador, y debe pertenecer a la empresa
  if (datos.anfitrion_id) {
    const { data: anf } = await db.from("anfitriones").select("nombre, area, activo").eq("id", datos.anfitrion_id).maybeSingle();
    const { data: pertenece } = await db.from("anfitrion_empresas").select("anfitrion_id")
      .eq("anfitrion_id", datos.anfitrion_id).eq("empresa_id", empresa.id).maybeSingle();
    if (!anf || !anf.activo || !pertenece) return json({ error: "Revisa los datos marcados.", campos: { persona_visita: "Elige a quién visitas." } }, 422);
    datos.persona_visita = anf.area ? `${anf.nombre} (${anf.area})` : anf.nombre;
  }

  // Foto de identificación al bucket privado (antes de guardar la visita)
  const mes = new Date().toISOString().slice(0, 7);
  const rutaFoto = `${mes}/${crypto.randomUUID()}.${foto!.ext}`;
  const { error: errFoto } = await db.storage.from("identificaciones")
    .upload(rutaFoto, foto!.bytes, { contentType: foto!.tipo, upsert: false });
  if (errFoto) {
    console.error("subida de identificación", errFoto);
    return json({ error: "No se pudo guardar la foto de tu identificación. Intenta de nuevo." }, 500);
  }

  const { data: visita, error } = await db
    .from("visitantes")
    .insert({ ...datos, identificacion_path: rutaFoto })
    .select("id, folio, nombre_completo, empresa, correo, persona_visita, motivo, entrada, salida")
    .single();
  if (error || !visita) {
    console.error("insert visitantes", error);
    await db.storage.from("identificaciones").remove([rutaFoto]); // no dejar fotos huérfanas
    return json({ error: "No se pudo guardar el registro." }, 500);
  }

  // Contenido del QR: liga de validación con folio + huella de los datos y el horario.
  const huella = await huellaPase(visita);
  const sitio = (Deno.env.get("PUBLIC_SITE_URL") ?? "").replace(/\/$/, "");
  const contenidoQr = sitio
    ? `${sitio}/admin.html?pase=${encodeURIComponent(visita.folio)}&h=${huella}`
    : `HIXSA|${visita.folio}|${visita.nombre_completo}|${visita.entrada}|${visita.salida}|${huella}`;

  const qrDataUrl: string = await QRCode.toDataURL(contenidoQr, {
    errorCorrectionLevel: "M",
    margin: 2,
    width: 440,
    color: { dark: "#12365F", light: "#FFFFFF" },
  });
  const qrBase64 = qrDataUrl.split(",")[1];

  // Logo del correo: el configurado en el panel o el del sitio publicado
  const { data: cfgLogo } = await db.from("configuracion").select("logo_url").eq("id", 1).maybeSingle();
  const logoCorreo = cfgLogo?.logo_url || (sitio ? `${sitio}/img/logo-hixsa.png` : "");

  // Copia a recepción (configurable desde el panel)
  const { data: cfg } = await db
    .from("configuracion")
    .select("correo_recepcion, copia_recepcion")
    .eq("id", 1)
    .maybeSingle();
  const cc = cfg?.copia_recepcion && cfg.correo_recepcion ? [cfg.correo_recepcion] : [];

  let correoEnviado = false;
  try {
    await enviarCorreo({
      para: [visita.correo],
      cc,
      asunto: `Tu pase de visita a HIXSA (${visita.folio})`,
      html: plantillaCorreo(visita, visita.folio, empresa.nombre, logoCorreo),
      texto: `Tu visita a HIXSA quedó registrada. Folio ${visita.folio}. ` +
        `Entrada: ${formatoFecha(visita.entrada)} ${formatoHora(visita.entrada)} h. ` +
        `Salida: ${formatoFecha(visita.salida)} ${formatoHora(visita.salida)} h.`,
      adjuntos: [
        { filename: "qr-pase.png", content: qrBase64, content_type: "image/png", content_id: "qr-pase" },
        { filename: `pase-${visita.folio}.png`, content: qrBase64, content_type: "image/png" },
      ],
    });
    correoEnviado = true;
    await db.from("visitantes").update({ qr_enviado_at: new Date().toISOString(), correo_error: null }).eq("id", visita.id);
  } catch (e) {
    console.error("envío de correo", e);
    await db.from("visitantes").update({ correo_error: String(e).slice(0, 300) }).eq("id", visita.id);
  }

  return json({
    ok: true,
    folio: visita.folio,
    entrada: visita.entrada,
    salida: visita.salida,
    qr: qrDataUrl,
    correo_enviado: correoEnviado,
  }, 201);
});
