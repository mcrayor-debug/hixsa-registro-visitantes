// =====================================================================
// Edge Function: respaldos (solo SUPERADMIN; los automáticos los llama pg_cron)
//   generar   { tipo: manual|semanal|mensual, incluir_fotos?, contrasena? } → archivo en el bucket privado "respaldos"
//   listar    → respaldos guardados y espacio usado
//   descargar { id } → enlace firmado de 10 min
//   eliminar  { id }
//   importar  { tabla, filas, simular } → agrega SOLO lo que falte (nunca borra ni sobrescribe)
//   importar_archivos { archivos: [{ ruta, b64 }], simular }
//   registrar_restauracion { resumen }
// Formato: JSON comprimido (gzip). Con contraseña: "HIXBAK1" + sal(16) + iv(12) + AES-GCM (PBKDF2-SHA256, 210 000 iteraciones).
// =====================================================================
import { json, leerJson, prepararPeticion } from "../_shared/http.ts";
import { clienteServicio } from "../_shared/supabase.ts";
import { esSuperadmin, registrarCambio, usuarioActivo } from "../_shared/auth.ts";
import { notificar } from "../_shared/notificaciones.ts";

// deno-lint-ignore no-explicit-any
type Fila = Record<string, any>;
// deno-lint-ignore no-explicit-any
type Db = any;

// Orden de respaldo y restauración (respeta las llaves foráneas)
const TABLAS: { t: string; pk?: string[]; identidad?: boolean; unicos?: string[][]; solo_respaldo?: boolean }[] = [
  { t: "roles", pk: ["id"] },
  { t: "empresas", pk: ["id"], unicos: [["nombre"]] },
  { t: "dias_festivos", pk: ["fecha"] },
  { t: "anfitriones", pk: ["id"] },
  { t: "anfitrion_empresas", pk: ["anfitrion_id", "empresa_id"] },
  { t: "personas", pk: ["id"], unicos: [["correo"], ["origen_id", "origen"]] },
  { t: "visitantes", pk: ["id"], unicos: [["folio"], ["origen_id", "origen"]] },
  { t: "intentos_acceso", identidad: true },
  { t: "bitacora_cambios", identidad: true },
  { t: "bitacora_reportes", identidad: true },
  { t: "configuracion", solo_respaldo: true },
  { t: "perfiles", solo_respaldo: true },
];
const COLUMNAS_USUARIO = ["usuario_id", "enviado_por", "updated_by", "bloqueado_por", "aprobacion_usuario", "autorizado_por",
  "cancelacion_usuario", "creado_por", "llegada_por", "salida_por"];
const BUCKETS_FOTOS = ["identificaciones", "anfitriones", "usuarios", "logos"];
const MAX_FOTOS_BYTES = 60 * 1024 * 1024;
const CONSERVAR: Record<string, number> = { semanal: 8, mensual: 12, manual: 10 };
const MAGIA = new TextEncoder().encode("HIXBAK1");

async function leerTodo(db: Db, tabla: string): Promise<Fila[]> {
  const filas: Fila[] = [];
  for (let desde = 0; ; desde += 1000) {
    const { data, error } = await db.from(tabla).select("*").range(desde, desde + 999);
    if (error) throw new Error(`${tabla}: ${error.message}`);
    filas.push(...(data ?? []));
    if (!data || data.length < 1000) return filas;
  }
}
async function listarArchivos(db: Db, bucket: string, prefijo = "", acc: string[] = []): Promise<string[]> {
  for (let desde = 0; ; desde += 1000) {
    const { data } = await db.storage.from(bucket).list(prefijo, { limit: 1000, offset: desde });
    if (!data?.length) break;
    for (const e of data) {
      const ruta = prefijo ? `${prefijo}/${e.name}` : e.name;
      if (e.id === null) await listarArchivos(db, bucket, ruta, acc); else acc.push(ruta);
    }
    if (data.length < 1000) break;
  }
  return acc;
}
const b64 = (u: Uint8Array) => { let s = ""; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s); };
const desdeB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
async function gzip(bytes: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await new Response(new Blob([bytes as unknown as BlobPart]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer());
}
async function cifrar(bytes: Uint8Array, contrasena: string): Promise<Uint8Array> {
  const sal = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(contrasena), "PBKDF2", false, ["deriveKey"]);
  const clave = await crypto.subtle.deriveKey({ name: "PBKDF2", salt: sal, iterations: 210000, hash: "SHA-256" }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt"]);
  const c = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, clave, bytes as unknown as BufferSource));
  const out = new Uint8Array(MAGIA.length + 28 + c.length);
  out.set(MAGIA, 0); out.set(sal, 7); out.set(iv, 23); out.set(c, 35);
  return out;
}

async function generar(db: Db, tipo: string, incluirFotos: boolean, contrasena: string | null, autor: string | null) {
  const tablas: Record<string, Fila[]> = {};
  const conteos: Record<string, number> = {};
  for (const { t } of TABLAS) { tablas[t] = await leerTodo(db, t); conteos[t] = tablas[t].length; }
  const archivos: Record<string, string> = {};
  let fotosIncompletas = false;
  if (incluirFotos) {
    let total = 0;
    fuera: for (const bucket of BUCKETS_FOTOS) {
      for (const ruta of await listarArchivos(db, bucket)) {
        const { data } = await db.storage.from(bucket).download(ruta);
        if (!data) continue;
        const u = new Uint8Array(await data.arrayBuffer());
        if (total + u.length > MAX_FOTOS_BYTES) { fotosIncompletas = true; break fuera; }
        total += u.length; archivos[`${bucket}/${ruta}`] = b64(u);
      }
    }
    conteos.archivos = Object.keys(archivos).length;
  }
  const contenido = { formato: "hixsa-respaldo", version: 1, creado: new Date().toISOString(), tipo, fotos_incompletas: fotosIncompletas, tablas, archivos };
  let bytes = await gzip(new TextEncoder().encode(JSON.stringify(contenido)));
  if (contrasena) bytes = await cifrar(bytes, contrasena);
  const fecha = new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Mexico_City", dateStyle: "short", timeStyle: "short" }).format(new Date()).replace(/[: ]/g, "-");
  const ruta = `${tipo}/respaldo_hixsa_${fecha}_${tipo}${contrasena ? ".hixbak" : ".json.gz"}`;
  const { error } = await db.storage.from("respaldos").upload(ruta, bytes, { contentType: "application/octet-stream", upsert: true });
  if (error) throw new Error(`No se pudo guardar el respaldo: ${error.message}`);
  const { data: fila } = await db.from("respaldos").insert({
    tipo, ruta, tamano_bytes: bytes.length, incluye_fotos: incluirFotos, cifrado: Boolean(contrasena), conteos, creado_por: autor,
  }).select("id").single();
  // Conservar solo los últimos N de cada tipo
  const { data: viejos } = await db.from("respaldos").select("id, ruta").eq("tipo", tipo).order("created_at", { ascending: false }).range(CONSERVAR[tipo], 1000);
  if (viejos?.length) {
    await db.storage.from("respaldos").remove(viejos.map((x: Fila) => x.ruta));
    await db.from("respaldos").delete().in("id", viejos.map((x: Fila) => x.id));
  }
  return { id: fila?.id, ruta, tamano: bytes.length, conteos, fotos_incompletas: fotosIncompletas };
}

async function importar(db: Db, tabla: string, filas: Fila[], simular: boolean) {
  const def = TABLAS.find((x) => x.t === tabla && !x.solo_respaldo);
  if (!def) throw new Error("Tabla no permitida.");
  const { data: us } = await db.from("perfiles").select("id");
  const usuarios = new Set((us ?? []).map((x: Fila) => x.id));
  const limpias = filas.map((f) => {
    const r: Fila = { ...f };
    for (const c of COLUMNAS_USUARIO) if (c in r && r[c] && !usuarios.has(r[c])) r[c] = null;
    if (def.identidad) delete r.id;
    return r;
  });
  let nuevas: Fila[];
  if (def.identidad) {
    // Sin llave natural: se reconocen por la fecha de creación exacta
    const fechas = limpias.map((r) => r.created_at).filter(Boolean).sort();
    const existentes = new Set<string>();
    if (fechas.length) {
      for (let desde = 0; ; desde += 1000) {
        const { data } = await db.from(tabla).select("created_at").gte("created_at", fechas[0]).lte("created_at", fechas.at(-1))
          .order("created_at").range(desde, desde + 999);
        (data ?? []).forEach((x: Fila) => existentes.add(new Date(x.created_at).toISOString()));
        if (!data || data.length < 1000) break;
      }
    }
    nuevas = limpias.filter((r) => !existentes.has(new Date(r.created_at).toISOString()));
  } else {
    const pk = def.pk!;
    const existe = new Set<string>();
    const clave = (r: Fila, cols: string[]) => cols.map((c) => String(r[c] ?? "").toLowerCase()).join("|");
    for (const cols of [pk, ...(def.unicos ?? [])]) {
      const valores = [...new Set(limpias.map((r) => r[cols[0]]).filter((x) => x !== null && x !== undefined))];
      for (let i = 0; i < valores.length; i += 200) {
        const { data } = await db.from(tabla).select(cols.join(",")).in(cols[0], valores.slice(i, i + 200));
        (data ?? []).forEach((x: Fila) => existe.add(`${cols.join("+")}:${clave(x, cols)}`));
      }
    }
    nuevas = limpias.filter((r) => [pk, ...(def.unicos ?? [])].every((cols) =>
      cols.some((c) => r[c] === null || r[c] === undefined) || !existe.has(`${cols.join("+")}:${clave(r, cols)}`)));
    if (tabla === "empresas") {
      const { data: p } = await db.from("empresas").select("id").eq("es_principal", true).maybeSingle();
      if (p) nuevas = nuevas.map((r) => ({ ...r, es_principal: false })); // nunca dos principales
    }
  }
  if (simular) return { total: filas.length, nuevas: nuevas.length, existentes: filas.length - nuevas.length };
  let insertadas = 0, errores = 0;
  for (let i = 0; i < nuevas.length; i += 200) {
    const { error, count } = await db.from(tabla).insert(nuevas.slice(i, i + 200), { count: "exact" });
    if (error) { console.error("importar", tabla, error); errores += Math.min(200, nuevas.length - i); } else insertadas += count ?? 0;
  }
  return { total: filas.length, nuevas: nuevas.length, insertadas, errores, existentes: filas.length - nuevas.length };
}

Deno.serve(async (req) => {
  const previo = prepararPeticion(req);
  if (previo) return previo;
  const db: Db = clienteServicio();
  const p = await leerJson<Fila>(req);
  const secreto = Deno.env.get("REPORTES_SECRETO") ?? "";
  const porCron = secreto.length >= 20 && req.headers.get("x-cron-secret") === secreto;
  const yo = porCron ? null : await usuarioActivo(req, db);
  if (!porCron && (!yo || !esSuperadmin(yo))) return json({ error: "Solo un SUPERADMIN puede administrar respaldos." }, 403);
  const accion = String(p?.accion ?? "");

  try {
    if (accion === "generar") {
      const tipo = ["semanal", "mensual"].includes(p?.tipo) ? p!.tipo : "manual";
      if (porCron && tipo === "manual") return json({ error: "Tipo inválido." }, 422);
      const { data: cfg } = await db.from("configuracion").select("respaldo_semanal, respaldo_mensual, respaldo_fotos").eq("id", 1).maybeSingle();
      if (tipo === "semanal" && cfg?.respaldo_semanal === false) return json({ ok: true, omitido: "Respaldo semanal desactivado." });
      if (tipo === "mensual" && cfg?.respaldo_mensual === false) return json({ ok: true, omitido: "Respaldo mensual desactivado." });
      const contrasena = tipo === "manual" && p?.contrasena ? String(p.contrasena) : null;
      if (contrasena && contrasena.length < 8) return json({ error: "La contraseña del respaldo debe tener al menos 8 caracteres." }, 422);
      const fotos = tipo === "manual" ? p?.incluir_fotos === true : cfg?.respaldo_fotos === true;
      const r = await generar(db, tipo, fotos, contrasena, yo?.id ?? null);
      let url: string | null = null;
      if (tipo === "manual") {
        const { data } = await db.storage.from("respaldos").createSignedUrl(r.ruta, 600, { download: r.ruta.split("/").pop() });
        url = data?.signedUrl ?? null;
        await registrarCambio(db, yo!, "respaldos", "respaldo", r.id ?? "", null, { tipo, tamano: r.tamano, incluye_fotos: fotos, cifrado: Boolean(contrasena) });
      }
      return json({ ok: true, ...r, url });
    }
    if (accion === "listar") {
      const { data } = await db.from("respaldos").select("id, created_at, tipo, tamano_bytes, incluye_fotos, cifrado, conteos").order("created_at", { ascending: false }).limit(100);
      return json({ ok: true, respaldos: data ?? [], total_bytes: (data ?? []).reduce((s: number, x: Fila) => s + Number(x.tamano_bytes), 0) });
    }
    if (accion === "descargar" || accion === "eliminar") {
      const { data: r } = await db.from("respaldos").select("id, ruta").eq("id", String(p?.id ?? "")).maybeSingle();
      if (!r) return json({ error: "El respaldo no existe." }, 404);
      if (accion === "eliminar") {
        await db.storage.from("respaldos").remove([r.ruta]);
        await db.from("respaldos").delete().eq("id", r.id);
        return json({ ok: true });
      }
      const { data } = await db.storage.from("respaldos").createSignedUrl(r.ruta, 600, { download: r.ruta.split("/").pop() });
      return json({ ok: true, url: data?.signedUrl });
    }
    if (accion === "importar") {
      const filas = Array.isArray(p?.filas) ? p!.filas : [];
      if (filas.length > 500) return json({ error: "Máximo 500 filas por lote." }, 422);
      return json({ ok: true, ...(await importar(db, String(p?.tabla ?? ""), filas, p?.simular !== false)) });
    }
    if (accion === "importar_archivos") {
      const archivos = Array.isArray(p?.archivos) ? p!.archivos.slice(0, 10) : [];
      let nuevos = 0, existentes = 0;
      for (const a of archivos) {
        const [bucket, ...resto] = String(a.ruta).split("/");
        if (!BUCKETS_FOTOS.includes(bucket) || !resto.length) continue;
        if (p?.simular !== false) { nuevos++; continue; }
        const { error } = await db.storage.from(bucket).upload(resto.join("/"), desdeB64(String(a.b64)), { upsert: false, contentType: "image/jpeg" });
        if (error) existentes++; else nuevos++;
      }
      return json({ ok: true, nuevos, existentes });
    }
    if (accion === "registrar_restauracion") {
      await registrarCambio(db, yo!, "respaldos", "restauracion", "restauracion", null, p?.resumen ?? {});
      return json({ ok: true });
    }
    return json({ error: "Acción desconocida." }, 400);
  } catch (e) {
    console.error("respaldos", e);
    if (accion === "generar") await notificar(db, { tipo: "respaldo", audiencia: "administracion", titulo: "No se pudo generar el respaldo", detalle: String(e).slice(0, 200) });
    return json({ error: String((e as Error).message ?? e).slice(0, 200) }, 500);
  }
});
