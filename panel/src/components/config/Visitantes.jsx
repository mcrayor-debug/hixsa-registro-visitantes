import { useCallback, useEffect, useState } from 'react';
import { supabase, invocar } from '../../lib/supabase.js';
import { fmtFechaHora } from '../../lib/formato.js';
import { Dialogo, Mensaje, useToast } from '../ui.jsx';
import { BotonIcono } from '../iconos.jsx';

const ESTADOS = {
  ninguno: ['Sin restricción', 'ok', 'Puede registrarse y entrar normalmente.'],
  no_deseado: ['No deseado', 'aviso', 'Puede registrarse; Recepción ve una alerta al recibirlo.'],
  restringido: ['Restringido', 'restringido', 'Puede registrarse, pero cada visita requiere la aprobación de su anfitrión.'],
  bloqueado: ['Bloqueado', 'error', 'No puede registrar visitas ni entrar.'],
};

export default function Visitantes() {
  const [lista, setLista] = useState([]);
  const [texto, setTexto] = useState('');
  const [filtro, setFiltro] = useState('');
  const [editando, setEditando] = useState(null);
  const [error, setError] = useState('');
  const [guardando, setGuardando] = useState(false);
  const toast = useToast();

  const cargar = useCallback(async () => {
    let q = supabase.from('personas').select('id, correo, nombre, apellidos, empresa, recurrente, estado_bloqueo, bloqueo_motivo, ultima_visita_at')
      .order('ultima_visita_at', { ascending: false, nullsFirst: false }).limit(200);
    const t = texto.replace(/[,()*%\\]/g, ' ').trim();
    if (t) q = q.or(['nombre', 'apellidos', 'correo', 'empresa'].map((c) => `${c}.ilike.%${t}%`).join(','));
    if (filtro === 'recurrentes') q = q.eq('recurrente', true);
    else if (filtro) q = q.eq('estado_bloqueo', filtro);
    const { data } = await q;
    setLista(data ?? []);
  }, [texto, filtro]);
  useEffect(() => { const t = setTimeout(cargar, 250); return () => clearTimeout(t); }, [cargar]);

  async function guardar(e) {
    e.preventDefault();
    if (editando.estado !== 'ninguno' && editando.motivo.trim().length < 5) return setError('Escribe el motivo (mínimo 5 caracteres).');
    setGuardando(true);
    try {
      const r = await invocar('gestionar-visitante', { accion: 'bloqueo', persona_id: editando.id, estado: editando.estado, motivo: editando.motivo.trim() });
      setEditando(null);
      toast(`Estado actualizado.${r.notificados ? ` Se avisó por correo a ${r.notificados} ${r.notificados === 1 ? 'persona' : 'personas'}.` : ''}`);
      cargar();
    } catch (err) { setError(err.message); } finally { setGuardando(false); }
  }

  return (
    <section className="card" aria-labelledby="vis-titulo">
      <div className="card-head">
        <div>
          <h2 id="vis-titulo">Visitantes</h2>
          <p className="muted">Perfiles de visitantes. Puedes marcarlos como no deseados, restringidos o bloqueados; se avisa por correo a los SUPERADMIN y a sus anfitriones.</p>
        </div>
      </div>
      <div className="filtros-grid filtros-visitantes">
        <div className="field field-wide"><label htmlFor="v-buscar">Buscar</label>
          <input id="v-buscar" type="search" placeholder="Nombre, correo o empresa" value={texto} onChange={(e) => setTexto(e.target.value)} /></div>
        <div className="field"><label htmlFor="v-filtro">Mostrar</label>
          <select id="v-filtro" value={filtro} onChange={(e) => setFiltro(e.target.value)}>
            <option value="">Todos</option><option value="recurrentes">Recurrentes</option>
            <option value="no_deseado">No deseados</option><option value="restringido">Restringidos</option><option value="bloqueado">Bloqueados</option>
          </select></div>
      </div>
      <div className="table-wrap">
        <table className="tabla">
          <thead><tr><th>Visitante</th><th>Empresa de origen</th><th>Tipo</th><th>Estado</th><th>Última visita</th><th><span className="sr-only">Acciones</span></th></tr></thead>
          <tbody>
            {lista.map((p) => {
              const [etiqueta, clase] = ESTADOS[p.estado_bloqueo] ?? ESTADOS.ninguno;
              return (
                <tr key={p.id}>
                  <td><strong>{`${p.nombre ?? ''} ${p.apellidos ?? ''}`.trim() || 'Sin nombre'}</strong><br /><span className="muted small">{p.correo}</span></td>
                  <td>{p.empresa}</td>
                  <td>{p.recurrente ? <span className="pill">Recurrente</span> : <span className="muted small">No recurrente</span>}</td>
                  <td><span className={`pill ${clase}`} title={p.bloqueo_motivo ?? ''}>{etiqueta}</span></td>
                  <td className="nowrap small">{p.ultima_visita_at ? fmtFechaHora.format(new Date(p.ultima_visita_at)) : '—'}</td>
                  <td className="acciones-fila">
                    <BotonIcono icono="editar" texto="Cambiar estado del visitante"
                      onClick={() => { setError(''); setEditando({ id: p.id, nombre: `${p.nombre ?? ''} ${p.apellidos ?? ''}`.trim() || p.correo, estado: p.estado_bloqueo, motivo: p.bloqueo_motivo ?? '' }); }} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!lista.length && <p className="vacio">No hay visitantes con estos filtros.</p>}
      </div>

      <Dialogo abierto={Boolean(editando)} onCerrar={() => setEditando(null)} titulo="Estado del visitante" ancho={540}>
        {editando && (
          <form onSubmit={guardar} noValidate>
            <p><strong>{editando.nombre}</strong></p>
            <fieldset className="field">
              <legend className="label">Estado</legend>
              {Object.entries(ESTADOS).map(([k, [t, , desc]]) => (
                <label key={k} className="opcion-estado">
                  <input type="radio" name="estado" value={k} checked={editando.estado === k} onChange={() => setEditando({ ...editando, estado: k })} />
                  <span><strong>{t}</strong><br /><span className="muted small">{desc}</span></span>
                </label>
              ))}
            </fieldset>
            {editando.estado !== 'ninguno' && (
              <div className="field"><label htmlFor="v-motivo">Motivo</label>
                <textarea id="v-motivo" rows={3} maxLength={300} value={editando.motivo} onChange={(e) => setEditando({ ...editando, motivo: e.target.value })} />
                <p className="hint">Lo verá Recepción y se incluye en el aviso por correo.</p></div>
            )}
            <Mensaje>{error}</Mensaje>
            <div className="dialog-actions"><button className="btn btn-compact" type="submit" disabled={guardando}>{guardando ? 'Guardando…' : 'Guardar y avisar'}</button></div>
          </form>
        )}
      </Dialogo>
    </section>
  );
}
