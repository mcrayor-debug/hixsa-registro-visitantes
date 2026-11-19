// Días hábiles para validar fechas de visitas: lunes a viernes, sin festivos (tabla dias_festivos).
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.45.4";
import { diaCDMX, esDiaHabil, hoyCDMX, sumarDias } from "./estadisticas.js";

/** Festivos de los próximos 400 días (y los últimos 30) como conjunto de "AAAA-MM-DD". */
export async function cargarFestivos(db: SupabaseClient): Promise<Set<string>> {
  const hoy = hoyCDMX();
  // Solo los días "sin visitas"; los de horario especial son hábiles con su propio horario
  const { data } = await db.from("dias_festivos").select("fecha").eq("tipo", "inhabil").gte("fecha", sumarDias(hoy, -30)).lte("fecha", sumarDias(hoy, 400));
  return new Set((data ?? []).map((f: { fecha: string }) => f.fecha));
}

export const MENSAJE_DIA_INHABIL = "Las visitas se agendan de lunes a viernes, sin días festivos. Elige otro día.";

/** Entrada y salida deben caer en día hábil (la visita sí puede cruzar un fin de semana). */
export function validarDiasHabiles(entrada: string, salida: string, festivos: Set<string>): { entrada?: string; salida?: string } {
  const r: { entrada?: string; salida?: string } = {};
  if (!esDiaHabil(diaCDMX(entrada), festivos)) r.entrada = MENSAJE_DIA_INHABIL;
  if (!esDiaHabil(diaCDMX(salida), festivos)) r.salida = MENSAJE_DIA_INHABIL;
  return r;
}

// ---------- Horario de recepción (configurable) ----------
export interface HorarioRecepcion { apertura: string; ultima_entrada: string; cierre: string }
const hhmm = (t: unknown, def: string) => String(t ?? def).slice(0, 5);
export async function cargarHorario(db: SupabaseClient): Promise<HorarioRecepcion> {
  const { data } = await db.from("configuracion").select("hora_apertura, hora_ultima_entrada, hora_cierre").eq("id", 1).maybeSingle();
  return { apertura: hhmm(data?.hora_apertura, "09:00"), ultima_entrada: hhmm(data?.hora_ultima_entrada, "17:45"), cierre: hhmm(data?.hora_cierre, "18:00") };
}
const horaCdmx = (iso: string) => new Intl.DateTimeFormat("en-GB", { timeZone: "America/Mexico_City", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));
/** Días con horario especial (p. ej. "Cena de fin de año: 09:00 a 14:00"). La última entrada guarda el margen del horario normal. */
export async function cargarEspeciales(db: SupabaseClient, general: HorarioRecepcion): Promise<Map<string, HorarioRecepcion & { nombre: string }>> {
  const hoy = hoyCDMX();
  const { data } = await db.from("dias_festivos").select("fecha, nombre, hora_inicio, hora_fin").eq("tipo", "especial")
    .gte("fecha", sumarDias(hoy, -30)).lte("fecha", sumarDias(hoy, 400));
  const min = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  const hh = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  const margen = min(general.cierre) - min(general.ultima_entrada);
  return new Map((data ?? []).map((f: { fecha: string; nombre: string; hora_inicio: string; hora_fin: string }) => {
    const ini = min(f.hora_inicio), fin = min(f.hora_fin);
    return [f.fecha, { nombre: f.nombre, apertura: hh(ini), ultima_entrada: hh(Math.max(ini, fin - margen)), cierre: hh(fin) }];
  }));
}

/** Entrada entre la apertura y la última hora de entrada; salida a más tardar al cierre (la visita puede durar varios días).
 *  Si el día tiene horario especial, se usa ese horario. */
export function validarHorario(
  entrada: string, salida: string, general: HorarioRecepcion, especiales = new Map<string, HorarioRecepcion & { nombre: string }>(),
): { entrada?: string; salida?: string } {
  const r: { entrada?: string; salida?: string } = {};
  const he = especiales.get(diaCDMX(entrada)) ?? general, hs = especiales.get(diaCDMX(salida)) ?? general;
  const e = horaCdmx(entrada), s = horaCdmx(salida);
  // "Recibimos…" en días normales; "Cena de fin de año: ese día recibimos…" en días especiales
  const frase = (h: HorarioRecepcion, texto: string) => ("nombre" in h ? `${(h as { nombre: string }).nombre}: ese día ${texto[0].toLowerCase()}${texto.slice(1)}` : texto);
  if (e < he.apertura || e > he.ultima_entrada) r.entrada = frase(he, `Recibimos visitas de ${he.apertura} a ${he.cierre}; la última entrada es a las ${he.ultima_entrada}.`);
  if (s > hs.cierre || s < hs.apertura) r.salida = frase(hs, `La salida debe ser entre las ${hs.apertura} y las ${hs.cierre}.`);
  return r;
}
