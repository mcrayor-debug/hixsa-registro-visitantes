// Permisos del panel: cada rol define sus secciones, su alcance de consulta y si exporta.
// La base de datos aplica las mismas reglas (RLS); aquí solo se decide qué mostrar.
export const SECCIONES = [
  ['recepcion', 'Recepción'],
  ['tablero', 'Tablero'],
  ['consultas', 'Consultas'],
  ['reportes', 'Reportes'],
  ['config_usuarios', 'Configuración: usuarios'],
  ['config_roles', 'Configuración: roles'],
  ['config_empresas', 'Configuración: empresas y modo auditoría'],
  ['config_anfitriones', 'Configuración: anfitriones'],
  ['config_correos', 'Configuración: correos, avisos y tolerancia'],
  ['config_bitacora', 'Configuración: bitácora'],
];
export const ALCANCES = { hoy: 'Solo hoy', semana: 'Semana (7 días atrás y 7 adelante)', sin_limite: 'Sin límite' };

export const esSuperadmin = (p) => p?.rol === 'superadmin';
export const puede = (p, seccion) => esSuperadmin(p) || (p?.roles?.secciones ?? []).includes(seccion);
export const puedeConfigurar = (p) => SECCIONES.some(([s]) => s.startsWith('config_') && puede(p, s));
export const puedeExportar = (p) => esSuperadmin(p) || Boolean(p?.roles?.puede_exportar);
export const alcanceDe = (p) => (esSuperadmin(p) ? 'sin_limite' : p?.roles?.alcance ?? 'hoy');
