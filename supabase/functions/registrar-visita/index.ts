// =====================================================================
// Edge Function: registrar-visita (pública)
// 1. Valida datos, horario, empresa a visitar y anfitrión.
// 2. Revisa el perfil del visitante (bloqueos) y, si verificó su código de recurrente,
//    reutiliza sus fotos guardadas.
// 3. Guarda fotos (identificación y selfie) en el bucket privado y la visita (pendiente de aprobación).
// 4. Envía el pase con QR al visitante y la solicitud de aprobación al anfitrión.
// =====================================================================
import { json, leerJson, prepararPeticion } from "../_shared/http.ts";
import { clienteServicio } from "../_shared/supabase.ts";
import { botonCorreo, EMAIL_RE, enviarCorreo, escapar, logoCorreo, plantilla } from "../_shared/correo.ts";
import { formatoFecha, formatoHora } from "../_shared/formato.ts";
import { enviarPase } from "../_shared/pase.ts";
import { filtroAuditoria } from "../_shared/auth.ts";
import { sha256Hex, tokenAleatorio, TOKEN_RE } from "../_shared/tokens.ts";

const MOTIVOS = ["Reunión", "Entrevista", "Proveedor o servicio", "Entrega o paquetería", "Otro"];
const IDENTIFICACIONES = ["INE", "Licencia", "Pasaporte", "ID empresa", "Otro"];
const EQUIPOS = ["Laptop", "Tablet", "Proyector", "Disco o memoria", "Otro"];
const MAX_FOTO_BYTES = 3 * 1024 * 1024;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HORA_MS = 60 * 60 * 1000;
const MENSAJE_BLOQUEO = "No es posible registrar tu visita en este momento. Comunícate con la persona que vas a visitar.";

interface Entrada {
  nombre?: string; apellidos?: string; empresa?: string; correo?: string; telefono?: string;
  empresa_visita_id?: string; anfitrion_id?: string | null; persona_visita?: string; motivo?: string;
  comentarios?: string | null; entrada?: string; salida?: string; acepta_aviso?: boolean;
  tipo_identificacion?: string; identificacion_detalle?: string | null; foto_identificacion?: string | null;
  sala_juntas?: boolean; selfie?: string | null;
  equipo_tipo?: string | null; equipo_marca?: string | null; equipo_serie?: string | null;
  guardar_datos?: boolean; token_recurrente?: string | null;
  sitio_web?: string; // trampa anti-bots
}
interface Foto { bytes: Uint8Array; tipo: string; ext: string }

/** Valida una foto (data URL) por sus bytes reales. null si no se envió; texto si hay error. */
function leerFoto(dataUrl: string | null | undefined): Foto | string | null {
  if (!dataUrl) return null;
  const m = String(dataUrl).match(/^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/);
  if (!m) return "La foto no es válida. Tómala de nuevo.";
  let bytes: Uint8Array;
  try { bytes = Uint8Array.from(atob(m[2]), (c) => c.charCodeAt(0)); } catch { return "La foto no se pudo leer. Intenta de nuevo."; }
  if (bytes.length > MAX_FOTO_BYTES) return "La foto pesa demasiado (máximo 3 MB).";
  const f = Array.from(bytes.slice(0, 12));
  if (f[0] === 0xff && f[1] === 0xd8 && f[2] === 0xff) return { bytes, tipo: "image/jpeg", ext: "jpg" };
  if (f[0] === 0x89 && f[1] === 0x50 && f[2] === 0x4e && f[3] === 0x47) return { bytes, tipo: "image/png", ext: "png" };
  if (String.fromCharCode(...f.slice(0, 4)) === "RIFF" && String.fromCharCode(...f.slice(8, 12)) === "WEBP") return { bytes, tipo: "image/webp", ext: "webp" };
  return "El archivo no es una imagen válida.";
}

function validar(b: Entrada) {
  const campos: Record<string, string> = {};
  const txt = (v: unknown) => String(v ?? "").trim().replace(/\s+/g, " ");
  const nombre = txt(b.nombre), apellidos = txt(b.apellidos);
  const correo = txt(b.correo).toLowerCase();
  const telCrudo = txt(b.telefono);
  const telefono = (telCrudo.startsWith("+") ? "+" : "") + telCrudo.replace(/\D/g, "");
  const empresa = txt(b.empresa), persona = txt(b.persona_visita), motivo = txt(b.motivo);
  const comentarios = txt(b.comentarios) || null;
  const empresaVisita = txt(b.empresa_visita_id), anfitrionId = txt(b.anfitrion_id);
  const tipoId = txt(b.tipo_identificacion), detalleId = txt(b.identificacion_detalle) || null;
  const equipoTipo = txt(b.equipo_tipo) || null, equipoMarca = txt(b.equipo_marca) || null, equipoSerie = txt(b.equipo_serie) || null;

  if (nombre.length < 1 || nombre.length > 60) campos.nombre = "Escribe tu nombre.";
  if (apellidos.length < 2 || apellidos.length > 80) campos.apellidos = "Escribe tus apellidos.";
  if (empresa.length < 2 || empresa.length > 120) campos.empresa = "Escribe tu empresa de origen.";
  if (!EMAIL_RE.test(correo) || correo.length > 254) campos.correo = "Revisa el formato del correo.";
  if (!/^\+?[0-9]{10,15}$/.test(telefono)) campos.telefono = "Escribe un teléfono de 10 a 15 dígitos.";
  if (!UUID_RE.test(empresaVisita)) campos.empresa_visita = "Elige la empresa que visitas.";
  if (anfitrionId && !UUID_RE.test(anfitrionId)) campos.persona_visita = "Elige a quién visitas.";
  if (!anfitrionId && (persona.length < 3 || persona.length > 120)) campos.persona_visita = "Escribe a quién visitas.";
  if (!MOTIVOS.includes(motivo)) campos.motivo = "Elige un motivo válido.";
  if (comentarios && comentarios.length > 500) campos.comentarios = "Máximo 500 caracteres.";
  if (b.acepta_aviso !== true) campos.acepta_aviso = "Debes aceptar el aviso de privacidad.";
  if (!IDENTIFICACIONES.includes(tipoId)) campos.tipo_identificacion = "Elige el tipo de identificación.";
  if (tipoId === "Otro" && (!detalleId || detalleId.length > 60)) campos.identificacion_detalle = "Escribe qué identificación es.";
  if (equipoTipo && !EQUIPOS.includes(equipoTipo)) campos.equipo_tipo = "Elige un tipo de equipo válido.";
  if (equipoMarca && equipoMarca.length > 60) campos.equipo_marca = "Máximo 60 caracteres.";
  if (equipoSerie && equipoSerie.length > 80) campos.equipo_serie = "Máximo 80 caracteres.";

  const entrada = new Date(String(b.entrada ?? "")), salida = new Date(String(b.salida ?? ""));
  const ahora = Date.now();
  if (isNaN(entrada.getTime())) campos.entrada = "Elige la fecha y hora de entrada.";
  else if (entrada.getTime() < ahora - 2 * HORA_MS) campos.entrada = "La entrada no puede ser en el pasado.";
  else if (entrada.getTime() > ahora + 90 * 24 * HORA_MS) campos.entrada = "Solo se aceptan visitas en los próximos 90 días.";
  if (isNaN(salida.getTime())) campos.salida = "Elige la fecha y hora de salida.";
  else if (!campos.entrada && salida <= entrada) campos.salida = "La salida debe ser después de la entrada.";
  else if (!campos.entrada && salida.getTime() - entrada.getTime() > 7 * 24 * HORA_MS) campos.salida = "La visita puede durar máximo 7 días.";

  const foto = leerFoto(b.foto_identificacion);
  if (typeof foto === "string") campos.foto_identificacion = foto;
  const selfie = leerFoto(b.selfie);
  if (typeof selfie === "string") campos.selfie = selfie;

  return {
    campos,
    foto: typeof foto === "string" ? null : foto,
    selfie: typeof selfie === "string" ? null : selfie,
    datos: {
      nombre_completo: `${nombre} ${apellidos}`.trim(), nombre, apellidos, empresa, correo, telefono,
      empresa_visita_id: empresaVisita, anfitrion_id: anfitrionId || null, persona_visita: persona, motivo, comentarios,
      tipo_identificacion: tipoId, identificacion_detalle: tipoId === "Otro" ? detalleId : null,
      sala_juntas: b.sala_juntas === true, equipo_tipo: equipoTipo, equipo_marca: equipoTipo ? equipoMarca : null,
      equipo_serie: equipoTipo ? equipoSerie : null,
      entrada: isNaN(entrada.getTime()) ? null : entrada.toISOString(),
      salida: isNaN(salida.getTime()) ? null : salida.toISOString(),
      acepta_aviso: true,
    },
  };
}

Deno.serve(async (req) => {
  const previo = prepararPeticion(req);
  if (previo) return previo;
  const body = await leerJson<Entrada>(req);
  if (!body) return json({ error: "Solicitud inválida." }, 400);
  if (body.sitio_web) return json({ ok: true, folio: "HX-000000-00000", correo_enviado: false }, 201);

  const { campos, datos, foto, selfie } = validar(body);
  if (Object.keys(campos).length) return json({ error: "Revisa los datos marcados.", campos }, 422);

  const db = clienteServicio();
  const { count } = await db.from("visitantes").select("id", { count: "exact", head: true })
    .eq("correo", datos.correo).gte("created_at", new Date(Date.now() - 10 * 60 * 1000).toISOString());
  if ((count ?? 0) >= 5) return json({ error: "Demasiados registros seguidos. Espera unos minutos." }, 429);

  // Perfil del visitante y bloqueos
  const { data: persona } = await db.from("personas").select("*").eq("correo", datos.correo).maybeSingle();
  if (persona?.estado_bloqueo === "bloqueado") return json({ error: MENSAJE_BLOQUEO }, 403);

  // Token de visitante recurrente verificado (permite reutilizar sus fotos guardadas)
  let tokenId: number | null = null;
  if (body.token_recurrente) {
    if (!TOKEN_RE.test(body.token_recurrente)) return json({ error: "Tu verificación no es válida. Vuelve a pedir el código." }, 422);
    const { data: t } = await db.from("verificaciones").select("id")
      .eq("tipo", "token").eq("correo", datos.correo).eq("hash", await sha256Hex(body.token_recurrente))
      .is("usado_at", null).gt("expira_at", new Date().toISOString()).maybeSingle();
    if (!t) return json({ error: "Tu verificación expiró. Vuelve a pedir el código de recurrente." }, 422);
    tokenId = t.id;
  }
  const reutiliza = Boolean(tokenId && persona);
  if (!foto && !(reutiliza && persona?.identificacion_path)) {
    return json({ error: "Revisa los datos marcados.", campos: { foto_identificacion: "Toma o adjunta la foto de tu identificación." } }, 422);
  }
  if (datos.sala_juntas && !selfie && !(reutiliza && persona?.selfie_path)) {
    return json({ error: "Revisa los datos marcados.", campos: { selfie: "Para entrar a salas de juntas toma una selfie." } }, 422);
  }

  // Empresa a visitar (activa y visible en modo auditoría) y anfitrión de esa empresa
  const { data: empresa } = await db.from("empresas").select("id, nombre, activa").eq("id", datos.empresa_visita_id).maybeSingle();
  const soloEmpresa = await filtroAuditoria(db);
  if (!empresa || !empresa.activa || (soloEmpresa && empresa.id !== soloEmpresa)) {
    return json({ error: "Revisa los datos marcados.", campos: { empresa_visita: "Elige una empresa válida." } }, 422);
  }
  let anfitrion: { nombre: string; area: string | null; correo: string | null } | null = null;
  if (datos.anfitrion_id) {
    const { data: anf } = await db.from("anfitriones").select("nombre, area, correo, activo").eq("id", datos.anfitrion_id).maybeSingle();
    const { data: pertenece } = await db.from("anfitrion_empresas").select("anfitrion_id")
      .eq("anfitrion_id", datos.anfitrion_id).eq("empresa_id", empresa.id).maybeSingle();
    if (!anf || !anf.activo || !pertenece) return json({ error: "Revisa los datos marcados.", campos: { persona_visita: "Elige a quién visitas." } }, 422);
    anfitrion = anf;
    datos.persona_visita = anf.area ? `${anf.nombre} (${anf.area})` : anf.nombre;
  }

  // Fotos al bucket privado
  const mes = new Date().toISOString().slice(0, 7);
  const subidas: string[] = [];
  const subir = async (f: Foto, carpeta: string) => {
    const ruta = `${carpeta}${mes}/${crypto.randomUUID()}.${f.ext}`;
    const { error } = await db.storage.from("identificaciones").upload(ruta, f.bytes, { contentType: f.tipo, upsert: false });
    if (error) throw error;
    subidas.push(ruta);
    return ruta;
  };
  let rutaId: string, rutaSelfie: string | null = null;
  try {
    rutaId = foto ? await subir(foto, "") : persona!.identificacion_path;
    if (datos.sala_juntas) rutaSelfie = selfie ? await subir(selfie, "selfies/") : persona!.selfie_path;
    else if (selfie) rutaSelfie = await subir(selfie, "selfies/");
  } catch (e) {
    console.error("subida de fotos", e);
    if (subidas.length) await db.storage.from("identificaciones").remove(subidas);
    return json({ error: "No se pudieron guardar tus fotos. Intenta de nuevo." }, 500);
  }

  // Perfil: se crea si no existe. Si existe, solo se actualiza con verificación (evita suplantación).
  const ahoraIso = new Date().toISOString();
  let personaId = persona?.id ?? null;
  const datosPerfil = {
    nombre: datos.nombre, apellidos: datos.apellidos, telefono: datos.telefono, empresa: datos.empresa,
    tipo_identificacion: datos.tipo_identificacion, identificacion_detalle: datos.identificacion_detalle,
    identificacion_path: rutaId, selfie_path: rutaSelfie ?? persona?.selfie_path ?? null,
    equipo_tipo: datos.equipo_tipo, equipo_marca: datos.equipo_marca, equipo_serie: datos.equipo_serie,
  };
  if (!persona) {
    const { data: nueva, error } = await db.from("personas").insert({
      correo: datos.correo, ...datosPerfil, recurrente: body.guardar_datos === true, ultima_visita_at: ahoraIso,
    }).select("id").single();
    if (error) console.error("perfil nuevo", error); else personaId = nueva.id;
  } else {
    await db.from("personas").update(reutiliza
      ? { ...datosPerfil, recurrente: true, ultima_visita_at: ahoraIso, updated_at: ahoraIso }
      : { ultima_visita_at: ahoraIso, ...(body.guardar_datos === true && !persona.recurrente ? { recurrente: true } : {}) })
      .eq("id", persona.id);
  }

  // Aprobación: el anfitrión con correo recibe la solicitud; sin él, valida Recepción
  const sitio = (Deno.env.get("PUBLIC_SITE_URL") ?? "").replace(/\/$/, "");
  const apruebaAnfitrion = Boolean(anfitrion?.correo && sitio);
  const tokenAprobacion = apruebaAnfitrion ? tokenAleatorio() : null;

  const { data: visita, error } = await db.from("visitantes").insert({
    ...datos, persona_id: personaId, identificacion_path: rutaId, selfie_path: rutaSelfie,
    estado_aprobacion: "pendiente", aprobacion_token_hash: tokenAprobacion ? await sha256Hex(tokenAprobacion) : null,
  }).select("id, folio, nombre_completo, empresa, correo, persona_visita, motivo, entrada, salida").single();
  if (error || !visita) {
    console.error("insert visitantes", error);
    if (subidas.length) await db.storage.from("identificaciones").remove(subidas);
    return json({ error: "No se pudo guardar el registro." }, 500);
  }
  if (tokenId) await db.from("verificaciones").update({ usado_at: ahoraIso }).eq("id", tokenId);

  // Pase con QR e invitación de calendario al visitante; invitación a los calendarios configurados
  const { qr: qrDataUrl, correoEnviado } = await enviarPase(db, { ...visita, nombre: datos.nombre }, {
    empresaVisita: empresa.nombre, aprueba: apruebaAnfitrion ? "anfitrion" : "recepcion",
  });
  const logo = await logoCorreo(db);
  const fila = (k: string, val: string) =>
    `<tr><td style="padding:6px 0;color:#5B6B7F;width:140px;vertical-align:top">${k}</td><td style="padding:6px 0;font-weight:600">${escapar(val)}</td></tr>`;
  const tablaVisita = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:14px">
    ${fila("Entrada", `${formatoFecha(visita.entrada)}, ${formatoHora(visita.entrada)} h`)}${fila("Salida", `${formatoFecha(visita.salida)}, ${formatoHora(visita.salida)} h`)}
    ${fila("Empresa a visitar", empresa.nombre)}${fila("Motivo", visita.motivo)}${fila("Empresa de origen", visita.empresa)}
  </table>`;

  // Solicitud de aprobación al anfitrión
  if (apruebaAnfitrion && tokenAprobacion) {
    const enlace = (a: string) => `${sitio}/aprobar.html?t=${tokenAprobacion}&a=${a}`;
    const restringido = persona?.estado_bloqueo === "restringido";
    try {
      await enviarCorreo({
        para: [anfitrion!.correo!],
        asunto: `Confirma la visita de ${visita.nombre_completo} (${visita.empresa})`,
        html: plantilla({
          titulo: "Solicitud de aprobación de visita", logo,
          cuerpo: `<p style="margin:0 0 12px;font-size:16px">Hola ${escapar(anfitrion!.nombre.split(" ")[0])}, <b>${escapar(visita.nombre_completo)}</b> registró una visita contigo.</p>
            ${restringido ? `<p style="margin:0 0 12px;padding:10px 12px;background:#FBEAE8;border-radius:8px"><b>Visitante con acceso restringido.</b> Solo podrá entrar si apruebas la visita.</p>` : ""}
            ${tablaVisita}
            <p style="margin:18px 0 8px">¿Confirmas la visita?</p>
            <p style="margin:0">${botonCorreo(enlace("aprobar"), "Aprobar visita")}${botonCorreo(enlace("rechazar"), "Rechazar", "#C0392B")}</p>
            <p style="margin:16px 0 0;font-size:13px;color:#5B6B7F">Sin tu aprobación, Recepción no registrará la entrada. El enlace es personal y de un solo uso.</p>`,
        }),
      });
    } catch (e) {
      console.error("solicitud al anfitrión", e);
    }
  }

  return json({
    ok: true, folio: visita.folio, entrada: visita.entrada, salida: visita.salida, qr: qrDataUrl,
    correo_enviado: correoEnviado, estado_aprobacion: "pendiente", aprueba: apruebaAnfitrion ? "anfitrion" : "recepcion",
  }, 201);
});
