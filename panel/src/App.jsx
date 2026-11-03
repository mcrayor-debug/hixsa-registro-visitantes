import { useEffect, useMemo, useState } from 'react';
import { supabase, configurado } from './lib/supabase.js';
import Login from './components/Login.jsx';
import Recepcion from './components/Recepcion.jsx';
import Tablero from './components/Tablero.jsx';
import Consultas from './components/Consultas.jsx';
import Configuracion from './components/Configuracion.jsx';
import { Dialogo, Mensaje, useToast } from './components/ui.jsx';

const PESTANAS = [
  { id: 'recepcion', texto: 'Recepción' },
  { id: 'tablero', texto: 'Tablero' },
  { id: 'consultas', texto: 'Consultas' },
  { id: 'configuracion', texto: 'Configuración', soloAdmin: true },
];

export default function App() {
  const [perfil, setPerfil] = useState(null);
  const [config, setConfig] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(configurado ? '' : 'El panel no está configurado: falta config.js (SUPABASE_URL y SUPABASE_ANON_KEY).');
  const pase = useMemo(() => {
    const p = new URLSearchParams(location.search);
    return p.get('pase') ? { folio: p.get('pase').toUpperCase(), h: p.get('h') } : null;
  }, []);
  const [tab, setTab] = useState(() => {
    const h = location.hash.slice(1);
    return pase ? 'recepcion' : PESTANAS.some((t) => t.id === h) ? h : 'recepcion';
  });

  useEffect(() => {
    if (!supabase) { setCargando(false); return undefined; }
    supabase.auth.getSession().then(({ data }) => (data.session ? entrar(data.session.user) : setCargando(false)));
    const { data } = supabase.auth.onAuthStateChange((evento) => { if (evento === 'SIGNED_OUT') setPerfil(null); });
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (perfil) history.replaceState(null, '', `${location.pathname}${location.search}#${tab}`);
  }, [tab, perfil]);

  async function entrar(user) {
    const { data: p } = await supabase.from('perfiles').select('id, email, nombre, rol, activo').eq('id', user.id).maybeSingle();
    if (!p || !p.activo) {
      await supabase.auth.signOut();
      setError('Tu cuenta no tiene acceso al panel. Pide a un administrador que la active.');
      setCargando(false);
      return;
    }
    const { data: c } = await supabase.from('configuracion').select('*').eq('id', 1).maybeSingle();
    setConfig(c);
    setPerfil(p);
    setError('');
    setCargando(false);
    if (tab === 'configuracion' && p.rol !== 'admin') setTab('recepcion');
  }

  async function salir() {
    await supabase.auth.signOut();
    history.replaceState(null, '', location.pathname);
    setPerfil(null);
  }

  const pestanas = PESTANAS.filter((t) => !t.soloAdmin || perfil?.rol === 'admin');

  return (
    <>
      <header className="topbar">
        <div className="topbar-brand">
          <a className="wordmark" href="/">HIXSA</a>
          <span className="topbar-title">Panel de visitas</span>
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
              <span className="badge">{perfil.rol === 'admin' ? 'Administrador' : 'Consulta'}</span>
              <CambiarPassword />
              <button className="link-btn" type="button" onClick={salir}>Salir</button>
            </div>
          </>
        )}
      </header>

      <main className="admin-main">
        {cargando ? <p className="muted cargando">Cargando…</p>
          : !perfil ? <Login error={error} onEntrar={entrar} />
            : (
              <section id={`vista-${tab}`} role="tabpanel" className="panel-section">
                {tab === 'recepcion' && <Recepcion paseInicial={pase} />}
                {tab === 'tablero' && <Tablero />}
                {tab === 'consultas' && <Consultas config={config} />}
                {tab === 'configuracion' && perfil.rol === 'admin' && <Configuracion perfil={perfil} onConfig={setConfig} />}
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
