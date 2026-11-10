// @ts-nocheck: el módulo es JavaScript puro compartido con el panel
import * as E from "./estadisticas.js";
import { crearIcs, enlaceGoogle } from "./calendario.ts";
let fallas = 0;
const ok = (nombre: string, cond: boolean, detalle = "") => { if (!cond) fallas++; console.log(`${cond ? "✔" : "✖"} ${nombre}${detalle ? ` | ${detalle}` : ""}`); };
// Martes 10-nov-2026 (CDMX). Cita 10:00-12:00 = 16:00Z-18:00Z
const v = (o) => ({ persona_id: "p1", correo: "a@x.mx", nombre_completo: "Ana", empresa: "Acme", persona_visita: "Carlos (Ventas)", origen: "formulario",
  entrada: "2026-11-10T16:00:00Z", salida: "2026-11-10T18:00:00Z", llegada_at: null, salida_real_at: null, estado_aprobacion: "aprobada", entrada_fuera_horario: false, ...o });
const ahora = Date.parse("2026-11-11T20:00:00Z");
const datos = [
  v({ llegada_at: "2026-11-10T16:05:00Z", salida_real_at: "2026-11-10T17:35:00Z" }),           // puntual, 1.5 h
  v({ persona_id: "p2", llegada_at: "2026-11-10T16:40:00Z", entrada_fuera_horario: true, salida_real_at: "2026-11-10T18:40:00Z" }), // autorizada, 2 h
  v({ persona_id: "p3" }),                                                                       // vencida sin uso
  v({ persona_id: "p4", llegada_at: "2026-11-10T16:00:00Z" }),                                   // sin salida
  v({ persona_id: "p5", origen: "glide", llegada_at: "2026-11-10T16:30:00Z" }),                  // importada: no se evalúa
  v({ persona_id: "p1", entrada: "2026-11-13T16:00:00Z", salida: "2026-11-13T18:00:00Z" }),      // viernes, futura
];
const r = E.resumen(datos, { tolerancia: 15, ahora });
ok("total 6, únicos 5", r.total === 6 && r.unicos === 5, JSON.stringify({ t: r.total, u: r.unicos }));
ok("puntualidad 67 % (2 de 3 evaluables)", r.puntualidad === 67, String(r.puntualidad));
ok("vencidas sin uso 1", r.sinUso === 1); ok("sin salida 1 (la importada no cuenta)", r.sinSalida === 1); ok("autorizadas 1", r.autorizadas === 1);
ok("duración promedio 1.8 h", r.duracionPromedio === 1.8, String(r.duracionPromedio));
const lv = E.porDiaLaboral(datos); ok("martes 5, viernes 1", lv[1].visitas === 5 && lv[4].visitas === 1, JSON.stringify(lv.map((x) => x.visitas)));
const pico = E.horasPico(datos); ok("hora pico 10:00 con 4 llegadas", pico.find((x) => x.hora === "10:00").llegadas === 4);
ok("semana anterior al miércoles 11-nov = 2 al 8-nov", JSON.stringify(E.semanaAnterior(ahora)) === '{"desde":"2026-11-02","hasta":"2026-11-08"}', JSON.stringify(E.semanaAnterior(ahora)));
ok("noviembre 2026: 30 días, 21 hábiles", E.mesDe("2026-11").hasta === "2026-11-30" && E.diasHabiles("2026-11-01", "2026-11-30") === 21);
const oc = E.ocupacionPorFranja([v({ llegada_at: "2026-11-10T16:30:00Z", salida_real_at: "2026-11-10T18:00:00Z" })], 1, { ahora });
ok("ocupación: 10:00 = 0.5, 11:00 = 1", oc.find((x) => x.franja === "10:00").promedio === 0.5 && oc.find((x) => x.franja === "11:00").promedio === 1);
ok("nuevos 3 / recurrentes 2", JSON.stringify(E.nuevosVsRecurrentes(datos, new Set(["p1", "p2"]))) === '{"nuevos":3,"recurrentes":2}');
ok("anfitrión y área", E.porAnfitrion(datos)[0].area === "Ventas");
const ics = crearIcs({ uid: "HX-1@hixsa", inicio: "2026-11-10T16:00:00Z", fin: "2026-11-10T18:00:00Z", titulo: "Visita, HIXSA; prueba", descripcion: "Línea 1\nLínea 2", lugar: "Torre Mitikah", organizador: { nombre: "HIXSA", correo: "r@x.mx" }, asistentes: ["a@x.mx"], metodo: "REQUEST" });
ok("ICS válido (CRLF, fechas UTC, escapes)", ics.includes("\r\nDTSTART:20261110T160000Z\r\n") && ics.includes("SUMMARY:Visita\\, HIXSA\\; prueba") && ics.includes("ATTENDEE") && ics.split("\r\n").every((l) => l.length <= 75));
ok("enlace de Google Calendar", enlaceGoogle({ titulo: "X", inicio: "2026-11-10T16:00:00Z", fin: "2026-11-10T18:00:00Z", descripcion: "", lugar: "" }).includes("dates=20261110T160000Z%2F20261110T180000Z"));
if (fallas) Deno.exit(1);
