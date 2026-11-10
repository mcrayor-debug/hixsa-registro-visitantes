import { useCallback, useEffect, useState } from 'react';
import { supabase, consultaVisitas } from '../../lib/supabase.js';
import { fmtFechaHora, fmtHora, rangoPeriodo } from '../../lib/formato.js';
import { puedeExportar } from '../../lib/permisos.js';
import { activoAhora } from '../../../../supabase/functions/_shared/estadisticas.js';
import { useToast } from '../ui.jsx';

const MOTIVOS = {
  anticipado: 'Llegó antes de su horario', tarde: 'Llegó fuera de su horario', fecha_no_asignada: 'Fecha no asignada',
  caducado: 'Pase vencido o caducado', bloqueado: 'Visitante bloqueado', restringido: 'Visitante restringido',
  pendiente_aprobacion: 'Pendiente de aprobación', rechazada_anfitrion: 'Rechazada por el anfitrión', no_coincide: 'El pase no coincide',
};
const FUERA_HORARIO = ['anticipado', 'tarde'], EXPIRADOS = ['caducado', 'fecha_no_asignada'];

export default function ConsultaSeguridad({ perfil }) {
  const [periodo, setPeriodo] = useState(() => rangoPeriodo('7d'));
  const [intentos, setIntentos] = useState(null);
  const [activos, setActivos] = useState([]);
  const exporta = puedeExportar(perfil);
  const toast = useToast();

  const cargar = useCallback(async () => {
    setIntentos(null);
    const [{ data: it }, { data: hoy }] = await Promise.all([
      supabase.from('intentos_acceso').select('created_at, folio, resultado, motivo, detalle, usuario_email, autorizacion_motivo, visitantes(nombre_completo, empresa)')
        .gte('created_at', `${periodo.desde}T00:00:00-06:00`).lte('created_at', `${periodo.hasta}T23:59:59.999-06:00`).order('created_at', { ascending: false }).limit(2000),
      consultaVisitas({ ...rangoPeriodo('7d') }, 'folio, nombre_completo, empresa, persona_visita, entrada, salida, llegada_at, salida_real_at, origen')
        .not('llegada_at', 'is', null).is('salida_real_at', null).limit(500),
    ]);
    setIntentos(it ?? []);
    setActivos((hoy ?? []).filter((v) => activoAhora(v)));
  }, [periodo]);
  useEffect(() => { cargar(); }, [cargar]);

  const fuera = (intentos ?? []).filter((x) => FUERA_HORARIO.includes(x.motivo));
  const expirados = (intentos ?? []).filter((x) => EXPIRADOS.includes(x.motivo));
  const filaIntento = (x) => [fmtFechaHora.format(new Date(x.created_at)), x.folio ?? '', x.visitantes?.nombre_completo ?? '', MOTIVOS[x.motivo] ?? x.motivo,
    x.resultado === 'autorizado' ? 'Autorizado' : 'Rechazado', x.usuario_email ?? 'Sistema', x.autorizacion_motivo ?? ''];
  const columnas = ['Fecha', 'Folio', 'Visitante', 'Motivo', 'Resultado', 'Usuario', 'Motivo de autorización'];

  function csvLog() {
    const celda = (s) => `"${(/^[=+\-@]/.test(String(s)) ? `'${s}` : String(s)).replace(/"/g, '""')}"`;
    const csv = '\uFEFF' + [columnas.map(celda).join(','), ...(intentos ?? []).map((x) => filaIntento(x).map(celda).join(','))].join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: `log_auditoria_${periodo.desde}_${periodo.hasta}.csv` });
    document.body.append(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  }
  async function pdfLog() {
    try {
      const { crearPdf } = await import('../../lib/pdf.js');
      const doc = await crearPdf({ titulo: 'Log de auditoría de accesos', subtitulo: `Periodo: ${periodo.desde} a ${periodo.hasta}. Generado por ${perfil.nombre}.`,
        kpis: [['intentos', intentos.length], ['fuera de horario', fuera.length], ['QR vencidos', expirados.length], ['activos ahora', activos.length]],
        secciones: [{ titulo: 'Intentos de acceso', columnas, filas: intentos.map(filaIntento) }] });
      doc.descargar(`log_auditoria_${periodo.desde}_${periodo.hasta}.pdf`);
    } catch { toast('No se pudo generar el PDF.'); }
  }

  const Tabla = ({ lista, vacio }) => (
    <div className="table-wrap"><table className="tabla">
      <thead><tr><th>Fecha</th><th>Folio</th><th>Visitante</th><th>Motivo</th><th>Resultado</th><th>Usuario</th></tr></thead>
      <tbody>{lista.slice(0, 100).map((x, i) => (
        <tr key={i}><td className="nowrap">{fmtFechaHora.format(new Date(x.created_at))}</td><td className="mono">{x.folio}</td>
          <td>{x.visitantes?.nombre_completo}<br /><span className="muted small">{x.visitantes?.empresa}</span></td>
          <td>{MOTIVOS[x.motivo] ?? x.motivo}<br /><span className="muted small">{x.detalle}</span></td>
          <td><span className={`pill ${x.resultado === 'autorizado' ? 'ok' : 'error'}`}>{x.resultado === 'autorizado' ? 'Autorizado' : 'Rechazado'}</span>
            {x.autorizacion_motivo && <><br /><span className="muted small">{x.autorizacion_motivo}</span></>}</td>
          <td className="small">{x.usuario_email ?? 'Sistema'}</td></tr>))}</tbody>
    </table>{!lista.length && <p className="vacio">{vacio}</p>}</div>
  );

  return (
    <div className="seguridad">
      <div className="card filtros seguridad-filtros">
        <div className="filtros-rapidos" role="group" aria-label="Periodo">
          {[['hoy', 'Hoy'], ['7d', 'Últimos 7 días'], ['30d', 'Últimos 30 días'], ['mes', 'Este mes']].map(([id, t]) => (
            <button key={id} type="button" className="chip-btn" aria-pressed={JSON.stringify(rangoPeriodo(id)) === JSON.stringify(periodo)} onClick={() => setPeriodo(rangoPeriodo(id))}>{t}</button>))}
        </div>
        {exporta && <div className="acciones">
          <button className="btn btn-secondary btn-compact" type="button" disabled={!intentos?.length} onClick={csvLog}>Exportar log (CSV)</button>
          <button className="btn btn-compact" type="button" disabled={!intentos?.length} onClick={pdfLog}>Exportar log (PDF)</button>
        </div>}
      </div>
      <div className="kpis kpis-4">
        <div className="card kpi"><span className="kpi-valor">{activos.length}</span><span className="kpi-texto">visitantes activos ahora</span></div>
        <div className="card kpi"><span className="kpi-valor">{fuera.length}</span><span className="kpi-texto">QR usados fuera de horario</span></div>
        <div className="card kpi"><span className="kpi-valor">{expirados.length}</span><span className="kpi-texto">intentos con QR vencido</span></div>
        <div className="card kpi"><span className="kpi-valor">{intentos?.length ?? '…'}</span><span className="kpi-texto">intentos registrados</span></div>
      </div>
      <section className="card"><h2>Visitantes activos en este momento</h2>
        <ul className="hoy-lista">{activos.map((v) => (
          <li key={v.folio} className="hoy-item"><span className="hoy-hora">{fmtHora.format(new Date(v.llegada_at))}</span>
            <span className="hoy-datos"><strong>{v.nombre_completo}</strong><span className="muted small">{v.empresa}, visita a {v.persona_visita}</span></span>
            <span className="mono small">{v.folio}</span></li>))}</ul>
        {!activos.length && <p className="vacio">No hay visitantes dentro de las oficinas.</p>}</section>
      <section className="card"><h2>QR usados fuera de horario</h2><Tabla lista={fuera} vacio="Sin intentos fuera de horario en el periodo." /></section>
      <section className="card"><h2>Intentos de acceso con QR vencido o de otra fecha</h2><Tabla lista={expirados} vacio="Sin intentos con QR vencido en el periodo." /></section>
    </div>
  );
}
