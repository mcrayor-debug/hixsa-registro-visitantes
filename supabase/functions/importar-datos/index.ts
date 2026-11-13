// =====================================================================
// Edge Function: importar-datos (permiso config_visitantes)
// Recibe filas ya normalizadas por el panel (lotes de hasta 50):
//   tipo "perfiles": visitantes de Glide (visitantes.csv)
//   tipo "visitas":  visitas de Glide (Visitas.csv) o de la plantilla HIXSA
// Importar dos veces no duplica (origen + origen_id). Las fotos de Glide se copian
// al bucket privado solo desde dominios de Google/Glide.
// =====================================================================
import { json, leerJson, prepararPeticion } from "../_shared/http.ts";
import { clienteServicio } from "../_shared/supabase.ts";
import { registrarCambio, tienePermiso, usuarioActivo } from "../_shared/auth.ts";
import { EMAIL_RE } from "../_shared/correo.ts";

const MOTIVOS = ["Reunión", "Entrevista", "Proveedor o servicio", "Entrega o paquetería", "Otro"];
const IDENTIFICACIONES = ["INE", "Licencia", "Pasaporte", "ID empresa", "Otro"];
const EQUIPOS = ["Laptop", "Tablet", "Proyector", "Disco o memoria", "Otro"];
const HOSTS_FOTOS = /(^|\.)(googleapis\.com|googleusercontent\.com|glideapps\.com|glideusercontent\.com)$/i;
const HORA = 3600000;

// deno-lint-ignore no-explicit-any
type Fila = Record<string, any>;
const txt = (v: unknown, max = 200) => String(v ?? "").trim().replace(/\s+/g, " ").slice(0, max);
const fecha = (v: unknown) => { const d = new Date(String(v ?? "")); return isNaN(d.getTime()) ? null : d; };

async function copiarFoto(db: ReturnType<typeof clienteServicio>, url: string, carpeta: string): Promise<string | null> {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" || !HOSTS_FOTOS.test(u.hostname)) return null;
    const r = await fetch(u, { signal: AbortSignal.timeout(10000), redirect: "follow" });
    if (!r.ok) return null;
    const bytes = new Uint8Array(await r.arrayBuffer());
    if (bytes.length > 3 * 1024 * 1024 || bytes.length < 100) return null;
    const f = Array.from(bytes.slice(0, 12));
    const tipo = f[0] === 0xff && f[1] === 0xd8 ? ["image/jpeg", "jpg"]
      : f[0] === 0x89 && f[1] === 0x50 ? ["image/png", "png"]
      : String.fromCharCode(...f.slice(8, 12)) === "WEBP" ? ["image/webp", "webp"] : null;
    if (!tipo) return null;
    const ruta = `importacion/${carpeta}/${crypto.randomUUID()}.${tipo[1]}`;
    const { error } = await db.storage.from("identificaciones").upload(ruta, bytes, { contentType: tipo[0], upsert: false });
    return error ? null : ruta;
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  const previo = prepararPeticion(req);
  if (previo) return previo;
  const db = clienteServicio();
  const yo = await usuarioActivo(req, db);
  if (!yo) return json({ error: "Inicia sesión para continuar." }, 401);
  if (!tienePermiso(yo, "config_visitantes")) return json({ error: "Tu rol no puede importar datos." }, 403);

  const p = await leerJson<{ tipo?: string; filas?: Fila[]; copiar_fotos?: boolean; sobrescribir?: boolean; simular?: boolean }>(req);
  const tipo = p?.tipo;
  const filas = Array.isArray(p?.filas) ? p!.filas! : [];
  if (tipo !== "perfiles" && tipo !== "visitas") return json({ error: "Tipo de importación inválido." }, 422);
  if (!filas.length || filas.length > 50) return json({ error: "Envía de 1 a 50 filas por lote." }, 422);
  const simular = p?.simular === true;          // vista previa: no escribe nada
  const sobrescribir = p?.sobrescribir === true; // actualizar lo ya importado
  const copiarFotos = p?.copiar_fotos !== false && !simular;

  const { data: empresas } = await db.from("empresas").select("id, nombre, es_principal");
  const principal = empresas?.find((e) => e.es_principal);
  const anfitriones = new Map<string, { id: string; nombre: string; area: string | null }>();
  {
    const { data } = await db.from("anfitriones").select("id, nombre, area");
    (data ?? []).forEach((a) => anfitriones.set(a.nombre.trim().toLowerCase(), a));
  }

  const resultados: { fila: number; estado: "creado" | "actualizado" | "omitido" | "error"; mensaje: string }[] = [];
  let creados = 0;

  for (const [i, f] of filas.entries()) {
    const n = Number(f._fila ?? i + 1);
    try {
      const origen = f.origen === "importacion" ? "importacion" : "glide";
      const avisos: string[] = [];
      let correo = txt(f.correo, 254).toLowerCase();
      // Glide a veces trae una fecha en la columna de correo: se recupera del perfil importado (row_Visitante)
      if (!EMAIL_RE.test(correo) && f.persona_origen_id) {
        const { data: per } = await db.from("personas").select("correo").eq("origen", "glide").eq("origen_id", txt(f.persona_origen_id, 120)).maybeSingle();
        if (per?.correo) { correo = per.correo; avisos.push("correo tomado del perfil"); }
      }
      // Visita histórica de Glide sin correo recuperable: correo provisional para conservar la estadística
      if (!EMAIL_RE.test(correo) && tipo === "visitas" && f.origen !== "importacion" && txt(f.nombre) && txt(f.origen_id)) {
        correo = `glide-${txt(f.origen_id, 40).toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 24) || crypto.randomUUID().slice(0, 8)}@sin-correo.invalid`;
        avisos.push("sin correo válido: correo provisional");
      }
      if (!EMAIL_RE.test(correo)) { resultados.push({ fila: n, estado: "error", mensaje: "Correo inválido o vacío (importa primero visitantes.csv)." }); continue; }
      let nombre = txt(f.nombre, 60), apellidos = txt(f.apellidos, 80);
      if (/^\d{1,2}\/\d{1,2}\/\d{4}/.test(nombre)) { resultados.push({ fila: n, estado: "error", mensaje: "El nombre contiene una fecha (error de captura en Glide)." }); continue; }
      if (!nombre) nombre = correo.split("@")[0].slice(0, 60);
      if (apellidos.length < 2) { apellidos = apellidos || "(sin apellidos)"; avisos.push("sin apellidos"); }
      // Perfil (uno por correo); de él se toma el teléfono si la fila no lo trae (Visitas.csv de Glide)
      const { data: existente } = await db.from("personas").select("*").eq("correo", correo).maybeSingle();
      const tel = txt(f.telefono, 30) || txt(existente?.telefono, 30);
      let telefono = (tel.startsWith("+") ? "+" : "") + tel.replace(/\D/g, "");
      if (!/^\+?[0-9]{10,15}$/.test(telefono)) { telefono = "0000000000"; avisos.push("sin teléfono válido"); }
      const empresa = txt(f.empresa, 120).length >= 2 ? txt(f.empresa, 120) : "Sin empresa";
      let personaId = existente?.id as string | undefined;

      if (tipo === "perfiles") {
        if (simular) {
          const cambia = !existente || sobrescribir || ["nombre", "apellidos", "telefono", "empresa"].some((k) => !existente[k]) || (f.recurrente && !existente.recurrente);
          resultados.push({ fila: n, estado: !existente ? "creado" : cambia ? "actualizado" : "omitido", mensaje: avisos.join(", ") });
          continue;
        }
        const selfie = copiarFotos && f.foto_url && !existente?.selfie_path ? await copiarFoto(db, f.foto_url, "perfiles") : null;
        if (!existente) {
          const { error } = await db.from("personas").insert({
            correo, nombre, apellidos, telefono, empresa, selfie_path: selfie, recurrente: Boolean(f.recurrente),
            origen, origen_id: txt(f.origen_id, 120) || null,
          });
          if (error) throw error;
          creados++;
          resultados.push({ fila: n, estado: "creado", mensaje: avisos.join(", ") });
        } else {
          const relleno: Fila = {};
          // Sin "sobrescribir" solo se llenan los datos vacíos; con él, se reemplazan los distintos
          for (const [k, val] of Object.entries({ nombre, apellidos, telefono, empresa })) if (!existente[k] || (sobrescribir && existente[k] !== val)) relleno[k] = val;
          if (selfie) relleno.selfie_path = selfie;
          if (f.recurrente && !existente.recurrente) relleno.recurrente = true;
          if (Object.keys(relleno).length) await db.from("personas").update(relleno).eq("id", existente.id);
          resultados.push({ fila: n, estado: Object.keys(relleno).length ? "actualizado" : "omitido", mensaje: "El perfil ya existía." });
        }
        continue;
      }

      // ---------- visitas ----------
      const origenId = txt(f.origen_id, 120);
      if (!origenId) { resultados.push({ fila: n, estado: "error", mensaje: "Falta el identificador de la fila (Row ID o folio)." }); continue; }
      const { data: dup } = await db.from("visitantes").select("id, folio, nombre_completo, identificacion_path, selfie_path")
        .eq("origen", origen).eq("origen_id", origenId).maybeSingle();
      if (dup && !sobrescribir) { resultados.push({ fila: n, estado: "omitido", mensaje: "Ya importada." }); continue; }
      if (dup && dup.nombre_completo === "Visitante eliminado") { resultados.push({ fila: n, estado: "omitido", mensaje: "Anonimizada: no se sobrescribe." }); continue; }

      let entrada = fecha(f.entrada), salida = fecha(f.salida);
      const llegada = fecha(f.llegada), salidaReal = fecha(f.salida_real);
      if (!entrada) entrada = llegada;
      if (!entrada) { resultados.push({ fila: n, estado: "error", mensaje: "Sin fecha de entrada ni de llegada." }); continue; }
      if (!salida || salida <= entrada || salida.getTime() - entrada.getTime() > 7 * 24 * HORA) salida = new Date(entrada.getTime() + HORA);
      if (simular) { resultados.push({ fila: n, estado: dup ? "actualizado" : "creado", mensaje: avisos.join(", ") }); continue; }

      if (!personaId) {
        const { data: nueva, error } = await db.from("personas").insert({ correo, nombre, apellidos, telefono, empresa, origen }).select("id").single();
        if (error) throw error;
        personaId = nueva.id;
      }
      // Empresa a visitar y anfitrión (se crea oculto si no existe)
      const empVis = empresas?.find((e) => e.nombre.toLowerCase() === txt(f.empresa_visita).toLowerCase()) ?? principal;
      let anfitrionId: string | null = null, personaVisita = "Recepción";
      const nombreAnf = txt(f.anfitrion, 120);
      if (nombreAnf.length >= 3) {
        let a = anfitriones.get(nombreAnf.toLowerCase());
        if (!a) {
          const { data: nuevo, error } = await db.from("anfitriones").insert({ nombre: nombreAnf, activo: false }).select("id, nombre, area").single();
          if (error) throw error;
          a = nuevo;
          anfitriones.set(nombreAnf.toLowerCase(), nuevo);
          if (empVis) await db.from("anfitrion_empresas").insert({ anfitrion_id: nuevo.id, empresa_id: empVis.id });
          avisos.push(`anfitrión creado oculto: ${nombreAnf}`);
        }
        anfitrionId = a!.id;
        personaVisita = a!.area ? `${a!.nombre} (${a!.area})` : a!.nombre;
      }
      const equipoTipo = txt(f.equipo_tipo, 40) ? (EQUIPOS.includes(txt(f.equipo_tipo, 40)) ? txt(f.equipo_tipo, 40) : "Otro") : null;
      const comentarios = [txt(f.comentarios, 300), f.registrado_por ? `Registrado por (Glide): ${txt(f.registrado_por, 80)}` : ""].filter(Boolean).join(". ") || null;
      const idPath = copiarFotos && f.foto_id_url && !dup?.identificacion_path ? await copiarFoto(db, f.foto_id_url, "identificaciones") : null;
      const selfiePath = copiarFotos && f.foto_user_url && !dup?.selfie_path ? await copiarFoto(db, f.foto_user_url, "selfies") : null;

      const registro: Fila = {
        nombre_completo: `${nombre} ${apellidos}`.slice(0, 120), nombre, apellidos, empresa, correo, telefono,
        persona_visita: personaVisita, anfitrion_id: anfitrionId, empresa_visita_id: empVis?.id,
        motivo: MOTIVOS.includes(txt(f.motivo)) ? txt(f.motivo) : "Otro", comentarios, acepta_aviso: true,
        entrada: entrada.toISOString(), salida: salida.toISOString(),
        llegada_at: llegada?.toISOString() ?? null,
        salida_real_at: llegada && salidaReal && salidaReal >= llegada ? salidaReal.toISOString() : null,
        tipo_identificacion: IDENTIFICACIONES.includes(txt(f.tipo_identificacion)) ? txt(f.tipo_identificacion) : null,
        identificacion_path: idPath, selfie_path: selfiePath,
        equipo_tipo: equipoTipo, equipo_marca: equipoTipo ? txt(f.equipo_marca, 60) || null : null, equipo_serie: equipoTipo ? txt(f.equipo_serie, 80) || null : null,
        persona_id: personaId, estado_aprobacion: "aprobada", aprobacion_por: "sistema", origen, origen_id: origenId,
      };
      if (dup) {
        // Sobrescribir: se actualiza la visita; las fotos solo si no tenía
        if (!idPath) delete registro.identificacion_path;
        if (!selfiePath) delete registro.selfie_path;
        const { error } = await db.from("visitantes").update(registro).eq("id", dup.id);
        if (error) throw error;
        creados++;
        resultados.push({ fila: n, estado: "actualizado", mensaje: [dup.folio, ...avisos].join(", ") });
        continue;
      }
      const { data: v, error } = await db.from("visitantes").insert(registro).select("id, folio").single();
      if (error) throw error;
      const intentos = Math.min(Number(f.escaneos_expirados) || 0, 20);
      if (intentos) {
        await db.from("intentos_acceso").insert(Array.from({ length: intentos }, () => ({
          visita_id: v.id, folio: v.folio, resultado: "rechazado", motivo: "caducado", detalle: "Importado de Glide: escaneo con pase vencido.",
        })));
      }
      const ultima = (llegada ?? entrada).toISOString();
      if (!existente?.ultima_visita_at || existente.ultima_visita_at < ultima) await db.from("personas").update({ ultima_visita_at: ultima }).eq("id", personaId);
      if (!existente?.selfie_path && selfiePath) await db.from("personas").update({ selfie_path: selfiePath }).eq("id", personaId).is("selfie_path", null);
      creados++;
      resultados.push({ fila: n, estado: "creado", mensaje: [v.folio, ...avisos].join(", ") });
    } catch (e) {
      console.error("importación fila", n, e);
      resultados.push({ fila: n, estado: "error", mensaje: "No se pudo guardar la fila." });
    }
  }
  if (creados) await registrarCambio(db, yo, tipo === "perfiles" ? "personas" : "visitantes", "alta", `importacion:${creados}`, null, { tipo, creados });
  return json({ ok: true, resultados });
});
