// =====================================================================
// Edge Function: reenviar-pase (permiso consultas o recepcion)
// Vuelve a enviar el pase (QR + invitación .ics) al correo del visitante.
// Respeta el modo auditoría y el alcance de fechas del rol.
// =====================================================================
import { json, leerJson, prepararPeticion } from "../_shared/http.ts";
import { clienteServicio } from "../_shared/supabase.ts";
import { filtroAuditoria, rangoDelAlcance, tienePermiso, usuarioActivo } from "../_shared/auth.ts";
import { enviarPase, invitarCalendario } from "../_shared/pase.ts";
import { diaCDMX } from "../_shared/estadisticas.js";

Deno.serve(async (req) => {
  const previo = prepararPeticion(req);
  if (previo) return previo;
  const db = clienteServicio();
  const yo = await usuarioActivo(req, db);
  if (!yo) return json({ error: "Inicia sesión para continuar." }, 401);
  if (!tienePermiso(yo, "consultas") && !tienePermiso(yo, "recepcion")) return json({ error: "Tu rol no puede reenviar pases." }, 403);

  const p = await leerJson<{ folio?: string; accion?: string }>(req);

  // Sincronizar calendario: invitación de todas las visitas próximas (máx. 40 por llamada)
  if (p?.accion === "sincronizar_calendario") {
    if (!tienePermiso(yo, "config_correos")) return json({ error: "Tu rol no puede sincronizar el calendario." }, 403);
    const solo = await filtroAuditoria(db);
    let q = db.from("visitantes").select("id, folio, nombre, nombre_completo, correo, empresa, persona_visita, motivo, entrada, salida, empresas(nombre)")
      .gt("salida", new Date().toISOString()).neq("estado_aprobacion", "rechazada").is("salida_real_at", null).order("entrada").limit(40);
    if (solo) q = q.eq("empresa_visita_id", solo);
    const { data } = await q;
    let enviadas = 0;
    // deno-lint-ignore no-explicit-any
    for (const v of (data ?? []) as any[]) {
      if (await invitarCalendario(db, v, v.empresas?.nombre ?? "HIXSA")) enviadas++;
      await new Promise((r) => setTimeout(r, 600)); // límite de envío de Resend
    }
    return json({ ok: true, visitas: data?.length ?? 0, enviadas });
  }

  const folio = String(p?.folio ?? "").trim().toUpperCase();
  const { data: v } = await db.from("visitantes")
    .select("id, folio, nombre, nombre_completo, correo, empresa, persona_visita, motivo, entrada, salida, salida_real_at, estado_aprobacion, empresa_visita_id, empresas(nombre)")
    .eq("folio", folio).maybeSingle();
  const solo = await filtroAuditoria(db);
  const rango = rangoDelAlcance(yo);
  // deno-lint-ignore no-explicit-any
  const visita = v as any;
  if (!visita || (solo && visita.empresa_visita_id !== solo) ||
      (rango && (diaCDMX(visita.entrada) < rango.desde || diaCDMX(visita.entrada) > rango.hasta))) {
    return json({ error: `No existe una visita con el folio ${folio} en tu alcance.` }, 404);
  }
  if (visita.estado_aprobacion === "rechazada") return json({ error: "La visita fue rechazada por el anfitrión; no se reenvía el pase." }, 409);
  if (visita.salida_real_at || new Date(visita.salida).getTime() < Date.now()) return json({ error: "La visita ya concluyó o venció; pide un nuevo registro." }, 409);

  const r = await enviarPase(db, visita, { empresaVisita: visita.empresas?.nombre ?? "HIXSA", aprueba: null, reenvio: true });
  if (!r.correoEnviado) return json({ error: "No se pudo enviar el correo. Revisa la columna de error en la visita o la configuración de Resend." }, 502);
  return json({ ok: true, correo: visita.correo });
});
