// Página que abre el visitante o el anfitrión desde su correo para cancelar una visita (enlace de un solo uso).
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';

const TZ = 'America/Mexico_City';
const cfg = window.HIXSA_CONFIG ?? {};
const supabase = cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY
  ? createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, { auth: { persistSession: false } }) : null;
const token = new URLSearchParams(location.search).get('t') ?? '';
const card = document.getElementById('cancelar-card');
const fmt = new Intl.DateTimeFormat('es-MX', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', hour12: false });
const hora = new Intl.DateTimeFormat('es-MX', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false });

function el(tag, props = {}, ...hijos) {
  const n = document.createElement(tag);
  Object.entries(props).forEach(([k, v]) => (k === 'class' ? (n.className = v) : k.startsWith('on') ? n.addEventListener(k.slice(2), v) : n.setAttribute(k, v)));
  hijos.flat().forEach((h) => h != null && n.append(h instanceof Node ? h : String(h)));
  return n;
}
async function llamar(body) {
  const { data, error } = await supabase.functions.invoke('cancelar-visita', { body });
  if (error) {
    let c = null;
    try { c = await error.context.json(); } catch { /* sin cuerpo */ }
    return { error: c?.error ?? 'No se pudo completar. Revisa tu conexión e intenta de nuevo.', visita: c?.visita };
  }
  return data;
}
const detalle = (v) => el('dl', { class: 'pase-detalle' },
  el('dt', {}, 'Visitante'), el('dd', {}, v.visitante),
  el('dt', {}, 'Empresa a visitar'), el('dd', {}, v.empresa_visita),
  el('dt', {}, 'Visita a'), el('dd', {}, v.anfitrion),
  el('dt', {}, 'Horario'), el('dd', {}, `${fmt.format(new Date(v.entrada))} a ${hora.format(new Date(v.salida))}`),
  el('dt', {}, 'Folio'), el('dd', {}, v.folio));
function mensaje(titulo, texto, tipo, v) { card.dataset.resultado = tipo; card.replaceChildren(el('h1', {}, titulo), el('p', {}, texto), v ? detalle(v) : ''); }

async function iniciar() {
  if (!supabase || !/^[a-f0-9]{64}$/.test(token)) return mensaje('Enlace no válido', 'Abre el enlace completo desde el correo que recibiste.', 'invalido');
  const r = await llamar({ token, consultar: true });
  if (r.error) return mensaje('No se puede cancelar', r.error, 'invalido', r.visita);
  const v = r.visita;
  const sel = el('select', { id: 'motivo' }, el('option', { value: '' }, 'Elige el motivo'), ...r.motivos.map((m) => el('option', { value: m }, m === 'Otro' ? 'Otro (especificar)' : m)));
  const txt = el('input', { id: 'detalle', type: 'text', maxlength: '300', placeholder: 'Especifica el motivo' });
  const campoDetalle = el('div', { class: 'field' }, el('label', { for: 'detalle' }, 'Detalle'), txt);
  campoDetalle.hidden = true;
  sel.addEventListener('change', () => { campoDetalle.hidden = sel.value !== 'Otro'; });
  const err = el('p', { class: 'error', role: 'alert' });
  const boton = el('button', { type: 'button', class: 'btn btn-peligro', onclick: async () => {
    err.textContent = '';
    if (!sel.value) { err.textContent = 'Elige el motivo de la cancelación.'; return; }
    if (sel.value === 'Otro' && txt.value.trim().length < 3) { err.textContent = 'Especifica el motivo.'; return; }
    boton.disabled = true;
    const res = await llamar({ token, motivo: sel.value, detalle: txt.value.trim() || null });
    if (res.error) { boton.disabled = false; err.textContent = res.error; return; }
    mensaje('Visita cancelada', v.quien === 'anfitrion' ? 'Avisamos al visitante y a Recepción.' : 'Avisamos a tu anfitrión y a Recepción. Si necesitas reprogramarla, registra una visita nueva.', 'valido', v);
  } }, 'Cancelar visita');
  card.dataset.resultado = '';
  card.replaceChildren(
    el('h1', {}, v.quien === 'anfitrion' ? '¿Cancelar esta visita?' : '¿Cancelar tu visita?'),
    el('p', { class: 'muted' }, v.quien === 'anfitrion' ? 'Avisaremos al visitante por correo.' : 'Avisaremos a tu anfitrión por correo.'),
    detalle(v),
    el('div', { class: 'field' }, el('label', { for: 'motivo' }, '¿Por qué se cancela?'), sel), campoDetalle, err,
    el('div', { class: 'aprobar-acciones' }, boton),
  );
}
iniciar();
