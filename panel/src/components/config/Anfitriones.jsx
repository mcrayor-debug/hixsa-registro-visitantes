import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase.js';
import { EMAIL_RE } from '../../lib/formato.js';
import { mensajeError, subirImagen } from '../../lib/archivos.js';
import { Dialogo, Mensaje, useToast } from '../ui.jsx';
import { BotonIcono, Icono } from '../iconos.jsx';

const VACIO = { nombre: '', area: '', correo: '', celular: '', activo: true, empresas: [], foto_path: null };

export default function Anfitriones({ empresas }) {
  const [lista, setLista] = useState([]);
  const [fotos, setFotos] = useState({});
  const [editando, setEditando] = useState(null);
  const [archivo, setArchivo] = useState(null);
  const [error, setError] = useState('');
  const toast = useToast();
  const nombreEmpresa = Object.fromEntries(empresas.map((e) => [e.id, e.nombre]));

  const cargar = useCallback(async () => {
    const { data } = await supabase.from('anfitriones')
      .select('id, nombre, area, correo, celular, activo, foto_path, anfitrion_empresas(empresa_id)').order('nombre');
    const filas = (data ?? []).map((a) => ({ ...a, empresas: (a.anfitrion_empresas ?? []).map((x) => x.empresa_id) }));
    setLista(filas);
    const rutas = filas.map((a) => a.foto_path).filter(Boolean);
    if (rutas.length) {
      const { data: urls } = await supabase.storage.from('anfitriones').createSignedUrls(rutas, 600);
      setFotos(Object.fromEntries((urls ?? []).filter((u) => u.signedUrl).map((u) => [u.path, u.signedUrl])));
    }
  }, []);
  useEffect(() => { cargar(); }, [cargar]);

  async function guardar(e) {
    e.preventDefault();
    const a = editando;
    const fila = {
      nombre: a.nombre.trim(), area: a.area.trim() || null,
      correo: a.correo.trim().toLowerCase() || null, celular: a.celular.replace(/[^\d+]/g, '') || null, activo: a.activo,
    };
    if (fila.nombre.length < 3) return setError('Escribe el nombre completo.');
    if (fila.correo && !EMAIL_RE.test(fila.correo)) return setError('Revisa el correo.');
    if (fila.celular && !/^\+?[0-9]{10,15}$/.test(fila.celular)) return setError('El celular debe tener de 10 a 15 dígitos.');
    if (!a.empresas.length) return setError('Elige al menos una empresa.');
    try {
      let id = a.id;
      if (id) {
        const { error: err } = await supabase.from('anfitriones').update(fila).eq('id', id);
        if (err) throw new Error(mensajeError(err));
      } else {
        const { data, error: err } = await supabase.from('anfitriones').insert(fila).select('id').single();
        if (err) throw new Error(mensajeError(err));
        id = data.id;
      }
      // Empresas a las que pertenece
      const antes = a.id ? (lista.find((x) => x.id === a.id)?.empresas ?? []) : [];
      const quitar = antes.filter((x) => !a.empresas.includes(x));
      const agregar = a.empresas.filter((x) => !antes.includes(x));
      if (quitar.length) await supabase.from('anfitrion_empresas').delete().eq('anfitrion_id', id).in('empresa_id', quitar);
      if (agregar.length) await supabase.from('anfitrion_empresas').insert(agregar.map((empresa_id) => ({ anfitrion_id: id, empresa_id })));
      // Foto (privada)
      if (archivo) {
        const ruta = await subirImagen('anfitriones', id, archivo, 2 * 1024 * 1024);
        await supabase.from('anfitriones').update({ foto_path: ruta }).eq('id', id);
        if (a.foto_path) await supabase.storage.from('anfitriones').remove([a.foto_path]);
      }
      setEditando(null);
      toast(a.id ? 'Anfitrión actualizado.' : 'Anfitrión agregado.');
      cargar();
    } catch (err) { setError(err.message); }
  }
  async function alternar(a) {
    const { error: err } = await supabase.from('anfitriones').update({ activo: !a.activo }).eq('id', a.id);
    toast(err ? mensajeError(err) : a.activo ? 'Ya no aparece en el formulario.' : 'Vuelve a aparecer en el formulario.');
    cargar();
  }
  async function eliminar(a) {
    if (!confirm(`¿Eliminar a ${a.nombre}? Sus visitas anteriores se conservan, pero sin el enlace al anfitrión.`)) return;
    const { error: err } = await supabase.from('anfitriones').delete().eq('id', a.id);
    if (!err && a.foto_path) await supabase.storage.from('anfitriones').remove([a.foto_path]);
    toast(err ? mensajeError(err) : 'Anfitrión eliminado.');
    cargar();
  }
  const alternarEmpresa = (id) => setEditando({ ...editando, empresas: editando.empresas.includes(id) ? editando.empresas.filter((x) => x !== id) : [...editando.empresas, id] });

  return (
    <section className="card" aria-labelledby="anf-titulo">
      <div className="card-head">
        <div>
          <h2 id="anf-titulo">Anfitriones</h2>
          <p className="muted">Personas que reciben visitas. En el formulario aparecen según la empresa elegida (solo nombre y área).</p>
        </div>
        <button className="btn btn-compact btn-icono" type="button" onClick={() => { setError(''); setArchivo(null); setEditando({ ...VACIO, empresas: empresas.filter((e) => e.es_principal).map((e) => e.id) }); }}>
          <Icono nombre="agregar" /> Agregar anfitrión
        </button>
      </div>
      <div className="table-wrap">
        <table className="tabla">
          <thead><tr><th>Anfitrión</th><th>Contacto</th><th>Empresas</th><th>Estado</th><th><span className="sr-only">Acciones</span></th></tr></thead>
          <tbody>
            {lista.map((a) => (
              <tr key={a.id}>
                <td><div className="persona">
                  {a.foto_path && fotos[a.foto_path] ? <img className="avatar" src={fotos[a.foto_path]} alt="" /> : <span className="avatar avatar-vacio" aria-hidden="true">{a.nombre.charAt(0)}</span>}
                  <span><strong>{a.nombre}</strong><br /><span className="muted small">{a.area || 'Sin área'}</span></span>
                </div></td>
                <td className="small">{a.correo || <span className="muted">Sin correo: no recibe avisos</span>}{a.celular && <><br />{a.celular}</>}</td>
                <td><div className="chips-secciones">{a.empresas.map((id) => nombreEmpresa[id] && <span key={id} className="pill">{nombreEmpresa[id]}</span>)}</div></td>
                <td><span className={`pill ${a.activo ? 'ok' : 'error'}`}>{a.activo ? 'Visible' : 'Oculto'}</span></td>
                <td className="acciones-fila">
                  <BotonIcono icono="editar" texto="Editar anfitrión" onClick={() => { setError(''); setArchivo(null); setEditando({ ...a, area: a.area ?? '', correo: a.correo ?? '', celular: a.celular ?? '' }); }} />
                  <BotonIcono icono={a.activo ? 'ocultar' : 'mostrar'} texto={a.activo ? 'Ocultar del formulario' : 'Mostrar en el formulario'} onClick={() => alternar(a)} />
                  <BotonIcono icono="eliminar" texto="Eliminar anfitrión" peligro onClick={() => eliminar(a)} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!lista.length && <p className="vacio">Aún no hay anfitriones.</p>}
      </div>

      <Dialogo abierto={Boolean(editando)} onCerrar={() => setEditando(null)} titulo={editando?.id ? 'Editar anfitrión' : 'Agregar anfitrión'} ancho={560}>
        {editando && (
          <form onSubmit={guardar} noValidate>
            <div className="grid-2">
              <div className="field"><label htmlFor="a-nombre">Nombre completo</label><input id="a-nombre" type="text" value={editando.nombre} onChange={(e) => setEditando({ ...editando, nombre: e.target.value })} /></div>
              <div className="field"><label htmlFor="a-area">Área (opcional)</label><input id="a-area" type="text" maxLength={80} value={editando.area} onChange={(e) => setEditando({ ...editando, area: e.target.value })} /></div>
            </div>
            <div className="grid-2">
              <div className="field"><label htmlFor="a-correo">Correo para avisos</label><input id="a-correo" type="email" value={editando.correo} onChange={(e) => setEditando({ ...editando, correo: e.target.value })} /></div>
              <div className="field"><label htmlFor="a-cel">Celular (opcional)</label><input id="a-cel" type="tel" inputMode="tel" placeholder="55 1234 5678" value={editando.celular} onChange={(e) => setEditando({ ...editando, celular: e.target.value })} /></div>
            </div>
            <fieldset className="field">
              <legend className="label">Empresas a las que pertenece</legend>
              <div className="matriz-secciones">
                {empresas.map((em) => <label key={em.id} className="check"><input type="checkbox" checked={editando.empresas.includes(em.id)} onChange={() => alternarEmpresa(em.id)} /><span>{em.nombre}</span></label>)}
              </div>
            </fieldset>
            <div className="field">
              <span className="label">Foto (opcional)</span>
              <label className="btn btn-secondary btn-compact btn-icono"><Icono nombre="subir" /> {archivo ? archivo.name : editando.foto_path ? 'Cambiar foto' : 'Subir foto'}
                <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={(e) => setArchivo(e.target.files?.[0] ?? null)} /></label>
              <p className="hint">Se guarda de forma privada. Máximo 2 MB.</p>
            </div>
            <label className="check"><input type="checkbox" checked={editando.activo} onChange={(e) => setEditando({ ...editando, activo: e.target.checked })} /><span>Visible en el formulario</span></label>
            <Mensaje>{error}</Mensaje>
            <div className="dialog-actions"><button className="btn btn-compact" type="submit">Guardar</button></div>
          </form>
        )}
      </Dialogo>
    </section>
  );
}
