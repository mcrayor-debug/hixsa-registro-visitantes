// =====================================================================
// Edge Function: cancelar-visita
//   Pública con token (enlace del correo del visitante o del anfitrión):
//     { token, consultar: true }  → datos de la visita
//     { token, motivo, detalle }  → cancela
//   Personal con sesión (permiso recepcion): { folio, motivo, detalle }
// Solo visitas sin llegada, no rechazadas, no canceladas y cuyo horario no ha terminado.
// Avisa al visitante y al anfitrión, cancela en los calendarios y notifica en la campana.
// =====================================================================
import { json, leerJson, prepararPeticion } from "../_shared/http.ts";
import { clienteServicio } from "../_shared/supabase.ts";
import { filtroAuditoria, registrarCambio, tienePermiso, usuarioActivo } from "../_shared/auth.ts";
import { enviarCorreo, escapar, logoCorreo, plantilla } from "../_shared/correo.ts";
import { formatoFecha, formatoHora } from "../_shared/formato.ts";
import { cancelarCalendario } from "../_shared/pase.ts";
import { notificar } from "../_shared/notificaciones.ts";
import { sha256Hex, TOKEN_RE } from "../_shared/tokens.ts";

export const MOTIVOS = ["Cambio de agenda", "El anfitrión no está disponible", "Ya no es necesaria", "Error en el registro", "Otro"];
const CAMPOS = "id, folio, nombre, nombre_completo, correo, empresa, persona_visita, motivo, entrada, salida, llegada_at, estado_aprobacion, " +
  "cancelada_at, empresa_visita_id, empresas(nombre), anfitriones(nombre, correo)";

Deno.serve(async (req) => {
  const previo = prepararPeticion(req);
  if (previo) return previo;
  const db = clienteServicio();
  const p = await leerJson<Record<string, string | boolean | undefined>>(req);

  // ¿Quién cancela?
  // deno-lint-ignore no-explicit-any
  let v: any = null;
  let por: "personal" | "visitante" | "anfitrion";
  let yo = null;
  if (p?.token) {
    const token = String(p.token);
    if (!TOKEN_RE.test(token)) return json({ error: "El enlace no es válido." }, 400);
    const hash = await sha256Hex(token);
    const { data: dv } = await db.from("visitantes").select(CAMPOS).eq("cancelacion_token_hash", hash).maybeSingle();
    const { data: da } = dv ? { data: null } : await db.from("visitantes").select(CAMPOS).eq("cancelacion_anfitrion_token_hash", hash).maybeSingle();
    v = dv ?? da;
    por = dv ? "visitante" : "anfitrion";
    if (!v) return json({ error: "Este enlace ya se usó o no es válido." }, 404);
  } else {
    yo = await usuarioActivo(req, db);
    if (!yo) return json({ error: "Inicia sesión para continuar." }, 401);
    if (!tienePermiso(yo, "recepcion")) return json({ error: "Tu rol no puede cancelar visitas." }, 403);
    const { data: crudo } = await db.from("visitantes").select(CAMPOS).eq("folio", String(p?.folio ?? "").toUpperCase()).maybeSingle();
    // deno-lint-ignore no-explicit-any
    const data = crudo as any;
    const solo = await filtroAuditoria(db);
    v = data && !(solo && data.empresa_visita_id !== solo) ? data : null;
    por = "personal";
    if (!v) return json({ error: "La visita no existe." }, 404);
  }

  const resumen = {
    folio: v.folio, visitante: v.nombre_completo, empresa_origen: v.empresa, empresa_visita: v.empresas?.nombre ?? "",
    anfitrion: v.persona_visita, motivo: v.motivo, entrada: v.entrada, salida: v.salida, quien: por,
  };
  if (v.cancelada_at) return json({ error: "Esta visita ya fue cancelada.", visita: resumen }, 409);
  if (v.llegada_at) return json({ error: "La visita ya se realizó; no se puede cancelar.", visita: resumen }, 409);
  if (v.estado_aprobacion === "rechazada") return json({ error: "Esta visita no fue autorizada.", visita: resumen }, 409);
  if (new Date(v.salida).getTime() < Date.now()) return json({ error: "El horario de esta visita ya pasó.", visita: resumen }, 410);
  if (p?.consultar) return json({ ok: true, visita: resumen, motivos: MOTIVOS });

  const motivo = String(p?.motivo ?? "");
  const detalle = String(p?.detalle ?? "").trim().slice(0, 300) || null;
  if (!MOTIVOS.includes(motivo)) return json({ error: "Elige el motivo de la cancelación." }, 422);
  if (motivo === "Otro" && (detalle ?? "").length < 3) return json({ error: "Especifica el motivo." }, 422);

  const { error } = await db.from("visitantes").update({
    cancelada_at: new Date().toISOString(), cancelada_por: por, cancelacion_usuario: yo?.id ?? null,
    cancelacion_motivo: motivo, cancelacion_detalle: detalle,
    cancelacion_token_hash: null, cancelacion_anfitrion_token_hash: null, aprobacion_token_hash: null,
  }).eq("id", v.id).is("cancelada_at", null);
  if (error) return json({ error: "No se pudo cancelar la visita." }, 500);

  const quien = por === "personal" ? `Recepción (${yo!.nombre})` : por === "anfitrion" ? `el anfitrión (${v.anfitriones?.nombre ?? v.persona_visita})` : "el visitante";
  const textoMotivo = motivo === "Otro" ? detalle : `${motivo}${detalle ? `: ${detalle}` : ""}`;
  await cancelarCalendario(db, v, resumen.empresa_visita);
  await notificar(db, { tipo: "cancelacion", titulo: `Visita cancelada: ${v.nombre_completo}`, detalle: `${textoMotivo} · por ${quien}`, folio: v.folio, empresa_id: v.empresa_visita_id });
  if (yo) await registrarCambio(db, yo, "visitantes", "cancelacion", v.folio, null, { folio: v.folio, nombre: v.nombre_completo, motivo, detalle });

  // Avisos por correo: al visitante (si no canceló él) y al anfitrión (si no canceló él)
  const cuando = `${formatoFecha(v.entrada)}, ${formatoHora(v.entrada)} h`;
  const logo = await logoCorreo(db);
  const avisos: Promise<unknown>[] = [];
  if (por !== "visitante") {
    avisos.push(enviarCorreo({
      para: [v.correo], asunto: `Tu visita a ${resumen.empresa_visita} fue cancelada`,
      html: plantilla({ titulo: "Visita cancelada", logo,
        cuerpo: `<p style="margin:0 0 12px">Hola ${escapar(v.nombre || v.nombre_completo.split(" ")[0])}, tu visita del <b>${escapar(cuando)}</b> fue cancelada.</p>
          <p style="margin:0;color:#5B6B7F">Motivo: ${escapar(textoMotivo ?? "")}. Si necesitas reprogramarla, registra una visita nueva.</p>` }),
    }));
  }
  if (por !== "anfitrion" && v.anfitriones?.correo) {
    avisos.push(enviarCorreo({
      para: [v.anfitriones.correo], asunto: `Visita cancelada: ${v.nombre_completo}`,
      html: plantilla({ titulo: "Visita cancelada", logo,
        cuerpo: `<p style="margin:0 0 12px">La visita de <b>${escapar(v.nombre_completo)}</b> (${escapar(v.empresa)}) del <b>${escapar(cuando)}</b> fue cancelada por ${escapar(quien)}.</p>
          <p style="margin:0;color:#5B6B7F">Motivo: ${escapar(textoMotivo ?? "")}. Folio ${escapar(v.folio)}.</p>` }),
    }));
  }
  await Promise.allSettled(avisos);
  return json({ ok: true, visita: { ...resumen, cancelada: true } });
});
