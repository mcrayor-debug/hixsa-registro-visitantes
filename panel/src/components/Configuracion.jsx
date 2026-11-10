import { useState } from 'react';
import { puede } from '../lib/permisos.js';
import Usuarios from './config/Usuarios.jsx';
import Roles from './config/Roles.jsx';
import Empresas from './config/Empresas.jsx';
import Anfitriones from './config/Anfitriones.jsx';
import Visitantes from './config/Visitantes.jsx';
import Correos from './config/Correos.jsx';
import Bitacora from './config/Bitacora.jsx';

const APARTADOS = [
  ['usuarios', 'Usuarios', 'config_usuarios'],
  ['roles', 'Roles', 'config_roles'],
  ['empresas', 'Empresas', 'config_empresas'],
  ['anfitriones', 'Anfitriones', 'config_anfitriones'],
  ['visitantes', 'Visitantes', 'config_visitantes'],
  ['correos', 'Correos y avisos', 'config_correos'],
  ['bitacora', 'Bitácora', 'config_bitacora'],
];

export default function Configuracion({ perfil, config, empresas, recargar }) {
  const visibles = APARTADOS.filter(([, , permiso]) => puede(perfil, permiso));
  const [apartado, setApartado] = useState(visibles[0]?.[0]);
  return (
    <div className="config">
      <div className="config-nav filtros-rapidos" role="tablist" aria-label="Apartados de configuración">
        {visibles.map(([id, texto]) => (
          <button key={id} type="button" role="tab" className="chip-btn" aria-pressed={apartado === id} aria-selected={apartado === id}
            onClick={() => setApartado(id)}>{texto}</button>
        ))}
      </div>
      {apartado === 'usuarios' && <Usuarios perfil={perfil} />}
      {apartado === 'roles' && <Roles />}
      {apartado === 'empresas' && <Empresas config={config} empresas={empresas} recargar={recargar} />}
      {apartado === 'anfitriones' && <Anfitriones empresas={empresas} />}
      {apartado === 'visitantes' && <Visitantes />}
      {apartado === 'correos' && <Correos recargar={recargar} />}
      {apartado === 'bitacora' && <Bitacora />}
    </div>
  );
}
