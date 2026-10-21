// =====================================================================
// HIXSA - Registro de visitantes
// Validación del formulario y envío a Supabase.
// =====================================================================
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';

const TABLE = 'visitantes';
const TZ = 'America/Mexico_City';
const RESET_SECONDS = 30; // la confirmación vuelve al formulario sola (modo recepción)

// ---------- Conexión a Supabase ----------
const cfg = window.HIXSA_CONFIG ?? {};
const isConfigured = Boolean(cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY);
const supabase = isConfigured
  ? createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  : null;

if (!isConfigured) {
  console.warn('[HIXSA] Falta config.js con SUPABASE_URL y SUPABASE_ANON_KEY. Ejecuta `npm run build`.');
}

// ---------- Referencias ----------
const $ = (sel) => document.querySelector(sel);
const form = $('#registro');
const statusBox = $('#estado');
const submitBtn = $('#enviar');
const successBox = $('#exito');
const comentarios = $('#comentarios');

// ---------- Reloj de llegada ----------
const timeFmt = new Intl.DateTimeFormat('es-MX', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: TZ });
const dateFmt = new Intl.DateTimeFormat('es-MX', { weekday: 'long', day: 'numeric', month: 'long', timeZone: TZ });
const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);

function tick() {
  const now = new Date();
  const reloj = $('#reloj');
  reloj.textContent = timeFmt.format(now);
  reloj.setAttribute('datetime', now.toISOString());
  $('#fecha').textContent = capitalize(dateFmt.format(now));
}
tick();
setInterval(tick, 1000);

// ---------- Reglas de validación ----------
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const digits = (v) => v.replace(/\D/g, '');

const rules = {
  nombre_completo: (v) =>
    v.length < 3 ? 'Escribe tu nombre y apellido.' : '',
  empresa: (v) =>
    v.length < 2 ? 'Escribe el nombre de tu empresa, o “Particular”.' : '',
  telefono: (v) => {
    const n = digits(v).length;
    return n < 10 || n > 15 ? 'Escribe un teléfono de al menos 10 dígitos.' : '';
  },
  correo: (v) => {
    if (!v) return 'Escribe tu correo electrónico.';
    return EMAIL_RE.test(v) ? '' : 'Revisa el correo; debe verse como nombre@empresa.com.';
  },
  persona_visita: (v) =>
    v.length < 3 ? 'Escribe el nombre de la persona o el área que visitas.' : '',
  motivo: (v) =>
    v ? '' : 'Elige el motivo de tu visita.',
  comentarios: (v) =>
    v.length > 500 ? 'Los comentarios admiten hasta 500 caracteres.' : '',
  acepta_aviso: (v) =>
    v ? '' : 'Para registrarte, acepta el aviso de privacidad.',
};

function getValue(name) {
  const el = form.elements[name];
  if (el instanceof RadioNodeList) return el.value;
  if (el.type === 'checkbox') return el.checked;
  return el.value.trim();
}

function targetFor(name) {
  return name === 'motivo' ? $('#motivo-group') : form.elements[name];
}

function setError(name, message) {
  $(`#${name}-error`).textContent = message;
  const target = targetFor(name);
  if (message) target.setAttribute('aria-invalid', 'true');
  else target.removeAttribute('aria-invalid');
}

function validateField(name) {
  const message = rules[name](getValue(name));
  setError(name, message);
  return !message;
}

function focusField(name) {
  const el = name === 'motivo' ? form.querySelector('input[name="motivo"]') : form.elements[name];
  el.focus({ preventScroll: true });
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

// Valida al salir del campo (solo si ya escribió algo) y corrige en vivo si había error.
form.addEventListener('focusout', (e) => {
  const { name } = e.target;
  if (!rules[name] || e.target.type === 'radio' || e.target.type === 'checkbox') return;
  if (e.target.value.trim() !== '') validateField(name);
});
form.addEventListener('input', (e) => {
  const { name } = e.target;
  if (rules[name] && targetFor(name).getAttribute('aria-invalid') === 'true') validateField(name);
});
form.addEventListener('change', (e) => {
  if (e.target.name === 'motivo' || e.target.name === 'acepta_aviso') validateField(e.target.name);
});

// Contador de comentarios
comentarios.addEventListener('input', () => {
  $('#comentarios-count').textContent = `${comentarios.value.length} / 500`;
});

// ---------- Estados de la interfaz ----------
function showStatus(message) {
  statusBox.textContent = message;
  statusBox.hidden = false;
}
function clearStatus() {
  statusBox.textContent = '';
  statusBox.hidden = true;
}
function setLoading(loading) {
  submitBtn.disabled = loading;
  submitBtn.textContent = loading ? 'Registrando…' : 'Registrar mi visita';
}

let resetTimer = null;

function showSuccess(nombre) {
  $('#exito-nombre').textContent = nombre.split(/\s+/)[0];
  $('#exito-hora').textContent = timeFmt.format(new Date());
  form.hidden = true;
  successBox.hidden = false;
  successBox.focus();
  window.scrollTo({ top: 0, behavior: 'smooth' });

  let remaining = RESET_SECONDS;
  const label = $('#exito-reset');
  label.textContent = `Esta pantalla vuelve al formulario en ${remaining} s.`;
  clearInterval(resetTimer);
  resetTimer = setInterval(() => {
    remaining -= 1;
    label.textContent = `Esta pantalla vuelve al formulario en ${remaining} s.`;
    if (remaining <= 0) resetForm();
  }, 1000);
}

function resetForm() {
  clearInterval(resetTimer);
  form.reset();
  Object.keys(rules).forEach((name) => setError(name, ''));
  clearStatus();
  $('#comentarios-count').textContent = '0 / 500';
  successBox.hidden = true;
  form.hidden = false;
  window.scrollTo({ top: 0 });
  form.elements.nombre_completo.focus({ preventScroll: true });
}
$('#nuevo').addEventListener('click', resetForm);

// ---------- Traducción de errores de Supabase ----------
function messageFor(error) {
  const msg = String(error?.message ?? '');
  if (!navigator.onLine || /Failed to fetch|NetworkError|Load failed/i.test(msg)) {
    return 'No hay conexión con el servidor. Revisa tu internet e intenta de nuevo.';
  }
  switch (error?.code) {
    case '23514':
      return 'Uno de los datos no tiene el formato esperado. Revísalos e intenta de nuevo.';
    case '42501':
      return 'El servidor rechazó el registro por permisos. Avisa en recepción (revisar políticas RLS en Supabase).';
    case '42P01':
    case 'PGRST205':
      return 'No existe la tabla de visitantes. El administrador debe ejecutar supabase/schema.sql.';
    default:
      return 'No se pudo registrar tu visita. Intenta de nuevo o avisa en recepción.';
  }
}

// ---------- Envío ----------
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  clearStatus();

  const invalid = Object.keys(rules).filter((name) => !validateField(name));
  if (invalid.length) {
    showStatus(invalid.length === 1 ? 'Revisa el campo marcado en rojo.' : `Revisa los ${invalid.length} campos marcados en rojo.`);
    focusField(invalid[0]);
    return;
  }

  const nombre = getValue('nombre_completo');

  // Trampa anti-bots: si se llenó el campo oculto, simulamos éxito sin guardar.
  if (form.elements.sitio_web.value) {
    showSuccess(nombre);
    return;
  }

  if (!supabase) {
    showStatus('El formulario aún no está conectado a la base de datos. Falta configurar SUPABASE_URL y SUPABASE_ANON_KEY.');
    return;
  }

  const telefono = getValue('telefono');
  const payload = {
    nombre_completo: nombre.replace(/\s+/g, ' '),
    empresa: getValue('empresa').replace(/\s+/g, ' '),
    correo: getValue('correo').toLowerCase(),
    telefono: (telefono.startsWith('+') ? '+' : '') + digits(telefono),
    persona_visita: getValue('persona_visita').replace(/\s+/g, ' '),
    motivo: getValue('motivo'),
    comentarios: getValue('comentarios') || null,
    acepta_aviso: true,
  };

  setLoading(true);
  try {
    // insert sin .select(): no se pide leer nada de vuelta (anon no tiene SELECT).
    const { error } = await supabase.from(TABLE).insert(payload);
    if (error) throw error;
    showSuccess(nombre);
  } catch (error) {
    console.error('[HIXSA] Error al registrar:', error);
    showStatus(messageFor(error));
  } finally {
    setLoading(false);
  }
});
