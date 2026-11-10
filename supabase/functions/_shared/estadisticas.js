// =====================================================================
// Indicadores de visitas. Módulo ÚNICO compartido por:
//   - el panel (pestaña Reportes, Consultas)    → panel/src/...
//   - la Edge Function reporte-programado       → correos automáticos
// Así las cifras del panel y del correo siempre coinciden.
// JavaScript puro (sin Deno ni navegador). Zona horaria: Ciudad de México (UTC-6 fijo).
// =====================================================================
export const TZ = 'America/Mexico_City';
const fDia = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
const fHora = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: '2-digit', hour12: false });
const fDow = new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short' });
const DOW = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
const HORA = 3600000;

export const diaCDMX = (iso) => fDia.format(new Date(iso));
export const horaCDMX = (iso) => Number(fHora.format(new Date(iso))) % 24;
export const diaSemana = (iso) => DOW[fDow.format(new Date(iso))];
export const hoyCDMX = (ahora = Date.now()) => fDia.format(new Date(ahora));
/** Suma días a una fecha AAAA-MM-DD. */
export function sumarDias(ymd, n) {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const dowYmd = (ymd) => { const d = new Date(`${ymd}T12:00:00Z`).getUTCDay(); return d === 0 ? 7 : d; };

/** Semana (lunes a domingo) que contiene la fecha. */
export const semanaDe = (ymd) => { const lunes = sumarDias(ymd, 1 - dowYmd(ymd)); return { desde: lunes, hasta: sumarDias(lunes, 6) }; };
/** Semana anterior completa (lunes a domingo) respecto a hoy. */
export const semanaAnterior = (ahora = Date.now()) => semanaDe(sumarDias(hoyCDMX(ahora), -7));
/** Mes completo AAAA-MM. */
export function mesDe(ym) {
  const [y, m] = ym.split('-').map(Number);
  const ultimo = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { desde: `${ym}-01`, hasta: `${ym}-${String(ultimo).padStart(2, '0')}` };
}
/** Días de lunes a viernes entre dos fechas (inclusive). */
export function diasHabiles(desde, hasta) {
  let n = 0;
  for (let d = desde; d <= hasta; d = sumarDias(d, 1)) if (dowYmd(d) <= 5) n++;
  return n;
}

export const clavePersona = (v) => v.persona_id || String(v.correo ?? '').toLowerCase();
export const esImportada = (v) => Boolean(v.origen) && v.origen !== 'formulario';

/** Llegada puntual: dentro de la tolerancia, sin autorización especial. Las importadas no se evalúan. */
export const esPuntual = (v, tolerancia) =>
  Boolean(v.llegada_at) && !v.entrada_fuera_horario && !esImportada(v) &&
  new Date(v.llegada_at).getTime() <= new Date(v.entrada).getTime() + tolerancia * 60000;
/** Invitación vencida sin uso: nunca llegó y su horario ya terminó. */
export const sinUso = (v, ahora = Date.now()) =>
  !v.llegada_at && v.estado_aprobacion !== 'rechazada' && new Date(v.salida).getTime() < ahora;
/** Llegó, ya pasó su horario y no tiene salida registrada (no aplica a importadas). */
export const sinSalida = (v, ahora = Date.now()) =>
  Boolean(v.llegada_at) && !v.salida_real_at && !esImportada(v) && new Date(v.salida).getTime() < ahora;
/** En las oficinas ahora: llegó hoy o sigue dentro de su horario, y no ha salido. */
export const activoAhora = (v, ahora = Date.now()) =>
  Boolean(v.llegada_at) && !v.salida_real_at && !esImportada(v) &&
  (diaCDMX(v.llegada_at) === hoyCDMX(ahora) || new Date(v.salida).getTime() > ahora);

export function contar(lista, clave) {
  const m = new Map();
  for (const x of lista) {
    const k = clave(x);
    if (k == null || k === '') continue;
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])));
}

/** Indicadores principales de un conjunto de visitas. */
export function resumen(visitas, { tolerancia = 15, ahora = Date.now() } = {}) {
  const llegaron = visitas.filter((v) => v.llegada_at);
  const evaluables = llegaron.filter((v) => !esImportada(v));
  const puntuales = evaluables.filter((v) => esPuntual(v, tolerancia)).length;
  const horas = visitas
    .filter((v) => v.llegada_at && v.salida_real_at)
    .map((v) => (new Date(v.salida_real_at) - new Date(v.llegada_at)) / HORA)
    .filter((h) => h >= 0 && h < 24 * 7);
  return {
    total: visitas.length,
    unicos: new Set(visitas.map(clavePersona)).size,
    empresas: new Set(visitas.map((v) => String(v.empresa ?? '').trim().toLowerCase()).filter(Boolean)).size,
    llegaron: llegaron.length,
    puntuales,
    puntualidad: evaluables.length ? Math.round((puntuales / evaluables.length) * 100) : null,
    autorizadas: visitas.filter((v) => v.entrada_fuera_horario).length,
    sinUso: visitas.filter((v) => sinUso(v, ahora)).length,
    sinSalida: visitas.filter((v) => sinSalida(v, ahora)).length,
    rechazadas: visitas.filter((v) => v.estado_aprobacion === 'rechazada').length,
    duracionPromedio: horas.length ? Number((horas.reduce((a, b) => a + b, 0) / horas.length).toFixed(1)) : null,
  };
}

export const DIAS_LV = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes'];
export function porDiaLaboral(visitas) {
  const c = [0, 0, 0, 0, 0];
  for (const v of visitas) { const d = diaSemana(v.entrada); if (d >= 1 && d <= 5) c[d - 1]++; }
  return DIAS_LV.map((dia, i) => ({ dia, visitas: c[i] }));
}
export function horasPico(visitas, desde = 7, hasta = 20) {
  return Array.from({ length: hasta - desde }, (_, i) => {
    const h = desde + i;
    return { hora: `${String(h).padStart(2, '0')}:00`, llegadas: visitas.filter((v) => v.llegada_at && horaCDMX(v.llegada_at) === h).length };
  });
}
/** Promedio de visitantes presentes en cada franja de una hora, por día hábil del periodo. */
export function ocupacionPorFranja(visitas, dias, { desde = 7, hasta = 20, ahora = Date.now() } = {}) {
  const minutos = Array(hasta - desde).fill(0);
  for (const v of visitas) {
    if (!v.llegada_at) continue;
    const ini = new Date(v.llegada_at).getTime();
    const fin = v.salida_real_at ? new Date(v.salida_real_at).getTime()
      : esImportada(v) ? ini + HORA : Math.min(new Date(v.salida).getTime(), ahora);
    // Las horas de CDMX empiezan en hora exacta UTC (desfase de horas completas)
    for (let t = ini; t < fin;) {
      const corte = Math.min(fin, t - (t % HORA) + HORA);
      const h = horaCDMX(new Date(t).toISOString());
      if (h >= desde && h < hasta) minutos[h - desde] += (corte - t) / 60000;
      t = corte;
    }
  }
  const d = Math.max(1, dias);
  return minutos.map((m, i) => ({ franja: `${String(desde + i).padStart(2, '0')}:00`, promedio: Number((m / 60 / d).toFixed(2)) }));
}
export function topVisitantes(visitas, n = 10) {
  const m = new Map();
  for (const v of visitas) {
    const k = clavePersona(v);
    const x = m.get(k) ?? { nombre: v.nombre_completo, empresa: v.empresa, visitas: 0 };
    x.visitas++;
    m.set(k, x);
  }
  return [...m.values()].sort((a, b) => b.visitas - a.visitas || a.nombre.localeCompare(b.nombre)).slice(0, n);
}
/** "Nombre (Área)" → anfitrión y área. */
export function porAnfitrion(visitas) {
  return contar(visitas, (v) => v.persona_visita).map(([texto, n]) => {
    const m = String(texto).match(/^(.*?)\s*\(([^)]+)\)\s*$/);
    return { anfitrion: m ? m[1] : texto, area: m ? m[2] : '', visitas: n };
  });
}
/** Nuevos: personas sin visitas antes del periodo. Recurrentes: con visitas previas. */
export function nuevosVsRecurrentes(visitas, conHistorial) {
  const vistos = new Set();
  let nuevos = 0, recurrentes = 0;
  for (const v of visitas) {
    const k = clavePersona(v);
    if (vistos.has(k)) continue;
    vistos.add(k);
    if (conHistorial.has(k)) recurrentes++; else nuevos++;
  }
  return { nuevos, recurrentes };
}
