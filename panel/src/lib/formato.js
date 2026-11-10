export const TZ = 'America/Mexico_City';
export const OFFSET = '-06:00'; // CDMX no usa horario de verano desde 2022

const fmt = (o) => new Intl.DateTimeFormat('es-MX', { timeZone: TZ, ...o });
export const fmtFechaHora = fmt({ day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
export const fmtHora = fmt({ hour: '2-digit', minute: '2-digit', hour12: false });
export const fmtLarga = fmt({ weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', hour12: false });
export const fmtDia = fmt({ day: '2-digit', month: 'short' });
const fmtCsv = fmt({ day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });

export const hoyCDMX = (dias = 0) => ymd.format(new Date(Date.now() + dias * 864e5));
export const diaCDMX = (iso) => ymd.format(new Date(iso));
export const horaCDMX = (iso) => Number(new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: '2-digit', hour12: false }).format(new Date(iso))) % 24;

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export const listaCorreos = (t) => [...new Set(t.split(/[\s,;]+/).map((s) => s.trim().toLowerCase()).filter(Boolean))];
export const MOTIVOS = ['Reunión', 'Entrevista', 'Proveedor o servicio', 'Entrega o paquetería', 'Otro'];

/** Estado real de la visita según llegada y salida registradas en recepción. */
export function estadoVisita(v, ahora = Date.now()) {
  if (v.salida_real_at) return { texto: 'Concluida', clave: 'concluida' };
  if (v.llegada_at) return { texto: 'En sitio', clave: 'sitio' };
  if (ahora > new Date(v.salida).getTime()) return { texto: 'No se presentó', clave: 'ausente' };
  if (ahora >= new Date(v.entrada).getTime() - 30 * 60e3) return { texto: 'Esperada', clave: 'esperada' };
  return { texto: 'Programada', clave: 'programada' };
}

/** Misma huella que genera la Edge Function al emitir el pase. */
export async function huella(v) {
  const texto = [v.folio, v.correo, new Date(v.entrada).toISOString(), new Date(v.salida).toISOString()].join('|');
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 12);
}

/** Interpreta el contenido de un QR: liga del pase, texto HIXSA|… o folio escrito. */
export function parsearQR(texto) {
  const t = String(texto ?? '').trim();
  try {
    const u = new URL(t);
    const folio = u.searchParams.get('pase');
    if (folio) return { folio: folio.toUpperCase(), h: u.searchParams.get('h') };
  } catch { /* no es URL */ }
  if (t.startsWith('HIXSA|')) {
    const p = t.split('|');
    return { folio: p[1]?.toUpperCase(), h: p[p.length - 1] };
  }
  const m = t.toUpperCase().match(/HX-[0-9A-Z]{6}-[0-9A-Z]{5}/);
  return m ? { folio: m[0], h: null } : null;
}

export function rangoPeriodo(rango) {
  const hoy = hoyCDMX();
  const [y, m] = hoy.split('-').map(Number);
  const ultimo = (yy, mm) => new Date(Date.UTC(yy, mm, 0)).getUTCDate();
  const p2 = (n) => String(n).padStart(2, '0');
  if (rango === 'semana') return { desde: hoy, hasta: hoyCDMX(6) };
  if (rango === '7d') return { desde: hoyCDMX(-6), hasta: hoy };
  if (rango === '30d') return { desde: hoyCDMX(-29), hasta: hoy };
  if (rango === 'mes') return { desde: `${y}-${p2(m)}-01`, hasta: `${y}-${p2(m)}-${ultimo(y, m)}` };
  if (rango === 'mes-anterior') {
    const py = m === 1 ? y - 1 : y, pm = m === 1 ? 12 : m - 1;
    return { desde: `${py}-${p2(pm)}-01`, hasta: `${py}-${p2(pm)}-${ultimo(py, pm)}` };
  }
  return { desde: hoy, hasta: hoy };
}

const COLS_CSV = [['folio', 'Folio'], ['nombre', 'Nombre'], ['apellidos', 'Apellidos'], ['empresa', 'Empresa de origen'], ['empresa_visita', 'Empresa a visitar'], ['correo', 'Correo'],
  ['telefono', 'Teléfono'], ['persona_visita', 'Visita a'], ['motivo', 'Motivo'], ['entrada', 'Entrada'],
  ['salida', 'Salida'], ['llegada_at', 'Llegada real'], ['salida_real_at', 'Salida real'],
  ['tipo_identificacion', 'Identificación'], ['comentarios', 'Comentarios']];
const FECHAS = new Set(['entrada', 'salida', 'llegada_at', 'salida_real_at']);

export function descargarCsv(filas, nombre) {
  const celda = (v) => {
    const s = String(v ?? '');
    return `"${(/^[=+\-@]/.test(s) ? `'${s}` : s).replace(/"/g, '""')}"`;
  };
  const cuerpo = filas.map((f) => COLS_CSV.map(([k]) =>
    celda(FECHAS.has(k) ? (f[k] ? fmtCsv.format(new Date(f[k])) : '') : k === 'empresa_visita' ? f.empresas?.nombre : f[k])).join(','));
  const csv = '\uFEFF' + [COLS_CSV.map(([, t]) => celda(t)).join(','), ...cuerpo].join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: nombre });
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
