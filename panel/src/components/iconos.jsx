// Íconos pequeños (SVG en línea) para acciones de agregar, editar y eliminar.
const trazos = {
  agregar: <path d="M12 5v14M5 12h14" />,
  editar: <><path d="M4 20h4L19 9l-4-4L4 16v4z" /><path d="M14 6l4 4" /></>,
  eliminar: <><path d="M4 7h16" /><path d="M9 7V4h6v3" /><path d="M6 7l1 13h10l1-13" /></>,
  ocultar: <><path d="M3 3l18 18" /><path d="M10.6 6.1A9.8 9.8 0 0 1 12 6c5 0 9 6 9 6a16 16 0 0 1-3 3.6M6.2 7.6C4 9.2 3 12 3 12s4 6 9 6c1.3 0 2.6-.3 3.7-.9" /></>,
  mostrar: <><path d="M3 12s4-6 9-6 9 6 9 6-4 6-9 6-9-6-9-6z" /><circle cx="12" cy="12" r="2.5" /></>,
  llave: <><circle cx="8" cy="15" r="4" /><path d="M11 12l9-9M17 6l3 3" /></>,
  subir: <><path d="M12 16V4M7 9l5-5 5 5" /><path d="M4 20h16" /></>,
  escudo: <path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" />,
  calendario: <><rect x="4" y="5" width="16" height="15" rx="2" /><path d="M8 3v4M16 3v4M4 10h16" /></>,
};
export function Icono({ nombre, tamano = 18 }) {
  return (
    <svg width={tamano} height={tamano} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{trazos[nombre]}</svg>
  );
}
/** Botón con ícono; el texto queda disponible para lectores de pantalla y como tooltip. */
export function BotonIcono({ icono, texto, peligro, ...props }) {
  return (
    <button type="button" className={`icon-btn${peligro ? ' icon-btn-peligro' : ''}`} title={texto} aria-label={texto} {...props}>
      <Icono nombre={icono} />
    </button>
  );
}
