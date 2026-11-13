import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';

// Paleta HIXSA para partes de un todo; más de 5 partes se agrupan en "Otros"
const COLORES = ['#0047BA', '#00A9E0', '#F38A00', '#FFCD00', '#5BB3D6', '#9AA7B8'];

export default function Dona({ titulo, datos, alto = 220 }) {
  const orden = [...datos].filter((d) => d.valor > 0).sort((a, b) => b.valor - a.valor);
  const partes = orden.length > 5 ? [...orden.slice(0, 4), { nombre: 'Otros', valor: orden.slice(4).reduce((s, d) => s + d.valor, 0) }] : orden;
  const total = partes.reduce((s, d) => s + d.valor, 0);
  return (
    <section className="card grafica dona">
      <h2>{titulo}</h2>
      {!total ? <p className="vacio">Sin datos en el periodo.</p> : (
        <div className="dona-cuerpo">
          <div className="dona-grafica" style={{ height: alto }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={partes} dataKey="valor" nameKey="nombre" innerRadius="58%" outerRadius="92%" paddingAngle={1} isAnimationActive={false} stroke="#FFFFFF" strokeWidth={2}>
                  {partes.map((p, i) => <Cell key={p.nombre} fill={COLORES[i % COLORES.length]} />)}
                </Pie>
                <Tooltip formatter={(v, n) => [`${v} (${Math.round((v / total) * 100)} %)`, n]} />
              </PieChart>
            </ResponsiveContainer>
            <div className="dona-total" aria-hidden="true"><strong>{total}</strong><span>total</span></div>
          </div>
          <ul className="dona-leyenda">
            {partes.map((p, i) => (
              <li key={p.nombre}><span className="dona-color" style={{ background: COLORES[i % COLORES.length] }} />
                <span>{p.nombre}</span><strong>{p.valor}</strong><span className="muted small">{Math.round((p.valor / total) * 100)} %</span></li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
