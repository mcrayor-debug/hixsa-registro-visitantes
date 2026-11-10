import { useCallback, useEffect, useState } from 'react';
import { consultaVisitas, invocar } from '../lib/supabase.js';
import { descargarCsv, EMAIL_RE, estadoVisita, fmtFechaHora, listaCorreos, MOTIVOS, rangoPeriodo } from '../lib/formato.js';
import { ALCANCES, alcanceDe, puedeExportar } from '../lib/permisos.js';
import FichaVisita from './FichaVisita.jsx';
import { Dialogo, Estado, Mensaje, useToast } from './ui.jsx';

const LIMITE = 1000;
const RANGOS = [['hoy', 'Hoy'], ['semana', 'Próximos 7 días'], ['mes', 'Este mes'], ['mes-anterior', 'Mes anterior']];

export default function Consultas({ config, perfil, empresas = [] }) {
  const [rango, setRango] = useState('hoy');
  const [f, setF] = useState(() => ({ ...rangoPeriodo('hoy'), empresa: '', motivo: '', texto: '', empresa_visita_id: '' }));
  const exporta = puedeExportar(perfil);
  const alcance = alcanceDe(perfil);
  const [filas, setFilas] = useState(null);
  const [total, setTotal] = useState(0);
  const [aplicados, setAplicados] = useState(f);
  const [ficha, setFicha] = useState(null);
  const [reporte, setReporte] = useState(false);

  const buscar = useCallback(async (filtros) => {
    setFilas(null);
    setAplicados(filtros);
    const { data, count } = await consultaVisitas(filtros).order('entrada', { ascending: true }).limit(LIMITE);
    setFilas(data ?? []);
    setTotal(count ?? 0);
  }, []);
  useEffect(() => { buscar(f); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const cambiar = (k) => (e) => { setF({ ...f, [k]: e.target.value }); if (k === 'desde' || k === 'hasta') setRango(''); };
  function elegirRango(r) {
    const nuevo = { ...f, ...rangoPeriodo(r) };
    setRango(r); setF(nuevo); buscar(nuevo);
  }

  const n = filas?.length ?? 0;
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
          <div className="field"><label htmlFor="f-empresa">Empresa de origen</label><input id="f-empresa" type="text" maxLength={80} value={f.empresa} onChange={cambiar('empresa')} /></div>
          <div className="field"><label htmlFor="f-motivo">Motivo</label>
            <select id="f-motivo" value={f.motivo} onChange={cambiar('motivo')}><option value="">Todos</option>{MOTIVOS.map((m) => <option key={m}>{m}</option>)}</select></div>
          <div className="field field-wide"><label htmlFor="f-texto">Buscar</label>
            <input id="f-texto" type="search" maxLength={80} placeholder="Nombre, correo, folio o persona visitada" value={f.texto} onChange={cambiar('texto')} /></div>
          <button className="btn btn-compact" type="submit">Buscar</button>
        </div>
      </form>

      <div className="resultados-head">
        <p className="resultados-total" aria-live="polite">
          {filas === null ? 'Buscando…' : n === 0 ? 'Sin resultados' : total > n ? `Mostrando ${n} de ${total} visitas` : `${n} ${n === 1 ? 'visita' : 'visitas'}`}
        </p>
        <div className="acciones">
          {exporta && <>
            <button className="btn btn-secondary btn-compact" type="button" disabled={!n}
              onClick={() => descargarCsv(filas, `visitas_${aplicados.desde ?? ''}_${aplicados.hasta ?? ''}.csv`)}>Descargar CSV</button>
            <button className="btn btn-compact" type="button" disabled={!n} onClick={() => setReporte(true)}>Enviar por correo</button>
          </>}
        </div>
      </div>

      <div className="table-wrap card">
        <table className="tabla">
          <thead><tr><th>Folio</th><th>Visitante</th><th>Visita a</th><th>Motivo</th><th>Entrada</th><th>Llegada</th><th>Salida</th><th>Estado</th><th>Pase</th></tr></thead>
          <tbody>
            {(filas ?? []).map((v) => (
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
                <td>{v.qr_enviado_at ? <span className="pill ok">Enviado</span>
                  : v.correo_error ? <span className="pill error" title={v.correo_error}>Error de envío</span>
                    : <span className="pill">Pendiente</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {filas && !n && <p className="vacio">No hay visitas con estos filtros. Prueba con otro periodo.</p>}
      </div>
      <p className="hint">Haz clic en una visita para ver su ficha, su identificación y registrar llegada o salida.
        {alcance !== 'sin_limite' && <> Tu rol consulta: <strong>{ALCANCES[alcance]}</strong>.</>}</p>

      <Dialogo abierto={Boolean(ficha)} onCerrar={() => setFicha(null)} titulo="Ficha de la visita" ancho={620}>
        {ficha && <FichaVisita folio={ficha} onCambio={() => buscar(aplicados)} />}
      </Dialogo>
      <EnviarReporte abierto={reporte} onCerrar={() => setReporte(false)} filtros={aplicados} n={n}
        destinatarios={config?.destinatarios_reporte ?? []} />
    </>
  );
}

function EnviarReporte({ abierto, onCerrar, filtros, n, destinatarios }) {
  const [texto, setTexto] = useState('');
  const [error, setError] = useState('');
  const [enviando, setEnviando] = useState(false);
  const toast = useToast();
  useEffect(() => { if (abierto) { setTexto(destinatarios.join('\n')); setError(''); } }, [abierto, destinatarios]);

  async function enviar(e) {
    e.preventDefault();
    const lista = listaCorreos(texto);
    const malos = lista.filter((d) => !EMAIL_RE.test(d));
    if (!lista.length) return setError('Agrega al menos un correo.');
    if (malos.length) return setError(`Revisa estos correos: ${malos.join(', ')}`);
    if (lista.length > 10) return setError('Máximo 10 destinatarios.');
    setEnviando(true);
    try {
      const r = await invocar('enviar-reporte', { filtros, destinatarios: lista });
      onCerrar();
      toast(`Reporte enviado a ${r.destinatarios.length} ${r.destinatarios.length === 1 ? 'destinatario' : 'destinatarios'} (${r.total} visitas).`);
    } catch (err) {
      setError(err.message);
    } finally {
      setEnviando(false);
    }
  }
  return (
    <Dialogo abierto={abierto} onCerrar={onCerrar} titulo="Enviar reporte por correo">
      <form onSubmit={enviar} noValidate>
        <p className="muted">{n} visitas del {filtros.desde || 'inicio'} al {filtros.hasta || 'hoy'}. Se adjunta un CSV con el detalle.</p>
        <div className="field"><label htmlFor="r-dest">Destinatarios</label>
          <textarea id="r-dest" rows={3} placeholder="Un correo por línea" value={texto} onChange={(e) => setTexto(e.target.value)} /></div>
        <Mensaje>{error}</Mensaje>
        <div className="dialog-actions"><button className="btn btn-compact" type="submit" disabled={enviando}>{enviando ? 'Enviando…' : 'Enviar reporte'}</button></div>
      </form>
    </Dialogo>
  );
}
