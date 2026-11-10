import { evaluarLlegada } from "./horario.ts";
const cfg = { anticipacion: 10, tolerancia: 15 };
// Cita: 2026-11-12 10:00 a 12:00 (CDMX = UTC-6)
const v = { entrada: "2026-11-12T16:00:00Z", salida: "2026-11-12T18:00:00Z" };
const en = (iso: string) => evaluarLlegada(v, new Date(iso), cfg);
const casos: [string, string, string | undefined, boolean | undefined][] = [
  ["día anterior", "2026-11-11T17:00:00Z", "fecha_no_asignada", false],
  ["09:40 (20 min antes)", "2026-11-12T15:40:00Z", "anticipado", true],
  ["09:50 (justo en la ventana)", "2026-11-12T15:50:00Z", undefined, undefined],
  ["10:15 (fin de la tolerancia)", "2026-11-12T16:15:00Z", undefined, undefined],
  ["10:20 (tarde)", "2026-11-12T16:20:00Z", "tarde", true],
  ["12:30 (después de la salida)", "2026-11-12T18:30:00Z", "caducado", false],
  ["día siguiente", "2026-11-13T16:00:00Z", "caducado", false],
];
let fallas = 0;
for (const [nombre, ahora, motivo, autorizable] of casos) {
  const r = en(ahora);
  const ok = r.motivo === motivo && r.autorizable === autorizable && r.permitido === !motivo;
  if (!ok) fallas++;
  console.log(`${ok ? "✔" : "✖"} ${nombre}: ${r.permitido ? "permitido" : `${r.motivo} (autorizable: ${r.autorizable})`}${r.detalle ? ` | ${r.detalle}` : ""}`);
}
if (fallas) Deno.exit(1);
