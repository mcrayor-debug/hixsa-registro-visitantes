// =====================================================================
// Edge Function: borrar-perfiles (solo SUPERADMIN)
// Borra perfiles de visitantes según filtros. Conserva las visitas para las
// estadísticas, pero ANONIMIZA sus datos personales y borra sus fotos.
// Nunca borra: visitantes con visitas próximas o con bloqueo vigente.
//   confirmar: false → vista previa (cuántos y una muestra)
//   confirmar: true + confirmacion "BORRAR" → borra
// =====================================================================
import { json, leerJson, prepararPeticion } from "../_shared/http.ts";
import { clienteServicio } from "../_shared/supabase.ts";
import { esSuperadmin, registrarCambio, usuarioActivo } from "../_shared/auth.ts";

interface Filtros { tipo?: "recurrentes" | "no_recurrentes" | "todos"; sin_visitas_desde?: string; empresa?: string }
const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;

Deno.serve(async (req) => {
  const previo = prepararPeticion(req);
  if (previo) return previo;
  const db = clienteServicio();
  const yo = await usuarioActivo(req, db);
  if (!yo) return json({ error: "Inicia sesión para continuar." }, 401);
  if (!esSuperadmin(yo)) return json({ error: "Solo un SUPERADMIN puede borrar perfiles de visitantes." }, 403);

  const p = await leerJson<{ filtros?: Filtros; confirmar?: boolean; confirmacion?: string }>(req);
  const f = p?.filtros ?? {};
  if (f.sin_visitas_desde && !FECHA_RE.test(f.sin_visitas_desde)) return json({ error: "Fecha inválida." }, 422);

  let q = db.from("personas").select("id, correo, nombre, apellidos, empresa, recurrente, estado_bloqueo, ultima_visita_at, identificacion_path, selfie_path").limit(1000);
  if (f.tipo === "recurrentes") q = q.eq("recurrente", true);
  if (f.tipo === "no_recurrentes") q = q.eq("recurrente", false);
  if (f.sin_visitas_desde) q = q.or(`ultima_visita_at.is.null,ultima_visita_at.lt.${f.sin_visitas_desde}T00:00:00-06:00`);
  const emp = String(f.empresa ?? "").replace(/[,()*%\\]/g, " ").trim();
  if (emp) q = q.ilike("empresa", `%${emp}%`);
  const { data: candidatos, error } = await q;
  if (error) return json({ error: "No se pudo consultar los perfiles." }, 500);

  const lista = candidatos ?? [];
  const bloqueados = lista.filter((x) => x.estado_bloqueo !== "ninguno");
  let elegibles = lista.filter((x) => x.estado_bloqueo === "ninguno");
  const conProximas = new Set<string>();
  if (elegibles.length) {
    const { data: prox } = await db.from("visitantes").select("persona_id").in("persona_id", elegibles.map((x) => x.id)).gt("salida", new Date().toISOString());
    (prox ?? []).forEach((x) => conProximas.add(x.persona_id));
  }
  elegibles = elegibles.filter((x) => !conProximas.has(x.id));

  if (!p?.confirmar) {
    return json({
      ok: true, total: elegibles.length, excluidos_bloqueo: bloqueados.length, excluidos_proximas: conProximas.size,
      muestra: elegibles.slice(0, 10).map((x) => ({ nombre: `${x.nombre ?? ""} ${x.apellidos ?? ""}`.trim(), empresa: x.empresa, ultima_visita: x.ultima_visita_at, recurrente: x.recurrente })),
    });
  }
  if (p.confirmacion !== "BORRAR") return json({ error: "Escribe BORRAR para confirmar." }, 422);

  let borrados = 0, fotos = 0;
  for (const per of elegibles) {
    const { data: visitas } = await db.from("visitantes").select("identificacion_path, selfie_path").eq("persona_id", per.id);
    const rutas = [...new Set([per.identificacion_path, per.selfie_path, ...(visitas ?? []).flatMap((v) => [v.identificacion_path, v.selfie_path])].filter(Boolean))] as string[];
    for (let i = 0; i < rutas.length; i += 100) {
      const { data: quitadas } = await db.storage.from("identificaciones").remove(rutas.slice(i, i + 100));
      fotos += quitadas?.length ?? 0;
    }
    const anon = `eliminado-${per.id.slice(0, 8)}@anonimo.invalid`;
    const { error: errV } = await db.from("visitantes").update({
      nombre_completo: "Visitante eliminado", nombre: "Visitante", apellidos: "eliminado", correo: anon, telefono: "0000000000",
      comentarios: null, identificacion_path: null, selfie_path: null, equipo_marca: null, equipo_serie: null, persona_id: null,
    }).eq("persona_id", per.id);
    if (errV) { console.error("anonimizar", errV); continue; }
    await db.from("verificaciones").delete().eq("correo", per.correo);
    const { error: errP } = await db.from("personas").delete().eq("id", per.id);
    if (!errP) borrados++;
  }
  await registrarCambio(db, yo, "personas", "baja", `borrado:${borrados}`, { filtros: f }, { borrados, fotos_borradas: fotos });
  return json({ ok: true, borrados, fotos_borradas: fotos, excluidos_bloqueo: bloqueados.length, excluidos_proximas: conProximas.size });
});
