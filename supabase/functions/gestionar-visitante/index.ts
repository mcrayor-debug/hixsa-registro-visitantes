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
import { enviarCorreo, escapar, logoCorreo, plantilla } from "../_shared/correo.ts";

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

  const p = await leerJson<{ accion?: string; persona_id?: string; estado?: string; motivo?: string }>(req);
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
