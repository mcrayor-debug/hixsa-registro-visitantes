// Invitaciones de calendario (.ics, RFC 5545) y enlace "Agregar a Google Calendar".
const fmt = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const esc = (s: string) => String(s ?? "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
/** Líneas de máximo 75 caracteres (las de continuación empiezan con un espacio). */
const plegar = (linea: string) => {
  const partes: string[] = [];
  for (let i = 0; i < linea.length; i += 72) partes.push((i ? " " : "") + linea.slice(i, i + 72));
  return partes.join("\r\n");
};

export interface Evento {
  uid: string;
  inicio: string;
  fin: string;
  titulo: string;
  descripcion: string;
  lugar: string;
  organizador: { nombre: string; correo: string };
  asistentes?: string[];
  metodo: "PUBLISH" | "REQUEST" | "CANCEL";
  secuencia?: number;
}

export function crearIcs(e: Evento): string {
  const lineas = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//HIXSA//Registro de visitas//ES", "CALSCALE:GREGORIAN", `METHOD:${e.metodo}`,
    "BEGIN:VEVENT", `UID:${e.uid}`, `DTSTAMP:${fmt(new Date())}`, `DTSTART:${fmt(new Date(e.inicio))}`, `DTEND:${fmt(new Date(e.fin))}`,
    `SUMMARY:${esc(e.titulo)}`, `DESCRIPTION:${esc(e.descripcion)}`, `LOCATION:${esc(e.lugar)}`,
    `ORGANIZER;CN=${esc(e.organizador.nombre)}:mailto:${e.organizador.correo}`,
    ...(e.asistentes ?? []).map((a) => `ATTENDEE;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=FALSE:mailto:${a}`),
    `STATUS:${e.metodo === "CANCEL" ? "CANCELLED" : "CONFIRMED"}`, `SEQUENCE:${e.secuencia ?? 0}`, "TRANSP:OPAQUE",
    "END:VEVENT", "END:VCALENDAR",
  ];
  return lineas.map(plegar).join("\r\n") + "\r\n";
}

export function enlaceGoogle(e: { titulo: string; inicio: string; fin: string; descripcion: string; lugar: string }): string {
  const p = new URLSearchParams({
    action: "TEMPLATE", text: e.titulo, dates: `${fmt(new Date(e.inicio))}/${fmt(new Date(e.fin))}`,
    details: e.descripcion, location: e.lugar,
  });
  return `https://calendar.google.com/calendar/render?${p.toString()}`;
}

/** Remitente a partir de EMAIL_FROM ("Nombre <correo>"). */
export function remitente(): { nombre: string; correo: string } {
  const from = Deno.env.get("EMAIL_FROM") ?? "HIXSA Recepción <onboarding@resend.dev>";
  const m = from.match(/^\s*(.*?)\s*<([^>]+)>\s*$/);
  return m ? { nombre: m[1] || "HIXSA", correo: m[2] } : { nombre: "HIXSA", correo: from.trim() };
}

/** Texto UTF-8 a base64 (para adjuntos). */
export function base64Texto(texto: string): string {
  const bytes = new TextEncoder().encode(texto);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export const LUGAR_HIXSA = "Torre Mitikah, piso 17. Av. Río Churubusco 601, Xoco, Benito Juárez, CDMX";
