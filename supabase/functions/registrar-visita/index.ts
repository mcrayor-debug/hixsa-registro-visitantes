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

const MOTIVOS = ["Reunión", "Entrevista", "Proveedor o servicio", "Entrega o paquetería", "Otro"];
const HORA_MS = 60 * 60 * 1000;
const AVISO_URL = "https://www.hixsa.com/sobre-nosotros/aviso-de-privacidad/";

interface Entrada {
  nombre_completo?: string;
  empresa?: string;
  correo?: string;
  telefono?: string;
  persona_visita?: string;
  motivo?: string;
  comentarios?: string | null;
  entrada?: string;
  salida?: string;
  acepta_aviso?: boolean;
  sitio_web?: string; // trampa anti-bots
}

function validar(b: Entrada) {
  const campos: Record<string, string> = {};
  const txt = (v: unknown) => String(v ?? "").trim().replace(/\s+/g, " ");

  const nombre = txt(b.nombre_completo);
  const empresa = txt(b.empresa);
  const correo = txt(b.correo).toLowerCase();
  const telefonoCrudo = txt(b.telefono);
  const telefono = (telefonoCrudo.startsWith("+") ? "+" : "") + telefonoCrudo.replace(/\D/g, "");
  const persona = txt(b.persona_visita);
  const motivo = txt(b.motivo);
  const comentarios = txt(b.comentarios) || null;

  if (nombre.length < 3 || nombre.length > 120) campos.nombre_completo = "Escribe tu nombre y apellido.";
  if (empresa.length < 2 || empresa.length > 120) campos.empresa = "Escribe el nombre de tu empresa.";
  if (!EMAIL_RE.test(correo) || correo.length > 254) campos.correo = "Revisa el formato del correo.";
  if (!/^\+?[0-9]{10,15}$/.test(telefono)) campos.telefono = "Escribe un teléfono de 10 a 15 dígitos.";
  if (persona.length < 3 || persona.length > 120) campos.persona_visita = "Escribe a quién visitas.";
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
      empresa,
      correo,
      telefono,
      persona_visita: persona,
      motivo,
      comentarios,
      entrada: isNaN(entrada.getTime()) ? null : entrada.toISOString(),
      salida: isNaN(salida.getTime()) ? null : salida.toISOString(),
      acepta_aviso: true,
    },
  };
}

function plantillaCorreo(v: Record<string, string>, folio: string) {
  const fila = (k: string, val: string) =>
    `<tr><td style="padding:6px 0;color:#5B6B7F;width:140px;vertical-align:top">${k}</td>` +
    `<td style="padding:6px 0;color:#1C2A3A;font-weight:600">${escapar(val)}</td></tr>`;
  const mismaFecha = formatoFecha(v.entrada) === formatoFecha(v.salida);
  return `<!doctype html><html lang="es"><body style="margin:0;background:#F4F7FA;font-family:Arial,Helvetica,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F4F7FA;padding:24px 12px">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#FFFFFF;border-radius:12px;overflow:hidden;border:1px solid #D3DCE6">
<tr><td style="background:#12365F;padding:22px 28px;color:#FFFFFF">
  <div style="font-size:20px;font-weight:800;letter-spacing:2px">HIXSA</div>
  <div style="font-size:15px;color:#CFE3F2;margin-top:4px">Tu pase de visita</div>
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
    ${fila("Visitas a", v.persona_visita)}
    ${fila("Motivo", v.motivo)}
    ${fila("Empresa", v.empresa)}
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

  const { campos, datos } = validar(body);
  if (Object.keys(campos).length) return json({ error: "Revisa los datos marcados.", campos }, 422);

  const db = clienteServicio();

  // Límite simple contra abuso: máximo 5 registros por correo cada 10 minutos.
  const { count } = await db
    .from("visitantes")
    .select("id", { count: "exact", head: true })
    .eq("correo", datos.correo)
    .gte("created_at", new Date(Date.now() - 10 * 60 * 1000).toISOString());
  if ((count ?? 0) >= 5) return json({ error: "Demasiados registros seguidos. Espera unos minutos." }, 429);

  const { data: visita, error } = await db
    .from("visitantes")
    .insert(datos)
    .select("id, folio, nombre_completo, empresa, correo, persona_visita, motivo, entrada, salida")
    .single();
  if (error || !visita) {
    console.error("insert visitantes", error);
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
      html: plantillaCorreo(visita, visita.folio),
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
