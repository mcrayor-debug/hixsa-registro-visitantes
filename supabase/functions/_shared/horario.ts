// Reglas de acceso por horario (las usa registrar-acceso; probadas en horario.test.ts).
// Ventana de entrada: desde (entrada - minutos de anticipación) hasta (entrada + tolerancia),
// el mismo día de la visita en Ciudad de México. Las salidas siempre se permiten.
export type MotivoHorario = "anticipado" | "tarde" | "fecha_no_asignada" | "caducado";

export interface Evaluacion {
  permitido: boolean;
  motivo?: MotivoHorario;
  detalle?: string;
  autorizable?: boolean;
}

const TZ = "America/Mexico_City";
const dia = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
const hora = (d: Date) => new Intl.DateTimeFormat("es-MX", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
const fecha = (d: Date) => new Intl.DateTimeFormat("es-MX", { timeZone: TZ, weekday: "long", day: "numeric", month: "long" }).format(d);

export function evaluarLlegada(
  v: { entrada: string; salida: string },
  ahora: Date,
  cfg: { anticipacion: number; tolerancia: number },
): Evaluacion {
  const entrada = new Date(v.entrada);
  const salida = new Date(v.salida);
  const hoy = dia(ahora);

  if (hoy < dia(entrada)) {
    return { permitido: false, motivo: "fecha_no_asignada", autorizable: false,
      detalle: `La visita está registrada para el ${fecha(entrada)} a las ${hora(entrada)}.` };
  }
  if (ahora > salida) {
    return { permitido: false, motivo: "caducado", autorizable: false,
      detalle: `El pase venció el ${fecha(salida)} a las ${hora(salida)}.` };
  }
  const inicio = new Date(entrada.getTime() - cfg.anticipacion * 60_000);
  const fin = new Date(entrada.getTime() + cfg.tolerancia * 60_000);
  if (ahora < inicio) {
    return { permitido: false, motivo: "anticipado", autorizable: true,
      detalle: `Su entrada es a las ${hora(entrada)}; puede entrar desde las ${hora(inicio)}.` };
  }
  if (ahora > fin) {
    return { permitido: false, motivo: "tarde", autorizable: true,
      detalle: `Su entrada era a las ${hora(entrada)}; la tolerancia terminó a las ${hora(fin)}.` };
  }
  return { permitido: true };
}

/** Llegada puntual: dentro de la ventana y sin autorización especial. */
export const esPuntual = (v: { entrada: string; llegada_at: string | null; entrada_fuera_horario?: boolean }, tolerancia: number) =>
  Boolean(v.llegada_at) && !v.entrada_fuera_horario &&
  new Date(v.llegada_at!).getTime() <= new Date(v.entrada).getTime() + tolerancia * 60_000;
