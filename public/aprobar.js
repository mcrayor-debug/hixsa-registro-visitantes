// Página que abre el anfitrión desde el correo para aprobar o rechazar una visita.
// Pide confirmar con un botón (los antivirus de correo que abren enlaces no aprueban nada).
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';

const TZ = 'America/Mexico_City';
const cfg = window.HIXSA_CONFIG ?? {};
const supabase = cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY
  ? createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, { auth: { persistSession: false } }) : null;
const params = new URLSearchParams(location.search);
const token = params.get('t') ?? '';
const sugerida = params.get('a') === 'rechazar' ? 'rechazar' : 'aprobar';
const card = document.getElementById('aprobar-card');
const fmt = new Intl.DateTimeFormat('es-MX', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', hour12: false });
const hora = new Intl.DateTimeFormat('es-MX', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false });

function el(tag, props = {}, ...hijos) {
  const n = document.createElement(tag);
  Object.entries(props).forEach(([k, v]) => (k === 'class' ? (n.className = v) : k.startsWith('on') ? n.addEventListener(k.slice(2), v) : n.setAttribute(k, v)));
  hijos.flat().forEach((h) => h != null && n.append(h instanceof Node ? h : String(h)));
  return n;
}
async function llamar(body) {
  const { data, error } = await supabase.functions.invoke('aprobar-visita', { body });
  if (error) {
    let c = null;
    try { c = await error.context.json(); } catch { /* sin cuerpo */ }
    return { error: c?.error ?? 'No se pudo completar. Revisa tu conexión e intenta de nuevo.', visita: c?.visita };
  }
  return data;
}
const detalle = (v) => el('dl', { class: 'pase-detalle' },
  el('dt', {}, 'Visitante'), el('dd', {}, v.visitante),
  el('dt', {}, 'Su empresa'), el('dd', {}, v.empresa_origen),
  el('dt', {}, 'Empresa a visitar'), el('dd', {}, v.empresa_visita),
  el('dt', {}, 'Motivo'), el('dd', {}, v.motivo),
  el('dt', {}, 'Horario'), el('dd', {}, `${fmt.format(new Date(v.entrada))} a ${hora.format(new Date(v.salida))}`),
  el('dt', {}, 'Folio'), el('dd', {}, v.folio));
function mensaje(titulo, texto, tipo, v) {
  card.dataset.resultado = tipo;
  card.replaceChildren(el('h1', {}, titulo), el('p', {}, texto), v ? detalle(v) : '');
}

async function iniciar() {
  if (!supabase || !/^[a-f0-9]{64}$/.test(token)) return mensaje('Enlace no válido', 'Abre el enlace completo desde el correo que recibiste.', 'invalido');
  const r = await llamar({ token, consultar: true });
  if (r.error) return mensaje('No se puede responder', r.error, 'invalido', r.visita);
  const v = r.visita;
  if (v.estado !== 'pendiente') {
    return mensaje(v.estado === 'aprobada' ? 'Visita ya aprobada' : 'Visita ya rechazada', 'Esta solicitud ya fue respondida.', 'aviso', v);
  }
  const responder = async (accion) => {
    card.querySelectorAll('button').forEach((b) => { b.disabled = true; });
    const res = await llamar({ token, accion });
    if (res.error) return mensaje('No se pudo guardar tu respuesta', res.error, 'invalido', res.visita ?? v);
    return accion === 'aprobar'
      ? mensaje('Visita aprobada', `Avisamos a ${v.visitante} por correo. Recepción registrará su llegada.`, 'valido', res.visita)
      : mensaje('Visita rechazada', `Avisamos a ${v.visitante} por correo. Recepción no registrará su entrada.`, 'invalido', res.visita);
  };
  const aprobar = el('button', { type: 'button', class: sugerida === 'aprobar' ? 'btn' : 'btn btn-secondary', onclick: () => responder('aprobar') }, 'Aprobar visita');
  const rechazar = el('button', { type: 'button', class: sugerida === 'rechazar' ? 'btn btn-peligro' : 'btn btn-secondary', onclick: () => responder('rechazar') }, 'Rechazar visita');
  card.dataset.resultado = '';
  card.replaceChildren(
    el('h1', {}, '¿Confirmas esta visita?'),
    el('p', { class: 'muted' }, 'Sin tu aprobación, Recepción no registrará la entrada.'),
    detalle(v),
    el('div', { class: 'aprobar-acciones' }, sugerida === 'rechazar' ? [rechazar, aprobar] : [aprobar, rechazar]),
  );
}
iniciar();
