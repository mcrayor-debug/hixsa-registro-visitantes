import { useState } from 'react';
import { invocar } from '../../lib/supabase.js';
import { MOTIVOS } from '../../lib/formato.js';
import { esSuperadmin } from '../../lib/permisos.js';
import { Dialogo, Mensaje, useToast } from '../ui.jsx';
import { Icono } from '../iconos.jsx';

const MODOS = [
  ['365', 'Más de 365 días', 'Visitas con más de un año'],
  ['rango', 'Por rango de fechas', 'Entre dos fechas'],
  ['tipo', 'Por tipo', 'Según visitante o motivo, todas las fechas'],
  ['completa', 'Completa', 'Todas las visitas pasadas'],
];
const TIPOS = [['todos', 'Todos'], ['no_recurrentes', 'No recurrentes'], ['recurrentes', 'Recurrentes'], ['glide', 'Importados de Glide'], ['bloqueados', 'Bloqueados'], ['restringidos', 'Restringidos']];

/** Depurar información: anonimiza visitas pasadas (conserva las estadísticas). */
export default function Depurar({ perfil }) {
  const superadmin = esSuperadmin(perfil);
  const [f, setF] = useState({ modo: '365', tipo_visitante: 'todos', motivo: '', desde: '', hasta: '' });
  const [previa, setPrevia] = useState(null);
  const [respaldo, setRespaldo] = useState(false);
  const [confirmacion, setConfirmacion] = useState('');
  const [dialogo, setDialogo] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState('');
  const toast = useToast();
  const cambiar = (k, v) => { setF({ ...f, [k]: v }); setPrevia(null); setRespaldo(false); setConfirmacion(''); };
  const filtros = { ...f, motivo: f.motivo || undefined };

  async function verPrevia() {
    setOcupado(true); setError('');
    try { setPrevia(await invocar('depurar-informacion', { ...filtros, accion: 'previa' })); } catch (e) { setError(e.message); } finally { setOcupado(false); }
  }
  async function descargarRespaldo() {
    setOcupado(true);
    try {
      const r = await invocar('depurar-informacion', { ...filtros, accion: 'respaldo' });
      const url = URL.createObjectURL(new Blob([r.csv], { type: 'text/csv;charset=utf-8' }));
      const a = Object.assign(document.createElement('a'), { href: url, download: `respaldo_depuracion_${new Date().toISOString().slice(0, 10)}.csv` });
      document.body.append(a); a.click(); a.remove(); URL.revokeObjectURL(url);
      setRespaldo(true);
    } catch (e) { setError(e.message); } finally { setOcupado(false); }
  }
  async function depurar() {
    setOcupado(true); setError('');
    try {
      const r = await invocar('depurar-informacion', { ...filtros, accion: 'depurar', confirmacion });
      setDialogo(false); setConfirmacion('');
      toast(`Se depuraron ${r.visitas} visitas, ${r.fotos_borradas} fotos y ${r.perfiles_borrados} perfiles.${r.restantes ? ` Faltan ${r.restantes}: repite la depuración.` : ''}`);
      setPrevia(null); setRespaldo(false);
    } catch (e) { setError(e.message); } finally { setOcupado(false); }
  }

  const exigeRespaldo = f.modo === 'completa';
  return (
    <section className="card depurar" aria-labelledby="dep-titulo">
      <h2 id="dep-titulo">Depurar información</h2>
      <p className="muted">Quita datos personales y fotos de visitas <strong>pasadas</strong>; las estadísticas se conservan. Nunca toca visitas próximas. Bloqueados y restringidos solo se depuran si los eliges, y conservan su perfil para que el bloqueo siga activo. <strong>No se puede deshacer.</strong></p>
      <div className="modos-depurar" role="radiogroup" aria-label="Modo">
        {MODOS.filter(([m]) => m !== 'completa' || superadmin).map(([m, t, d]) => (
          <label key={m} className={`modo-depurar${f.modo === m ? ' activo' : ''}${m === 'completa' ? ' peligro' : ''}`}>
            <input type="radio" name="modo" checked={f.modo === m} onChange={() => cambiar('modo', m)} />
            <span><strong>{t}</strong><br /><span className="muted small">{d}</span></span>
          </label>
        ))}
      </div>
      <div className="filtros-grid">
        <div className="field"><label htmlFor="dp-tipo">Tipo de visitante</label>
          <select id="dp-tipo" value={f.tipo_visitante} onChange={(e) => cambiar('tipo_visitante', e.target.value)}>{TIPOS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select></div>
        <div className="field"><label htmlFor="dp-motivo">Tipo de visita</label>
          <select id="dp-motivo" value={f.motivo} onChange={(e) => cambiar('motivo', e.target.value)}><option value="">Todos los motivos</option>{MOTIVOS.map((m) => <option key={m}>{m}</option>)}</select></div>
        {f.modo === 'rango' && <>
          <div className="field"><label htmlFor="dp-desde">Desde</label><input id="dp-desde" type="date" value={f.desde} onChange={(e) => cambiar('desde', e.target.value)} /></div>
          <div className="field"><label htmlFor="dp-hasta">Hasta</label><input id="dp-hasta" type="date" value={f.hasta} onChange={(e) => cambiar('hasta', e.target.value)} /></div>
        </>}
        <button type="button" className="btn btn-secondary btn-compact" disabled={ocupado} aria-busy={ocupado && !previa} onClick={verPrevia}>Vista previa</button>
      </div>
      {previa && (
        <div className="borrado-previa">
          <p>Se depurarían <strong>{previa.visitas}</strong> visitas de <strong>{previa.visitantes}</strong> visitantes y hasta <strong>{previa.fotos}</strong> fotos.
            {previa.excluidas_bloqueo ? ` Se excluyen ${previa.excluidas_bloqueo} visitas de bloqueados o restringidos.` : ''}{previa.hay_mas ? ' Hay más de 5,000: se procesan por partes.' : ''}</p>
          {previa.visitas > 0 && (
            <div className="acciones-depurar">
              <button type="button" className="btn btn-secondary btn-compact btn-icono" disabled={ocupado} onClick={descargarRespaldo}><Icono nombre="subir" /> {respaldo ? 'Respaldo descargado' : 'Descargar respaldo CSV'}</button>
              <button type="button" className="btn btn-peligro btn-compact" disabled={exigeRespaldo && !respaldo} onClick={() => { setError(''); setDialogo(true); }}>Depurar {previa.visitas} visitas</button>
              {exigeRespaldo && !respaldo && <span className="small muted">En la depuración completa, primero descarga el respaldo.</span>}
            </div>
          )}
        </div>
      )}
      <Mensaje>{error}</Mensaje>
      <Dialogo abierto={dialogo} onCerrar={() => setDialogo(false)} titulo={`¿Depurar ${previa?.visitas ?? 0} visitas?`}>
        <p>Se quitarán nombres, correos, teléfonos y fotos. Las estadísticas se conservan. <strong>No se puede deshacer.</strong></p>
        <div className="field field-corto"><label htmlFor="dp-conf">Escribe DEPURAR para confirmar</label>
          <input id="dp-conf" type="text" autoComplete="off" value={confirmacion} onChange={(e) => setConfirmacion(e.target.value)} /></div>
        <Mensaje>{error}</Mensaje>
        <div className="dialog-actions">
          <button type="button" className="btn btn-secondary btn-compact" onClick={() => setDialogo(false)}>Cancelar</button>
          <button type="button" className="btn btn-peligro btn-compact" disabled={ocupado} aria-busy={ocupado}
            onClick={() => (confirmacion === 'DEPURAR' ? depurar() : setError('Escribe DEPURAR para confirmar.'))}>{ocupado ? 'Depurando…' : 'Depurar'}</button>
        </div>
      </Dialogo>
    </section>
  );
}
