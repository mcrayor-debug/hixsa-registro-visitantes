export const TZ = "America/Mexico_City";

const fechaLarga = new Intl.DateTimeFormat("es-MX", {
  weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: TZ,
});
const hora = new Intl.DateTimeFormat("es-MX", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: TZ });
const fechaHora = new Intl.DateTimeFormat("es-MX", {
  day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: TZ,
});

const mayuscula = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export const formatoFecha = (iso: string) => mayuscula(fechaLarga.format(new Date(iso)));
export const formatoHora = (iso: string) => hora.format(new Date(iso));
export const formatoFechaHora = (iso: string) => fechaHora.format(new Date(iso));

/** Huella del pase: SHA-256 de folio|correo|entrada|salida (12 caracteres). El panel la recalcula igual. */
export async function huellaPase(v: { folio: string; correo: string; entrada: string; salida: string }) {
  const texto = [v.folio, v.correo, new Date(v.entrada).toISOString(), new Date(v.salida).toISOString()].join("|");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(texto));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 12);
}
