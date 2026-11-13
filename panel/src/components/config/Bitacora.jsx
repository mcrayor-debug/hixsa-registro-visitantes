import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase.js';
import { fmtFechaHora, fmtHora } from '../../lib/formato.js';

const TABLAS = { roles: 'Rol', empresas: 'Empresa', anfitriones: 'Anfitrión', anfitrion_empresas: 'Empresa de anfitrión', configuracion: 'Configuración', perfiles: 'Usuario', personas: 'Visitante', visitantes: 'Visitas' };
const ACCIONES = { alta: 'Alta', edicion: 'Edición', baja: 'Baja' };
const ORIGEN = { panel: 'Envío manual', automatico: 'Reporte automático', programado: 'Reporte automático', 'claude-code': 'Claude Code' };
const POR_PAGINA = 25;
const ymd = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(d);
const fmtDiaLargo = new Intl.DateTimeFormat('es-MX', { timeZone: 'America/Mexico_City', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

const etiqueta = (b) => { const f = b.despues ?? b.antes ?? {}; return f.nombre ?? f.email ?? f.correo ?? (b.tabla === 'configuracion' ? 'General' : b.registro_id ?? ''); };
const cambios = (b) => {
  if (b.accion !== 'edicion' || !b.antes || !b.despues) return '';
  const ignorar = new Set(['updated_at', 'updated_by', 'created_at']);
  return Object.keys(b.despues).filter((k) => !ignorar.has(k) && JSON.stringify(b.antes[k]) !== JSON.stringify(b.despues[k])).join(', ');
};

export default function Bitacora() {
  const [f, setF] = useState(() => ({ desde: ymd(new Date(Date.now() - 30 * 864e5)), hasta: ymd(new Date()), tabla: '' }));
  const [pagina, setPagina] = useState(0);
  const [filas, setFilas] = useState(null);
  const [total, setTotal] = useState(0);
  const [reportes, setReportes] = useState([]);

  const cargar = useCallback(async () => {
    setFilas(null);
    let q = supabase.from('bitacora_cambios').select('*', { count: 'exact' })
      .gte('created_at', `${f.desde}T00:00:00-06:00`).lte('created_at', `${f.hasta}T23:59:59.999-06:00`)
      .order('created_at', { ascending: false }).range(pagina * POR_PAGINA, pagina * POR_PAGINA + POR_PAGINA - 1);
    if (f.tabla) q = q.eq('tabla', f.tabla);
    const { data, count } = await q;
    setFilas(data ?? []); setTotal(count ?? 0);
  }, [f, pagina]);
  useEffect(() => { cargar(); }, [cargar]);
  useEffect(() => {
    supabase.from('bitacora_reportes').select('created_at, origen, destinatarios, total_registros').order('created_at', { ascending: false }).limit(20).then(({ data }) => setReportes(data ?? []));
  }, []);
  const cambiar = (k) => (e) => { setF({ ...f, [k]: e.target.value }); setPagina(0); };

  // Agrupadas por día
  const grupos = [];
  for (const b of filas ?? []) {
    const dia = ymd(new Date(b.created_at));
    if (!grupos.length || grupos.at(-1).dia !== dia) grupos.push({ dia, fecha: new Date(b.created_at), filas: [] });
    grupos.at(-1).filas.push(b);
  }
  const paginas = Math.max(1, Math.ceil(total / POR_PAGINA));

  return (
    <div className="config-grid">
      <section className="card" aria-labelledby="cambios-titulo">
        <h2 id="cambios-titulo">Cambios en la configuración</h2>
        <div className="filtros-grid filtros-bitacora">
          <div className="field"><label htmlFor="bt-desde">Desde</label><input id="bt-desde" type="date" value={f.desde} onChange={cambiar('desde')} /></div>
          <div className="field"><label htmlFor="bt-hasta">Hasta</label><input id="bt-hasta" type="date" value={f.hasta} onChange={cambiar('hasta')} /></div>
          <div className="field"><label htmlFor="bt-tabla">Apartado</label>
            <select id="bt-tabla" value={f.tabla} onChange={cambiar('tabla')}><option value="">Todos</option>{Object.entries(TABLAS).map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select></div>
        </div>
        {filas === null ? <p className="muted">Cargando…</p> : !filas.length ? <p className="vacio">Sin cambios en estas fechas.</p> : grupos.map((g) => (
          <div key={g.dia} className="bitacora-dia">
            <h3>{fmtDiaLargo.format(g.fecha).replace(/^./, (c) => c.toUpperCase())}</h3>
            <ul>{g.filas.map((b) => (
              <li key={b.id}><span className="bit-hora">{fmtHora.format(new Date(b.created_at))}</span>
                <span><strong>{ACCIONES[b.accion]}</strong> de {TABLAS[b.tabla] ?? b.tabla}: {etiqueta(b)}
                  <span className="muted small"> · {b.usuario_email ?? 'Sistema'}{cambios(b) ? ` · cambió: ${cambios(b)}` : ''}</span></span></li>
            ))}</ul>
          </div>
        ))}
        <div className="paginacion">
          <span className="muted small">{total ? `${pagina * POR_PAGINA + 1}–${Math.min(total, (pagina + 1) * POR_PAGINA)} de ${total}` : ''}</span>
          <span>
            <button type="button" className="btn btn-secondary btn-compact" disabled={pagina === 0} onClick={() => setPagina(pagina - 1)}>Anterior</button>
            <span className="small">Página {pagina + 1} de {paginas}</span>
            <button type="button" className="btn btn-secondary btn-compact" disabled={pagina + 1 >= paginas} onClick={() => setPagina(pagina + 1)}>Siguiente</button>
          </span>
        </div>
      </section>
      <section className="card" aria-labelledby="bit-titulo">
        <h2 id="bit-titulo">Reportes enviados</h2>
        <ol className="bitacora">
          {!reportes.length && <li className="muted">Aún no se ha enviado ningún reporte.</li>}
          {reportes.map((b, i) => (
            <li key={i}><span className="bit-fecha">{fmtFechaHora.format(new Date(b.created_at))}</span>
              <span>{ORIGEN[b.origen] ?? b.origen}: {b.total_registros} visitas a {b.destinatarios.join(', ')}</span></li>
          ))}
        </ol>
      </section>
    </div>
  );
}
