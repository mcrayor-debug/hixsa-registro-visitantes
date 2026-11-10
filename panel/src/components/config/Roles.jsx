import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase.js';
import { ALCANCES, SECCIONES } from '../../lib/permisos.js';
import { mensajeError } from '../../lib/archivos.js';
import { Dialogo, Mensaje, useToast } from '../ui.jsx';
import { BotonIcono, Icono } from '../iconos.jsx';

const VACIO = { id: '', nombre: '', descripcion: '', secciones: [], alcance: 'hoy', puede_exportar: false };
const aId = (t) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 30);

export default function Roles() {
  const [roles, setRoles] = useState([]);
  const [editando, setEditando] = useState(null); // { ...rol, nuevo: bool }
  const [error, setError] = useState('');
  const toast = useToast();
  const cargar = useCallback(async () => {
    const { data } = await supabase.from('roles').select('*').order('sistema', { ascending: false }).order('nombre');
    setRoles(data ?? []);
  }, []);
  useEffect(() => { cargar(); }, [cargar]);

  async function guardar(e) {
    e.preventDefault();
    const r = editando;
    const fila = { nombre: r.nombre.trim(), descripcion: r.descripcion?.trim() || null, secciones: r.secciones, alcance: r.alcance, puede_exportar: r.puede_exportar };
    if (fila.nombre.length < 2) return setError('Escribe el nombre del rol.');
    let res;
    if (r.nuevo) {
      const id = aId(fila.nombre);
      if (!/^[a-z][a-z0-9_]{1,29}$/.test(id)) return setError('El nombre debe empezar con una letra.');
      res = await supabase.from('roles').insert({ id, ...fila });
    } else {
      res = await supabase.from('roles').update(fila).eq('id', r.id);
    }
    if (res.error) return setError(mensajeError(res.error));
    setEditando(null);
    toast(r.nuevo ? 'Rol creado.' : 'Rol actualizado.');
    cargar();
  }
  async function eliminar(r) {
    if (!confirm(`¿Eliminar el rol ${r.nombre}?`)) return;
    const { error: err } = await supabase.from('roles').delete().eq('id', r.id);
    toast(err ? (err.code === '23503' ? 'Hay usuarios con este rol. Cámbialos de rol antes de eliminarlo.' : mensajeError(err)) : 'Rol eliminado.');
    cargar();
  }
  const alternar = (s) => setEditando({ ...editando, secciones: editando.secciones.includes(s) ? editando.secciones.filter((x) => x !== s) : [...editando.secciones, s] });

  return (
    <section className="card" aria-labelledby="roles-titulo">
      <div className="card-head">
        <div>
          <h2 id="roles-titulo">Roles y permisos</h2>
          <p className="muted">Define a qué secciones entra cada rol, qué fechas puede consultar y si puede exportar.</p>
        </div>
        <button className="btn btn-compact btn-icono" type="button" onClick={() => { setError(''); setEditando({ ...VACIO, nuevo: true }); }}>
          <Icono nombre="agregar" /> Agregar rol
        </button>
      </div>
      <div className="table-wrap">
        <table className="tabla">
          <thead><tr><th>Rol</th><th>Secciones</th><th>Consulta</th><th>Exporta</th><th><span className="sr-only">Acciones</span></th></tr></thead>
          <tbody>
            {roles.map((r) => (
              <tr key={r.id}>
                <td><strong>{r.nombre}</strong><br /><span className="muted small">{r.descripcion}</span></td>
                <td><div className="chips-secciones">
                  {r.id === 'superadmin' ? <span className="pill ok">Todas</span>
                    : SECCIONES.filter(([s]) => r.secciones.includes(s)).map(([s, t]) => <span key={s} className="pill">{t.replace('Configuración: ', 'Config.: ')}</span>)}
                </div></td>
                <td className="nowrap">{ALCANCES[r.alcance]}</td>
                <td>{r.puede_exportar ? 'Sí' : 'No'}</td>
                <td className="acciones-fila">
                  {r.sistema ? <span className="muted small">Protegido</span> : <>
                    <BotonIcono icono="editar" texto="Editar rol" onClick={() => { setError(''); setEditando({ ...r, nuevo: false }); }} />
                    <BotonIcono icono="eliminar" texto="Eliminar rol" peligro onClick={() => eliminar(r)} />
                  </>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Dialogo abierto={Boolean(editando)} onCerrar={() => setEditando(null)} titulo={editando?.nuevo ? 'Agregar rol' : 'Editar rol'} ancho={620}>
        {editando && (
          <form onSubmit={guardar} noValidate>
            <div className="grid-2">
              <div className="field"><label htmlFor="r-nombre">Nombre</label><input id="r-nombre" type="text" maxLength={40} value={editando.nombre} onChange={(e) => setEditando({ ...editando, nombre: e.target.value })} /></div>
              <div className="field"><label htmlFor="r-alcance">Fechas que puede consultar</label>
                <select id="r-alcance" value={editando.alcance} onChange={(e) => setEditando({ ...editando, alcance: e.target.value })}>
                  {Object.entries(ALCANCES).map(([k, t]) => <option key={k} value={k}>{t}</option>)}
                </select></div>
            </div>
            <div className="field"><label htmlFor="r-desc">Descripción</label><input id="r-desc" type="text" maxLength={200} value={editando.descripcion ?? ''} onChange={(e) => setEditando({ ...editando, descripcion: e.target.value })} /></div>
            <fieldset className="field">
              <legend className="label">Secciones a las que entra</legend>
              <div className="matriz-secciones">
                {SECCIONES.filter(([s]) => s !== 'config_roles').map(([s, t]) => (
                  <label key={s} className="check"><input type="checkbox" checked={editando.secciones.includes(s)} onChange={() => alternar(s)} /><span>{t}</span></label>
                ))}
              </div>
              <p className="hint">La sección de roles es exclusiva del SUPERADMIN.</p>
            </fieldset>
            <label className="check"><input type="checkbox" checked={editando.puede_exportar} onChange={(e) => setEditando({ ...editando, puede_exportar: e.target.checked })} /><span>Puede exportar (CSV, PDF) y enviar reportes por correo</span></label>
            <Mensaje>{error}</Mensaje>
            <div className="dialog-actions"><button className="btn btn-compact" type="submit">Guardar rol</button></div>
          </form>
        )}
      </Dialogo>
    </section>
  );
}
