// =====================================================================
// Edge Function: depurar-informacion (permiso config_visitantes; "completa" solo SUPERADMIN)
// Anonimiza visitas PASADAS (conserva las estadísticas): quita datos personales y fotos.
//   modo: "365" (más de un año) | "rango" (desde/hasta) | "tipo" (todas las fechas) | "completa"
//   tipo_visitante: todos | recurrentes | no_recurrentes | glide | bloqueados | restringidos
//   motivo: tipo de visita (opcional)
//   accion: "previa" (cuenta) | "respaldo" (CSV) | "depurar" (requiere confirmacion "DEPURAR")
// Nunca toca visitas próximas o en curso. Bloqueados y restringidos solo si se eligen
// explícitamente, y su perfil se conserva para que el bloqueo siga activo.
// Una foto se borra solo si ninguna visita restante ni perfil la usa.
// =====================================================================
import { json, leerJson, prepararPeticion } from "../_shared/http.ts";
import { clienteServicio } from "../_shared/supabase.ts";
import { esSuperadmin, registrarCambio, tienePermiso, usuarioActivo } from "../_shared/auth.ts";
import { hoyCDMX, sumarDias } from "../_shared/estadisticas.js";

const MOTIVOS = ["Reunión", "Entrevista", "Proveedor o servicio", "Entrega o paquetería", "Otro"];
const TIPOS = ["todos", "recurrentes", "no_recurrentes", "glide", "bloqueados", "restringidos"];
const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;
const LOTE = 1000;
const ANONIMO = "Visitante eliminado";

// deno-lint-ignore no-explicit-any
type Db = any;

Deno.serve(async (req) => {
  const previo = prepararPeticion(req);
  if (previo) return previo;
  const db: Db = clienteServicio();
  const yo = await usuarioActivo(req, db);
  if (!yo) return json({ error: "Inicia sesión para continuar." }, 401);
  if (!tienePermiso(yo, "config_visitantes")) return json({ error: "Tu rol no puede depurar información." }, 403);

  const p = await leerJson<Record<string, string | undefined>>(req);
  const modo = String(p?.modo ?? "");
  const tipo = TIPOS.includes(String(p?.tipo_visitante)) ? String(p!.tipo_visitante) : "todos";
  const motivo = MOTIVOS.includes(String(p?.motivo)) ? String(p!.motivo) : null;
  const accion = String(p?.accion ?? "previa");
  if (!["365", "rango", "tipo", "completa"].includes(modo)) return json({ error: "Elige el modo de depuración." }, 422);
  if (modo === "completa" && !esSuperadmin(yo)) return json({ error: "Solo un SUPERADMIN puede hacer la depuración completa." }, 403);
  if (modo === "rango" && (!FECHA_RE.test(String(p?.desde)) || !FECHA_RE.test(String(p?.hasta)) || p!.desde! > p!.hasta!)) {
    return json({ error: "Elige un rango de fechas válido." }, 422);
  }

  // ---------- Selección: visitas pasadas, no anonimizadas, según filtros ----------
  const ahora = new Date().toISOString();
  let q = db.from("visitantes")
    .select("id, folio, nombre_completo, empresa, correo, telefono, motivo, entrada, salida, llegada_at, salida_real_at, origen, persona_id, identificacion_path, selfie_path, personas(id, recurrente, estado_bloqueo)")
    .lt("salida", ahora).neq("nombre_completo", ANONIMO).order("entrada").limit(5000);
  if (modo === "365") q = q.lt("entrada", `${sumarDias(hoyCDMX(), -365)}T00:00:00-06:00`);
  if (modo === "rango") q = q.gte("entrada", `${p!.desde}T00:00:00-06:00`).lte("entrada", `${p!.hasta}T23:59:59.999-06:00`);
  if (motivo) q = q.eq("motivo", motivo);
  if (tipo === "glide") q = q.eq("origen", "glide");
  const { data, error } = await q;
  if (error) return json({ error: "No se pudieron consultar las visitas." }, 500);
  // deno-lint-ignore no-explicit-any
  const todas = (data ?? []) as any[];
  const bloqueo = (v: { personas?: { estado_bloqueo?: string } | null }) => v.personas?.estado_bloqueo ?? "ninguno";
  const seleccion = todas.filter((v) => {
    if (tipo === "bloqueados") return bloqueo(v) === "bloqueado";
    if (tipo === "restringidos") return bloqueo(v) === "restringido";
    if (bloqueo(v) === "bloqueado" || bloqueo(v) === "restringido") return false; // solo si se eligen
    if (tipo === "recurrentes") return v.personas?.recurrente === true;
    if (tipo === "no_recurrentes") return !v.personas?.recurrente;
    return true;
  });
  const excluidasBloqueo = tipo === "bloqueados" || tipo === "restringidos" ? 0 : todas.length - seleccion.length;
  const fotos = [...new Set(seleccion.flatMap((v) => [v.identificacion_path, v.selfie_path]).filter(Boolean))] as string[];
  const personas = [...new Set(seleccion.map((v) => v.persona_id).filter(Boolean))] as string[];

  if (accion === "previa") {
    return json({ ok: true, visitas: seleccion.length, visitantes: new Set(seleccion.map((v) => v.persona_id ?? v.correo)).size,
      fotos: fotos.length, excluidas_bloqueo: excluidasBloqueo, hay_mas: todas.length === 5000 });
  }

  if (accion === "respaldo") {
    const cols: [string, string][] = [["folio", "Folio"], ["nombre_completo", "Nombre"], ["empresa", "Empresa de origen"], ["correo", "Correo"],
      ["telefono", "Teléfono"], ["motivo", "Motivo"], ["entrada", "Entrada"], ["salida", "Salida"], ["llegada_at", "Llegada real"],
      ["salida_real_at", "Salida real"], ["origen", "Origen"]];
    const celda = (x: unknown) => { const s = String(x ?? ""); return `"${(/^[=+\-@]/.test(s) ? `'${s}` : s).replace(/"/g, '""')}"`; };
    const csv = "\uFEFF" + [cols.map(([, t]) => celda(t)).join(","), ...seleccion.map((v) => cols.map(([k]) => celda(v[k])).join(","))].join("\r\n");
    return json({ ok: true, csv, visitas: seleccion.length });
  }

  if (accion !== "depurar") return json({ error: "Acción desconocida." }, 400);
  if (p?.confirmacion !== "DEPURAR") return json({ error: "Escribe DEPURAR para confirmar." }, 422);

  const lote = seleccion.slice(0, LOTE);
  const ids = lote.map((v) => v.id);
  // 1) Anonimizar visitas (conservan fechas, empresas, motivo, anfitrión y estado: las estadísticas no cambian)
  for (let i = 0; i < ids.length; i += 200) {
    const parte = lote.slice(i, i + 200);
    for (const v of parte) {
      const { error: e } = await db.from("visitantes").update({
        nombre_completo: ANONIMO, nombre: "Visitante", apellidos: "eliminado", correo: `eliminado-${v.id.slice(0, 8)}@anonimo.invalid`,
        telefono: "0000000000", comentarios: null, identificacion_path: null, selfie_path: null, identificacion_detalle: null,
        equipo_marca: null, equipo_serie: null, autorizacion_motivo: null, persona_id: null,
      }).eq("id", v.id);
      if (e) console.error("anonimizar", v.id, e);
    }
  }
  // 2) Fotos: borrar solo las que ya no usa ninguna visita restante ni perfil
  const fotosLote = [...new Set(lote.flatMap((v) => [v.identificacion_path, v.selfie_path]).filter(Boolean))] as string[];
  const enUso = new Set<string>();
  for (let i = 0; i < fotosLote.length; i += 100) {
    const parte = fotosLote.slice(i, i + 100);
    for (const col of ["identificacion_path", "selfie_path"]) {
      const { data: v } = await db.from("visitantes").select(col).in(col, parte);
      (v ?? []).forEach((x: Record<string, string>) => enUso.add(x[col]));
      const { data: pe } = await db.from("personas").select(col).in(col, parte);
      (pe ?? []).forEach((x: Record<string, string>) => enUso.add(x[col]));
    }
  }
  // Perfiles que se borrarán (abajo): sus fotos dejan de estar en uso
  const personasLote = [...new Set(lote.map((v) => v.persona_id).filter(Boolean))] as string[];
  const borrables: string[] = [];
  for (const pid of personasLote) {
    const { data: per } = await db.from("personas").select("id, correo, estado_bloqueo, identificacion_path, selfie_path").eq("id", pid).maybeSingle();
    if (!per || per.estado_bloqueo !== "ninguno") continue; // bloqueados y restringidos conservan su perfil
    const { count } = await db.from("visitantes").select("id", { count: "exact", head: true }).eq("persona_id", pid);
    if ((count ?? 0) > 0) continue; // aún tiene visitas sin depurar (o próximas)
    borrables.push(pid);
    for (const f of [per.identificacion_path, per.selfie_path]) if (f) enUso.delete(f);
    await db.from("verificaciones").delete().eq("correo", per.correo);
  }
  // Fotos de bloqueados/restringidos: se borran también del perfil (se anonimiza su historial fotográfico)
  if (tipo === "bloqueados" || tipo === "restringidos") {
    const conservados = personasLote.filter((x) => !borrables.includes(x));
    if (conservados.length) {
      const { data: pf } = await db.from("personas").select("identificacion_path, selfie_path").in("id", conservados);
      (pf ?? []).forEach((x: Record<string, string>) => { if (x.identificacion_path) enUso.delete(x.identificacion_path); if (x.selfie_path) enUso.delete(x.selfie_path); });
      await db.from("personas").update({ identificacion_path: null, selfie_path: null, telefono: null }).in("id", conservados);
    }
  }
  const aBorrar = fotosLote.filter((f) => !enUso.has(f));
  let fotosBorradas = 0;
  for (let i = 0; i < aBorrar.length; i += 100) {
    const { data: q2 } = await db.storage.from("identificaciones").remove(aBorrar.slice(i, i + 100));
    fotosBorradas += q2?.length ?? 0;
  }
  if (borrables.length) await db.from("personas").delete().in("id", borrables);

  await registrarCambio(db, yo, "visitantes", "depuracion", `depuracion:${lote.length}`, null,
    { modo, tipo_visitante: tipo, motivo, desde: p?.desde ?? null, hasta: p?.hasta ?? null, visitas: lote.length, perfiles_borrados: borrables.length, fotos_borradas: fotosBorradas });
  return json({ ok: true, visitas: lote.length, perfiles_borrados: borrables.length, fotos_borradas: fotosBorradas, restantes: Math.max(0, seleccion.length - lote.length) });
});
