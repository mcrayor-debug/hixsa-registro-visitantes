import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { fmtFechaHora } from '../lib/formato.js';

const ICONO = { pendiente: '⏳', cancelacion: '✕', acceso: '⛔', bloqueado: '⛔', bloqueo: '🛡', reporte: '✉', respaldo: '💾' };
const hace = (iso) => {
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return 'ahora'; if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60); if (h < 24) return `hace ${h} h`;
  return fmtFechaHora.format(new Date(iso));
};

/** Campana de notificaciones: se actualiza cada minuto; "Marcar como leídas" guarda la fecha en el perfil. */
export default function Campana({ perfil, onLeidas }) {
  const [lista, setLista] = useState([]);
  const [abierta, setAbierta] = useState(false);
  const cargar = useCallback(async () => {
    const { data } = await supabase.from('notificaciones').select('id, created_at, tipo, titulo, detalle, folio').order('created_at', { ascending: false }).limit(30);
    setLista(data ?? []);
  }, []);
  useEffect(() => { cargar(); const t = setInterval(cargar, 60000); return () => clearInterval(t); }, [cargar]);
  const leidas = perfil.notificaciones_leidas_at ? new Date(perfil.notificaciones_leidas_at).getTime() : 0;
  const nuevas = lista.filter((n) => new Date(n.created_at).getTime() > leidas).length;
  async function marcar() {
    const ahora = new Date().toISOString();
    const { error } = await supabase.from('perfiles').update({ notificaciones_leidas_at: ahora }).eq('id', perfil.id);
    if (!error) onLeidas(ahora);
  }
  return (
    <div className="campana">
      <button type="button" className="campana-boton" aria-label={`Notificaciones${nuevas ? `: ${nuevas} nuevas` : ''}`} aria-expanded={abierta}
        onClick={() => { setAbierta(!abierta); if (!abierta) cargar(); }}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" /></svg>
        {nuevas > 0 && <span className="campana-contador">{nuevas > 9 ? '9+' : nuevas}</span>}
      </button>
      {abierta && (
        <div className="campana-panel" role="dialog" aria-label="Notificaciones">
          <div className="campana-cabecera">
            <strong>Notificaciones</strong>
            {nuevas > 0 && <button type="button" className="link-btn" onClick={marcar}>Marcar como leídas</button>}
          </div>
          <ul>
            {!lista.length && <li className="vacio">Sin notificaciones.</li>}
            {lista.map((n) => (
              <li key={n.id} className={new Date(n.created_at).getTime() > leidas ? 'nueva' : ''}>
                <span className="campana-icono" aria-hidden="true">{ICONO[n.tipo] ?? '•'}</span>
                <span><span className={n.tipo === 'acceso' || n.tipo === 'bloqueado' ? 'texto-peligro' : ''}>{n.titulo}</span>
                  {n.detalle && <><br /><span className="muted small">{n.detalle}</span></>}
                  <br /><span className="muted small">{hace(n.created_at)}{n.folio ? ` · ${n.folio}` : ''}</span></span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
