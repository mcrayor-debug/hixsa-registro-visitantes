// =====================================================================
// HIXSA - Panel de visitas (requiere inicio de sesión)
// Consultas y reportes para todos los usuarios activos;
// Configuración (usuarios y correos) solo para administradores.
// =====================================================================
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';

const TZ = 'America/Mexico_City';
const OFFSET = '-06:00';
const LIMITE = 1000;

const cfg = window.HIXSA_CONFIG ?? {};
const supabase = cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY
  ? createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY)
  : null;

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

const estado = { perfil: null, filas: [], filtros: {}, config: null, usuarios: [] };

// ---------- Utilidades ----------
const fechaHora = new Intl.DateTimeFormat('es-MX', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: TZ });
const fechaLarga = new Intl.DateTimeFormat('es-MX', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: TZ });
const fechaCsv = new Intl.DateTimeFormat('es-MX', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: TZ });
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function hoyCDMX(desplazamientoDias = 0) {
  const d = new Date(Date.now() + desplazamientoDias * 864e5);
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

/** Crea un elemento con texto seguro (nunca innerHTML con datos del usuario). */
function el(tag, props = {}, ...hijos) {
  const n = document.createElement(tag);
  Object.entries(props).forEach(([k, v]) => {
    if (k === 'class') n.className = v;
    else if (k === 'dataset') Object.assign(n.dataset, v);
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null && v !== false) n.setAttribute(k, v === true ? '' : v);
  });
  hijos.flat().forEach((h) => h !== null && h !== undefined && n.append(h instanceof Node ? h : String(h)));
  return n;
}

function mostrarEstado(box, msg, tipo = 'error') {
  box.textContent = msg;
  box.dataset.tipo = tipo;
  box.hidden = !msg;
}

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 4000);
}

async function errorDeFuncion(error) {
  try {
    if (error?.context?.json) return (await error.context.json()).error;
  } catch { /* sin cuerpo */ }
  return null;
}

async function invocar(nombre, body) {
  const { data, error } = await supabase.functions.invoke(nombre, { body });
  if (error) throw new Error((await errorDeFuncion(error)) ?? 'No se pudo completar la acción. Intenta de nuevo.');
  return data;
}

function estadoVisita(v) {
  const ahora = Date.now();
  if (ahora < new Date(v.entrada)) return ['Programada', 'programada'];
  if (ahora <= new Date(v.salida)) return ['En curso', 'curso'];
  return ['Concluida', 'concluida'];
}

function listaCorreos(texto) {
  return [...new Set(texto.split(/[\s,;]+/).map((s) => s.trim().toLowerCase()).filter(Boolean))];
}

// ---------- Vistas ----------
const VISTAS = ['login', 'pase', 'consultas', 'configuracion'];
function mostrarVista(nombre) {
  VISTAS.forEach((v) => ($(`#vista-${v}`).hidden = v !== nombre));
  const conSesion = nombre !== 'login';
  $('#tabs').hidden = !conSesion;
  $('#user').hidden = !conSesion;
  $$('.tab').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.tab === nombre)));
}

$$('.tab').forEach((t) => t.addEventListener('click', () => irA(t.dataset.tab)));

function irA(tab) {
  if (tab === 'configuracion' && estado.perfil?.rol !== 'admin') tab = 'consultas';
  mostrarVista(tab);
  history.replaceState(null, '', `${location.pathname}#${tab}`);
  if (tab === 'configuracion') cargarConfiguracion();
}

// ---------- Sesión ----------
async function iniciar() {
  if (!supabase) {
    mostrarVista('login');
    mostrarEstado($('#login-estado'), 'El panel no está configurado: falta config.js (SUPABASE_URL y SUPABASE_ANON_KEY).');
    return;
  }
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return mostrarVista('login');
  await entrar(session.user);
}

async function entrar(user) {
  const { data: perfil } = await supabase
    .from('perfiles').select('id, email, nombre, rol, activo').eq('id', user.id).maybeSingle();
  if (!perfil || !perfil.activo) {
    await supabase.auth.signOut();
    mostrarVista('login');
    mostrarEstado($('#login-estado'), 'Tu cuenta no tiene acceso al panel. Pide a un administrador que la active.');
    return;
  }
  estado.perfil = perfil;
  $('#user-name').textContent = perfil.nombre;
  $('#user-rol').textContent = perfil.rol === 'admin' ? 'Administrador' : 'Consulta';
  $('#tab-configuracion').hidden = perfil.rol !== 'admin';

  // Configuración (destinatarios por defecto del reporte)
  const { data: conf } = await supabase.from('configuracion').select('*').eq('id', 1).maybeSingle();
  estado.config = conf;

  aplicarRango('hoy');
  await buscar();

  const params = new URLSearchParams(location.search);
  if (params.get('pase')) return validarPase(params.get('pase'), params.get('h'));
  irA(location.hash === '#configuracion' ? 'configuracion' : 'consultas');
}

$('#form-login').addEventListener('submit', async (e) => {
  e.preventDefault();
  const box = $('#login-estado');
  mostrarEstado(box, '');
  const email = $('#login-email').value.trim();
  const password = $('#login-password').value;
  if (!EMAIL_RE.test(email) || !password) return mostrarEstado(box, 'Escribe tu correo y tu contraseña.');
  const btn = $('#btn-login');
  btn.disabled = true;
  btn.textContent = 'Entrando…';
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  btn.disabled = false;
  btn.textContent = 'Entrar';
  if (error) {
    const msg = /invalid/i.test(error.message) ? 'Correo o contraseña incorrectos.'
      : /banned/i.test(error.message) ? 'Tu cuenta está desactivada.' : 'No se pudo iniciar sesión. Intenta de nuevo.';
    return mostrarEstado(box, msg);
  }
  $('#login-password').value = '';
  await entrar(data.user);
});

$('#btn-salir').addEventListener('click', async () => {
  await supabase.auth.signOut();
  estado.perfil = null;
  history.replaceState(null, '', location.pathname);
  mostrarVista('login');
});

// ---------- Validación de pase (QR) ----------
async function huella(v) {
  const texto = [v.folio, v.correo, new Date(v.entrada).toISOString(), new Date(v.salida).toISOString()].join('|');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 12);
}

async function validarPase(folio, h) {
  mostrarVista('pase');
  const card = $('#pase-card');
  const titulo = $('#pase-titulo');
  const est = $('#pase-estado');
  const dl = $('#pase-detalle');
  dl.replaceChildren();
  titulo.textContent = 'Validando pase…';
  est.textContent = folio;

  const { data: v } = await supabase
    .from('visitantes')
    .select('folio, nombre_completo, empresa, correo, persona_visita, motivo, entrada, salida')
    .eq('folio', folio).maybeSingle();

  if (!v) {
    card.dataset.resultado = 'invalido';
    titulo.textContent = 'Pase no encontrado';
    est.textContent = `No existe una visita con el folio ${folio}.`;
    return;
  }
  const coincide = h && (await huella(v)) === h;
  const [etiqueta, clave] = estadoVisita(v);
  if (!coincide) {
    card.dataset.resultado = 'invalido';
    titulo.textContent = 'El pase no coincide con el registro';
    est.textContent = 'Los datos o el horario cambiaron desde que se emitió. Verifica identidad antes de dar acceso.';
  } else if (clave === 'curso') {
    card.dataset.resultado = 'valido';
    titulo.textContent = `Pase válido: ${v.nombre_completo}`;
    est.textContent = 'La visita está dentro de su horario.';
  } else {
    card.dataset.resultado = 'aviso';
    titulo.textContent = `Pase válido, fuera de horario: ${v.nombre_completo}`;
    est.textContent = clave === 'programada' ? 'La visita aún no inicia.' : 'El horario de la visita ya terminó.';
  }
  const fila = (k, val) => [el('dt', {}, k), el('dd', {}, val)];
  dl.append(
    ...fila('Folio', v.folio), ...fila('Empresa', v.empresa), ...fila('Visita a', v.persona_visita),
    ...fila('Motivo', v.motivo), ...fila('Entrada', fechaLarga.format(new Date(v.entrada))),
    ...fila('Salida', fechaLarga.format(new Date(v.salida))), ...fila('Estado', etiqueta),
  );
}

$('#btn-pase-cerrar').addEventListener('click', () => {
  history.replaceState(null, '', location.pathname);
  irA('consultas');
});

// ---------- Consultas ----------
function aplicarRango(rango) {
  const hoy = hoyCDMX();
  const [y, m] = hoy.split('-').map(Number);
  const ultimoDia = (yy, mm) => new Date(Date.UTC(yy, mm, 0)).getUTCDate();
  let desde = hoy, hasta = hoy;
  if (rango === 'semana') hasta = hoyCDMX(6);
  if (rango === 'mes') {
    desde = `${y}-${String(m).padStart(2, '0')}-01`;
    hasta = `${y}-${String(m).padStart(2, '0')}-${ultimoDia(y, m)}`;
  }
  if (rango === 'mes-anterior') {
    const py = m === 1 ? y - 1 : y, pm = m === 1 ? 12 : m - 1;
    desde = `${py}-${String(pm).padStart(2, '0')}-01`;
    hasta = `${py}-${String(pm).padStart(2, '0')}-${ultimoDia(py, pm)}`;
  }
  $('#f-desde').value = desde;
  $('#f-hasta').value = hasta;
  $$('.chip-btn').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.rango === rango)));
}

$$('.chip-btn').forEach((b) => b.addEventListener('click', () => { aplicarRango(b.dataset.rango); buscar(); }));
['#f-desde', '#f-hasta'].forEach((s) => $(s).addEventListener('change', () =>
  $$('.chip-btn').forEach((b) => b.setAttribute('aria-pressed', 'false'))));

function leerFiltros() {
  return {
    desde: $('#f-desde').value || undefined,
    hasta: $('#f-hasta').value || undefined,
    empresa: $('#f-empresa').value.trim() || undefined,
    motivo: $('#f-motivo').value || undefined,
    texto: $('#f-texto').value.trim() || undefined,
  };
}

const limpiar = (s) => (s ?? '').replace(/[,()*%\\]/g, ' ').trim();

async function buscar() {
  const f = leerFiltros();
  estado.filtros = f;
  $('#res-total').textContent = 'Buscando…';
  let q = supabase
    .from('visitantes')
    .select('folio, nombre_completo, empresa, correo, telefono, persona_visita, motivo, comentarios, entrada, salida, qr_enviado_at, correo_error', { count: 'exact' });
  if (f.desde) q = q.gte('entrada', `${f.desde}T00:00:00${OFFSET}`);
  if (f.hasta) q = q.lte('entrada', `${f.hasta}T23:59:59.999${OFFSET}`);
  if (limpiar(f.empresa)) q = q.ilike('empresa', `%${limpiar(f.empresa)}%`);
  if (f.motivo) q = q.eq('motivo', f.motivo);
  const t = limpiar(f.texto);
  if (t) q = q.or(['nombre_completo', 'correo', 'folio', 'persona_visita'].map((c) => `${c}.ilike.%${t}%`).join(','));
  const { data, count, error } = await q.order('entrada', { ascending: true }).limit(LIMITE);

  if (error) {
    $('#res-total').textContent = 'No se pudieron cargar las visitas. Revisa tu conexión e intenta de nuevo.';
    return;
  }
  estado.filas = data ?? [];
  pintarTabla(count ?? estado.filas.length);
}

function pintarTabla(total) {
  const tbody = $('#tbody-visitas');
  tbody.replaceChildren(...estado.filas.map((v) => {
    const [etiqueta, clave] = estadoVisita(v);
    const pase = v.qr_enviado_at ? el('span', { class: 'pill ok' }, 'Enviado')
      : v.correo_error ? el('span', { class: 'pill error', title: v.correo_error }, 'Error de envío')
        : el('span', { class: 'pill' }, 'Pendiente');
    return el('tr', {},
      el('td', { class: 'mono' }, v.folio),
      el('td', {}, el('strong', {}, v.nombre_completo), el('br'), el('span', { class: 'muted small' }, v.correo)),
      el('td', {}, v.empresa),
      el('td', {}, v.persona_visita),
      el('td', {}, v.motivo),
      el('td', { class: 'nowrap' }, fechaHora.format(new Date(v.entrada))),
      el('td', { class: 'nowrap' }, fechaHora.format(new Date(v.salida))),
      el('td', {}, el('span', { class: `pill estado-${clave}` }, etiqueta)),
      el('td', {}, pase),
    );
  }));
  const n = estado.filas.length;
  $('#res-vacio').hidden = n > 0;
  $('#res-total').textContent = n === 0 ? 'Sin resultados'
    : total > n ? `Mostrando ${n} de ${total} visitas. Ajusta los filtros para ver el resto.`
      : `${n} ${n === 1 ? 'visita' : 'visitas'}`;
  $('#btn-csv').disabled = n === 0;
  $('#btn-reporte').disabled = n === 0;
}

$('#form-filtros').addEventListener('submit', (e) => { e.preventDefault(); buscar(); });

// ---------- CSV ----------
$('#btn-csv').addEventListener('click', () => {
  const cols = [['folio', 'Folio'], ['nombre_completo', 'Nombre'], ['empresa', 'Empresa'], ['correo', 'Correo'],
    ['telefono', 'Teléfono'], ['persona_visita', 'Visita a'], ['motivo', 'Motivo'], ['entrada', 'Entrada'],
    ['salida', 'Salida'], ['comentarios', 'Comentarios']];
  const celda = (v) => {
    const s = String(v ?? '');
    return `"${(/^[=+\-@]/.test(s) ? `'${s}` : s).replace(/"/g, '""')}"`;
  };
  const filas = estado.filas.map((f) => cols.map(([k]) =>
    celda(k === 'entrada' || k === 'salida' ? fechaCsv.format(new Date(f[k])) : f[k])).join(','));
  const csv = '\uFEFF' + [cols.map(([, t]) => celda(t)).join(','), ...filas].join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = el('a', { href: url, download: `visitas_${estado.filtros.desde ?? ''}_${estado.filtros.hasta ?? ''}.csv` });
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
});

// ---------- Reporte por correo ----------
$('#btn-reporte').addEventListener('click', () => {
  const f = estado.filtros;
  $('#dlg-reporte-resumen').textContent =
    `${estado.filas.length} visitas del ${f.desde ?? 'inicio'} al ${f.hasta ?? 'hoy'}. Se adjunta un CSV con el detalle.`;
  $('#r-destinatarios').value = (estado.config?.destinatarios_reporte ?? []).join('\n');
  mostrarEstado($('#reporte-estado'), '');
  $('#dlg-reporte').showModal();
});

$('#form-reporte').addEventListener('submit', async (e) => {
  if (e.submitter?.value === 'cancel') return;
  e.preventDefault();
  const box = $('#reporte-estado');
  const destinatarios = listaCorreos($('#r-destinatarios').value);
  const malos = destinatarios.filter((d) => !EMAIL_RE.test(d));
  if (!destinatarios.length) return mostrarEstado(box, 'Agrega al menos un correo.');
  if (malos.length) return mostrarEstado(box, `Revisa estos correos: ${malos.join(', ')}`);
  if (destinatarios.length > 10) return mostrarEstado(box, 'Máximo 10 destinatarios.');
  const btn = $('#btn-enviar-reporte');
  btn.disabled = true;
  btn.textContent = 'Enviando…';
  try {
    const r = await invocar('enviar-reporte', { filtros: estado.filtros, destinatarios });
    $('#dlg-reporte').close();
    toast(`Reporte enviado a ${r.destinatarios.length} ${r.destinatarios.length === 1 ? 'destinatario' : 'destinatarios'} (${r.total} visitas).`);
  } catch (err) {
    mostrarEstado(box, err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Enviar reporte';
  }
});

// ---------- Cambiar contraseña ----------
$('#btn-password').addEventListener('click', () => {
  $('#form-password').reset();
  mostrarEstado($('#password-estado'), '');
  $('#dlg-password').showModal();
});
$('#form-password').addEventListener('submit', async (e) => {
  if (e.submitter?.value === 'cancel') return;
  e.preventDefault();
  const box = $('#password-estado');
  const a = $('#p-nueva').value, b = $('#p-confirmar').value;
  if (a.length < 10) return mostrarEstado(box, 'La contraseña debe tener al menos 10 caracteres.');
  if (a !== b) return mostrarEstado(box, 'Las contraseñas no coinciden.');
  const { error } = await supabase.auth.updateUser({ password: a });
  if (error) return mostrarEstado(box, 'No se pudo cambiar la contraseña. Intenta con otra.');
  $('#dlg-password').close();
  toast('Contraseña actualizada.');
});

// ---------- Configuración (admin) ----------
async function cargarConfiguracion() {
  await Promise.all([cargarUsuarios(), cargarCorreos(), cargarBitacora()]);
}

async function cargarUsuarios() {
  try {
    const { usuarios } = await invocar('admin-usuarios', { accion: 'listar' });
    estado.usuarios = usuarios;
    pintarUsuarios();
  } catch (err) {
    $('#tbody-usuarios').replaceChildren(el('tr', {}, el('td', { colspan: 4 }, err.message)));
  }
}

function pintarUsuarios() {
  $('#tbody-usuarios').replaceChildren(...estado.usuarios.map((u) => {
    const soyYo = u.id === estado.perfil.id;
    const rol = el('select', {
      'aria-label': `Rol de ${u.nombre}`, disabled: soyYo,
      onchange: (e) => actualizarUsuario(u, { rol: e.target.value }, 'Rol actualizado.'),
    }, el('option', { value: 'consulta' }, 'Consulta'), el('option', { value: 'admin' }, 'Administrador'));
    rol.value = u.rol;
    return el('tr', {},
      el('td', {}, el('strong', {}, u.nombre), soyYo ? ' (tú)' : '', el('br'), el('span', { class: 'muted small' }, u.email)),
      el('td', {}, rol),
      el('td', {}, el('span', { class: `pill ${u.activo ? 'ok' : 'error'}` }, u.activo ? 'Activo' : 'Inactivo')),
      el('td', { class: 'acciones-fila' },
        soyYo ? '' : el('button', {
          class: 'link-btn', type: 'button',
          onclick: () => actualizarUsuario(u, { activo: !u.activo }, u.activo ? 'Usuario desactivado.' : 'Usuario activado.'),
        }, u.activo ? 'Desactivar' : 'Activar'),
        soyYo ? '' : el('button', {
          class: 'link-btn', type: 'button',
          onclick: () => restablecer(u),
        }, 'Nueva contraseña'),
      ),
    );
  }));
}

async function actualizarUsuario(u, cambios, mensaje) {
  try {
    await invocar('admin-usuarios', { accion: 'actualizar', id: u.id, ...cambios });
    toast(mensaje);
  } catch (err) {
    toast(err.message);
  }
  cargarUsuarios();
}

async function restablecer(u) {
  if (!confirm(`¿Generar una contraseña temporal nueva para ${u.nombre}? La actual dejará de funcionar.`)) return;
  try {
    const r = await invocar('admin-usuarios', { accion: 'actualizar', id: u.id, restablecer_password: true });
    mostrarCredenciales(u.email, r.password_temporal);
  } catch (err) {
    toast(err.message);
  }
}

function mostrarCredenciales(email, password) {
  $('#cred-texto').textContent = `Usuario: ${email}`;
  $('#cred-password').textContent = password;
  $('#dlg-credenciales').showModal();
}
$('#btn-copiar').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText($('#cred-password').textContent);
    toast('Contraseña copiada.');
  } catch {
    toast('Selecciona y copia la contraseña manualmente.');
  }
});

$('#form-usuario').addEventListener('submit', async (e) => {
  e.preventDefault();
  const box = $('#usuario-estado');
  const nombre = $('#u-nombre').value.trim();
  const email = $('#u-email').value.trim().toLowerCase();
  const rol = $('#u-rol').value;
  if (nombre.length < 3) return mostrarEstado(box, 'Escribe el nombre completo.');
  if (!EMAIL_RE.test(email)) return mostrarEstado(box, 'Revisa el correo.');
  mostrarEstado(box, '');
  try {
    const r = await invocar('admin-usuarios', { accion: 'crear', nombre, email, rol });
    e.target.reset();
    mostrarCredenciales(email, r.password_temporal);
    cargarUsuarios();
  } catch (err) {
    mostrarEstado(box, err.message);
  }
});

async function cargarCorreos() {
  const { data } = await supabase.from('configuracion').select('*').eq('id', 1).maybeSingle();
  estado.config = data;
  $('#c-recepcion').value = data?.correo_recepcion ?? '';
  $('#c-copia').checked = Boolean(data?.copia_recepcion);
  $('#c-destinatarios').value = (data?.destinatarios_reporte ?? []).join('\n');
}

$('#form-config').addEventListener('submit', async (e) => {
  e.preventDefault();
  const box = $('#config-estado');
  const recepcion = $('#c-recepcion').value.trim().toLowerCase();
  const destinatarios = listaCorreos($('#c-destinatarios').value);
  if (recepcion && !EMAIL_RE.test(recepcion)) return mostrarEstado(box, 'Revisa el correo de recepción.');
  const malos = destinatarios.filter((d) => !EMAIL_RE.test(d));
  if (malos.length) return mostrarEstado(box, `Revisa estos correos: ${malos.join(', ')}`);
  if (destinatarios.length > 10) return mostrarEstado(box, 'Máximo 10 destinatarios.');
  if ($('#c-copia').checked && !recepcion) return mostrarEstado(box, 'Para enviar copia, escribe el correo de recepción.');
  const { error } = await supabase.from('configuracion').update({
    correo_recepcion: recepcion || null,
    copia_recepcion: $('#c-copia').checked,
    destinatarios_reporte: destinatarios,
    updated_at: new Date().toISOString(),
    updated_by: estado.perfil.id,
  }).eq('id', 1);
  if (error) return mostrarEstado(box, 'No se pudieron guardar los cambios.');
  mostrarEstado(box, '');
  await cargarCorreos();
  toast('Correos guardados.');
});

async function cargarBitacora() {
  const { data } = await supabase.from('bitacora_reportes')
    .select('created_at, origen, enviado_por, destinatarios, total_registros')
    .order('created_at', { ascending: false }).limit(15);
  const nombres = Object.fromEntries(estado.usuarios.map((u) => [u.id, u.nombre]));
  const origen = { panel: 'Panel', automatico: 'Reporte automático', 'claude-code': 'Claude Code' };
  const lista = $('#lista-bitacora');
  if (!data?.length) return lista.replaceChildren(el('li', { class: 'muted' }, 'Aún no se ha enviado ningún reporte.'));
  lista.replaceChildren(...data.map((b) => el('li', {},
    el('span', { class: 'bit-fecha' }, fechaHora.format(new Date(b.created_at))),
    el('span', {}, `${origen[b.origen] ?? b.origen}${b.enviado_por && nombres[b.enviado_por] ? `, ${nombres[b.enviado_por]}` : ''}: ${b.total_registros} visitas a ${b.destinatarios.join(', ')}`),
  )));
}

// ---------- Arranque ----------
supabase?.auth.onAuthStateChange((evento) => {
  if (evento === 'SIGNED_OUT') mostrarVista('login');
});
iniciar();
