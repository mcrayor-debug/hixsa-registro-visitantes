import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase, configurado } from './lib/supabase.js';
import { puede, puedeConfigurar } from './lib/permisos.js';
import Login from './components/Login.jsx';
import Recepcion from './components/Recepcion.jsx';
import Tablero from './components/Tablero.jsx';
import Consultas from './components/Consultas.jsx';
import Configuracion from './components/Configuracion.jsx';
import { Dialogo, Mensaje, useToast } from './components/ui.jsx';

const PESTANAS = [
  { id: 'recepcion', texto: 'Recepción', permitido: (p) => puede(p, 'recepcion') },
  { id: 'tablero', texto: 'Tablero', permitido: (p) => puede(p, 'tablero') },
  { id: 'consultas', texto: 'Consultas', permitido: (p) => puede(p, 'consultas') },
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
      .select('id, email, nombre, rol, activo, roles(id, nombre, secciones, alcance, puede_exportar)')
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

  return (
    <>
      <header className="topbar">
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
        {perfil && (
          <>
            <nav className="tabs" role="tablist" aria-label="Secciones">
              {pestanas.map((t) => (
                <button key={t.id} className="tab" role="tab" aria-selected={tab === t.id} aria-controls={`vista-${t.id}`}
                  onClick={() => setTab(t.id)}>{t.texto}</button>
              ))}
            </nav>
            <div className="user">
              <span className="user-name">{perfil.nombre}</span>
              <span className="badge">{perfil.roles?.nombre ?? perfil.rol}</span>
              <CambiarPassword />
              <button className="link-btn" type="button" onClick={salir}>Salir</button>
            </div>
          </>
        )}
      </header>

      <main className="admin-main">
        {cargando ? <p className="muted cargando">Cargando…</p>
          : !perfil ? <Login error={error} onEntrar={entrar} />
            : !pestanas.length ? <p className="status">Tu rol no tiene secciones asignadas. Pide a un SUPERADMIN que lo configure.</p>
              : (
                <section id={`vista-${tab}`} role="tabpanel" className="panel-section">
                  {tab === 'recepcion' && <Recepcion paseInicial={pase} />}
                  {tab === 'tablero' && <Tablero empresas={empresas} auditoria={config?.modo_auditoria} />}
                  {tab === 'consultas' && <Consultas config={config} perfil={perfil} empresas={empresas} />}
                  {tab === 'configuracion' && (
                    <Configuracion perfil={perfil} config={config} empresas={empresas} recargar={recargarContexto} />
                  )}
                </section>
              )}
      </main>
    </>
  );
}

function CambiarPassword() {
  const [abierto, setAbierto] = useState(false);
  const [a, setA] = useState('');
  const [b, setB] = useState('');
  const [error, setError] = useState('');
  const toast = useToast();
  async function guardar(e) {
    e.preventDefault();
    if (a.length < 10) return setError('La contraseña debe tener al menos 10 caracteres.');
    if (a !== b) return setError('Las contraseñas no coinciden.');
    const { error: err } = await supabase.auth.updateUser({ password: a });
    if (err) return setError('No se pudo cambiar la contraseña. Intenta con otra.');
    setAbierto(false);
    toast('Contraseña actualizada.');
  }
  return (
    <>
      <button className="link-btn" type="button" onClick={() => { setA(''); setB(''); setError(''); setAbierto(true); }}>Cambiar contraseña</button>
      <Dialogo abierto={abierto} onCerrar={() => setAbierto(false)} titulo="Cambiar contraseña">
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
    </>
  );
}
