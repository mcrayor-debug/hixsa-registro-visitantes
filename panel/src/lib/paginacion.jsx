import { useEffect, useMemo, useState } from 'react';

/** Paginación en el navegador: devuelve la página visible y los controles. */
export function usePaginacion(items, porPagina = 25) {
  const lista = items ?? [];
  const [pagina, setPagina] = useState(0);
  const paginas = Math.max(1, Math.ceil(lista.length / porPagina));
  useEffect(() => { if (pagina >= paginas) setPagina(0); }, [paginas, pagina]);
  const visibles = useMemo(() => lista.slice(pagina * porPagina, (pagina + 1) * porPagina), [lista, pagina, porPagina]);
  const controles = lista.length > porPagina ? (
    <div className="paginacion">
      <span className="muted small">{pagina * porPagina + 1}–{Math.min(lista.length, (pagina + 1) * porPagina)} de {lista.length}</span>
      <span>
        <button type="button" className="btn btn-secondary btn-compact" disabled={pagina === 0} onClick={() => setPagina(pagina - 1)}>Anterior</button>
        <span className="small">Página {pagina + 1} de {paginas}</span>
        <button type="button" className="btn btn-secondary btn-compact" disabled={pagina + 1 >= paginas} onClick={() => setPagina(pagina + 1)}>Siguiente</button>
      </span>
    </div>
  ) : null;
  return { visibles, controles, reiniciar: () => setPagina(0) };
}
