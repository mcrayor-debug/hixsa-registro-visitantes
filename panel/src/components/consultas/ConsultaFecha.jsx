import { useCallback, useEffect, useMemo, useState } from 'react';
import { consultaVisitas } from '../../lib/supabase.js';
import { descargarCsv, estadoVisita, fmtFechaHora, MOTIVOS, rangoPeriodo } from '../../lib/formato.js';
import { puedeExportar } from '../../lib/permisos.js';
import { resumen, sinSalida } from '../../../../supabase/functions/_shared/estadisticas.js';
import FichaVisita from '../FichaVisita.jsx';
import EnviarReporte from '../EnviarReporte.jsx';
import { Dialogo, Estado, useToast } from '../ui.jsx';

const LIMITE = 2000;
const RANGOS = [['hoy', 'Hoy'], ['semana', 'Próximos 7 días'], ['7d', 'Últimos 7 días'], ['mes', 'Este mes'], ['mes-anterior', 'Mes anterior']];
const VISTAS = [['todas', 'Todas'], ['estuvieron', 'Quién estuvo'], ['sin_salida', 'Sin salida registrada']];

export default function ConsultaFecha({ config, perfil, empresas = [] }) {
  const [rango, setRango] = useState('hoy');
  const [f, setF] = useState(() => ({ ...rangoPeriodo('hoy'), empresa: '', motivo: '', texto: '', empresa_visita_id: '' }));
  const [vista, setVista] = useState('todas');
  const [filas, setFilas] = useState(null);
  const [total, setTotal] = useState(0);
  const [aplicados, setAplicados] = useState(f);
  const [ficha, setFicha] = useState(null);
  const [reporte, setReporte] = useState(false);
  const exporta = puedeExportar(perfil);
  const toast = useToast();

  const buscar = useCallback(async (filtros) => {
    setFilas(null);
    setAplicados(filtros);
    const { data, count } = await consultaVisitas(filtros).order('entrada', { ascending: true }).limit(LIMITE);
    setFilas(data ?? []);
    setTotal(count ?? 0);
  }, []);
  useEffect(() => { buscar(f); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const cambiar = (k) => (e) => { setF({ ...f, [k]: e.target.value }); if (k === 'desde' || k === 'hasta') setRango(''); };
  const elegirRango = (r) => { const nuevo = { ...f, ...rangoPeriodo(r) }; setRango(r); setF(nuevo); buscar(nuevo); };

  const visibles = useMemo(() => (filas ?? []).filter((v) =>
    vista === 'estuvieron' ? Boolean(v.llegada_at) : vista === 'sin_salida' ? sinSalida(v) : true), [filas, vista]);
  const r = useMemo(() => resumen(visibles, { tolerancia: config?.tolerancia_min ?? 15 }), [visibles, config]);
  const nombre = `visitas_${aplicados.desde ?? ''}_${aplicados.hasta ?? ''}`;
  const titulo = vista === 'estuvieron' ? 'Quién estuvo' : vista === 'sin_salida' ? 'Visitas sin salida registrada' : 'Consulta de visitas';

  async function pdf() {
    const { crearPdf } = await import('../../lib/pdf.js');
    const doc = await crearPdf({
      titulo, subtitulo: `Periodo: ${aplicados.desde} a ${aplicados.hasta}. Generado por ${perfil.nombre}.`,
      kpis: [['visitas', r.total], ['únicos', r.unicos], ['llegaron', r.llegaron], ['duración promedio', r.duracionPromedio === null ? '—' : `${r.duracionPromedio} h`]],
      secciones: [{ titulo: 'Detalle', columnas: ['Folio', 'Visitante', 'Empresa', 'Visita a', 'Entrada', 'Llegada', 'Salida', 'Estado'],
        filas: visibles.map((v) => [v.folio, v.nombre_completo, v.empresa, v.persona_visita, fmtFechaHora.format(new Date(v.entrada)),
          v.llegada_at ? fmtFechaHora.format(new Date(v.llegada_at)) : '—', v.salida_real_at ? fmtFechaHora.format(new Date(v.salida_real_at)) : '—', estadoVisita(v).texto]) }],
    });
    return { doc, nombre: `${nombre}.pdf`, base64: doc.base64() };
  }
  async function descargarPdf() {
    try { const p = await pdf(); p.doc.descargar(p.nombre); } catch { toast('No se pudo generar el PDF.'); }
  }

  const n = visibles.length;
  return (
    <>
      <form className="card filtros" onSubmit={(e) => { e.preventDefault(); buscar(f); }} noValidate>
        <div className="filtros-rapidos" role="group" aria-label="Periodo rápido">
          {RANGOS.map(([id, t]) => <button key={id} type="button" className="chip-btn" aria-pressed={rango === id} onClick={() => elegirRango(id)}>{t}</button>)}
        </div>
        <div className="filtros-grid">
          <div className="field"><label htmlFor="f-desde">Desde</label><input id="f-desde" type="date" value={f.desde} onChange={cambiar('desde')} /></div>
          <div className="field"><label htmlFor="f-hasta">Hasta</label><input id="f-hasta" type="date" value={f.hasta} onChange={cambiar('hasta')} /></div>
          <div className="field"><label htmlFor="f-empresa-visita">Empresa a visitar</label>
            <select id="f-empresa-visita" value={f.empresa_visita_id} onChange={cambiar('empresa_visita_id')}>
              {!config?.modo_auditoria && <option value="">Todas</option>}
              {empresas.map((e) => <option key={e.id} value={e.id}>{e.nombre}</option>)}
            </select></div>
          <div className="field"><label htmlFor="f-motivo">Motivo</label>
            <select id="f-motivo" value={f.motivo} onChange={cambiar('motivo')}><option value="">Todos</option>{MOTIVOS.map((m) => <option key={m}>{m}</option>)}</select></div>
          <div className="field"><label htmlFor="f-empresa">Empresa de origen</label><input id="f-empresa" type="text" maxLength={80} value={f.empresa} onChange={cambiar('empresa')} /></div>
          <div className="field field-medio"><label htmlFor="f-texto">Buscar</label>
            <input id="f-texto" type="search" maxLength={80} placeholder="Nombre, correo, folio o persona visitada" value={f.texto} onChange={cambiar('texto')} /></div>
          <button className="btn btn-compact" type="submit">Buscar</button>
        </div>
      </form>

      <div className="resultados-head">
        <div className="filtros-rapidos" role="group" aria-label="Vista">
          {VISTAS.map(([id, t]) => <button key={id} type="button" className="chip-btn" aria-pressed={vista === id} onClick={() => setVista(id)}>{t}</button>)}
        </div>
        {exporta && (
          <div className="acciones">
            <button className="btn btn-secondary btn-compact" type="button" disabled={!n} onClick={() => descargarCsv(visibles, `${nombre}.csv`)}>CSV</button>
            <button className="btn btn-secondary btn-compact" type="button" disabled={!n} onClick={descargarPdf}>PDF</button>
            <button className="btn btn-compact" type="button" disabled={!n} onClick={() => setReporte(true)}>Enviar por correo</button>
          </div>
        )}
      </div>
      <p className="resultados-total" aria-live="polite">
        {filas === null ? 'Buscando…' : n === 0 ? 'Sin resultados'
          : `${n} ${n === 1 ? 'visita' : 'visitas'}${total > (filas?.length ?? 0) ? ` (de ${total}; ajusta los filtros)` : ''} · ${r.unicos} visitantes · duración promedio ${r.duracionPromedio ?? '—'} h`}
      </p>

      <div className="table-wrap card">
        <table className="tabla">
          <thead><tr><th>Folio</th><th>Visitante</th><th>Visita a</th><th>Motivo</th><th>Entrada</th><th>Llegada</th><th>Salida</th><th>Estado</th><th>Pase</th></tr></thead>
          <tbody>
            {visibles.map((v) => (
              <tr key={v.folio} className="fila-click" tabIndex={0} onClick={() => setFicha(v.folio)}
                onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), setFicha(v.folio))}>
                <td className="mono">{v.folio}</td>
                <td><strong>{v.nombre_completo}</strong><br /><span className="muted small">{v.empresa}</span></td>
                <td>{v.persona_visita}<br /><span className="muted small">{v.empresas?.nombre}</span></td>
                <td>{v.motivo}</td>
                <td className="nowrap">{fmtFechaHora.format(new Date(v.entrada))}</td>
                <td className="nowrap">{v.llegada_at ? fmtFechaHora.format(new Date(v.llegada_at)) : '—'}</td>
                <td className="nowrap">{v.salida_real_at ? fmtFechaHora.format(new Date(v.salida_real_at)) : '—'}</td>
                <td><Estado {...estadoVisita(v)} /></td>
                <td>{v.origen && v.origen !== 'formulario' ? <span className="pill">Importada</span>
                  : v.qr_enviado_at ? <span className="pill ok">Enviado</span>
                    : v.correo_error ? <span className="pill error" title={v.correo_error}>Error de envío</span> : <span className="pill">Pendiente</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {filas && !n && <p className="vacio">No hay visitas con estos filtros. Prueba con otro periodo.</p>}
      </div>
      <p className="hint">Haz clic en una visita para ver su ficha, reenviar su QR o registrar llegada y salida.</p>

      <Dialogo abierto={Boolean(ficha)} onCerrar={() => setFicha(null)} titulo="Ficha de la visita" ancho={640}>
        {ficha && <FichaVisita folio={ficha} onCambio={() => buscar(aplicados)} />}
      </Dialogo>
      <EnviarReporte abierto={reporte} onCerrar={() => setReporte(false)} filtros={aplicados} n={n} titulo={titulo}
        destinatarios={config?.destinatarios_reporte ?? []} crearPdf={pdf} />
    </>
  );
}
