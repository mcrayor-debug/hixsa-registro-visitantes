import { useState } from 'react';
import { puede } from '../lib/permisos.js';
import Proteccion from './Proteccion.jsx';
import Usuarios from './config/Usuarios.jsx';
import Roles from './config/Roles.jsx';
import Empresas from './config/Empresas.jsx';
import Anfitriones from './config/Anfitriones.jsx';
import Visitantes from './config/Visitantes.jsx';
import Datos from './config/Datos.jsx';
import Correos from './config/Correos.jsx';
import Bitacora from './config/Bitacora.jsx';
import Calendario from './config/Calendario.jsx';
import Respaldos from './config/Respaldos.jsx';

const APARTADOS = [
  ['usuarios', 'Usuarios', 'config_usuarios'],
  ['roles', 'Roles', 'config_roles'],
  ['empresas', 'Empresas', 'config_empresas'],
  ['anfitriones', 'Anfitriones', 'config_anfitriones'],
  ['visitantes', 'Visitantes', 'config_visitantes'],
  ['datos', 'Importar y depurar', 'config_visitantes'],
  ['correos', 'Correos y avisos', 'config_correos'],
  ['calendario', 'Calendario laboral', 'config_correos'],
  ['respaldos', 'Respaldos', 'config_roles'],
  ['bitacora', 'Bitácora', 'config_bitacora'],
];

export default function Configuracion({ perfil, config, empresas, recargar }) {
  const visibles = APARTADOS.filter(([, , permiso]) => puede(perfil, permiso));
  const [apartado, setApartado] = useState(visibles[0]?.[0]);
  return (
    <div className="config">
      <div className="field config-select">
        <label htmlFor="config-apartado">Apartado</label>
        <select id="config-apartado" value={apartado} onChange={(e) => setApartado(e.target.value)}>
          {visibles.map(([id, texto]) => <option key={id} value={id}>{texto}</option>)}
        </select>
      </div>
      <div className="config-nav filtros-rapidos" role="tablist" aria-label="Apartados de configuración">
        {visibles.map(([id, texto]) => (
          <button key={id} type="button" role="tab" className="chip-btn" aria-pressed={apartado === id} aria-selected={apartado === id}
            onClick={() => setApartado(id)}>{texto}</button>
        ))}
      </div>
      <Proteccion key={apartado} nombre={`configuracion/${apartado}`}>
      {apartado === 'usuarios' && <Usuarios perfil={perfil} />}
      {apartado === 'roles' && <Roles />}
      {apartado === 'empresas' && <Empresas config={config} empresas={empresas} recargar={recargar} />}
      {apartado === 'anfitriones' && <Anfitriones empresas={empresas} />}
      {apartado === 'visitantes' && <Visitantes empresas={empresas} />}
      {apartado === 'datos' && <Datos perfil={perfil} />}
      {apartado === 'correos' && <Correos recargar={recargar} perfil={perfil} />}
      {apartado === 'calendario' && <Calendario />}
      {apartado === 'respaldos' && <Respaldos />}
      {apartado === 'bitacora' && <Bitacora />}
      </Proteccion>
    </div>
  );
}
