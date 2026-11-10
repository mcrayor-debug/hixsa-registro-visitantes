import { useEffect, useState } from 'react';
import { supabase, invocar, CAMPOS_VISITA } from '../../lib/supabase.js';
import { estadoVisita, fmtFechaHora } from '../../lib/formato.js';
import FichaVisita from '../FichaVisita.jsx';
import { Dialogo, Estado, useToast } from '../ui.jsx';

const ESTADOS_BLOQUEO = { no_deseado: ['No deseado', 'aviso'], restringido: ['Restringido', 'restringido'], bloqueado: ['Bloqueado', 'error'] };

export default function ConsultaVisitante() {
  const [texto, setTexto] = useState('');
  const [personas, setPersonas] = useState([]);
  const [sel, setSel] = useState(null);
  const [visitas, setVisitas] = useState([]);
  const [ficha, setFicha] = useState(null);
  const [enviando, setEnviando] = useState('');
  const toast = useToast();

  useEffect(() => {
    const t = texto.replace(/[,()*%\\]/g, ' ').trim();
    if (t.length < 2) { setPersonas([]); return undefined; }
    const id = setTimeout(async () => {
      const { data } = await supabase.from('personas').select('id, correo, nombre, apellidos, empresa, recurrente, estado_bloqueo, ultima_visita_at')
        .or(['nombre', 'apellidos', 'correo'].map((c) => `${c}.ilike.%${t}%`).join(',')).order('ultima_visita_at', { ascending: false, nullsFirst: false }).limit(20);
      setPersonas(data ?? []);
    }, 250);
    return () => clearTimeout(id);
  }, [texto]);

  async function abrir(p) {
    setSel(p);
    const { data } = await supabase.from('visitantes').select(CAMPOS_VISITA).eq('persona_id', p.id).order('entrada', { ascending: false }).limit(200);
    setVisitas(data ?? []);
  }
  async function reenviar(v) {
    setEnviando(v.folio);
    try { const r = await invocar('reenviar-pase', { folio: v.folio }); toast(`Pase reenviado a ${r.correo}.`); abrir(sel); }
    catch (e) { toast(e.message); } finally { setEnviando(''); }
  }

  const ahora = Date.now();
  const vigente = visitas.find((v) => !v.salida_real_at && new Date(v.salida).getTime() > ahora && v.estado_aprobacion !== 'rechazada');
  return (
    <div className="consulta-visitante">
      <section className="card">
        <div className="field"><label htmlFor="cv-buscar">Buscar visitante por nombre o correo</label>
          <input id="cv-buscar" type="search" placeholder="Escribe al menos 2 letras" value={texto} onChange={(e) => setTexto(e.target.value)} /></div>
        <ul className="lista-personas">
          {personas.map((p) => (
            <li key={p.id}><button type="button" className="hoy-item" aria-current={sel?.id === p.id} onClick={() => abrir(p)}>
              <span className="avatar avatar-vacio" aria-hidden="true">{(p.nombre ?? p.correo).charAt(0).toUpperCase()}</span>
              <span className="hoy-datos"><strong>{`${p.nombre ?? ''} ${p.apellidos ?? ''}`.trim() || p.correo}</strong><span className="muted small">{p.correo} · {p.empresa}</span></span>
              {ESTADOS_BLOQUEO[p.estado_bloqueo] && <span className={`pill ${ESTADOS_BLOQUEO[p.estado_bloqueo][1]}`}>{ESTADOS_BLOQUEO[p.estado_bloqueo][0]}</span>}
            </button></li>
          ))}
          {texto.trim().length >= 2 && !personas.length && <li className="vacio">Sin coincidencias.</li>}
        </ul>
      </section>

      {sel && (
        <section className="card" aria-labelledby="perfil-titulo">
          <div className="card-head">
            <div>
              <h2 id="perfil-titulo">{`${sel.nombre ?? ''} ${sel.apellidos ?? ''}`.trim() || sel.correo}</h2>
              <p className="muted">{sel.correo} · {sel.empresa} · {sel.recurrente ? 'Recurrente' : 'No recurrente'} · {visitas.length} {visitas.length === 1 ? 'visita' : 'visitas'}</p>
            </div>
          </div>
          <div className={`estado-invitacion ${vigente ? 'activa' : ''}`}>
            <strong>Estado actual de su invitación:</strong>{' '}
            {vigente ? <>{estadoVisita(vigente).texto}, {fmtFechaHora.format(new Date(vigente.entrada))} (folio {vigente.folio})
              <button type="button" className="btn btn-compact btn-icono" disabled={enviando === vigente.folio} onClick={() => reenviar(vigente)}>
                {enviando === vigente.folio ? 'Enviando…' : 'Reenviar QR'}</button></>
              : 'Sin invitaciones vigentes.'}
          </div>
          <div className="table-wrap">
            <table className="tabla">
              <thead><tr><th>Folio</th><th>Entrada</th><th>Visita a</th><th>Llegada</th><th>Salida</th><th>Estado</th></tr></thead>
              <tbody>
                {visitas.map((v) => (
                  <tr key={v.folio} className="fila-click" tabIndex={0} onClick={() => setFicha(v.folio)} onKeyDown={(e) => e.key === 'Enter' && setFicha(v.folio)}>
                    <td className="mono">{v.folio}</td><td className="nowrap">{fmtFechaHora.format(new Date(v.entrada))}</td>
                    <td>{v.persona_visita}<br /><span className="muted small">{v.empresas?.nombre}</span></td>
                    <td className="nowrap">{v.llegada_at ? fmtFechaHora.format(new Date(v.llegada_at)) : '—'}</td>
                    <td className="nowrap">{v.salida_real_at ? fmtFechaHora.format(new Date(v.salida_real_at)) : '—'}</td>
                    <td><Estado {...estadoVisita(v)} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!visitas.length && <p className="vacio">No hay visitas en tu alcance.</p>}
          </div>
        </section>
      )}
      <Dialogo abierto={Boolean(ficha)} onCerrar={() => setFicha(null)} titulo="Ficha de la visita" ancho={640}>
        {ficha && <FichaVisita folio={ficha} onCambio={() => abrir(sel)} />}
      </Dialogo>
    </div>
  );
}
