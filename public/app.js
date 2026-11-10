// =====================================================================
// HIXSA - Registro de visitantes (formulario público)
// Valida, envía a la Edge Function `registrar-visita` y muestra el pase QR.
// =====================================================================
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';

const TZ = 'America/Mexico_City';
const OFFSET = '-06:00'; // CDMX no usa horario de verano desde 2022
const RESET_SECONDS = 90;
const OTRO = '__otro';
const MAX_LADO_FOTO = 1600; // px; la foto se reduce en el teléfono antes de enviarla

// ---------- Conexión ----------
const cfg = window.HIXSA_CONFIG ?? {};
const isConfigured = Boolean(cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY);
const supabase = isConfigured
  ? createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
  : null;
if (!isConfigured) console.warn('[HIXSA] Falta config.js. Ejecuta `npm run build`.');

// ---------- Referencias ----------
const $ = (sel) => document.querySelector(sel);
const form = $('#registro');
const statusBox = $('#estado');
const submitBtn = $('#enviar');
const successBox = $('#exito');
const comentarios = $('#comentarios');

// ---------- Anfitriones (directorio público: solo nombre y área) ----------
const selAnfitrion = $('#anfitrion');
const txtPersona = $('#persona_visita');

/** Llena la lista de anfitriones con los de la empresa elegida. */
function cargarAnfitriones() {
  const lista = (publico.anfitriones ?? []).filter((a) => !empresaElegida || (a.empresas ?? []).includes(empresaElegida.id));
  const opciones = [new Option(lista.length ? 'Elige a la persona' : 'Escribe a quién visitas', '')];
  lista.forEach((a) => opciones.push(new Option(a.area ? `${a.nombre} (${a.area})` : a.nombre, a.id)));
  opciones.push(new Option('Otra persona o área', OTRO));
  selAnfitrion.replaceChildren(...opciones);
  if (!lista.length) { selAnfitrion.value = OTRO; mostrarOtraPersona(); }
}
function mostrarOtraPersona() {
  const otro = selAnfitrion.value === OTRO;
  txtPersona.hidden = !otro;
  if (otro) txtPersona.focus({ preventScroll: true });
}
selAnfitrion.addEventListener('change', () => { mostrarOtraPersona(); validateField('persona_visita'); });

// ---------- Bienvenida: empresas y logo (datos públicos de config_publica) ----------
const LOGO_COLOR = 'img/logo-hixsa.png';
let publico = { modo_auditoria: false, logo_url: null, empresas: [], anfitriones: [] };
let empresaElegida = null;

function mostrarVista(nombre) {
  $('#vista-bienvenida').hidden = nombre !== 'bienvenida';
  $('#vista-registro').hidden = nombre !== 'registro';
  window.scrollTo({ top: 0 });
}

/** Tarjeta de empresa: su logo si lo tiene; si no, su nombre en un recuadro. */
function tarjetaEmpresa(e, grande) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = grande ? 'empresa-boton empresa-boton-grande' : 'empresa-boton';
  b.setAttribute('aria-label', `Visitar ${e.nombre}`);
  const logo = e.logo_url || (e.es_principal ? (publico.logo_url || LOGO_COLOR) : null);
  if (logo) {
    const img = document.createElement('img');
    img.src = logo;
    img.alt = '';
    img.className = 'empresa-logo';
    b.append(img);
  } else {
    const t = document.createElement('span');
    t.className = 'empresa-nombre-logo';
    t.textContent = e.nombre;
    b.append(t);
  }
  const pie = document.createElement('span');
  pie.className = 'empresa-pie';
  pie.textContent = grande ? 'Registrarse' : e.nombre;
  b.append(pie);
  b.addEventListener('click', () => elegirEmpresa(e));
  return b;
}

function pintarBienvenida() {
  const botones = $('#empresas-botones');
  const lista = $('#empresas-lista');
  const principal = publico.empresas.find((e) => e.es_principal) ?? publico.empresas[0];
  if (publico.modo_auditoria) {
    // Modo auditoría: solo HIXSA, como un solo botón grande
    botones.replaceChildren(...(principal ? [tarjetaEmpresa(principal, true)] : []));
    $('#empresas-otras').hidden = true;
    $('#bienvenida-texto').textContent = 'Toca el logotipo para registrar tu visita. Al terminar recibirás en tu correo un pase con código QR.';
  } else {
    botones.replaceChildren(...publico.empresas.filter((e) => e.mostrar_como === 'boton').map((e) => tarjetaEmpresa(e, false)));
    const otras = publico.empresas.filter((e) => e.mostrar_como !== 'boton');
    lista.replaceChildren(...otras.map((e) => {
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'empresa-fila';
      b.textContent = e.nombre;
      b.addEventListener('click', () => elegirEmpresa(e));
      li.append(b);
      return li;
    }));
    $('#empresas-otras').hidden = !otras.length;
  }
  if (!publico.empresas.length) {
    const box = $('#bienvenida-estado');
    box.textContent = 'No hay empresas configuradas. Avisa en recepción.';
    box.hidden = false;
  }
}

function elegirEmpresa(e) {
  empresaElegida = e;
  $('#empresa-elegida').textContent = e.nombre;
  $('#cambiar-empresa').hidden = publico.modo_auditoria;
  cargarAnfitriones();
  mostrarVista('registro');
  form.elements.nombre.focus({ preventScroll: true });
}
$('#cambiar-empresa').addEventListener('click', () => mostrarVista('bienvenida'));

async function cargarPublico() {
  if (supabase) {
    const { data, error } = await supabase.rpc('config_publica');
    if (!error && data) publico = data;
  }
  // Logo configurado en el panel (si existe) para la bienvenida
  if (publico.logo_url) document.querySelectorAll('[data-logo="color"]').forEach((img) => { img.src = publico.logo_url; });
  pintarBienvenida();
  if (!supabase) {
    const box = $('#bienvenida-estado');
    box.textContent = 'El sitio aún no está conectado. Falta configurar SUPABASE_URL y SUPABASE_ANON_KEY.';
    box.hidden = false;
  }
}

// ---------- Foto de identificación ----------
let fotoDataUrl = null;
const inputFoto = $('#foto_identificacion');

/** Reduce la foto a máx. 1600 px y la convierte a JPEG para enviarla ligera. */
function comprimir(file) {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) return reject(new Error('tipo'));
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const escala = Math.min(1, MAX_LADO_FOTO / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement('canvas');
      c.width = Math.round(img.naturalWidth * escala);
      c.height = Math.round(img.naturalHeight * escala);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/jpeg', 0.82));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('lectura')); };
    img.src = url;
  });
}

inputFoto.addEventListener('change', async () => {
  const file = inputFoto.files?.[0];
  if (!file) return;
  try {
    fotoDataUrl = await comprimir(file);
    $('#foto-preview').src = fotoDataUrl;
    $('#foto-preview').hidden = false;
    $('#foto-vacia').hidden = true;
    $('#foto-boton').textContent = 'Cambiar foto';
    setError('foto_identificacion', '');
  } catch {
    fotoDataUrl = null;
    setError('foto_identificacion', 'No pudimos leer esa imagen. Toma la foto de nuevo.');
  }
  inputFoto.value = '';
});

function limpiarFoto() {
  fotoDataUrl = null;
  $('#foto-preview').hidden = true;
  $('#foto-preview').removeAttribute('src');
  $('#foto-vacia').hidden = false;
  $('#foto-boton').textContent = 'Tomar foto';
}

form.addEventListener('change', (e) => {
  if (e.target.name === 'tipo_identificacion') {
    $('#detalle-field').hidden = e.target.value !== 'Otro';
    if (e.target.value !== 'Otro') setError('identificacion_detalle', '');
  }
});

// ---------- Fechas ----------
const timeFmt = new Intl.DateTimeFormat('es-MX', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: TZ });
const dateFmt = new Intl.DateTimeFormat('es-MX', { weekday: 'long', day: 'numeric', month: 'long', timeZone: TZ });
const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const pad = (n) => String(n).padStart(2, '0');

/** Fecha y hora "de pared" en CDMX para un instante dado. */
function partesCDMX(d) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
      .formatToParts(d).map((x) => [x.type, x.value]),
  );
  return { fecha: `${p.year}-${p.month}-${p.day}`, hora: `${p.hour === '24' ? '00' : p.hour}:${p.minute}` };
}
/** Convierte fecha (YYYY-MM-DD) + hora (HH:MM) de CDMX a Date. */
function aInstante(fecha, hora) {
  if (!fecha || !hora) return null;
  const d = new Date(`${fecha}T${hora}:00${OFFSET}`);
  return isNaN(d) ? null : d;
}

const els = {
  fe: form.elements.fecha_entrada, he: form.elements.hora_entrada,
  fs: form.elements.fecha_salida, hs: form.elements.hora_salida,
};

function horarioPorDefecto() {
  const ahora = new Date();
  const inicio = new Date(Math.ceil(ahora.getTime() / (15 * 60e3)) * 15 * 60e3); // siguiente cuarto de hora
  const fin = new Date(inicio.getTime() + 60 * 60e3);
  const a = partesCDMX(inicio), b = partesCDMX(fin);
  els.fe.value = a.fecha; els.he.value = a.hora;
  els.fs.value = b.fecha; els.hs.value = b.hora;
  els.fe.min = partesCDMX(ahora).fecha;
  els.fs.min = els.fe.value;
  actualizarResumen();
}

function actualizarResumen() {
  const ent = aInstante(els.fe.value, els.he.value);
  const sal = aInstante(els.fs.value, els.hs.value);
  $('#resumen-hora').textContent = ent ? timeFmt.format(ent) : '--:--';
  if (ent) $('#resumen-hora').setAttribute('datetime', ent.toISOString());
  $('#resumen-fecha').textContent = ent ? capitalize(dateFmt.format(ent)) : '';
  if (sal && ent && sal > ent) {
    const mismoDia = els.fs.value === els.fe.value;
    $('#resumen-salida').textContent = mismoDia
      ? `Salida a las ${timeFmt.format(sal)}`
      : `Salida el ${dateFmt.format(sal)} a las ${timeFmt.format(sal)}`;
  } else {
    $('#resumen-salida').textContent = '';
  }
}

// Si la entrada se mueve después de la salida, la salida se recorre 1 hora después.
function ajustarSalida() {
  const ent = aInstante(els.fe.value, els.he.value);
  const sal = aInstante(els.fs.value, els.hs.value);
  els.fs.min = els.fe.value;
  if (ent && (!sal || sal <= ent)) {
    const p = partesCDMX(new Date(ent.getTime() + 60 * 60e3));
    els.fs.value = p.fecha; els.hs.value = p.hora;
  }
}
[els.fe, els.he].forEach((el) => el.addEventListener('change', () => { ajustarSalida(); actualizarResumen(); }));
[els.fs, els.hs].forEach((el) => el.addEventListener('change', actualizarResumen));

// ---------- Validación ----------
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const digits = (v) => v.replace(/\D/g, '');

const rules = {
  nombre: (v) => (v.length < 1 ? 'Escribe tu nombre.' : ''),
  apellidos: (v) => (v.length < 2 ? 'Escribe tus apellidos.' : ''),
  empresa: (v) => (v.length < 2 ? 'Escribe el nombre de tu empresa, o “Particular”.' : ''),
  telefono: (v) => {
    const n = digits(v).length;
    return n < 10 || n > 15 ? 'Escribe un teléfono de al menos 10 dígitos.' : '';
  },
  correo: (v) => {
    if (!v) return 'Escribe tu correo electrónico; ahí te enviaremos tu pase.';
    return EMAIL_RE.test(v) ? '' : 'Revisa el correo; debe verse como nombre@empresa.com.';
  },
  entrada: () => {
    const ent = aInstante(els.fe.value, els.he.value);
    if (!ent) return 'Elige la fecha y la hora de entrada.';
    if (ent.getTime() < Date.now() - 2 * 3600e3) return 'La entrada no puede ser en el pasado.';
    if (ent.getTime() > Date.now() + 90 * 864e5) return 'Solo se aceptan visitas en los próximos 90 días.';
    return '';
  },
  salida: () => {
    const ent = aInstante(els.fe.value, els.he.value);
    const sal = aInstante(els.fs.value, els.hs.value);
    if (!sal) return 'Elige la fecha y la hora de salida.';
    if (ent && sal <= ent) return 'La salida debe ser después de la entrada.';
    if (ent && sal - ent > 7 * 864e5) return 'La visita puede durar máximo 7 días.';
    return '';
  },
  persona_visita: () => {
    if (!selAnfitrion.value) return 'Elige a quién visitas.';
    if (selAnfitrion.value === OTRO && txtPersona.value.trim().length < 3) return 'Escribe el nombre de la persona o el área que visitas.';
    return '';
  },
  tipo_identificacion: (v) => (v ? '' : 'Elige el tipo de identificación.'),
  identificacion_detalle: () => (form.elements.tipo_identificacion.value === 'Otro' && form.elements.identificacion_detalle.value.trim().length < 2
    ? 'Escribe qué identificación es.' : ''),
  foto_identificacion: () => (fotoDataUrl ? '' : 'Toma o adjunta la foto de tu identificación.'),
  motivo: (v) => (v ? '' : 'Elige el motivo de tu visita.'),
  comentarios: (v) => (v.length > 500 ? 'Los comentarios admiten hasta 500 caracteres.' : ''),
  acepta_aviso: (v) => (v ? '' : 'Para registrarte, acepta el aviso de privacidad.'),
};

const COMPUESTOS = {
  entrada: [els.fe, els.he],
  salida: [els.fs, els.hs],
};

function getValue(name) {
  if (COMPUESTOS[name] || name === 'persona_visita' || name === 'foto_identificacion') return '';
  const el = form.elements[name];
  if (el instanceof RadioNodeList) return el.value;
  if (el.type === 'checkbox') return el.checked;
  return el.value.trim();
}

function targetsFor(name) {
  if (name === 'motivo') return [$('#motivo-group')];
  if (name === 'tipo_identificacion') return [$('#tipo_identificacion-group')];
  if (name === 'foto_identificacion') return [$('#foto-box')];
  if (name === 'persona_visita') return [selAnfitrion, txtPersona];
  return COMPUESTOS[name] ?? [form.elements[name]];
}

function setError(name, message) {
  const box = $(`#${name}-error`);
  if (box) box.textContent = message;
  targetsFor(name).forEach((t) => (message ? t.setAttribute('aria-invalid', 'true') : t.removeAttribute('aria-invalid')));
}

function validateField(name) {
  const message = rules[name](getValue(name));
  setError(name, message);
  return !message;
}

function focusField(name) {
  const el = name === 'motivo' || name === 'tipo_identificacion' ? form.querySelector(`input[name="${name}"]`)
    : name === 'foto_identificacion' ? $('#foto-box')
      : name === 'persona_visita' && selAnfitrion.value === OTRO ? txtPersona : targetsFor(name)[0];
  if (name === 'foto_identificacion') { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); return; }
  el.focus({ preventScroll: true });
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

const campoDe = (el) => {
  if (el === els.fe || el === els.he) return 'entrada';
  if (el === els.fs || el === els.hs) return 'salida';
  return el.name;
};

form.addEventListener('focusout', (e) => {
  const name = campoDe(e.target);
  if (!rules[name] || e.target.type === 'radio' || e.target.type === 'checkbox' || e.target.type === 'file') return;
  if (COMPUESTOS[name] || e.target.value.trim() !== '') validateField(name);
});
form.addEventListener('input', (e) => {
  const name = campoDe(e.target);
  if (rules[name] && targetsFor(name)[0].getAttribute('aria-invalid') === 'true') validateField(name);
});
form.addEventListener('change', (e) => {
  const name = campoDe(e.target);
  if (name === 'motivo' || name === 'acepta_aviso' || name === 'tipo_identificacion') validateField(name);
  if (COMPUESTOS[name]) { validateField('entrada'); validateField('salida'); }
});

comentarios.addEventListener('input', () => {
  $('#comentarios-count').textContent = `${comentarios.value.length} / 500`;
});

// ---------- Estados ----------
function showStatus(message) { statusBox.textContent = message; statusBox.hidden = false; }
function clearStatus() { statusBox.textContent = ''; statusBox.hidden = true; }
function setLoading(loading) {
  submitBtn.disabled = loading;
  submitBtn.textContent = loading ? 'Registrando…' : 'Registrar mi visita';
}

let resetTimer = null;

function showSuccess(nombre, correo, r) {
  const ent = new Date(r.entrada), sal = new Date(r.salida);
  $('#exito-nombre').textContent = nombre.split(/\s+/)[0];
  $('#exito-folio').textContent = r.folio;
  $('#exito-entrada').textContent = `${capitalize(dateFmt.format(ent))}, ${timeFmt.format(ent)} h`;
  $('#exito-salida').textContent = `${capitalize(dateFmt.format(sal))}, ${timeFmt.format(sal)} h`;
  const img = $('#exito-qr');
  const descargar = $('#exito-descargar');
  if (r.qr) {
    img.src = r.qr;
    img.alt = `Código QR del pase ${r.folio}`;
    descargar.href = r.qr;
    descargar.download = `pase-${r.folio}.png`;
    descargar.hidden = false;
  } else {
    img.removeAttribute('src');
    descargar.hidden = true;
  }
  $('#exito-correo').textContent = r.correo_enviado
    ? `También te enviamos este pase a ${correo}. Muéstralo en recepción al llegar.`
    : 'No pudimos enviar el correo en este momento. Descarga el pase o toma una captura de pantalla para mostrarlo en recepción.';

  form.hidden = true;
  successBox.hidden = false;
  successBox.focus();
  window.scrollTo({ top: 0, behavior: 'smooth' });

  let remaining = RESET_SECONDS;
  const label = $('#exito-reset');
  const pintar = () => (label.textContent = `Esta pantalla vuelve al formulario en ${remaining} s.`);
  pintar();
  clearInterval(resetTimer);
  resetTimer = setInterval(() => {
    remaining -= 1;
    pintar();
    if (remaining <= 0) resetForm();
  }, 1000);
}

function resetForm() {
  clearInterval(resetTimer);
  form.reset();
  Object.keys(rules).forEach((name) => setError(name, ''));
  clearStatus();
  $('#comentarios-count').textContent = '0 / 500';
  horarioPorDefecto();
  limpiarFoto();
  $('#detalle-field').hidden = true;
  txtPersona.hidden = selAnfitrion.value !== OTRO;
  successBox.hidden = true;
  form.hidden = false;
  window.scrollTo({ top: 0 });
  mostrarVista('bienvenida');
}
$('#nuevo').addEventListener('click', resetForm);

// ---------- Errores del servidor ----------
async function leerErrorFuncion(error) {
  // FunctionsHttpError trae la respuesta original en error.context
  try {
    if (error?.context && typeof error.context.json === 'function') return await error.context.json();
  } catch { /* respuesta sin JSON */ }
  return null;
}

function mensajeGeneral(error, cuerpo) {
  if (cuerpo?.error) return cuerpo.error;
  const msg = String(error?.message ?? '');
  if (!navigator.onLine || /Failed to fetch|NetworkError|Load failed|FunctionsFetchError/i.test(msg + error?.name)) {
    return 'No hay conexión con el servidor. Revisa tu internet e intenta de nuevo.';
  }
  return 'No se pudo registrar tu visita. Intenta de nuevo o avisa en recepción.';
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

  if (!supabase) {
    showStatus('El formulario aún no está conectado. Falta configurar SUPABASE_URL y SUPABASE_ANON_KEY.');
    return;
  }

  const nombre = getValue('nombre');
  const correo = getValue('correo').toLowerCase();
  const body = {
    nombre,
    apellidos: getValue('apellidos'),
    empresa_visita_id: empresaElegida?.id ?? null,
    empresa: getValue('empresa'),
    correo,
    telefono: getValue('telefono'),
    anfitrion_id: selAnfitrion.value && selAnfitrion.value !== OTRO ? selAnfitrion.value : null,
    persona_visita: selAnfitrion.value === OTRO ? txtPersona.value.trim() : selAnfitrion.selectedOptions[0].text,
    tipo_identificacion: form.elements.tipo_identificacion.value,
    identificacion_detalle: form.elements.tipo_identificacion.value === 'Otro' ? form.elements.identificacion_detalle.value.trim() : null,
    foto_identificacion: fotoDataUrl,
    motivo: getValue('motivo'),
    comentarios: getValue('comentarios') || null,
    entrada: aInstante(els.fe.value, els.he.value).toISOString(),
    salida: aInstante(els.fs.value, els.hs.value).toISOString(),
    acepta_aviso: true,
    sitio_web: form.elements.sitio_web.value, // trampa anti-bots
  };

  setLoading(true);
  try {
    const { data, error } = await supabase.functions.invoke('registrar-visita', { body });
    if (error) {
      const cuerpo = await leerErrorFuncion(error);
      if (cuerpo?.campos?.empresa_visita) {
        mostrarVista('bienvenida');
        const box = $('#bienvenida-estado');
        box.textContent = 'Esa empresa ya no está disponible. Elige otra.';
        box.hidden = false;
      }
      if (cuerpo?.campos) {
        Object.entries(cuerpo.campos).forEach(([campo, msg]) => rules[campo] && setError(campo, msg));
        const primero = Object.keys(cuerpo.campos).find((c) => rules[c]);
        if (primero) focusField(primero);
      }
      showStatus(mensajeGeneral(error, cuerpo));
      return;
    }
    showSuccess(nombre, correo, data);
  } catch (error) {
    console.error('[HIXSA] Error al registrar:', error);
    showStatus(mensajeGeneral(error));
  } finally {
    setLoading(false);
  }
});

horarioPorDefecto();
cargarPublico();
