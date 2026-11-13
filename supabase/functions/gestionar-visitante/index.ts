// =====================================================================
// Edge Function: gestionar-visitante (permiso config_visitantes)
// Cambia el estado de bloqueo de un visitante y avisa por correo a los
// SUPERADMIN y a los anfitriones de sus visitas próximas y de la última.
// Estados: ninguno | no_deseado (alerta en recepción) | restringido (requiere
// aprobación del anfitrión) | bloqueado (no puede registrarse ni entrar).
// =====================================================================
import { json, leerJson, prepararPeticion } from "../_shared/http.ts";
import { clienteServicio } from "../_shared/supabase.ts";
import { registrarCambio, tienePermiso, usuarioActivo } from "../_shared/auth.ts";
import { EMAIL_RE, enviarCorreo, escapar, logoCorreo, plantilla } from "../_shared/correo.ts";
import { leerFoto, subirFoto } from "../_shared/fotos.ts";
import { enviarPase } from "../_shared/pase.ts";
import type { Perfil } from "../_shared/auth.ts";

const ESTADOS: Record<string, string> = {
  ninguno: "Sin restricción", no_deseado: "No deseado", restringido: "Restringido", bloqueado: "Bloqueado",
};
const EXPLICACION: Record<string, string> = {
  ninguno: "Puede registrarse y entrar normalmente.",
  no_deseado: "Puede registrarse, pero Recepción verá una alerta al recibirlo.",
  restringido: "Puede registrarse, pero cada visita requiere la aprobación del anfitrión.",
  bloqueado: "No puede registrar visitas ni entrar a las oficinas.",
};

Deno.serve(async (req) => {
  const previo = prepararPeticion(req);
  if (previo) return previo;
  const db = clienteServicio();
  const yo = await usuarioActivo(req, db);
  if (!yo) return json({ error: "Inicia sesión para continuar." }, 401);
  if (!tienePermiso(yo, "config_visitantes")) return json({ error: "Tu rol no tiene permiso para gestionar visitantes." }, 403);

  const p = await leerJson<Record<string, string | null | undefined>>(req);
  if (p?.accion === "editar") return await editar(db, yo, p);
  if (p?.accion !== "bloqueo") return json({ error: "Acción desconocida." }, 400);
  const estado = String(p.estado ?? "");
  const motivo = String(p.motivo ?? "").trim();
  if (!ESTADOS[estado]) return json({ error: "Estado inválido." }, 422);
  if (estado !== "ninguno" && motivo.length < 5) return json({ error: "Escribe el motivo (mínimo 5 caracteres)." }, 422);
  if (motivo.length > 300) return json({ error: "El motivo admite hasta 300 caracteres." }, 422);

  const { data: per } = await db.from("personas").select("*").eq("id", p.persona_id ?? "").maybeSingle();
  if (!per) return json({ error: "El visitante no existe." }, 404);
  if (per.estado_bloqueo === estado) return json({ ok: true, notificados: 0 });

  const cambios = {
    estado_bloqueo: estado,
    bloqueo_motivo: estado === "ninguno" ? null : motivo,
    bloqueado_por: estado === "ninguno" ? null : yo.id,
    bloqueado_at: estado === "ninguno" ? null : new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  const { error } = await db.from("personas").update(cambios).eq("id", per.id);
  if (error) return json({ error: "No se pudo actualizar al visitante." }, 500);
  await registrarCambio(db, yo, "personas", "edicion", per.id,
    { estado_bloqueo: per.estado_bloqueo, bloqueo_motivo: per.bloqueo_motivo, correo: per.correo, nombre: per.nombre },
    { ...cambios, correo: per.correo, nombre: per.nombre });

  // Destinatarios: SUPERADMIN activos + anfitriones de visitas próximas y de la última visita
  const { data: supers } = await db.from("perfiles").select("email").eq("rol", "superadmin").eq("activo", true);
  const { data: visitas } = await db.from("visitantes").select("salida, anfitriones(correo)")
    .eq("persona_id", per.id).order("entrada", { ascending: false }).limit(20);
  const ahora = Date.now();
  const anfitriones = (visitas ?? [])
    .filter((v, i) => i === 0 || new Date(v.salida).getTime() > ahora)
    .map((v) => (v.anfitriones as { correo?: string } | null)?.correo).filter(Boolean) as string[];
  const para = [...new Set([...(supers ?? []).map((s) => s.email), ...anfitriones].map((c) => c.toLowerCase()))].slice(0, 40);

  let notificados = 0;
  if (para.length) {
    try {
      const nombre = `${per.nombre ?? ""} ${per.apellidos ?? ""}`.trim() || per.correo;
      await enviarCorreo({
        para,
        asunto: `Visitante ${ESTADOS[estado].toLowerCase()}: ${nombre}`,
        html: plantilla({
          titulo: "Aviso de seguridad", logo: await logoCorreo(db),
          cuerpo: `<p style="margin:0 0 12px"><b>${escapar(nombre)}</b> (${escapar(per.correo)}${per.empresa ? `, ${escapar(per.empresa)}` : ""}) ahora está como <b>${ESTADOS[estado]}</b>.</p>
            <p style="margin:0 0 12px">${EXPLICACION[estado]}</p>
            ${motivo ? `<p style="margin:0 0 12px;padding:10px 12px;background:#FFF6DB;border-radius:8px"><b>Motivo:</b> ${escapar(motivo)}</p>` : ""}
            <p style="margin:0;color:#5B6B7F">Cambio realizado por ${escapar(yo.nombre)}.</p>`,
        }),
      });
      notificados = para.length;
    } catch (e) {
      console.error("aviso de bloqueo", e);
    }
  }
  return json({ ok: true, notificados });
});

// ---------------------------------------------------------------------
// Editar datos del visitante: perfil + visitas futuras (el historial no cambia).
// Si cambia el correo, se reenvían los pases de las visitas futuras (el QR incluye el correo).
// ---------------------------------------------------------------------
// deno-lint-ignore no-explicit-any
async function editar(db: any, yo: Perfil, p: Record<string, string | null | undefined>) {
  const txt = (v: unknown, max: number) => String(v ?? "").trim().replace(/\s+/g, " ").slice(0, max);
  const { data: per } = await db.from("personas").select("*").eq("id", p.persona_id ?? "").maybeSingle();
  if (!per) return json({ error: "El visitante no existe." }, 404);

  const nombre = txt(p.nombre, 60), apellidos = txt(p.apellidos, 80), empresa = txt(p.empresa, 120);
  const correo = txt(p.correo, 254).toLowerCase();
  const tel = txt(p.telefono, 30);
  const telefono = (tel.startsWith("+") ? "+" : "") + tel.replace(/\D/g, "");
  if (nombre.length < 1) return json({ error: "Escribe el nombre." }, 422);
  if (apellidos.length < 2) return json({ error: "Escribe los apellidos." }, 422);
  if (empresa.length < 2) return json({ error: "Escribe la empresa de origen." }, 422);
  if (!EMAIL_RE.test(correo)) return json({ error: "Revisa el correo." }, 422);
  if (!/^\+?[0-9]{10,15}$/.test(telefono)) return json({ error: "El teléfono debe tener de 10 a 15 dígitos." }, 422);
  const cambiaCorreo = correo !== per.correo;
  if (cambiaCorreo) {
    const { data: otro } = await db.from("personas").select("id").eq("correo", correo).maybeSingle();
    if (otro) return json({ error: "Ya existe otro visitante con ese correo." }, 409);
  }
  const fotoId = leerFoto(p.foto_identificacion), selfie = leerFoto(p.selfie);
  if (typeof fotoId === "string") return json({ error: `Identificación: ${fotoId}` }, 422);
  if (typeof selfie === "string") return json({ error: `Selfie: ${selfie}` }, 422);

  const cambios: Record<string, unknown> = { nombre, apellidos, correo, telefono, empresa, updated_at: new Date().toISOString() };
  try {
    if (fotoId) cambios.identificacion_path = await subirFoto(db, fotoId, "");
    if (selfie) cambios.selfie_path = await subirFoto(db, selfie, "selfies/");
  } catch {
    return json({ error: "No se pudieron guardar las fotos." }, 500);
  }
  const { error } = await db.from("personas").update(cambios).eq("id", per.id);
  if (error) return json({ error: "No se pudo actualizar el visitante." }, 500);

  // Visitas futuras (sin salida registrada y con horario por terminar)
  const enVisita: Record<string, unknown> = { nombre, apellidos, nombre_completo: `${nombre} ${apellidos}`.slice(0, 120), correo, telefono, empresa };
  if (cambios.identificacion_path) enVisita.identificacion_path = cambios.identificacion_path;
  if (cambios.selfie_path) enVisita.selfie_path = cambios.selfie_path;
  const { data: futuras } = await db.from("visitantes").update(enVisita)
    .eq("persona_id", per.id).gt("salida", new Date().toISOString()).is("salida_real_at", null)
    .select("id, folio, nombre, nombre_completo, correo, empresa, persona_visita, motivo, entrada, salida, estado_aprobacion, empresas(nombre)");

  let reenviados = 0;
  if (cambiaCorreo) {
    for (const v of (futuras ?? []).filter((x: { estado_aprobacion: string }) => x.estado_aprobacion !== "rechazada").slice(0, 10)) {
      const r = await enviarPase(db, v, { empresaVisita: v.empresas?.nombre ?? "HIXSA", aprueba: null, reenvio: true });
      if (r.correoEnviado) reenviados++;
    }
  }
  const { identificacion_path: _a, selfie_path: _b, ...antes } = per;
  await registrarCambio(db, yo, "personas", "edicion", per.id, antes, { ...antes, ...cambios });
  return json({ ok: true, visitas_actualizadas: futuras?.length ?? 0, pases_reenviados: reenviados });
}
