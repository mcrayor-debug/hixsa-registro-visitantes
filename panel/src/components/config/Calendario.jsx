import { usePaginacion } from '../../lib/paginacion.jsx';
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase.js';
import { mensajeError } from '../../lib/archivos.js';
import { Mensaje, useToast } from '../ui.jsx';
import { BotonIcono, Icono } from '../iconos.jsx';

const fmt = new Intl.DateTimeFormat('es-MX', { timeZone: 'UTC', weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' });
const p2 = (n) => String(n).padStart(2, '0');
/** n-ésimo lunes del mes (mes 1-12). */
function lunes(anio, mes, n) {
  const d = new Date(Date.UTC(anio, mes - 1, 1));
  const primero = 1 + ((8 - d.getUTCDay()) % 7);
  return `${anio}-${p2(mes)}-${p2(primero + (n - 1) * 7)}`;
}
/** Días de descanso obligatorio, Ley Federal del Trabajo, art. 74 (revisar ante reformas). */
export function descansoObligatorio(anio) {
  const dias = [
    [`${anio}-01-01`, 'Año Nuevo'],
    [lunes(anio, 2, 1), 'Día de la Constitución'],
    [lunes(anio, 3, 3), 'Natalicio de Benito Juárez'],
    [`${anio}-05-01`, 'Día del Trabajo'],
    [`${anio}-09-16`, 'Día de la Independencia'],
    [lunes(anio, 11, 3), 'Revolución Mexicana'],
    [`${anio}-12-25`, 'Navidad'],
  ];
  if ((anio - 2024) % 6 === 0) dias.push([`${anio}-10-01`, 'Transmisión del Poder Ejecutivo Federal']);
  return dias.sort();
}

export default function Calendario() {
  const anioActual = Number(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City', year: 'numeric' }).format(new Date()));
  const [anio, setAnio] = useState(anioActual);
  const [lista, setLista] = useState([]);
  const [nuevo, setNuevo] = useState({ fecha: '', nombre: '' });
  const [error, setError] = useState('');
  const [horario, setHorario] = useState(null);
  const toast = useToast();
  const pag = usePaginacion(lista, 25);

  const cargar = useCallback(async () => {
    const { data } = await supabase.from('dias_festivos').select('fecha, nombre').gte('fecha', `${anio}-01-01`).lte('fecha', `${anio}-12-31`).order('fecha');
    setLista(data ?? []);
  }, [anio]);
  useEffect(() => { cargar(); }, [cargar]);
  useEffect(() => {
    supabase.from('configuracion').select('hora_apertura, hora_ultima_entrada, hora_cierre').eq('id', 1).maybeSingle()
      .then(({ data }) => data && setHorario({ apertura: data.hora_apertura.slice(0, 5), ultima: data.hora_ultima_entrada.slice(0, 5), cierre: data.hora_cierre.slice(0, 5), error: '' }));
  }, []);
  async function guardarHorario(e) {
    e.preventDefault();
    const { apertura, ultima, cierre } = horario;
    if (!(apertura < ultima && ultima <= cierre)) return setHorario({ ...horario, error: 'La apertura debe ser antes de la última entrada, y esta no puede pasar del cierre.' });
    const { error: err } = await supabase.from('configuracion').update({ hora_apertura: apertura, hora_ultima_entrada: ultima, hora_cierre: cierre }).eq('id', 1);
    if (err) return setHorario({ ...horario, error: mensajeError(err) });
    setHorario({ ...horario, error: '' }); toast('Horario de recepción guardado.');
  }

  async function agregar(e) {
    e.preventDefault();
    if (!nuevo.fecha) return setError('Elige la fecha.');
    if (nuevo.nombre.trim().length < 2) return setError('Escribe el nombre del día.');
    const { error: err } = await supabase.from('dias_festivos').insert({ fecha: nuevo.fecha, nombre: nuevo.nombre.trim() });
    if (err) return setError(err.code === '23505' ? 'Esa fecha ya está en la lista.' : mensajeError(err));
    setError(''); setNuevo({ fecha: '', nombre: '' }); toast('Día festivo agregado.');
    if (nuevo.fecha.startsWith(String(anio))) cargar(); else setAnio(Number(nuevo.fecha.slice(0, 4)));
  }
  async function quitar(f) {
    if (!confirm(`¿Quitar ${f.nombre} (${f.fecha})? Ese día se podrán agendar visitas.`)) return;
    const { error: err } = await supabase.from('dias_festivos').delete().eq('fecha', f.fecha);
    toast(err ? mensajeError(err) : 'Día festivo eliminado.'); cargar();
  }
  async function cargarLFT() {
    const existentes = new Set(lista.map((f) => f.fecha));
    const faltan = descansoObligatorio(anio).filter(([f]) => !existentes.has(f)).map(([fecha, nombre]) => ({ fecha, nombre }));
    if (!faltan.length) return toast(`Los días de descanso obligatorio de ${anio} ya están cargados.`);
    const { error: err } = await supabase.from('dias_festivos').insert(faltan);
    toast(err ? mensajeError(err) : `Se agregaron ${faltan.length} días de descanso obligatorio de ${anio}.`); cargar();
  }

  return (
    <div className="config-col">
    {horario && (
      <section className="card" aria-labelledby="hor-titulo">
        <h2 id="hor-titulo">Horario de recepción</h2>
        <p className="muted">Se aplica al formulario, a las invitaciones del personal y al servidor. Las visitas pueden durar varios días.</p>
        <form className="horario-form" onSubmit={guardarHorario} noValidate>
          <div className="field"><label htmlFor="h-ap">Apertura (entrada más temprana)</label><input id="h-ap" type="time" value={horario.apertura} onChange={(e) => setHorario({ ...horario, apertura: e.target.value })} /></div>
          <div className="field"><label htmlFor="h-ul">Última hora de entrada</label><input id="h-ul" type="time" value={horario.ultima} onChange={(e) => setHorario({ ...horario, ultima: e.target.value })} /></div>
          <div className="field"><label htmlFor="h-ci">Cierre (salida más tarde)</label><input id="h-ci" type="time" value={horario.cierre} onChange={(e) => setHorario({ ...horario, cierre: e.target.value })} /></div>
          <button className="btn btn-compact" type="submit">Guardar horario</button>
        </form>
        <Mensaje>{horario.error}</Mensaje>
      </section>
    )}
    <section className="card" aria-labelledby="cal-titulo">
      <div className="card-head">
        <div>
          <h2 id="cal-titulo">Calendario laboral</h2>
          <p className="muted">Las visitas se agendan de lunes a viernes. En los días de esta lista tampoco se agendan visitas ni se envía el reporte diario. Una visita sí puede cruzar un fin de semana.</p>
        </div>
        <select aria-label="Año" value={anio} onChange={(e) => setAnio(Number(e.target.value))} style={{ width: 'auto' }}>
          {[anioActual - 1, anioActual, anioActual + 1, anioActual + 2].map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
      </div>
      <form className="festivo-nuevo" onSubmit={agregar} noValidate>
        <input type="date" aria-label="Fecha" value={nuevo.fecha} onChange={(e) => setNuevo({ ...nuevo, fecha: e.target.value })} />
        <input type="text" aria-label="Nombre" placeholder="Ej.: Aniversario de la empresa" maxLength={80} value={nuevo.nombre} onChange={(e) => setNuevo({ ...nuevo, nombre: e.target.value })} />
        <button className="btn btn-compact btn-icono" type="submit"><Icono nombre="agregar" /> Agregar</button>
      </form>
      <Mensaje>{error}</Mensaje>
      <div className="table-wrap">
        <table className="tabla">
          <thead><tr><th>Fecha</th><th>Día festivo</th><th><span className="sr-only">Acciones</span></th></tr></thead>
          <tbody>{pag.visibles.map((f) => (
            <tr key={f.fecha}><td className="nowrap">{fmt.format(new Date(`${f.fecha}T12:00:00Z`))}</td><td>{f.nombre}</td>
              <td className="acciones-fila"><BotonIcono icono="eliminar" texto="Quitar día festivo" peligro onClick={() => quitar(f)} /></td></tr>
          ))}</tbody>
        </table>
        {pag.controles}
        {!lista.length && <p className="vacio">Sin días festivos en {anio}.</p>}
      </div>
      <button type="button" className="btn btn-secondary btn-compact btn-icono" onClick={cargarLFT}>
        <Icono nombre="calendario" /> Cargar descanso obligatorio {anio} (Ley Federal del Trabajo)</button>
      <p className="hint">Revisa la lista cada año: la ley puede cambiar y los días que caen en lunes se mueven.</p>
    </section>
    </div>
  );
}
