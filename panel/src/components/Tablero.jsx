import { useEffect, useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { consultaVisitas } from '../lib/supabase.js';
import Dona from './Dona.jsx';
import { diaCDMX, estadoVisita, fmtDia, horaCDMX, rangoPeriodo } from '../lib/formato.js';

// Paleta del Manual de Identidad Corporativa de HIXSA
const AZUL = '#0047BA', CIAN = '#00A9E0', NARANJA = '#F38A00', AMARILLO = '#FFCD00';
const PERIODOS = [['7d', 'Últimos 7 días'], ['30d', 'Últimos 30 días'], ['mes', 'Este mes'], ['mes-anterior', 'Mes anterior']];

function contar(lista, clave) {
  const m = new Map();
  lista.forEach((x) => { const k = clave(x); m.set(k, (m.get(k) ?? 0) + 1); });
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}

export default function Tablero({ empresas = [], auditoria = false }) {
  const [empresa, setEmpresa] = useState('');
  const [periodo, setPeriodo] = useState('7d');
  const [filas, setFilas] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    setFilas(null);
    consultaVisitas({ ...rangoPeriodo(periodo), empresa_visita_id: empresa || undefined }, 'folio, empresa, persona_visita, motivo, entrada, salida, llegada_at, salida_real_at')
      .order('entrada', { ascending: true }).limit(5000)
      .then(({ data, error: e }) => { if (e) setError('No se pudieron cargar los datos.'); setFilas(data ?? []); });
  }, [periodo, empresa]);

  const d = useMemo(() => {
    if (!filas) return null;
    const { desde, hasta } = rangoPeriodo(periodo);
    const conEstado = filas.map((v) => ({ ...v, est: estadoVisita(v).clave }));
    const llegaron = conEstado.filter((v) => v.llegada_at);
    const ausentes = conEstado.filter((v) => v.est === 'ausente');
    const cerradas = llegaron.length + ausentes.length;
    const duraciones = conEstado.filter((v) => v.salida_real_at).map((v) => (new Date(v.salida_real_at) - new Date(v.llegada_at)) / 36e5);

    // Una barra por día del periodo, aunque no haya visitas
    const dias = [];
    for (let t = new Date(`${desde}T12:00:00-06:00`); diaCDMX(t) <= hasta; t = new Date(t.getTime() + 864e5)) dias.push(diaCDMX(t));
    const porDia = dias.map((dia) => {
      const del = conEstado.filter((v) => diaCDMX(v.entrada) === dia);
      return {
        dia: fmtDia.format(new Date(`${dia}T12:00:00-06:00`)),
        Asistieron: del.filter((v) => v.llegada_at).length,
        'No se presentaron': del.filter((v) => v.est === 'ausente').length,
        Pendientes: del.filter((v) => !v.llegada_at && v.est !== 'ausente').length,
      };
    });
    const horas = Array.from({ length: 13 }, (_, i) => i + 7);
    const porHora = horas.map((h) => ({ hora: `${String(h).padStart(2, '0')}:00`, Llegadas: llegaron.filter((v) => horaCDMX(v.llegada_at) === h).length }));

    return {
      total: filas.length,
      empresas: new Set(filas.map((v) => v.empresa.toLowerCase())).size,
      asistencia: cerradas ? Math.round((llegaron.length / cerradas) * 100) : null,
      enSitio: conEstado.filter((v) => v.est === 'sitio').length,
      duracion: duraciones.length ? (duraciones.reduce((a, b) => a + b, 0) / duraciones.length).toFixed(1) : null,
      porDia,
      porHora,
      porMotivo: contar(filas, (v) => v.motivo).map(([motivo, n]) => ({ motivo, Visitas: n })),
      anfitriones: contar(filas, (v) => v.persona_visita).slice(0, 6).map(([nombre, n]) => ({ nombre, Visitas: n })),
      empresasTop: contar(filas, (v) => v.empresa).slice(0, 6),
    };
  }, [filas, periodo]);

  return (
    <div className="tablero">
      <div className="filtros-rapidos" role="group" aria-label="Periodo del tablero">
        {PERIODOS.map(([id, texto]) => (
          <button key={id} type="button" className="chip-btn" aria-pressed={periodo === id} onClick={() => setPeriodo(id)}>{texto}</button>
        ))}
        <label className="tablero-empresa">
          <span className="sr-only">Empresa a visitar</span>
          <select value={empresa} onChange={(e) => setEmpresa(e.target.value)} aria-label="Empresa a visitar">
            {!auditoria && <option value="">Todas las empresas</option>}
            {empresas.map((e) => <option key={e.id} value={e.id}>{e.nombre}</option>)}
          </select>
        </label>
      </div>
      {error && <p className="status">{error}</p>}
      {!d ? <p className="muted">Cargando tablero…</p> : (
        <>
          <div className="kpis">
            <Kpi valor={d.total} texto="visitas registradas" />
            <Kpi valor={d.asistencia === null ? '—' : `${d.asistencia} %`} texto="asistencia" nota="llegaron de las que ya debían llegar" />
            <Kpi valor={d.enSitio} texto="en sitio ahora" />
            <Kpi valor={d.duracion === null ? '—' : `${d.duracion} h`} texto="duración real promedio" />
            <Kpi valor={d.empresas} texto="empresas distintas" />
          </div>

          <div className="graficas">
            <Grafica titulo="Visitas por día" ancho>
              <BarChart data={d.porDia} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E3E9EF" />
                <XAxis dataKey="dia" tick={{ fontSize: 12 }} interval="preserveStartEnd" />
                <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 13 }} />
                <Bar isAnimationActive={false} dataKey="Asistieron" stackId="a" fill={AZUL} />
                <Bar isAnimationActive={false} dataKey="No se presentaron" stackId="a" fill={NARANJA} />
                <Bar isAnimationActive={false} dataKey="Pendientes" stackId="a" fill={AMARILLO} radius={[4, 4, 0, 0]} />
              </BarChart>
            </Grafica>
            <Grafica titulo="Hora de llegada">
              <BarChart data={d.porHora} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E3E9EF" />
                <XAxis dataKey="hora" tick={{ fontSize: 11 }} interval={1} />
                <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                <Tooltip />
                <Bar isAnimationActive={false} dataKey="Llegadas" fill={AZUL} radius={[4, 4, 0, 0]} />
              </BarChart>
            </Grafica>
            <Dona titulo="Motivo de la visita" datos={d.porMotivo.map((x) => ({ nombre: x.motivo, valor: x.Visitas }))} />
            <Grafica titulo="Anfitriones con más visitas">
              <BarChart data={d.anfitriones} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 0 }}>
                <XAxis type="number" allowDecimals={false} tick={{ fontSize: 12 }} />
                <YAxis type="category" dataKey="nombre" width={170} tick={{ fontSize: 12 }} />
                <Tooltip />
                <Bar isAnimationActive={false} dataKey="Visitas" fill={AZUL} radius={[0, 4, 4, 0]} />
              </BarChart>
            </Grafica>
            <section className="card grafica" aria-labelledby="top-emp">
              <h2 id="top-emp">Empresas con más visitas</h2>
              {d.empresasTop.length ? (
                <ol className="ranking">
                  {d.empresasTop.map(([emp, n]) => (
                    <li key={emp}><span>{emp}</span><span className="ranking-barra"><span style={{ width: `${(n / d.empresasTop[0][1]) * 100}%` }} /></span><strong>{n}</strong></li>
                  ))}
                </ol>
              ) : <p className="vacio">Sin datos en este periodo.</p>}
            </section>
          </div>
        </>
      )}
    </div>
  );
}

function Kpi({ valor, texto, nota }) {
  return (
    <div className="card kpi">
      <span className="kpi-valor">{valor}</span>
      <span className="kpi-texto">{texto}</span>
      {nota && <span className="hint">{nota}</span>}
    </div>
  );
}

function Grafica({ titulo, ancho, children }) {
  return (
    <section className={`card grafica${ancho ? ' grafica-ancha' : ''}`}>
      <h2>{titulo}</h2>
      <div className="grafica-cuerpo"><ResponsiveContainer width="100%" height="100%">{children}</ResponsiveContainer></div>
    </section>
  );
}
