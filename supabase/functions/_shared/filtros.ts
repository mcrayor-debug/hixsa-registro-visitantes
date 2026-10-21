// Filtros de consulta compartidos por el panel y el envío de reportes.
export interface Filtros {
  desde?: string; // YYYY-MM-DD
  hasta?: string; // YYYY-MM-DD
  empresa?: string;
  motivo?: string;
  texto?: string;
}

const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;
const limpiar = (s?: string) => (s ?? "").replace(/[,()*%\\]/g, " ").trim().slice(0, 80);

// deno-lint-ignore no-explicit-any
export function aplicarFiltros(q: any, f: Filtros) {
  if (f.desde && FECHA_RE.test(f.desde)) q = q.gte("entrada", `${f.desde}T00:00:00-06:00`);
  if (f.hasta && FECHA_RE.test(f.hasta)) q = q.lte("entrada", `${f.hasta}T23:59:59.999-06:00`);
  const empresa = limpiar(f.empresa);
  if (empresa) q = q.ilike("empresa", `%${empresa}%`);
  if (f.motivo) q = q.eq("motivo", f.motivo);
  const texto = limpiar(f.texto);
  if (texto) {
    q = q.or(
      ["nombre_completo", "correo", "folio", "persona_visita"].map((c) => `${c}.ilike.%${texto}%`).join(","),
    );
  }
  return q;
}
