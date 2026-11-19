import { useEffect, useMemo, useState } from 'react';
import { supabase, consultaVisitas } from '../lib/supabase.js';
import { fmtHora } from '../lib/formato.js';
import { diaCDMX, hoyCDMX, mesDe, sumarDias, diaSemanaYmd } from '../../../supabase/functions/_shared/estadisticas.js';

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const nivel = (n) => (n >= 9 ? 'muchas' : n >= 4 ? 'normal' : n >= 1 ? 'pocas' : '');

/** Calendario mensual de Recepción: visitas por día (sin canceladas), festivos y fines de semana. */
export default function CalendarioRecepcion({ onElegir }) {
  const hoy = hoyCDMX();
  const [mes, setMes] = useState(hoy.slice(0, 7));
  const [visitas, setVisitas] = useState([]);
  const [festivos, setFestivos] = useState({});
  const [dia, setDia] = useState(hoy);
  useEffect(() => {
    const r = mesDe(mes);
    consultaVisitas(r, 'folio, nombre_completo, empresa, persona_visita, entrada, salida, llegada_at, cancelada_at').limit(3000)
      .then(({ data }) => setVisitas(data ?? []));
    supabase.from('dias_festivos').select('fecha, nombre, tipo, hora_inicio, hora_fin').gte('fecha', r.desde).lte('fecha', r.hasta)
      .then(({ data }) => setFestivos(Object.fromEntries((data ?? []).map((f) => [f.fecha, f]))));
  }, [mes]);

  const porDia = useMemo(() => {
    const m = {};
    for (const v of visitas) if (!v.cancelada_at) (m[diaCDMX(v.entrada)] ??= []).push(v);
    return m;
  }, [visitas]);
  const { desde, hasta } = mesDe(mes);
  const celdas = [];
  for (let i = 1; i < diaSemanaYmd(desde); i++) celdas.push(null);
  for (let d = desde; d <= hasta; d = sumarDias(d, 1)) celdas.push(d);
  const cambiarMes = (n) => { const [y, m] = mes.split('-').map(Number); const f = new Date(Date.UTC(y, m - 1 + n, 1)); setMes(f.toISOString().slice(0, 7)); };
  const [y, m] = mes.split('-').map(Number);
  const delDia = (porDia[dia] ?? []).sort((a, b) => a.entrada.localeCompare(b.entrada));
  const [dy, dm, dd] = dia.split('-').map(Number);

  return (
    <section className="card calendario-recepcion" aria-labelledby="cal-rec-titulo">
      <div className="cal-cabecera">
        <h2 id="cal-rec-titulo">{MESES[m - 1].replace(/^./, (c) => c.toUpperCase())} {y}</h2>
        <span>
          <button type="button" className="icon-btn" aria-label="Mes anterior" onClick={() => cambiarMes(-1)}>‹</button>
          <button type="button" className="icon-btn" aria-label="Mes siguiente" onClick={() => cambiarMes(1)}>›</button>
        </span>
      </div>
      <div className="cal-grid" role="grid" aria-label="Visitas por día">
        {['L', 'M', 'M', 'J', 'V', 'S', 'D'].map((d, i) => <span key={i} className="cal-dow" aria-hidden="true">{d}</span>)}
        {celdas.map((d, i) => {
          if (!d) return <span key={`v${i}`} />;
          const n = porDia[d]?.length ?? 0;
          const finde = diaSemanaYmd(d) >= 6;
          const f = festivos[d];
          const especial = f?.tipo === 'especial';
          const clases = ['cal-dia', nivel(n), finde ? 'finde' : '', f ? (especial ? 'especial' : 'festivo') : '', d === hoy ? 'hoy' : '', d === dia ? 'elegido' : ''].filter(Boolean).join(' ');
          return (
            <button key={d} type="button" className={clases} onClick={() => setDia(d)}
              title={f ? (especial ? `${f.nombre}: ${f.hora_inicio.slice(0, 5)} a ${f.hora_fin.slice(0, 5)} · ${n} visitas` : `Festivo: ${f.nombre}`) : `${n} ${n === 1 ? 'visita' : 'visitas'}`}
              aria-label={`${Number(d.slice(8))}: ${f ? (especial ? `horario especial de ${f.hora_inicio.slice(0, 5)} a ${f.hora_fin.slice(0, 5)}, ${n} visitas` : `festivo, ${f.nombre}`) : `${n} visitas`}`}>
              <span className="cal-num">{Number(d.slice(8))}</span>
              <span className="cal-n">{f ? (especial ? `${Number(f.hora_inicio.slice(0, 2))}–${Number(f.hora_fin.slice(0, 2))}` : 'festivo') : n || ''}</span>
            </button>
          );
        })}
      </div>
      <div className="cal-leyenda" aria-hidden="true">
        <span><i className="cal-muestra pocas" />1–3</span><span><i className="cal-muestra normal" />4–8</span>
        <span><i className="cal-muestra muchas" />9 o más</span><span><i className="cal-muestra festivo" />Festivo</span><span><i className="cal-muestra especial" />Horario especial</span>
      </div>
      <div className="cal-dia-lista">
        <p className="cal-dia-titulo"><strong>{dd} de {MESES[dm - 1]}</strong> · {festivos[dia]?.tipo === 'inhabil' ? `Festivo: ${festivos[dia].nombre}`
          : `${festivos[dia] ? `${festivos[dia].nombre} (${festivos[dia].hora_inicio.slice(0, 5)} a ${festivos[dia].hora_fin.slice(0, 5)}) · ` : ''}${delDia.length} ${delDia.length === 1 ? 'visita' : 'visitas'}`}</p>
        <ul>{delDia.slice(0, 12).map((v) => (
          <li key={v.folio}><button type="button" className="cal-visita" onClick={() => onElegir(v.folio)}>
            <span className="hoy-hora">{fmtHora.format(new Date(v.entrada))} – {fmtHora.format(new Date(v.salida))}</span> {v.nombre_completo}</button></li>
        ))}</ul>
        {delDia.length > 12 && <p className="muted small">y {delDia.length - 12} más (ver en Consultas).</p>}
      </div>
      <a className="btn btn-secondary btn-compact btn-icono cal-google" href={`https://calendar.google.com/calendar/r/day/${dy}/${dm}/${dd}`} target="_blank" rel="noopener noreferrer">Abrir Google Calendar</a>
    </section>
  );
}
