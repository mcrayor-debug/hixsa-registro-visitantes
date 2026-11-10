import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase.js';
import { fmtFechaHora } from '../../lib/formato.js';

const TABLAS = { roles: 'Rol', empresas: 'Empresa', anfitriones: 'Anfitrión', anfitrion_empresas: 'Empresa de anfitrión', configuracion: 'Configuración', perfiles: 'Usuario' };
const ACCIONES = { alta: 'Alta', edicion: 'Edición', baja: 'Baja' };
const ORIGEN = { panel: 'Panel', automatico: 'Reporte automático', 'claude-code': 'Claude Code' };

/** Nombre legible del registro afectado. */
const etiqueta = (b) => {
  const f = b.despues ?? b.antes ?? {};
  return f.nombre ?? f.email ?? (b.tabla === 'configuracion' ? 'General' : b.registro_id ?? '');
};
/** Campos que cambiaron en una edición. */
const cambios = (b) => {
  if (b.accion !== 'edicion' || !b.antes || !b.despues) return '';
  const ignorar = new Set(['updated_at', 'updated_by', 'created_at']);
  return Object.keys(b.despues).filter((k) => !ignorar.has(k) && JSON.stringify(b.antes[k]) !== JSON.stringify(b.despues[k])).join(', ');
};

export default function Bitacora() {
  const [cambiosLista, setCambios] = useState([]);
  const [reportes, setReportes] = useState([]);
  useEffect(() => {
    supabase.from('bitacora_cambios').select('*').order('created_at', { ascending: false }).limit(60).then(({ data }) => setCambios(data ?? []));
    supabase.from('bitacora_reportes').select('created_at, origen, destinatarios, total_registros').order('created_at', { ascending: false }).limit(20).then(({ data }) => setReportes(data ?? []));
  }, []);
  return (
    <div className="config-grid">
      <section className="card" aria-labelledby="cambios-titulo">
        <h2 id="cambios-titulo">Cambios en la configuración</h2>
        <p className="muted">Quién cambió qué y cuándo (últimos 60).</p>
        <div className="table-wrap">
          <table className="tabla">
            <thead><tr><th>Fecha</th><th>Usuario</th><th>Qué</th><th>Detalle</th></tr></thead>
            <tbody>
              {cambiosLista.map((b) => (
                <tr key={b.id}>
                  <td className="nowrap">{fmtFechaHora.format(new Date(b.created_at))}</td>
                  <td className="small">{b.usuario_email ?? 'Sistema'}</td>
                  <td><strong>{ACCIONES[b.accion]}</strong> de {TABLAS[b.tabla] ?? b.tabla}: {etiqueta(b)}</td>
                  <td className="small muted">{cambios(b)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!cambiosLista.length && <p className="vacio">Aún no hay cambios registrados.</p>}
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
