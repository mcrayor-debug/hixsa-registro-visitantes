import { useState } from 'react';
import ConsultaFecha from './consultas/ConsultaFecha.jsx';
import ConsultaVisitante from './consultas/ConsultaVisitante.jsx';
import ConsultaSeguridad from './consultas/ConsultaSeguridad.jsx';
import { ALCANCES, alcanceDe } from '../lib/permisos.js';

const GRUPOS = [['fecha', 'Por fecha'], ['visitante', 'Por visitante'], ['seguridad', 'Seguridad']];

export default function Consultas(props) {
  const [grupo, setGrupo] = useState('fecha');
  const alcance = alcanceDe(props.perfil);
  return (
    <div className="consultas">
      <div className="consultas-head">
        <div className="filtros-rapidos consultas-grupos" role="tablist" aria-label="Tipo de consulta">
          {GRUPOS.map(([id, t]) => <button key={id} type="button" role="tab" className="chip-btn chip-grupo" aria-pressed={grupo === id} aria-selected={grupo === id} onClick={() => setGrupo(id)}>{t}</button>)}
        </div>
        <p className="muted small">Tu rol consulta: <strong>{ALCANCES[alcance]}</strong>{props.config?.modo_auditoria && ' · modo auditoría: solo HIXSA'}</p>
      </div>
      {grupo === 'fecha' && <ConsultaFecha {...props} />}
      {grupo === 'visitante' && <ConsultaVisitante {...props} />}
      {grupo === 'seguridad' && <ConsultaSeguridad {...props} />}
    </div>
  );
}
