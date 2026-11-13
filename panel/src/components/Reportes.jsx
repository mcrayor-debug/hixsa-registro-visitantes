import { useEffect, useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { supabase, consultaVisitas, invocar } from '../lib/supabase.js';
import { descargarCsv, fmtFechaHora } from '../lib/formato.js';
import { puedeExportar } from '../lib/permisos.js';
import * as E from '../../../supabase/functions/_shared/estadisticas.js';
import EnviarReporte from './EnviarReporte.jsx';
import { useToast } from './ui.jsx';

const AZUL = '#0047BA', CIAN = '#00A9E0', NARANJA = '#F38A00';
const mesActual = () => E.hoyCDMX().slice(0, 7);

export default function Reportes({ config, perfil, empresas = [] }) {
  const [tipo, setTipo] = useState('semanal');
  const [semana, setSemana] = useState(() => E.semanaDe(E.hoyCDMX()).desde);
  const [mes, setMes] = useState(mesActual);
  const [empresa, setEmpresa] = useState('');
  const [visitas, setVisitas] = useState(null);
  const [historial, setHistorial] = useState(new Set());
  const [correo, setCorreo] = useState(false);
  const [envio, setEnvio] = useState(() => ({ tipo: 'diario', fecha: E.sumarDias(E.hoyCDMX(), -1), enviando: false }));
  const exporta = puedeExportar(perfil);
  const toast = useToast();
  const rango = tipo === 'semanal' ? E.semanaDe(semana) : E.mesDe(mes);
  const tolerancia = config?.tolerancia_min ?? 15;

  useEffect(() => {
    let vivo = true;
    setVisitas(null);
    (async () => {
      const { data } = await consultaVisitas({ ...rango, empresa_visita_id: empresa || undefined }).order('entrada').limit(10000);
      const vs = data ?? [];
      const ids = [...new Set(vs.map((v) => v.persona_id).filter(Boolean))];
      const h = new Set();
      for (let i = 0; i < ids.length; i += 200) {
        const { data: prev } = await supabase.from('visitantes').select('persona_id').in('persona_id', ids.slice(i, i + 200)).lt('entrada', `${rango.desde}T00:00:00-06:00`).limit(5000);
        (prev ?? []).forEach((x) => h.add(x.persona_id));
      }
      if (vivo) { setHistorial(h); setVisitas(vs); }
    })();
    return () => { vivo = false; };
  }, [tipo, semana, mes, empresa]); // eslint-disable-line react-hooks/exhaustive-deps

  const d = useMemo(() => {
    if (!visitas) return null;
    const r = E.resumen(visitas, { tolerancia });
    return {
      r, nr: E.nuevosVsRecurrentes(visitas, historial), porDia: E.porDiaLaboral(visitas), pico: E.horasPico(visitas),
      expiradas: visitas.filter((v) => E.sinUso(v)), top: E.topVisitantes(visitas, 10),
      ocupacion: E.ocupacionPorFranja(visitas, E.diasHabiles(rango.desde, rango.hasta)), anfitriones: E.porAnfitrion(visitas),
    };
  }, [visitas, historial, tolerancia]); // eslint-disable-line react-hooks/exhaustive-deps

  const titulo = `Reporte ${tipo} de visitas`;
  const nombre = `reporte_${tipo}_${rango.desde}_${rango.hasta}`;
  async function pdf() {
    const { crearPdf } = await import('../lib/pdf.js');
    const { r, nr } = d;
    const secciones = tipo === 'semanal' ? [
      { titulo: 'Visitas por día (lunes a viernes)', barras: d.porDia.map((x) => ({ etiqueta: x.dia, valor: x.visitas })) },
      { titulo: 'Horas pico de acceso', barras: d.pico.filter((x) => x.llegadas).map((x) => ({ etiqueta: x.hora, valor: x.llegadas, color: [0, 169, 224] })) },
      { titulo: 'Visitantes nuevos contra recurrentes', barras: [{ etiqueta: 'Nuevos', valor: nr.nuevos }, { etiqueta: 'Recurrentes', valor: nr.recurrentes, color: [0, 169, 224] }] },
      { titulo: `Invitaciones vencidas sin uso (${d.expiradas.length})`, columnas: ['Folio', 'Visitante', 'Empresa', 'Entrada'],
        filas: d.expiradas.map((v) => [v.folio, v.nombre_completo, v.empresa, fmtFechaHora.format(new Date(v.entrada))]) },
    ] : [
      { titulo: 'Resumen consolidado del mes', columnas: ['Indicador', 'Valor'], filas: [['Visitas', r.total], ['Visitantes únicos', r.unicos], ['Empresas de origen', r.empresas],
        ['Llegaron', r.llegaron], ['Puntualidad', r.puntualidad === null ? '—' : `${r.puntualidad} %`], ['Duración real promedio', r.duracionPromedio === null ? '—' : `${r.duracionPromedio} h`],
        ['Entradas autorizadas fuera de horario', r.autorizadas], ['Vencidas sin uso', r.sinUso], ['Rechazadas', r.rechazadas], ['Nuevos / recurrentes', `${nr.nuevos} / ${nr.recurrentes}`]] },
      { titulo: 'Top 10 visitantes frecuentes', columnas: ['#', 'Visitante', 'Empresa', 'Visitas'], filas: d.top.map((x, i) => [i + 1, x.nombre, x.empresa, x.visitas]) },
      { titulo: 'Ocupación por franja horaria (visitantes presentes en promedio por día hábil)', barras: d.ocupacion.map((x) => ({ etiqueta: x.franja, valor: x.promedio })) },
      { titulo: 'Visitas por anfitrión y área', columnas: ['Anfitrión', 'Área', 'Visitas'], filas: d.anfitriones.map((x) => [x.anfitrion, x.area, x.visitas]) },
    ];
    const doc = await crearPdf({
      titulo, subtitulo: `${rango.desde} a ${rango.hasta}${empresa ? ` · ${empresas.find((e) => e.id === empresa)?.nombre}` : ''}. Generado por ${perfil.nombre}.`,
      kpis: [['visitas en el periodo', r.total], ['visitantes distintos', r.unicos], ['acceso en horario', r.puntualidad === null ? '—' : `${r.puntualidad} %`], ['vencidas sin uso', r.sinUso]],
      secciones, pie: titulo,
    });
    return { doc, nombre: `${nombre}.pdf`, base64: doc.base64() };
  }

  return (
    <div className="reportes">
      <div className="card filtros reportes-filtros">
        <div className="filtros-rapidos" role="tablist" aria-label="Tipo de reporte">
          <button type="button" className="chip-btn chip-grupo" aria-pressed={tipo === 'semanal'} onClick={() => setTipo('semanal')}>Semanal</button>
          <button type="button" className="chip-btn chip-grupo" aria-pressed={tipo === 'mensual'} onClick={() => setTipo('mensual')}>Mensual</button>
        </div>
        <div className="filtros-grid">
          {tipo === 'semanal'
            ? <div className="field"><label htmlFor="rp-semana">Semana que contiene</label><input id="rp-semana" type="date" value={semana} onChange={(e) => e.target.value && setSemana(e.target.value)} /></div>
            : <div className="field"><label htmlFor="rp-mes">Mes</label><input id="rp-mes" type="month" value={mes} onChange={(e) => e.target.value && setMes(e.target.value)} /></div>}
          <div className="field"><label htmlFor="rp-emp">Empresa a visitar</label>
            <select id="rp-emp" value={empresa} onChange={(e) => setEmpresa(e.target.value)}>
              {!config?.modo_auditoria && <option value="">Todas</option>}
              {empresas.map((e) => <option key={e.id} value={e.id}>{e.nombre}</option>)}
            </select></div>
          <p className="muted small reportes-periodo">Periodo: <strong>{rango.desde}</strong> a <strong>{rango.hasta}</strong></p>
        </div>
      </div>

      {exporta && (
        <div className="card envio-manual">
          <div><strong>Enviar reporte a los destinatarios ahora</strong>
            <p className="muted small">El mismo correo que sale solo a las 07:00. Útil si no llegó o para reenviar otro día.</p></div>
          <div className="envio-manual-campos">
            <select aria-label="Tipo de reporte" value={envio.tipo} onChange={(e) => setEnvio({ ...envio, tipo: e.target.value })}>
              <option value="diario">Diario</option><option value="semanal">Semanal</option></select>
            <input type="date" aria-label={envio.tipo === 'diario' ? 'Día del reporte' : 'Semana que contiene'} value={envio.fecha} max={E.hoyCDMX()} onChange={(e) => setEnvio({ ...envio, fecha: e.target.value })} />
            <button type="button" className="btn btn-compact" disabled={envio.enviando} aria-busy={envio.enviando} onClick={async () => {
              setEnvio({ ...envio, enviando: true });
              try { const r = await invocar('reporte-programado', { tipo: envio.tipo, fecha: envio.fecha }); toast(`Reporte ${r.tipo} enviado (${r.total} visitas, ${r.desde}${r.hasta !== r.desde ? ` a ${r.hasta}` : ''}).`); }
              catch (e) { toast(e.message); } finally { setEnvio((x) => ({ ...x, enviando: false })); }
            }}>{envio.enviando ? 'Enviando…' : 'Enviar ahora'}</button>
          </div>
        </div>
      )}

      {!d ? <p className="muted">Calculando…</p> : (
        <>
          <div className="kpis kpis-4">
            <div className="card kpi kpi-color" style={{ '--kpi': CIAN }}><span className="kpi-valor">{d.r.total}</span><span className="kpi-texto">Total</span><span className="hint">visitas en el periodo</span></div>
            <div className="card kpi kpi-color" style={{ '--kpi': AZUL }}><span className="kpi-valor">{d.r.unicos}</span><span className="kpi-texto">Únicos</span><span className="hint">visitantes distintos</span></div>
            <div className="card kpi kpi-color" style={{ '--kpi': '#5BB3D6' }}><span className="kpi-valor">{d.r.puntualidad === null ? '—' : `${d.r.puntualidad} %`}</span><span className="kpi-texto">Puntual</span><span className="hint">acceso en horario (tolerancia {tolerancia} min)</span></div>
            <div className="card kpi kpi-color kpi-export" style={{ '--kpi': NARANJA }}>
              <span className="kpi-texto">Exportar</span>
              {exporta ? <div className="acciones">
                <button type="button" className="btn btn-secondary btn-compact" disabled={!visitas.length} onClick={() => descargarCsv(visitas, `${nombre}.csv`)}>CSV</button>
                <button type="button" className="btn btn-secondary btn-compact" disabled={!visitas.length} onClick={async () => { try { const p = await pdf(); p.doc.descargar(p.nombre); } catch { toast('No se pudo generar el PDF.'); } }}>PDF</button>
                <button type="button" className="btn btn-compact" disabled={!visitas.length} onClick={() => setCorreo(true)}>Correo</button>
              </div> : <span className="hint">Tu rol no exporta.</span>}
            </div>
          </div>

          {tipo === 'semanal' ? (
            <div className="graficas">
              <Grafica titulo="Visitas por día (lunes a viernes)"><BarChart data={d.porDia}><CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E3E9EF" />
                <XAxis dataKey="dia" tick={{ fontSize: 12 }} /><YAxis allowDecimals={false} tick={{ fontSize: 12 }} /><Tooltip /><Bar isAnimationActive={false} dataKey="visitas" name="Visitas" fill={AZUL} radius={[4, 4, 0, 0]} /></BarChart></Grafica>
              <Grafica titulo="Horas pico de acceso"><BarChart data={d.pico}><CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E3E9EF" />
                <XAxis dataKey="hora" tick={{ fontSize: 11 }} interval={1} /><YAxis allowDecimals={false} tick={{ fontSize: 12 }} /><Tooltip /><Bar isAnimationActive={false} dataKey="llegadas" name="Llegadas" fill={CIAN} radius={[4, 4, 0, 0]} /></BarChart></Grafica>
              <section className="card grafica"><h2>Visitantes nuevos contra recurrentes</h2>
                <div className="duo"><div><span className="kpi-valor">{d.nr.nuevos}</span><span className="kpi-texto">nuevos</span></div>
                  <div><span className="kpi-valor" style={{ color: CIAN }}>{d.nr.recurrentes}</span><span className="kpi-texto">recurrentes</span></div></div>
                <div className="barra-duo" aria-hidden="true"><span style={{ flex: d.nr.nuevos || 0.001, background: AZUL }} /><span style={{ flex: d.nr.recurrentes || 0.001, background: CIAN }} /></div>
                <p className="hint">Recurrente: ya había visitado antes de este periodo.</p></section>
              <section className="card grafica"><h2>Invitaciones vencidas sin uso ({d.expiradas.length})</h2>
                <ul className="hoy-lista">{d.expiradas.slice(0, 8).map((v) => <li key={v.folio} className="hoy-item"><span className="hoy-hora">{fmtFechaHora.format(new Date(v.entrada)).split(',')[0]}</span>
                  <span className="hoy-datos"><strong>{v.nombre_completo}</strong><span className="muted small">{v.empresa}</span></span><span className="mono small">{v.folio}</span></li>)}</ul>
                {!d.expiradas.length && <p className="vacio">Ninguna.</p>}</section>
            </div>
          ) : (
            <div className="graficas">
              <section className="card grafica"><h2>Resumen consolidado del mes</h2>
                <dl className="resumen-mes">
                  {[['Visitas', d.r.total], ['Visitantes únicos', d.r.unicos], ['Empresas de origen', d.r.empresas], ['Llegaron', d.r.llegaron],
                    ['Puntualidad', d.r.puntualidad === null ? '—' : `${d.r.puntualidad} %`], ['Duración real promedio', d.r.duracionPromedio === null ? '—' : `${d.r.duracionPromedio} h`],
                    ['Autorizadas fuera de horario', d.r.autorizadas], ['Vencidas sin uso', d.r.sinUso], ['Nuevos / recurrentes', `${d.nr.nuevos} / ${d.nr.recurrentes}`]]
                    .map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
                </dl></section>
              <section className="card grafica"><h2>Top 10 visitantes frecuentes</h2>
                <ol className="ranking">{d.top.map((x) => <li key={`${x.nombre}${x.empresa}`}><span>{x.nombre}<span className="muted small"> · {x.empresa}</span></span>
                  <span className="ranking-barra"><span style={{ width: `${(x.visitas / d.top[0].visitas) * 100}%` }} /></span><strong>{x.visitas}</strong></li>)}</ol>
                {!d.top.length && <p className="vacio">Sin datos.</p>}</section>
              <Grafica titulo="Ocupación por franja horaria"><BarChart data={d.ocupacion}><CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E3E9EF" />
                <XAxis dataKey="franja" tick={{ fontSize: 11 }} interval={1} /><YAxis tick={{ fontSize: 12 }} /><Tooltip formatter={(v) => [`${v} visitantes en promedio`, 'Ocupación']} />
                <Bar isAnimationActive={false} dataKey="promedio" name="Visitantes presentes" fill={AZUL} radius={[4, 4, 0, 0]} /></BarChart></Grafica>
              <section className="card grafica"><h2>Visitas por anfitrión y área</h2>
                <div className="table-wrap"><table className="tabla"><thead><tr><th>Anfitrión</th><th>Área</th><th>Visitas</th></tr></thead>
                  <tbody>{d.anfitriones.slice(0, 15).map((x) => <tr key={`${x.anfitrion}${x.area}`}><td>{x.anfitrion}</td><td>{x.area || '—'}</td><td><strong>{x.visitas}</strong></td></tr>)}</tbody></table></div></section>
            </div>
          )}
          <EnviarReporte abierto={correo} onCerrar={() => setCorreo(false)} filtros={{ ...rango, empresa_visita_id: empresa || undefined }} n={visitas.length}
            titulo={titulo} destinatarios={config?.destinatarios_reporte ?? []} crearPdf={pdf} />
        </>
      )}
    </div>
  );
}

function Grafica({ titulo, children }) {
  return <section className="card grafica"><h2>{titulo}</h2><div className="grafica-cuerpo"><ResponsiveContainer width="100%" height="100%">{children}</ResponsiveContainer></div></section>;
}
