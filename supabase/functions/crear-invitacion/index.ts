// =====================================================================
// Edge Function: crear-invitacion (permiso recepcion o config_visitantes)
// El personal invita a un visitante que ya tiene perfil: elige empresa, anfitrión
// y horario; se reutilizan sus datos y fotos. La invitación queda APROBADA
// (la crea el personal) y se avisa al anfitrión. Visitante restringido: requiere
// aprobación del anfitrión. Bloqueado: no se permite.
// =====================================================================
import { json, leerJson, prepararPeticion } from "../_shared/http.ts";
import { clienteServicio } from "../_shared/supabase.ts";
import { filtroAuditoria, tienePermiso, usuarioActivo } from "../_shared/auth.ts";
import { botonCorreo, enviarCorreo, escapar, logoCorreo, plantilla } from "../_shared/correo.ts";
import { formatoFecha, formatoHora } from "../_shared/formato.ts";
import { enviarPase } from "../_shared/pase.ts";
import { sha256Hex, tokenAleatorio } from "../_shared/tokens.ts";

const MOTIVOS = ["Reunión", "Entrevista", "Proveedor o servicio", "Entrega o paquetería", "Otro"];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HORA = 3600000;

Deno.serve(async (req) => {
  const previo = prepararPeticion(req);
  if (previo) return previo;
  const db = clienteServicio();
  const yo = await usuarioActivo(req, db);
  if (!yo) return json({ error: "Inicia sesión para continuar." }, 401);
  if (!tienePermiso(yo, "recepcion") && !tienePermiso(yo, "config_visitantes")) return json({ error: "Tu rol no puede crear invitaciones." }, 403);

  const p = await leerJson<Record<string, string | null | undefined>>(req);
  const txt = (v: unknown, max = 200) => String(v ?? "").trim().replace(/\s+/g, " ").slice(0, max);
  const { data: per } = await db.from("personas").select("*").eq("id", txt(p?.persona_id, 40)).maybeSingle();
  if (!per) return json({ error: "El visitante no existe." }, 404);
  if (per.estado_bloqueo === "bloqueado") return json({ error: "El visitante está bloqueado; no se puede invitar." }, 409);

  const motivo = txt(p?.motivo), comentarios = txt(p?.comentarios, 500) || null;
  const empresaId = txt(p?.empresa_visita_id, 40), anfitrionId = txt(p?.anfitrion_id, 40);
  const entrada = new Date(String(p?.entrada ?? "")), salida = new Date(String(p?.salida ?? ""));
  if (!MOTIVOS.includes(motivo)) return json({ error: "Elige un motivo válido." }, 422);
  if (!UUID_RE.test(empresaId)) return json({ error: "Elige la empresa a visitar." }, 422);
  if (isNaN(entrada.getTime()) || isNaN(salida.getTime())) return json({ error: "Elige la fecha y hora de entrada y salida." }, 422);
  if (entrada.getTime() < Date.now() - 2 * HORA) return json({ error: "La entrada no puede ser en el pasado." }, 422);
  if (entrada.getTime() > Date.now() + 90 * 24 * HORA) return json({ error: "Solo se aceptan visitas en los próximos 90 días." }, 422);
  if (salida <= entrada || salida.getTime() - entrada.getTime() > 7 * 24 * HORA) return json({ error: "La salida debe ser después de la entrada (máximo 7 días)." }, 422);

  const { data: empresa } = await db.from("empresas").select("id, nombre, activa").eq("id", empresaId).maybeSingle();
  const solo = await filtroAuditoria(db);
  if (!empresa || !empresa.activa || (solo && empresa.id !== solo)) return json({ error: "Elige una empresa válida." }, 422);

  let anfitrion: { nombre: string; area: string | null; correo: string | null } | null = null;
  let personaVisita = txt(p?.persona_visita, 120);
  if (anfitrionId) {
    const { data: anf } = await db.from("anfitriones").select("nombre, area, correo").eq("id", anfitrionId).maybeSingle();
    const { data: pertenece } = await db.from("anfitrion_empresas").select("anfitrion_id").eq("anfitrion_id", anfitrionId).eq("empresa_id", empresa.id).maybeSingle();
    if (!anf || !pertenece) return json({ error: "Elige un anfitrión de esa empresa." }, 422);
    anfitrion = anf;
    personaVisita = anf.area ? `${anf.nombre} (${anf.area})` : anf.nombre;
  }
  if (personaVisita.length < 3) return json({ error: "Elige o escribe a quién visita." }, 422);

  // Aprobación: la crea el personal → aprobada; restringido → la aprueba el anfitrión
  const sitio = (Deno.env.get("PUBLIC_SITE_URL") ?? "").replace(/\/$/, "");
  const restringido = per.estado_bloqueo === "restringido";
  const pideAnfitrion = restringido && Boolean(anfitrion?.correo && sitio);
  const token = pideAnfitrion ? tokenAleatorio() : null;
  const ahora = new Date().toISOString();
  const nombre = per.nombre || per.correo.split("@")[0];
  const apellidos = per.apellidos || "(sin apellidos)";
  const tel = String(per.telefono ?? "").replace(/[^\d+]/g, "");

  const { data: visita, error } = await db.from("visitantes").insert({
    nombre_completo: `${nombre} ${apellidos}`.slice(0, 120), nombre, apellidos, empresa: per.empresa || "Sin empresa", correo: per.correo,
    telefono: /^\+?[0-9]{10,15}$/.test(tel) ? tel : "0000000000",
    empresa_visita_id: empresa.id, anfitrion_id: anfitrionId || null, persona_visita: personaVisita, motivo, comentarios,
    acepta_aviso: true, entrada: entrada.toISOString(), salida: salida.toISOString(),
    tipo_identificacion: per.tipo_identificacion, identificacion_detalle: per.identificacion_detalle,
    identificacion_path: per.identificacion_path, selfie_path: per.selfie_path,
    equipo_tipo: per.equipo_tipo, equipo_marca: per.equipo_marca, equipo_serie: per.equipo_serie,
    persona_id: per.id, creado_por: yo.id,
    ...(restringido
      ? { estado_aprobacion: "pendiente", aprobacion_token_hash: token ? await sha256Hex(token) : null }
      : { estado_aprobacion: "aprobada", aprobacion_por: "recepcion", aprobacion_usuario: yo.id, aprobacion_at: ahora }),
  }).select("id, folio, nombre, nombre_completo, correo, empresa, persona_visita, motivo, entrada, salida").single();
  if (error || !visita) {
    console.error("invitación", error);
    return json({ error: "No se pudo crear la invitación." }, 500);
  }

  const r = await enviarPase(db, visita, { empresaVisita: empresa.nombre, aprueba: restringido ? (pideAnfitrion ? "anfitrion" : "recepcion") : null });

  // Aviso al anfitrión (o solicitud de aprobación si el visitante está restringido)
  if (anfitrion?.correo) {
    const cuando = `${formatoFecha(visita.entrada)}, ${formatoHora(visita.entrada)} a ${formatoHora(visita.salida)} h`;
    try {
      await enviarCorreo({
        para: [anfitrion.correo],
        asunto: pideAnfitrion ? `Confirma la visita de ${visita.nombre_completo}` : `Visita programada: ${visita.nombre_completo} (${visita.empresa})`,
        html: plantilla({
          titulo: pideAnfitrion ? "Solicitud de aprobación de visita" : "Visita programada por el personal", logo: await logoCorreo(db),
          cuerpo: `<p style="margin:0 0 12px">Hola ${escapar(anfitrion.nombre.split(" ")[0])}, ${escapar(yo.nombre)} programó una visita de <b>${escapar(visita.nombre_completo)}</b> (${escapar(visita.empresa)}) contigo.</p>
            <p style="margin:0 0 12px"><b>${escapar(cuando)}</b> · ${escapar(empresa.nombre)} · ${escapar(motivo)} · folio ${escapar(visita.folio)}</p>
            ${pideAnfitrion
              ? `<p style="margin:0 0 12px;padding:10px 12px;background:#FBEAE8;border-radius:8px"><b>Visitante con acceso restringido.</b> Solo podrá entrar si apruebas la visita.</p>
                 <p style="margin:0">${botonCorreo(`${sitio}/aprobar.html?t=${token}&a=aprobar`, "Aprobar visita")}${botonCorreo(`${sitio}/aprobar.html?t=${token}&a=rechazar`, "Rechazar", "#C0392B")}</p>`
              : `<p style="margin:0;color:#5B6B7F">La visita ya está aprobada; no necesitas hacer nada.</p>`}`,
        }),
      });
    } catch (e) {
      console.error("aviso al anfitrión", e);
    }
  }
  return json({ ok: true, folio: visita.folio, correo_enviado: r.correoEnviado, estado: restringido ? "pendiente" : "aprobada" }, 201);
});
