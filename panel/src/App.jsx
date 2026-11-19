import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { supabase, configurado } from './lib/supabase.js';
import { puede, puedeConfigurar } from './lib/permisos.js';
import Login from './components/Login.jsx';
import Recepcion from './components/Recepcion.jsx';
// Pestañas pesadas: se descargan solo al abrirlas (Recepción carga de inmediato)
const Tablero = lazy(() => import('./components/Tablero.jsx'));
const Consultas = lazy(() => import('./components/Consultas.jsx'));
const Reportes = lazy(() => import('./components/Reportes.jsx'));
const Configuracion = lazy(() => import('./components/Configuracion.jsx'));
import { Dialogo, Mensaje, useToast } from './components/ui.jsx';
import Avatar from './components/Avatar.jsx';
import Campana from './components/Campana.jsx';
import Proteccion from './components/Proteccion.jsx';
import { quitarFotoUsuario, subirFotoUsuario } from './lib/usuarios.js';

const PESTANAS = [
  { id: 'recepcion', texto: 'Recepción', permitido: (p) => puede(p, 'recepcion') },
  { id: 'tablero', texto: 'Dashboard', permitido: (p) => puede(p, 'tablero') },
  { id: 'consultas', texto: 'Consultas', permitido: (p) => puede(p, 'consultas') },
  { id: 'reportes', texto: 'Reportes', permitido: (p) => puede(p, 'reportes') },
  { id: 'configuracion', texto: 'Configuración', permitido: puedeConfigurar },
];
const LOGO_BLANCO = '/img/logo-hixsa-blanco.png';

export default function App() {
  const [perfil, setPerfil] = useState(null);
  const [config, setConfig] = useState(null);
  const [empresas, setEmpresas] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(configurado ? '' : 'El panel no está configurado: falta config.js (SUPABASE_URL y SUPABASE_ANON_KEY).');
  const pase = useMemo(() => {
    const p = new URLSearchParams(location.search);
    return p.get('pase') ? { folio: p.get('pase').toUpperCase(), h: p.get('h') } : null;
  }, []);
  const [tab, setTab] = useState(() => (pase ? 'recepcion' : location.hash.slice(1) || 'recepcion'));
  const [menu, setMenu] = useState(false);
  const [menuUsuario, setMenuUsuario] = useState(false);
  const [dialogo, setDialogo] = useState(null);

  const pestanas = PESTANAS.filter((t) => perfil && t.permitido(perfil));

  /** Configuración general y empresas visibles (en modo auditoría, solo la principal). */
  const recargarContexto = useCallback(async () => {
    const [{ data: c }, { data: e }] = await Promise.all([
      supabase.from('configuracion').select('*').eq('id', 1).maybeSingle(),
      supabase.from('empresas').select('id, nombre, logo_url, mostrar_como, orden, activa, es_principal').order('orden').order('nombre'),
    ]);
    setConfig(c);
    setEmpresas(e ?? []);
  }, []);

  useEffect(() => {
    if (!supabase) { setCargando(false); return undefined; }
    supabase.auth.getSession().then(({ data }) => (data.session ? entrar(data.session.user) : setCargando(false)));
    const { data } = supabase.auth.onAuthStateChange((evento) => { if (evento === 'SIGNED_OUT') setPerfil(null); });
    return () => data.subscription.unsubscribe();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!perfil) return;
    if (!pestanas.some((t) => t.id === tab) && pestanas.length) setTab(pestanas[0].id);
    else history.replaceState(null, '', `${location.pathname}${location.search}#${tab}`);
  }, [tab, perfil]); // eslint-disable-line react-hooks/exhaustive-deps

  async function entrar(user) {
    const { data: p } = await supabase.from('perfiles')
      .select('id, email, nombre, rol, activo, celular, foto_path, notificaciones_leidas_at, roles(id, nombre, secciones, alcance, puede_exportar)')
      .eq('id', user.id).maybeSingle();
    if (!p || !p.activo) {
      await supabase.auth.signOut();
      setError('Tu cuenta no tiene acceso al panel. Pide a un administrador que la active.');
      setCargando(false);
      return;
    }
    await recargarContexto();
    setPerfil(p);
    setError('');
    setCargando(false);
  }

  async function salir() {
    await supabase.auth.signOut();
    history.replaceState(null, '', location.pathname);
    setPerfil(null);
  }

  const principal = empresas.find((e) => e.es_principal);
  const logoBarra = config?.logo_url || null;
  const actual = pestanas.find((t) => t.id === tab);
  const irA = (id) => { setTab(id); setMenu(false); };

  // Tablas → tarjetas en celular: cada celda recibe el título de su columna
  useEffect(() => {
    const etiquetar = () => document.querySelectorAll('table.tabla').forEach((t) => {
      const titulos = [...t.querySelectorAll('thead th')].map((th) => th.textContent.trim());
      t.querySelectorAll('tbody tr').forEach((tr) => [...tr.children].forEach((td, i) => {
        if (titulos[i] && td.getAttribute('data-label') !== titulos[i]) td.setAttribute('data-label', titulos[i]);
      }));
    });
    etiquetar();
    const obs = new MutationObserver(etiquetar);
    obs.observe(document.body, { childList: true, subtree: true });
    return () => obs.disconnect();
  }, []);
  useEffect(() => { document.body.classList.toggle('menu-abierto', menu); }, [menu]);

  return (
    <>
      <header className="topbar">
        {perfil && (
          <button type="button" className="hamburguesa" aria-label="Abrir menú" aria-expanded={menu} onClick={() => setMenu(true)}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
          </button>
        )}
        <div className="topbar-brand">
          <a href="/" className="topbar-logo" aria-label="Ir al registro de visitantes">
            {logoBarra ? <span className="logo-chip"><img src={logoBarra} alt="HIXSA" /></span>
              : <img src={LOGO_BLANCO} alt="HIXSA" />}
          </a>
          <span className="topbar-title">Panel de visitas</span>
          {config?.modo_auditoria && (
            <span className="badge-auditoria" title="Solo se muestra la información de la empresa principal">
              Modo auditoría: {principal?.nombre ?? 'HIXSA'}
            </span>
          )}
        </div>
        {perfil && <span className="topbar-seccion">{actual?.texto}</span>}
        {perfil && (
          <>
            <nav className="tabs" role="tablist" aria-label="Secciones">
              {pestanas.map((t) => (
                <button key={t.id} className="tab" role="tab" aria-selected={tab === t.id} aria-controls={`vista-${t.id}`}
                  onClick={() => setTab(t.id)}>{t.texto}</button>
              ))}
            </nav>
            <Campana perfil={perfil} onLeidas={(t) => setPerfil({ ...perfil, notificaciones_leidas_at: t })} />
            <div className="usuario-menu">
              <button type="button" className="usuario-boton" aria-haspopup="menu" aria-expanded={menuUsuario} onClick={() => setMenuUsuario(!menuUsuario)}>
                <span className="usuario-textos"><span className="usuario-nombre">{perfil.nombre}</span><span className="usuario-rol">{perfil.roles?.nombre ?? perfil.rol}</span></span>
                <Avatar usuario={perfil} tamano={34} />
              </button>
              {menuUsuario && (
                <div className="usuario-desplegable" role="menu" onMouseLeave={() => setMenuUsuario(false)}>
                  <button type="button" role="menuitem" onClick={() => { setMenuUsuario(false); setDialogo('perfil'); }}>Mi perfil</button>
                  <button type="button" role="menuitem" onClick={() => { setMenuUsuario(false); setDialogo('password'); }}>Cambiar contraseña</button>
                  <button type="button" role="menuitem" className="peligro" onClick={salir}>Salir</button>
                </div>
              )}
            </div>
            <button type="button" className="avatar-movil" aria-label="Mi perfil" onClick={() => setDialogo('perfil')}><Avatar usuario={perfil} tamano={32} /></button>
          </>
        )}
      </header>

      {perfil && menu && (
        <div className="cajon-fondo" onClick={() => setMenu(false)} role="presentation">
          <nav className="cajon" aria-label="Menú" onClick={(e) => e.stopPropagation()}>
            <div className="cajon-usuario">
              <Avatar usuario={perfil} tamano={44} />
              <span><strong>{perfil.nombre}</strong><br /><span className="muted small">{perfil.roles?.nombre ?? perfil.rol}</span></span>
              <button type="button" className="cajon-cerrar" aria-label="Cerrar menú" onClick={() => setMenu(false)}>×</button>
            </div>
            {pestanas.map((t) => (
              <button key={t.id} type="button" className="cajon-item" aria-current={tab === t.id ? 'page' : undefined} onClick={() => irA(t.id)}>{t.texto}</button>
            ))}
            <div className="cajon-pie">
              <button type="button" className="cajon-item secundario" onClick={() => { setMenu(false); setDialogo('perfil'); }}>Mi perfil</button>
              <button type="button" className="cajon-item secundario" onClick={() => { setMenu(false); setDialogo('password'); }}>Cambiar contraseña</button>
              <button type="button" className="cajon-item peligro" onClick={salir}>Salir</button>
            </div>
          </nav>
        </div>
      )}

      <main className="admin-main">
        {cargando ? <p className="muted cargando">Cargando…</p>
          : !perfil ? <Login error={error} onEntrar={entrar} />
            : !pestanas.length ? <p className="status">Tu rol no tiene secciones asignadas. Pide a un SUPERADMIN que lo configure.</p>
              : (
                <Proteccion key={tab} nombre={tab}>
                <Suspense fallback={<p className="muted cargando">Cargando…</p>}>
                <section id={`vista-${tab}`} role="tabpanel" className="panel-section">
                  {tab === 'recepcion' && <Recepcion paseInicial={pase} />}
                  {tab === 'tablero' && <Tablero empresas={empresas} auditoria={config?.modo_auditoria} />}
                  {tab === 'consultas' && <Consultas config={config} perfil={perfil} empresas={empresas} />}
                  {tab === 'reportes' && <Reportes config={config} perfil={perfil} empresas={empresas} />}
                  {tab === 'configuracion' && (
                    <Configuracion perfil={perfil} config={config} empresas={empresas} recargar={recargarContexto} />
                  )}
                </section>
                </Suspense>
                </Proteccion>
              )}
      </main>
      {perfil && <CambiarPassword abierto={dialogo === 'password'} onCerrar={() => setDialogo(null)} />}
      {perfil && <MiPerfil abierto={dialogo === 'perfil'} perfil={perfil} onCerrar={() => setDialogo(null)}
        onCambio={(foto_path) => setPerfil({ ...perfil, foto_path })} abrirPassword={() => setDialogo('password')} salir={salir} />}
    </>
  );
}

function CambiarPassword({ abierto, onCerrar }) {
  const [a, setA] = useState('');
  const [b, setB] = useState('');
  const [error, setError] = useState('');
  const toast = useToast();
  useEffect(() => { if (abierto) { setA(''); setB(''); setError(''); } }, [abierto]);
  async function guardar(e) {
    e.preventDefault();
    if (a.length < 10) return setError('La contraseña debe tener al menos 10 caracteres.');
    if (a !== b) return setError('Las contraseñas no coinciden.');
    const { error: err } = await supabase.auth.updateUser({ password: a });
    if (err) return setError('No se pudo cambiar la contraseña. Intenta con otra.');
    onCerrar();
    toast('Contraseña actualizada.');
  }
  return (
    <Dialogo abierto={abierto} onCerrar={onCerrar} titulo="Cambiar contraseña">
      <form onSubmit={guardar} noValidate>
        <div className="field"><label htmlFor="p-nueva">Nueva contraseña</label>
          <input id="p-nueva" type="password" autoComplete="new-password" value={a} onChange={(e) => setA(e.target.value)} /></div>
        <div className="field"><label htmlFor="p-conf">Confirma la contraseña</label>
          <input id="p-conf" type="password" autoComplete="new-password" value={b} onChange={(e) => setB(e.target.value)} /></div>
        <p className="hint">Mínimo 10 caracteres.</p>
        <Mensaje>{error}</Mensaje>
        <div className="dialog-actions"><button className="btn btn-compact" type="submit">Guardar contraseña</button></div>
      </form>
    </Dialogo>
  );
}

/** Mi perfil: cada usuario cambia su propia foto. */
function MiPerfil({ abierto, perfil, onCerrar, onCambio, abrirPassword, salir }) {
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState('');
  const toast = useToast();
  async function cambiar(file) {
    setOcupado(true); setError('');
    try {
      const ruta = await subirFotoUsuario(perfil.id, file);
      const { error: err } = await supabase.from('perfiles').update({ foto_path: ruta }).eq('id', perfil.id);
      if (err) throw new Error('No se pudo guardar la foto.');
      await quitarFotoUsuario(perfil.foto_path);
      onCambio(ruta); toast('Foto actualizada.');
    } catch (e) { setError(e.message); } finally { setOcupado(false); }
  }
  async function quitar() {
    const { error: err } = await supabase.from('perfiles').update({ foto_path: null }).eq('id', perfil.id);
    if (err) return setError('No se pudo quitar la foto.');
    await quitarFotoUsuario(perfil.foto_path); onCambio(null); toast('Foto eliminada.');
  }
  return (
    <Dialogo abierto={abierto} onCerrar={onCerrar} titulo="Mi perfil">
      <div className="mi-perfil">
        <Avatar usuario={perfil} tamano={88} />
        <div>
          <p className="mi-perfil-nombre">{perfil.nombre}</p>
          <p className="muted small">{perfil.email}{perfil.celular ? ` · ${perfil.celular}` : ''}</p>
          <span className="badge">{perfil.roles?.nombre ?? perfil.rol}</span>
        </div>
      </div>
      <div className="mi-perfil-acciones">
        <label className="btn btn-secondary btn-compact">{ocupado ? 'Subiendo…' : perfil.foto_path ? 'Cambiar foto' : 'Agregar foto'}
          <input type="file" accept="image/*" className="sr-only" disabled={ocupado} onChange={(e) => e.target.files?.[0] && cambiar(e.target.files[0])} /></label>
        {perfil.foto_path && <button type="button" className="link-btn" onClick={quitar}>Quitar foto</button>}
      </div>
      <p className="hint">Tu nombre, correo y celular los cambia un administrador en Configuración → Usuarios.</p>
      <Mensaje>{error}</Mensaje>
      <div className="dialog-actions mi-perfil-pie">
        <button type="button" className="btn btn-secondary btn-compact" onClick={abrirPassword}>Cambiar contraseña</button>
        <button type="button" className="btn btn-secondary btn-compact" onClick={salir}>Salir</button>
      </div>
    </Dialogo>
  );
}
