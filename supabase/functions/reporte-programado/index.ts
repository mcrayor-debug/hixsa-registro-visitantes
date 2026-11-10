// =====================================================================
// Edge Function: reporte-programado
// La llama pg_cron (Supabase) con el encabezado x-cron-secret:
//   { tipo: "diario" }  → lunes a viernes 07:00: visitas de ayer + agenda de hoy
//   { tipo: "semanal" } → lunes 07:05: semana anterior (lunes a domingo)
// Un SUPERADMIN también puede lanzarla desde el panel ("Enviar reporte de prueba").
// Aplica el modo auditoría. Sin IA: el resumen se calcula con estadisticas.js.
// =====================================================================
import { json, leerJson, prepararPeticion } from "../_shared/http.ts";
import { clienteServicio } from "../_shared/supabase.ts";
import { esSuperadmin, filtroAuditoria, usuarioActivo } from "../_shared/auth.ts";
import { enviarCorreo, escapar, logoCorreo, plantilla } from "../_shared/correo.ts";
import { base64Texto } from "../_shared/calendario.ts";
import * as E from "../_shared/estadisticas.js";

const CAMPOS = "folio, persona_id, correo, nombre_completo, empresa, persona_visita, motivo, entrada, salida, llegada_at, salida_real_at, " +
  "estado_aprobacion, entrada_fuera_horario, origen, correo_error, empresas(nombre)";
const fechaLarga = (ymd: string) => new Intl.DateTimeFormat("es-MX", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long" }).format(new Date(`${ymd}T12:00:00Z`));
const hora = (iso: string) => new Intl.DateTimeFormat("es-MX", { timeZone: E.TZ, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));

// deno-lint-ignore no-explicit-any
type V = any;

function tablaHtml(titulo: string, encabezados: string[], filas: (string | number)[][]) {
  if (!filas.length) return `<h3 style="margin:18px 0 6px;font-size:15px;color:#0047BA">${titulo}</h3><p style="margin:0;color:#5B6B7F">Sin datos.</p>`;
  return `<h3 style="margin:18px 0 6px;font-size:15px;color:#0047BA">${titulo}</h3>
  <table width="100%" cellpadding="0" cellspacing="0" style="font-size:13px;border-collapse:collapse">
    <tr>${encabezados.map((e) => `<th style="text-align:left;padding:6px;border-bottom:2px solid #0047BA;color:#5B6B7F">${e}</th>`).join("")}</tr>
    ${filas.map((f) => `<tr>${f.map((c) => `<td style="padding:6px;border-bottom:1px solid #E3E9EF">${escapar(String(c))}</td>`).join("")}</tr>`).join("")}
  </table>`;
}
function kpis(items: [string, string | number][]) {
  return `<table role="presentation" width="100%" cellspacing="6" style="margin:0 -6px"><tr>${items.map(([t, n]) =>
    `<td style="padding:12px 8px;background:#F4F7FA;border-radius:8px;text-align:center;border-top:3px solid #0047BA">
      <div style="font-size:24px;font-weight:700;color:#0047BA">${escapar(String(n))}</div><div style="font-size:12px;color:#5B6B7F">${t}</div></td>`).join("")}</tr></table>`;
}
function csv(visitas: V[]) {
  const cols: [string, (v: V) => unknown][] = [["Folio", (v) => v.folio], ["Visitante", (v) => v.nombre_completo], ["Empresa de origen", (v) => v.empresa],
    ["Empresa a visitar", (v) => v.empresas?.nombre], ["Visita a", (v) => v.persona_visita], ["Motivo", (v) => v.motivo],
    ["Entrada", (v) => v.entrada], ["Salida", (v) => v.salida], ["Llegada real", (v) => v.llegada_at ?? ""], ["Salida real", (v) => v.salida_real_at ?? ""],
    ["Aprobación", (v) => v.estado_aprobacion], ["Fuera de horario autorizada", (v) => (v.entrada_fuera_horario ? "Sí" : "No")], ["Origen", (v) => v.origen]];
  const celda = (x: unknown) => { const s = String(x ?? ""); return `"${(/^[=+\-@]/.test(s) ? `'${s}` : s).replace(/"/g, '""')}"`; };
  return "\uFEFF" + [cols.map(([t]) => celda(t)).join(","), ...visitas.map((v) => cols.map(([, f]) => celda(f(v))).join(","))].join("\r\n");
}

Deno.serve(async (req) => {
  const previo = prepararPeticion(req);
  if (previo) return previo;
  const db = clienteServicio();
  const secreto = Deno.env.get("REPORTES_SECRETO") ?? "";
  const porCron = secreto.length >= 20 && req.headers.get("x-cron-secret") === secreto;
  if (!porCron) {
    const yo = await usuarioActivo(req, db);
    if (!yo || !esSuperadmin(yo)) return json({ error: "No autorizado." }, 401);
  }
  const p = await leerJson<{ tipo?: string }>(req);
  const tipo = p?.tipo === "semanal" ? "semanal" : "diario";

  const { data: cfg } = await db.from("configuracion").select("destinatarios_reporte, tolerancia_min").eq("id", 1).maybeSingle();
  const destinatarios = (cfg?.destinatarios_reporte ?? []) as string[];
  if (!destinatarios.length) return json({ error: "No hay destinatarios configurados (Configuración → Correos y avisos)." }, 422);
  const tolerancia = cfg?.tolerancia_min ?? 15;
  const solo = await filtroAuditoria(db);
  const hoy = E.hoyCDMX();
  const rango = tipo === "diario" ? { desde: E.sumarDias(hoy, -1), hasta: E.sumarDias(hoy, -1) } : E.semanaAnterior();

  const consulta = (desde: string, hasta: string) => {
    let q = db.from("visitantes").select(CAMPOS)
      .gte("entrada", `${desde}T00:00:00-06:00`).lte("entrada", `${hasta}T23:59:59.999-06:00`).order("entrada").limit(10000);
    if (solo) q = q.eq("empresa_visita_id", solo);
    return q;
  };
  const { data: visitas, error } = await consulta(rango.desde, rango.hasta);
  if (error) return json({ error: "No se pudieron consultar las visitas." }, 500);
  const vs = (visitas ?? []) as V[];
  const r = E.resumen(vs, { tolerancia });
  const { count: rechazos } = await db.from("intentos_acceso").select("id", { count: "exact", head: true }).eq("resultado", "rechazado")
    .gte("created_at", `${rango.desde}T00:00:00-06:00`).lte("created_at", `${rango.hasta}T23:59:59.999-06:00`);

  let cuerpo = "";
  let asunto = "";
  if (tipo === "diario") {
    const { data: agenda } = await consulta(hoy, hoy);
    const ag = (agenda ?? []) as V[];
    const alertas: string[] = [];
    if (r.sinUso) alertas.push(`${r.sinUso} ${r.sinUso === 1 ? "invitación venció" : "invitaciones vencieron"} sin uso.`);
    if (r.sinSalida) alertas.push(`${r.sinSalida} ${r.sinSalida === 1 ? "visita no tiene" : "visitas no tienen"} salida registrada.`);
    if (r.autorizadas) alertas.push(`${r.autorizadas} ${r.autorizadas === 1 ? "entrada fue autorizada" : "entradas fueron autorizadas"} fuera de horario.`);
    if (rechazos) alertas.push(`${rechazos} ${rechazos === 1 ? "intento de acceso fue rechazado" : "intentos de acceso fueron rechazados"}.`);
    const errCorreo = vs.filter((v) => v.correo_error).length;
    if (errCorreo) alertas.push(`${errCorreo} ${errCorreo === 1 ? "pase no se pudo" : "pases no se pudieron"} enviar por correo.`);
    asunto = `Reporte diario de visitas HIXSA (${rango.desde})`;
    cuerpo = `<p style="margin:0 0 12px">Resumen del <b>${fechaLarga(rango.desde)}</b>: ${r.total} visitas de ${r.empresas} empresas; llegaron ${r.llegaron}${r.puntualidad !== null ? `, con ${r.puntualidad} % de puntualidad` : ""}. Hoy hay ${ag.length} visitas programadas.</p>
      ${kpis([["visitas", r.total], ["llegaron", r.llegaron], ["puntualidad", r.puntualidad === null ? "—" : `${r.puntualidad} %`], ["programadas hoy", ag.length]])}
      ${alertas.length ? `<h3 style="margin:18px 0 6px;font-size:15px;color:#F38A00">Alertas</h3><ul style="margin:0;padding-left:20px">${alertas.map((a) => `<li>${a}</li>`).join("")}</ul>` : ""}
      ${tablaHtml(`Agenda de hoy (${ag.length})`, ["Horario", "Visitante", "Empresa", "Visita a", "Aprobación"],
        ag.map((v) => [`${hora(v.entrada)} a ${hora(v.salida)}`, v.nombre_completo, v.empresa, v.persona_visita, v.estado_aprobacion]))}`;
  } else {
    const claves = [...new Set(vs.map((v) => v.persona_id).filter(Boolean))];
    const historial = new Set<string>();
    if (claves.length) {
      const { data: previas } = await db.from("visitantes").select("persona_id").in("persona_id", claves).lt("entrada", `${rango.desde}T00:00:00-06:00`).limit(10000);
      (previas ?? []).forEach((x) => historial.add(x.persona_id));
    }
    const nr = E.nuevosVsRecurrentes(vs, historial);
    asunto = `Reporte semanal de visitas HIXSA (${rango.desde} a ${rango.hasta})`;
    cuerpo = `<p style="margin:0 0 12px">Semana del <b>${fechaLarga(rango.desde)}</b> al <b>${fechaLarga(rango.hasta)}</b>: ${r.total} visitas, ${r.unicos} visitantes distintos (${nr.nuevos} nuevos y ${nr.recurrentes} recurrentes).</p>
      ${kpis([["visitas", r.total], ["únicos", r.unicos], ["puntualidad", r.puntualidad === null ? "—" : `${r.puntualidad} %`], ["vencidas sin uso", r.sinUso]])}
      ${tablaHtml("Visitas por día", ["Día", "Visitas"], E.porDiaLaboral(vs).map((x) => [x.dia, x.visitas]))}
      ${tablaHtml("Horas pico de acceso", ["Hora", "Llegadas"], E.horasPico(vs).filter((x) => x.llegadas).map((x) => [x.hora, x.llegadas]))}
      ${tablaHtml("Empresas de origen con más visitas", ["Empresa", "Visitas"], E.contar(vs, (v: V) => v.empresa).slice(0, 8))}
      ${tablaHtml("Visitas por anfitrión", ["Anfitrión", "Área", "Visitas"], E.porAnfitrion(vs).slice(0, 10).map((x) => [x.anfitrion, x.area, x.visitas]))}
      <p style="margin:16px 0 0;color:#5B6B7F">Duración real promedio: ${r.duracionPromedio ?? "—"} h. Entradas autorizadas fuera de horario: ${r.autorizadas}. Intentos rechazados: ${rechazos ?? 0}.</p>`;
  }
  cuerpo += `<p style="margin:16px 0 0;font-size:12px;color:#5B6B7F">Detalle en el CSV adjunto.${solo ? " Modo auditoría activo: solo empresa principal." : ""} Reporte automático (sin IA).</p>`;

  try {
    await enviarCorreo({
      para: destinatarios, asunto,
      html: plantilla({ titulo: tipo === "diario" ? "Reporte diario de visitas" : "Reporte semanal de visitas", logo: await logoCorreo(db), cuerpo }),
      adjuntos: [{ filename: `visitas_${rango.desde}_${rango.hasta}.csv`, content: base64Texto(csv(vs)), content_type: "text/csv" }],
    });
  } catch (e) {
    console.error("reporte programado", e);
    return json({ error: "No se pudo enviar el reporte. Revisa la configuración de Resend." }, 502);
  }
  await db.from("bitacora_reportes").insert({ origen: "programado", destinatarios, filtros: { tipo, ...rango }, total_registros: vs.length });
  return json({ ok: true, tipo, ...rango, total: vs.length, destinatarios });
});
