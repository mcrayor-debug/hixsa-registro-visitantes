import { useCallback, useEffect, useState } from 'react';
import { supabase, invocar } from '../../lib/supabase.js';
import { EMAIL_RE } from '../../lib/formato.js';
import { esSuperadmin } from '../../lib/permisos.js';
import { Dialogo, Mensaje, useToast } from '../ui.jsx';
import { BotonIcono, Icono } from '../iconos.jsx';

export default function Usuarios({ perfil }) {
  const [usuarios, setUsuarios] = useState([]);
  const [roles, setRoles] = useState([]);
  const [nuevo, setNuevo] = useState(null);
  const [error, setError] = useState('');
  const [cred, setCred] = useState(null);
  const [editar, setEditar] = useState(null);
  const toast = useToast();
  const soySuper = esSuperadmin(perfil);

  const cargar = useCallback(async () => {
    const [{ data: r }, lista] = await Promise.all([
      supabase.from('roles').select('id, nombre').order('sistema', { ascending: false }).order('nombre'),
      invocar('admin-usuarios', { accion: 'listar' }).catch(() => ({ usuarios: [] })),
    ]);
    setRoles(r ?? []);
    setUsuarios(lista.usuarios ?? []);
  }, []);
  useEffect(() => { cargar(); }, [cargar]);
  const rolesAsignables = roles.filter((r) => r.id !== 'superadmin' || soySuper);

  async function accion(u, cuerpo, msg) {
    try {
      const r = await invocar('admin-usuarios', { id: u.id, ...cuerpo });
      if (r.password_temporal) setCred({ email: u.email, password: r.password_temporal }); else toast(msg);
    } catch (e) { toast(e.message); }
    cargar();
  }
  async function crear(e) {
    e.preventDefault();
    if (nuevo.nombre.trim().length < 3) return setError('Escribe el nombre completo.');
    if (!EMAIL_RE.test(nuevo.email.trim())) return setError('Revisa el correo.');
    try {
      const email = nuevo.email.trim().toLowerCase();
      const r = await invocar('admin-usuarios', { accion: 'crear', ...nuevo, email });
      setNuevo(null);
      setCred({ email, password: r.password_temporal });
      cargar();
    } catch (err) { setError(err.message); }
  }

  return (
    <section className="card" aria-labelledby="usuarios-titulo">
      <div className="card-head">
        <div>
          <h2 id="usuarios-titulo">Usuarios del panel</h2>
          <p className="muted">Solo entran las personas dadas de alta aquí, con los permisos de su rol.</p>
        </div>
        <button className="btn btn-compact btn-icono" type="button" onClick={() => { setError(''); setNuevo({ nombre: '', email: '', rol: 'recepcion' }); }}>
          <Icono nombre="agregar" /> Agregar usuario
        </button>
      </div>
      <div className="table-wrap">
        <table className="tabla">
          <thead><tr><th>Nombre</th><th>Rol</th><th>Estado</th><th><span className="sr-only">Acciones</span></th></tr></thead>
          <tbody>
            {usuarios.map((u) => {
              const yo = u.id === perfil.id;
              const protegido = u.rol === 'superadmin' && !soySuper;
              return (
                <tr key={u.id}>
                  <td><strong>{u.nombre}</strong>{yo && ' (tú)'}<br /><span className="muted small">{u.email}{u.celular ? ` · ${u.celular}` : ''}</span></td>
                  <td>
                    <select aria-label={`Rol de ${u.nombre}`} value={u.rol} disabled={yo || protegido}
                      onChange={(e) => accion(u, { accion: 'actualizar', rol: e.target.value }, 'Rol actualizado.')}>
                      {(protegido ? roles : rolesAsignables).map((r) => <option key={r.id} value={r.id}>{r.nombre}</option>)}
                    </select>
                  </td>
                  <td><span className={`pill ${u.activo ? 'ok' : 'error'}`}>{u.activo ? 'Activo' : 'Inactivo'}</span></td>
                  <td className="acciones-fila">
                    {!protegido && <BotonIcono icono="editar" texto="Editar datos" onClick={() => { setError(''); setEditar({ id: u.id, nombre: u.nombre, email: u.email, celular: u.celular ?? '' }); }} />}
                    {!yo && !protegido && <>
                      <BotonIcono icono={u.activo ? 'ocultar' : 'mostrar'} texto={u.activo ? 'Desactivar' : 'Activar'}
                        onClick={() => accion(u, { accion: 'actualizar', activo: !u.activo }, u.activo ? 'Usuario desactivado.' : 'Usuario activado.')} />
                      <BotonIcono icono="llave" texto="Generar contraseña temporal"
                        onClick={() => confirm(`¿Generar una contraseña temporal nueva para ${u.nombre}?`) && accion(u, { accion: 'actualizar', restablecer_password: true })} />
                      {soySuper && <BotonIcono icono="eliminar" texto="Eliminar usuario" peligro
                        onClick={() => confirm(`¿Eliminar a ${u.nombre}? Ya no podrá entrar al panel. Esta acción no se puede deshacer.`) && accion(u, { accion: 'eliminar' }, 'Usuario eliminado.')} />}
                    </>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <Dialogo abierto={Boolean(nuevo)} onCerrar={() => setNuevo(null)} titulo="Agregar usuario">
        {nuevo && (
          <form onSubmit={crear} noValidate>
            <div className="field"><label htmlFor="u-nombre">Nombre completo</label><input id="u-nombre" type="text" value={nuevo.nombre} onChange={(e) => setNuevo({ ...nuevo, nombre: e.target.value })} /></div>
            <div className="field"><label htmlFor="u-email">Correo</label><input id="u-email" type="email" value={nuevo.email} onChange={(e) => setNuevo({ ...nuevo, email: e.target.value })} /></div>
            <div className="field"><label htmlFor="u-rol">Rol</label>
              <select id="u-rol" value={nuevo.rol} onChange={(e) => setNuevo({ ...nuevo, rol: e.target.value })}>
                {rolesAsignables.map((r) => <option key={r.id} value={r.id}>{r.nombre}</option>)}
              </select></div>
            <Mensaje>{error}</Mensaje>
            <div className="dialog-actions"><button className="btn btn-compact" type="submit">Agregar usuario</button></div>
          </form>
        )}
      </Dialogo>
      <Dialogo abierto={Boolean(editar)} onCerrar={() => setEditar(null)} titulo="Editar usuario">
        {editar && (
          <form noValidate onSubmit={async (e) => {
            e.preventDefault();
            if (editar.nombre.trim().length < 3) return setError('Escribe el nombre completo.');
            if (!EMAIL_RE.test(editar.email.trim())) return setError('Revisa el correo.');
            try {
              await invocar('admin-usuarios', { accion: 'actualizar', id: editar.id, nombre: editar.nombre, email: editar.email.trim().toLowerCase(), celular: editar.celular.trim() || null });
              setEditar(null); toast('Usuario actualizado.'); cargar();
            } catch (err) { setError(err.message); }
          }}>
            <div className="field"><label htmlFor="ue-nombre">Nombre completo</label><input id="ue-nombre" type="text" value={editar.nombre} onChange={(e) => setEditar({ ...editar, nombre: e.target.value })} /></div>
            <div className="field"><label htmlFor="ue-email">Correo (también es su usuario de acceso)</label><input id="ue-email" type="email" value={editar.email} onChange={(e) => setEditar({ ...editar, email: e.target.value })} /></div>
            <div className="field"><label htmlFor="ue-cel">Celular (opcional)</label><input id="ue-cel" type="tel" inputMode="tel" placeholder="55 1234 5678" value={editar.celular} onChange={(e) => setEditar({ ...editar, celular: e.target.value })} /></div>
            <Mensaje>{error}</Mensaje>
            <div className="dialog-actions"><button className="btn btn-compact" type="submit">Guardar</button></div>
          </form>
        )}
      </Dialogo>
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
