import { useCallback, useEffect, useState } from 'react';
import { supabase, invocar } from '../lib/supabase.js';
import { EMAIL_RE, fmtFechaHora, listaCorreos } from '../lib/formato.js';
import { Dialogo, Mensaje, useToast } from './ui.jsx';

export default function Configuracion({ perfil, onConfig }) {
  const [usuarios, setUsuarios] = useState([]);
  const cargarUsuarios = useCallback(async () => {
    try { setUsuarios((await invocar('admin-usuarios', { accion: 'listar' })).usuarios); } catch { setUsuarios([]); }
  }, []);
  useEffect(() => { cargarUsuarios(); }, [cargarUsuarios]);
  return (
    <div className="config-grid">
      <div className="config-col">
        <Usuarios perfil={perfil} usuarios={usuarios} recargar={cargarUsuarios} />
        <Anfitriones />
      </div>
      <div className="config-col">
        <Correos onConfig={onConfig} />
        <Bitacora usuarios={usuarios} />
      </div>
    </div>
  );
}

function Usuarios({ perfil, usuarios, recargar }) {
  const [nuevo, setNuevo] = useState({ nombre: '', email: '', rol: 'consulta' });
  const [error, setError] = useState('');
  const [cred, setCred] = useState(null);
  const toast = useToast();

  async function actualizar(u, cambios, msg) {
    try { const r = await invocar('admin-usuarios', { accion: 'actualizar', id: u.id, ...cambios }); if (r.password_temporal) setCred({ email: u.email, password: r.password_temporal }); else toast(msg); }
    catch (e) { toast(e.message); }
    recargar();
  }
  async function crear(e) {
    e.preventDefault();
    if (nuevo.nombre.trim().length < 3) return setError('Escribe el nombre completo.');
    if (!EMAIL_RE.test(nuevo.email.trim())) return setError('Revisa el correo.');
    setError('');
    try {
      const r = await invocar('admin-usuarios', { accion: 'crear', ...nuevo, email: nuevo.email.trim().toLowerCase() });
      setCred({ email: nuevo.email.trim().toLowerCase(), password: r.password_temporal });
      setNuevo({ nombre: '', email: '', rol: 'consulta' });
      recargar();
    } catch (err) { setError(err.message); }
  }

  return (
    <section className="card" aria-labelledby="usuarios-titulo">
      <h2 id="usuarios-titulo">Usuarios del panel</h2>
      <p className="muted">Consulta: recepción, tablero y consultas. Administrador: además, configuración.</p>
      <div className="table-wrap">
        <table className="tabla tabla-usuarios">
          <thead><tr><th>Nombre</th><th>Rol</th><th>Estado</th><th><span className="sr-only">Acciones</span></th></tr></thead>
          <tbody>
            {usuarios.map((u) => {
              const yo = u.id === perfil.id;
              return (
                <tr key={u.id}>
                  <td><strong>{u.nombre}</strong>{yo && ' (tú)'}<br /><span className="muted small">{u.email}</span></td>
                  <td><select aria-label={`Rol de ${u.nombre}`} value={u.rol} disabled={yo}
                    onChange={(e) => actualizar(u, { rol: e.target.value }, 'Rol actualizado.')}>
                    <option value="consulta">Consulta</option><option value="admin">Administrador</option></select></td>
                  <td><span className={`pill ${u.activo ? 'ok' : 'error'}`}>{u.activo ? 'Activo' : 'Inactivo'}</span></td>
                  <td className="acciones-fila">{!yo && <>
                    <button className="link-btn" type="button" onClick={() => actualizar(u, { activo: !u.activo }, u.activo ? 'Usuario desactivado.' : 'Usuario activado.')}>{u.activo ? 'Desactivar' : 'Activar'}</button>
                    <button className="link-btn" type="button" onClick={() => confirm(`¿Generar una contraseña temporal nueva para ${u.nombre}?`) && actualizar(u, { restablecer_password: true })}>Nueva contraseña</button>
                  </>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <form className="nuevo-usuario" onSubmit={crear} noValidate>
        <h3>Agregar usuario</h3>
        <div className="grid-2">
          <div className="field"><label htmlFor="u-nombre">Nombre completo</label><input id="u-nombre" type="text" value={nuevo.nombre} onChange={(e) => setNuevo({ ...nuevo, nombre: e.target.value })} /></div>
          <div className="field"><label htmlFor="u-email">Correo</label><input id="u-email" type="email" value={nuevo.email} onChange={(e) => setNuevo({ ...nuevo, email: e.target.value })} /></div>
        </div>
        <div className="field"><label htmlFor="u-rol">Rol</label>
          <select id="u-rol" value={nuevo.rol} onChange={(e) => setNuevo({ ...nuevo, rol: e.target.value })}><option value="consulta">Consulta</option><option value="admin">Administrador</option></select></div>
        <Mensaje>{error}</Mensaje>
        <button className="btn btn-compact" type="submit">Agregar usuario</button>
      </form>
      <Dialogo abierto={Boolean(cred)} onCerrar={() => setCred(null)} titulo="Contraseña temporal">
        {cred && <>
          <p>Usuario: {cred.email}</p>
          <p className="cred-password"><code>{cred.password}</code></p>
          <p className="hint">Compártela por un canal seguro. Solo se muestra esta vez; la persona puede cambiarla al entrar.</p>
          <div className="dialog-actions">
            <button className="btn btn-secondary btn-compact" type="button" onClick={() => navigator.clipboard?.writeText(cred.password).then(() => toast('Contraseña copiada.'))}>Copiar</button>
            <button className="btn btn-compact" type="button" onClick={() => setCred(null)}>Listo</button>
          </div>
        </>}
      </Dialogo>
    </section>
  );
}

function Anfitriones() {
  const [lista, setLista] = useState([]);
  const [nuevo, setNuevo] = useState({ nombre: '', area: '', correo: '' });
  const [error, setError] = useState('');
  const toast = useToast();
  const cargar = useCallback(async () => {
    const { data } = await supabase.from('anfitriones').select('id, nombre, area, correo, activo').order('nombre');
    setLista(data ?? []);
  }, []);
  useEffect(() => { cargar(); }, [cargar]);

  async function agregar(e) {
    e.preventDefault();
    const n = { nombre: nuevo.nombre.trim(), area: nuevo.area.trim() || null, correo: nuevo.correo.trim().toLowerCase() || null };
    if (n.nombre.length < 3) return setError('Escribe el nombre completo.');
    if (n.correo && !EMAIL_RE.test(n.correo)) return setError('Revisa el correo.');
    const { error: err } = await supabase.from('anfitriones').insert(n);
    if (err) return setError('No se pudo agregar al anfitrión.');
    setError(''); setNuevo({ nombre: '', area: '', correo: '' }); toast('Anfitrión agregado.'); cargar();
  }
  async function alternar(a) {
    const { error: err } = await supabase.from('anfitriones').update({ activo: !a.activo }).eq('id', a.id);
    toast(err ? 'No se pudo actualizar.' : a.activo ? 'Ya no aparece en el formulario.' : 'Vuelve a aparecer en el formulario.');
    cargar();
  }

  return (
    <section className="card" aria-labelledby="anf-titulo">
      <h2 id="anf-titulo">Anfitriones</h2>
      <p className="muted">Aparecen en el formulario (solo nombre y área). Al registrar la llegada se avisa por correo al anfitrión.</p>
      <div className="table-wrap">
        <table className="tabla">
          <thead><tr><th>Nombre</th><th>Correo para avisos</th><th>Estado</th><th><span className="sr-only">Acciones</span></th></tr></thead>
          <tbody>
            {lista.map((a) => (
              <tr key={a.id}>
                <td><strong>{a.nombre}</strong><br /><span className="muted small">{a.area || 'Sin área'}</span></td>
                <td>{a.correo || <span className="muted">Sin correo: no recibe avisos</span>}</td>
                <td><span className={`pill ${a.activo ? 'ok' : 'error'}`}>{a.activo ? 'Visible' : 'Oculto'}</span></td>
                <td><button className="link-btn" type="button" onClick={() => alternar(a)}>{a.activo ? 'Ocultar' : 'Mostrar'}</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        {!lista.length && <p className="vacio">Aún no hay anfitriones. Agrega al personal que recibe visitas.</p>}
      </div>
      <form className="nuevo-usuario" onSubmit={agregar} noValidate>
        <h3>Agregar anfitrión</h3>
        <div className="grid-2">
          <div className="field"><label htmlFor="a-nombre">Nombre completo</label><input id="a-nombre" type="text" value={nuevo.nombre} onChange={(e) => setNuevo({ ...nuevo, nombre: e.target.value })} /></div>
          <div className="field"><label htmlFor="a-area">Área</label><input id="a-area" type="text" maxLength={80} value={nuevo.area} onChange={(e) => setNuevo({ ...nuevo, area: e.target.value })} /></div>
        </div>
        <div className="field"><label htmlFor="a-correo">Correo para avisos de llegada</label><input id="a-correo" type="email" value={nuevo.correo} onChange={(e) => setNuevo({ ...nuevo, correo: e.target.value })} /></div>
        <Mensaje>{error}</Mensaje>
        <button className="btn btn-compact" type="submit">Agregar anfitrión</button>
      </form>
    </section>
  );
}

function Correos({ onConfig }) {
  const [c, setC] = useState(null);
  const [dest, setDest] = useState('');
  const [error, setError] = useState('');
  const toast = useToast();
  useEffect(() => {
    supabase.from('configuracion').select('*').eq('id', 1).maybeSingle().then(({ data }) => {
      setC(data); setDest((data?.destinatarios_reporte ?? []).join('\n'));
    });
  }, []);
  if (!c) return <section className="card"><p className="muted">Cargando…</p></section>;

  async function guardar(e) {
    e.preventDefault();
    const recepcion = (c.correo_recepcion ?? '').trim().toLowerCase();
    const lista = listaCorreos(dest);
    if (recepcion && !EMAIL_RE.test(recepcion)) return setError('Revisa el correo de recepción.');
    const malos = lista.filter((d) => !EMAIL_RE.test(d));
    if (malos.length) return setError(`Revisa estos correos: ${malos.join(', ')}`);
    if (lista.length > 10) return setError('Máximo 10 destinatarios.');
    if (c.copia_recepcion && !recepcion) return setError('Para enviar copia, escribe el correo de recepción.');
    const cambios = { correo_recepcion: recepcion || null, copia_recepcion: c.copia_recepcion, avisar_anfitrion: c.avisar_anfitrion, destinatarios_reporte: lista, updated_at: new Date().toISOString() };
    const { data, error: err } = await supabase.from('configuracion').update(cambios).eq('id', 1).select().maybeSingle();
    if (err) return setError('No se pudieron guardar los cambios.');
    setError(''); onConfig(data); toast('Configuración guardada.');
  }
  return (
    <section className="card" aria-labelledby="correos-titulo">
      <h2 id="correos-titulo">Correos y avisos</h2>
      <form onSubmit={guardar} noValidate>
        <div className="field"><label htmlFor="c-rec">Correo de recepción</label>
          <input id="c-rec" type="email" placeholder="recepcion@hixsa.com" value={c.correo_recepcion ?? ''} onChange={(e) => setC({ ...c, correo_recepcion: e.target.value })} /></div>
        <label className="check"><input type="checkbox" checked={c.copia_recepcion} onChange={(e) => setC({ ...c, copia_recepcion: e.target.checked })} /><span>Enviar a recepción una copia de cada pase</span></label>
        <label className="check"><input type="checkbox" checked={c.avisar_anfitrion !== false} onChange={(e) => setC({ ...c, avisar_anfitrion: e.target.checked })} /><span>Avisar al anfitrión cuando llega su visita</span></label>
        <div className="field"><label htmlFor="c-dest">Destinatarios del reporte</label>
          <textarea id="c-dest" rows={3} placeholder="Un correo por línea" value={dest} onChange={(e) => setDest(e.target.value)} />
          <p className="hint">Se usan al enviar reportes y en el reporte diario automático. Máximo 10.</p></div>
        <Mensaje>{error}</Mensaje>
        <button className="btn btn-compact" type="submit">Guardar</button>
      </form>
    </section>
  );
}

function Bitacora({ usuarios }) {
  const [lista, setLista] = useState([]);
  useEffect(() => {
    supabase.from('bitacora_reportes').select('created_at, origen, enviado_por, destinatarios, total_registros')
      .order('created_at', { ascending: false }).limit(15).then(({ data }) => setLista(data ?? []));
  }, []);
  const nombres = Object.fromEntries(usuarios.map((u) => [u.id, u.nombre]));
  const origen = { panel: 'Panel', automatico: 'Reporte automático', 'claude-code': 'Claude Code' };
  return (
    <section className="card" aria-labelledby="bit-titulo">
      <h2 id="bit-titulo">Reportes enviados</h2>
      <ol className="bitacora">
        {!lista.length && <li className="muted">Aún no se ha enviado ningún reporte.</li>}
        {lista.map((b, i) => (
          <li key={i}><span className="bit-fecha">{fmtFechaHora.format(new Date(b.created_at))}</span>
            <span>{origen[b.origen] ?? b.origen}{b.enviado_por && nombres[b.enviado_por] ? `, ${nombres[b.enviado_por]}` : ''}: {b.total_registros} visitas a {b.destinatarios.join(', ')}</span></li>
        ))}
      </ol>
    </section>
  );
}
