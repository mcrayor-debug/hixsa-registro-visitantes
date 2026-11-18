// Días hábiles para validar fechas de visitas: lunes a viernes, sin festivos (tabla dias_festivos).
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.45.4";
import { diaCDMX, esDiaHabil, hoyCDMX, sumarDias } from "./estadisticas.js";

/** Festivos de los próximos 400 días (y los últimos 30) como conjunto de "AAAA-MM-DD". */
export async function cargarFestivos(db: SupabaseClient): Promise<Set<string>> {
  const hoy = hoyCDMX();
  const { data } = await db.from("dias_festivos").select("fecha").gte("fecha", sumarDias(hoy, -30)).lte("fecha", sumarDias(hoy, 400));
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
