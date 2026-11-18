import { useState } from 'react';
import { invocar } from '../../lib/supabase.js';
import { descargarPlantilla, detectarFormato, leerCsv, normalizar, revisar } from '../../lib/importar.js';
import { Mensaje, useToast } from '../ui.jsx';
import { Icono } from '../iconos.jsx';
import Depurar from './Depurar.jsx';

const FORMATOS = { glide_perfiles: 'Glide: visitantes (perfiles)', glide_visitas: 'Glide: visitas', plantilla: 'Plantilla HIXSA' };

export default function Datos({ perfil }) {
  return (
    <div className="config-col">
      <Importar />
      <Depurar perfil={perfil} />
    </div>
  );
}

function Importar() {
  const [archivo, setArchivo] = useState(null);
  const [norm, setNorm] = useState(null);
  const [rev, setRev] = useState([]);
  const [formato, setFormato] = useState(null);
  const [fotos, setFotos] = useState(true);
  const [sobrescribir, setSobrescribir] = useState(false);
  const [previa, setPrevia] = useState(null);
  const [progreso, setProgreso] = useState(null);
  const [resultados, setResultados] = useState([]);
  const [error, setError] = useState('');
  const toast = useToast();

  async function leer(file) {
    setError(''); setResultados([]); setProgreso(null); setArchivo(file);
    try {
      const filas = leerCsv(await file.text());
      const fmt = detectarFormato(filas);
      if (!fmt) { setNorm(null); setFormato(null); return setError('No reconozco el formato. Usa la exportación de Glide (visitantes o visitas) o la plantilla HIXSA.'); }
      const n = normalizar(fmt, filas);
      setFormato(fmt); setNorm(n); const r = revisar(n); setRev(r); simular(n, r, sobrescribir);
    } catch { setError('No se pudo leer el archivo. Debe ser CSV.'); }
  }

  /** Vista previa en el servidor: cuántas filas se crearían, actualizarían u omitirían (no escribe nada). */
  async function simular(n, r, sob) {
    setPrevia('cargando');
    const validas = n.filas.filter((f, i) => !r[i].errores.length);
    const todos = [];
    try {
      for (let i = 0; i < validas.length; i += 50) {
        const res = await invocar('importar-datos', { tipo: n.tipo, filas: validas.slice(i, i + 50), simular: true, sobrescribir: sob });
        todos.push(...res.resultados);
      }
      const c = (e) => todos.filter((x) => x.estado === e).length;
      setPrevia({ nuevas: c('creado'), actualizar: c('actualizado'), omitir: c('omitido'), errores: c('error') });
    } catch { setPrevia(null); }
  }

  async function importar() {
    const validas = norm.filas.filter((f, i) => !rev[i].errores.length);
    const lote = norm.tipo === 'visitas' && fotos ? 10 : 40;
    const todos = [];
    setProgreso({ hechos: 0, total: validas.length });
    for (let i = 0; i < validas.length; i += lote) {
      try {
        const r = await invocar('importar-datos', { tipo: norm.tipo, filas: validas.slice(i, i + lote), copiar_fotos: fotos, sobrescribir });
        todos.push(...r.resultados);
      } catch (e) {
        todos.push(...validas.slice(i, i + lote).map((f) => ({ fila: f._fila, estado: 'error', mensaje: e.message })));
      }
      setProgreso({ hechos: Math.min(i + lote, validas.length), total: validas.length });
      setResultados([...todos]);
    }
    const c = (e) => todos.filter((x) => x.estado === e).length;
    toast(`Importación terminada: ${c('creado')} nuevas, ${c('actualizado')} actualizadas, ${c('omitido')} ya existían, ${c('error')} con error.`);
  }

  const conError = rev.filter((x) => x.errores.length);
  const conAviso = rev.filter((x) => x.avisos?.length || x.revisar);
  const cuenta = (e) => resultados.filter((x) => x.estado === e).length;
  return (
    <section className="card" aria-labelledby="imp-titulo">
      <div className="card-head">
        <div><h2 id="imp-titulo">Importar datos</h2>
          <p className="muted">Archivos CSV exportados de Glide o la plantilla HIXSA. Importa primero <strong>visitantes.csv</strong> y después <strong>Visitas.csv</strong>. Importar dos veces el mismo archivo no duplica registros.</p></div>
        <button type="button" className="btn btn-secondary btn-compact btn-icono" onClick={descargarPlantilla}><Icono nombre="subir" /> Descargar plantilla CSV</button>
      </div>
      <label className="btn btn-compact btn-icono"><Icono nombre="subir" /> {archivo ? 'Elegir otro archivo' : 'Elegir archivo CSV'}
        <input type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => e.target.files?.[0] && leer(e.target.files[0])} /></label>
      {archivo && <p className="small muted">{archivo.name}</p>}
      <Mensaje>{error}</Mensaje>
      {norm && (
        <div className="import-resumen">
          <p><strong>{FORMATOS[formato]}</strong>: {norm.filas.length} filas · {norm.filas.length - conError.length} listas · {conError.length} con error · {conAviso.length} con aviso</p>
          {norm.tipo === 'visitas' && formato === 'glide_visitas' && (
            <label className="check"><input type="checkbox" checked={fotos} onChange={(e) => setFotos(e.target.checked)} /><span>Copiar fotos de identificación y del visitante desde Glide (más lento)</span></label>)}
          <label className="check"><input type="checkbox" checked={sobrescribir} onChange={(e) => { setSobrescribir(e.target.checked); simular(norm, rev, e.target.checked); }} />
            <span>Actualizar los registros ya importados con los datos de este archivo (no toca visitas anonimizadas)</span></label>
          {previa === 'cargando' && <p className="small muted">Revisando con el servidor…</p>}
          {previa && previa !== 'cargando' && (
            <p className="small previa-import">Vista previa: <strong>{previa.nuevas}</strong> nuevas · <strong>{previa.actualizar}</strong> se actualizarán · <strong>{previa.omitir}</strong> ya existen y se omiten{previa.errores ? ` · ${previa.errores} con error` : ''}</p>)}
          {(conError.length > 0 || conAviso.length > 0) && (
            <details><summary>Ver filas con error o aviso</summary>
              <ul className="small">{[...conError, ...conAviso].slice(0, 50).map((x) => <li key={`${x.fila}${x.errores.join()}`}>Fila {x.fila}{x.nombre ? ` (${x.nombre})` : ''}: {[...x.errores, ...(x.avisos ?? []), ...(x.revisar ? ['revisar separación de nombre y apellidos'] : [])].join('; ')}</li>)}</ul>
            </details>)}
          <button type="button" className="btn btn-compact" disabled={Boolean(progreso && progreso.hechos < progreso.total)} onClick={importar}>
            {progreso && progreso.hechos < progreso.total ? `Importando ${progreso.hechos} de ${progreso.total}…` : `Importar ${norm.filas.length - conError.length} filas`}</button>
          {progreso && <progress value={progreso.hechos} max={progreso.total} aria-label="Avance de la importación" />}
          {resultados.length > 0 && (
            <p className="small">Nuevas: <strong>{cuenta('creado')}</strong> · actualizadas: <strong>{cuenta('actualizado')}</strong> · ya existían: <strong>{cuenta('omitido')}</strong> · con error: <strong>{cuenta('error')}</strong></p>)}
          {cuenta('error') > 0 && <details><summary>Errores del servidor</summary><ul className="small">{resultados.filter((x) => x.estado === 'error').map((x) => <li key={x.fila}>Fila {x.fila}: {x.mensaje}</li>)}</ul></details>}
        </div>
      )}
    </section>
  );
}
