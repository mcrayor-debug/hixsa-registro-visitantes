import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

const ToastCtx = createContext(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }) {
  const [msg, setMsg] = useState('');
  const timer = useRef();
  const mostrar = useCallback((m) => {
    setMsg(m);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setMsg(''), 4000);
  }, []);
  return (
    <ToastCtx.Provider value={mostrar}>
      {children}
      <div className="toast" role="status" aria-live="polite" hidden={!msg}>{msg}</div>
    </ToastCtx.Provider>
  );
}

/** Diálogo modal nativo (<dialog>) con foco y tecla Escape gestionados por el navegador. */
export function Dialogo({ abierto, onCerrar, titulo, ancho, children }) {
  const ref = useRef();
  useEffect(() => {
    const d = ref.current;
    if (abierto && !d.open) d.showModal();
    if (!abierto && d.open) d.close();
  }, [abierto]);
  return (
    <dialog ref={ref} className="dialog" style={ancho ? { width: `min(${ancho}px, calc(100vw - 2rem))` } : undefined}
      onClose={onCerrar} aria-label={titulo}>
      {abierto && (
        <>
          <div className="dialog-head">
            <h2>{titulo}</h2>
            <button type="button" className="link-btn" onClick={onCerrar}>Cerrar</button>
          </div>
          {children}
        </>
      )}
    </dialog>
  );
}

export function Estado({ texto, clave }) {
  return <span className={`pill estado-${clave}`}>{texto}</span>;
}

export function Mensaje({ children, tipo = 'error' }) {
  if (!children) return null;
  return <div className="status" data-tipo={tipo} role="alert">{children}</div>;
}
