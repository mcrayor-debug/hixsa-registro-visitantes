import { useState } from 'react';
import { supabase } from '../../lib/supabase.js';
import { mensajeError, subirImagen, urlPublica } from '../../lib/archivos.js';
import { Dialogo, Mensaje, useToast } from '../ui.jsx';
import { BotonIcono, Icono } from '../iconos.jsx';

const MAX_LOGO = 1024 * 1024;
const VACIA = { nombre: '', mostrar_como: 'lista', orden: 100, activa: true, logo_url: null };

function LogoEmpresa({ e }) {
  const src = e.logo_url || (e.es_principal ? '/img/logo-hixsa.png' : null);
  return src ? <img className="logo-mini" src={src} alt={`Logo de ${e.nombre}`} />
    : <span className="logo-mini logo-mini-texto" aria-hidden="true">{e.nombre.slice(0, 8)}</span>;
}

export default function Empresas({ config, empresas, recargar }) {
  const [editando, setEditando] = useState(null);
  const [archivo, setArchivo] = useState(null);
  const [error, setError] = useState('');
  const [guardando, setGuardando] = useState(false);
  const toast = useToast();
  const auditoria = Boolean(config?.modo_auditoria);

  async function cambiarAuditoria(valor) {
    const msg = valor
      ? '¿Activar el modo auditoría? El formulario y el panel mostrarán solo la empresa principal.'
      : '¿Desactivar el modo auditoría? Se volverán a mostrar todas las empresas.';
    if (!confirm(msg)) return;
    const { error: err } = await supabase.from('configuracion').update({ modo_auditoria: valor, updated_at: new Date().toISOString() }).eq('id', 1);
    toast(err ? mensajeError(err) : valor ? 'Modo auditoría activado.' : 'Modo auditoría desactivado.');
    recargar();
  }

  async function subirLogoSistema(file) {
    try {
      const ruta = await subirImagen('logos', 'sistema', file, MAX_LOGO);
      const { error: err } = await supabase.from('configuracion').update({ logo_url: urlPublica('logos', ruta) }).eq('id', 1);
      toast(err ? mensajeError(err) : 'Logo actualizado.');
      recargar();
    } catch (e) { toast(e.message); }
  }
  async function quitarLogoSistema() {
    await supabase.from('configuracion').update({ logo_url: null }).eq('id', 1);
    toast('Se usa el logo de HIXSA incluido en el sitio.');
    recargar();
  }

  async function guardar(e) {
    e.preventDefault();
    const em = editando;
    const fila = { nombre: em.nombre.trim(), mostrar_como: em.mostrar_como, orden: Number(em.orden) || 100, activa: em.es_principal ? true : em.activa };
    if (fila.nombre.length < 2) return setError('Escribe el nombre de la empresa.');
    setGuardando(true);
    try {
      if (archivo) fila.logo_url = urlPublica('logos', await subirImagen('logos', 'empresas', archivo, MAX_LOGO));
      const res = em.id ? await supabase.from('empresas').update(fila).eq('id', em.id) : await supabase.from('empresas').insert(fila);
      if (res.error) throw new Error(mensajeError(res.error));
      setEditando(null);
      toast(em.id ? 'Empresa actualizada.' : 'Empresa agregada.');
      recargar();
    } catch (err) { setError(err.message); } finally { setGuardando(false); }
  }
  async function eliminar(em) {
    if (!confirm(`¿Eliminar ${em.nombre}? Si tiene visitas registradas no se podrá; en ese caso desactívala.`)) return;
    const { error: err } = await supabase.from('empresas').delete().eq('id', em.id);
    toast(err ? mensajeError(err) : 'Empresa eliminada.');
    recargar();
  }

  return (
    <div className="config-col">
      <section className={`card auditoria-card${auditoria ? ' activa' : ''}`} aria-labelledby="aud-titulo">
        <div className="card-head">
          <div>
            <h2 id="aud-titulo">Modo auditoría</h2>
            <p className="muted">Activo: la bienvenida muestra solo el logo de la empresa principal y el panel oculta la información de las demás empresas.
              Inactivo: se muestran todas las empresas (las marcadas como botón con su logo y el resto en lista).</p>
          </div>
          <label className="switch">
            <input type="checkbox" checked={auditoria} onChange={(e) => cambiarAuditoria(e.target.checked)} />
            <span>{auditoria ? 'Activo' : 'Inactivo'}</span>
          </label>
        </div>
      </section>

      <section className="card" aria-labelledby="logo-titulo">
        <h2 id="logo-titulo">Logo del sistema</h2>
        <p className="muted">Aparece en la bienvenida, el panel y los correos. Si no subes uno, se usa el de HIXSA incluido en el sitio. PNG, JPG o WebP, máximo 1 MB.</p>
        <div className="logo-sistema">
          <img src={config?.logo_url || '/img/logo-hixsa.png'} alt="Logo actual" />
          <label className="btn btn-secondary btn-compact btn-icono"><Icono nombre="subir" /> Subir logo
            <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={(e) => e.target.files?.[0] && subirLogoSistema(e.target.files[0])} /></label>
          {config?.logo_url && <button className="link-btn" type="button" onClick={quitarLogoSistema}>Usar el logo predeterminado</button>}
        </div>
      </section>

      <section className="card" aria-labelledby="emp-titulo">
        <div className="card-head">
          <div>
            <h2 id="emp-titulo">Empresas a visitar</h2>
            <p className="muted">Las marcadas como <strong>botón</strong> aparecen con su logo en la bienvenida; las de <strong>lista</strong>, debajo.</p>
          </div>
          {!auditoria && (
            <button className="btn btn-compact btn-icono" type="button" onClick={() => { setError(''); setArchivo(null); setEditando({ ...VACIA }); }}>
              <Icono nombre="agregar" /> Agregar empresa
            </button>
          )}
        </div>
        {auditoria && <p className="status" data-tipo="aviso">Modo auditoría activo: solo se muestra la empresa principal. Desactívalo para administrar las demás.</p>}
        <div className="table-wrap">
          <table className="tabla">
            <thead><tr><th>Logo</th><th>Empresa</th><th>Se muestra como</th><th>Orden</th><th>Estado</th><th><span className="sr-only">Acciones</span></th></tr></thead>
            <tbody>
              {empresas.map((em) => (
                <tr key={em.id}>
                  <td><LogoEmpresa e={em} /></td>
                  <td><strong>{em.nombre}</strong>{em.es_principal && <><br /><span className="pill ok">Principal</span></>}</td>
                  <td>{em.mostrar_como === 'boton' ? 'Botón con logo' : 'Lista'}</td>
                  <td>{em.orden}</td>
                  <td><span className={`pill ${em.activa ? 'ok' : 'error'}`}>{em.activa ? 'Activa' : 'Inactiva'}</span></td>
                  <td className="acciones-fila">
                    <BotonIcono icono="editar" texto="Editar empresa" onClick={() => { setError(''); setArchivo(null); setEditando({ ...em }); }} />
                    {!em.es_principal && <BotonIcono icono="eliminar" texto="Eliminar empresa" peligro onClick={() => eliminar(em)} />}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <Dialogo abierto={Boolean(editando)} onCerrar={() => setEditando(null)} titulo={editando?.id ? 'Editar empresa' : 'Agregar empresa'}>
        {editando && (
          <form onSubmit={guardar} noValidate>
            <div className="field"><label htmlFor="e-nombre">Nombre</label><input id="e-nombre" type="text" maxLength={80} value={editando.nombre} onChange={(e) => setEditando({ ...editando, nombre: e.target.value })} /></div>
            <div className="grid-2">
              <div className="field"><label htmlFor="e-como">Se muestra como</label>
                <select id="e-como" value={editando.mostrar_como} onChange={(e) => setEditando({ ...editando, mostrar_como: e.target.value })}>
                  <option value="boton">Botón con logo</option><option value="lista">Lista</option>
                </select></div>
              <div className="field"><label htmlFor="e-orden">Orden</label><input id="e-orden" type="number" min="1" max="999" value={editando.orden} onChange={(e) => setEditando({ ...editando, orden: e.target.value })} /></div>
            </div>
            <div className="field">
              <span className="label">Logo</span>
              <div className="logo-sistema">
                {(archivo || editando.logo_url) && <img src={archivo ? URL.createObjectURL(archivo) : editando.logo_url} alt="Vista previa del logo" />}
                <label className="btn btn-secondary btn-compact btn-icono"><Icono nombre="subir" /> {editando.logo_url || archivo ? 'Cambiar logo' : 'Subir logo'}
                  <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={(e) => setArchivo(e.target.files?.[0] ?? null)} /></label>
              </div>
              <p className="hint">PNG con fondo transparente de preferencia. Máximo 1 MB.</p>
            </div>
            {!editando.es_principal && (
              <label className="check"><input type="checkbox" checked={editando.activa} onChange={(e) => setEditando({ ...editando, activa: e.target.checked })} /><span>Activa (aparece en la bienvenida)</span></label>
            )}
            <Mensaje>{error}</Mensaje>
            <div className="dialog-actions"><button className="btn btn-compact" type="submit" disabled={guardando}>{guardando ? 'Guardando…' : 'Guardar'}</button></div>
          </form>
        )}
      </Dialogo>
    </div>
  );
}
