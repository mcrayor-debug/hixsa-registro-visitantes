// Envío del pase de visita (QR + invitación .ics) y de las invitaciones a los correos
// de calendario configurados. Lo usan registrar-visita y reenviar-pase.
import QRCode from "npm:qrcode@1.5.4";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.45.4";
import { enviarCorreo, escapar, logoCorreo, plantilla } from "./correo.ts";
import { formatoFecha, formatoHora, huellaPase } from "./formato.ts";
import { base64Texto, crearIcs, enlaceGoogle, LUGAR_HIXSA, remitente } from "./calendario.ts";

export interface VisitaPase {
  id: string; folio: string; nombre_completo: string; nombre?: string | null; correo: string; empresa: string;
  persona_visita: string; motivo: string; entrada: string; salida: string;
}

const sitio = () => (Deno.env.get("PUBLIC_SITE_URL") ?? "").replace(/\/$/, "");
const uid = (folio: string) => `${folio}@registro-visitas.hixsa`;

function tabla(v: VisitaPase, empresaVisita: string) {
  const fila = (k: string, val: string) =>
    `<tr><td style="padding:6px 0;color:#5B6B7F;width:140px;vertical-align:top">${k}</td><td style="padding:6px 0;font-weight:600">${escapar(val)}</td></tr>`;
  const mismaFecha = formatoFecha(v.entrada) === formatoFecha(v.salida);
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:14px">
    ${fila("Entrada", `${formatoFecha(v.entrada)}, ${formatoHora(v.entrada)} h`)}
    ${fila("Salida", mismaFecha ? `${formatoHora(v.salida)} h` : `${formatoFecha(v.salida)}, ${formatoHora(v.salida)} h`)}
    ${fila("Empresa a visitar", empresaVisita)}${fila("Visitas a", v.persona_visita)}${fila("Motivo", v.motivo)}${fila("Empresa de origen", v.empresa)}
  </table>`;
}

/** Envía el pase al visitante. Devuelve el QR (data URL) y si el correo salió. */
export async function enviarPase(
  db: SupabaseClient, v: VisitaPase,
  o: { empresaVisita: string; aprueba: "anfitrion" | "recepcion" | null; reenvio?: boolean },
): Promise<{ qr: string; correoEnviado: boolean }> {
  const s = sitio();
  const huella = await huellaPase(v);
  const contenido = s ? `${s}/admin.html?pase=${encodeURIComponent(v.folio)}&h=${huella}`
    : `HIXSA|${v.folio}|${v.nombre_completo}|${v.entrada}|${v.salida}|${huella}`;
  const qr: string = await QRCode.toDataURL(contenido, { errorCorrectionLevel: "M", margin: 2, width: 440, color: { dark: "#0047BA", light: "#FFFFFF" } });
  const qrBase64 = qr.split(",")[1];
  const logo = await logoCorreo(db);
  const { data: cfg } = await db.from("configuracion").select("correo_recepcion, copia_recepcion, correos_calendario").eq("id", 1).maybeSingle();
  const cc = !o.reenvio && cfg?.copia_recepcion && cfg.correo_recepcion ? [cfg.correo_recepcion] : [];

  const evento = {
    titulo: `Visita a ${o.empresaVisita} (${v.folio})`, inicio: v.entrada, fin: v.salida, lugar: LUGAR_HIXSA,
    descripcion: `Visitas a: ${v.persona_visita}\nMotivo: ${v.motivo}\nFolio: ${v.folio}\nMuestra tu código QR en recepción.`,
  };
  const ics = crearIcs({ ...evento, uid: uid(v.folio), organizador: remitente(), metodo: "PUBLISH" });
  const nombre = v.nombre || v.nombre_completo.split(" ")[0];
  const aviso = o.aprueba === "anfitrion" ? "Tu anfitrión debe confirmar la visita; te avisaremos por correo cuando lo haga."
    : o.aprueba === "recepcion" ? "Recepción validará tu visita al llegar." : "";

  let correoEnviado = false;
  try {
    await enviarCorreo({
      para: [v.correo], cc,
      asunto: `${o.reenvio ? "Reenvío: " : ""}Tu pase de visita a ${o.empresaVisita} (${v.folio})`,
      html: plantilla({
        titulo: "Tu pase de visita", logo,
        cuerpo: `<p style="margin:0 0 12px;font-size:16px">Hola ${escapar(nombre)}, ${o.reenvio ? "te reenviamos tu pase de visita" : "tu visita quedó registrada"}. Muestra este código en recepción al llegar.</p>
          ${aviso ? `<p style="margin:0 0 16px;padding:10px 12px;background:#FFF6DB;border-radius:8px">${aviso}</p>` : ""}
          <div style="text-align:center;margin:20px 0">
            <img src="cid:qr-pase" width="220" height="220" alt="Código QR del pase ${escapar(v.folio)}" style="display:inline-block;border:1px solid #D3DCE6;border-radius:8px">
            <div style="font-family:'Courier New',monospace;font-size:18px;font-weight:700;color:#0047BA;margin-top:10px">${escapar(v.folio)}</div>
          </div>${tabla(v, o.empresaVisita)}
          <p style="margin:18px 0 0"><a href="${escapar(enlaceGoogle(evento))}" style="color:#0047BA;font-weight:700">Agregar a Google Calendar</a>
            <span style="color:#5B6B7F"> o abre el archivo adjunto <b>invitacion.ics</b> para otros calendarios.</span></p>
          <p style="margin:12px 0 0;font-size:13px;color:#5B6B7F">Llega dentro de tu horario: fuera de él, Recepción no podrá registrar tu entrada sin autorización.</p>`,
      }),
      texto: `Tu pase de visita a ${o.empresaVisita}. Folio ${v.folio}. Entrada: ${formatoFecha(v.entrada)} ${formatoHora(v.entrada)} h.`,
      adjuntos: [
        { filename: "qr-pase.png", content: qrBase64, content_type: "image/png", content_id: "qr-pase" },
        { filename: `pase-${v.folio}.png`, content: qrBase64, content_type: "image/png" },
        { filename: "invitacion.ics", content: base64Texto(ics), content_type: "text/calendar; charset=utf-8; method=PUBLISH" },
      ],
    });
    correoEnviado = true;
    await db.from("visitantes").update({ qr_enviado_at: new Date().toISOString(), correo_error: null }).eq("id", v.id);
  } catch (e) {
    console.error("envío del pase", e);
    await db.from("visitantes").update({ correo_error: String(e).slice(0, 300) }).eq("id", v.id);
  }

  // Todas las visitas, sin excepción, a los correos de calendario configurados (solo en el registro)
  const calendario = (cfg?.correos_calendario ?? []) as string[];
  if (!o.reenvio && calendario.length) {
    const invitacion = crearIcs({ ...evento, titulo: `Visita: ${v.nombre_completo} (${v.empresa}) a ${o.empresaVisita}`,
      uid: uid(v.folio), organizador: remitente(), asistentes: calendario, metodo: "REQUEST" });
    try {
      await enviarCorreo({
        para: calendario,
        asunto: `Visita: ${v.nombre_completo} (${v.empresa}), ${formatoFecha(v.entrada)} ${formatoHora(v.entrada)} h`,
        html: plantilla({ titulo: "Visita programada", logo, cuerpo: tabla(v, o.empresaVisita) }),
        adjuntos: [{ filename: "invitacion.ics", content: base64Texto(invitacion), content_type: "text/calendar; charset=utf-8; method=REQUEST" }],
      });
    } catch (e) {
      console.error("invitación de calendario", e);
    }
  }
  return { qr, correoEnviado };
}

/** Cancela la invitación en los calendarios configurados (cuando el anfitrión rechaza). */
export async function cancelarCalendario(db: SupabaseClient, v: VisitaPase, empresaVisita: string) {
  const { data: cfg } = await db.from("configuracion").select("correos_calendario").eq("id", 1).maybeSingle();
  const calendario = (cfg?.correos_calendario ?? []) as string[];
  if (!calendario.length) return;
  const ics = crearIcs({
    uid: uid(v.folio), inicio: v.entrada, fin: v.salida, lugar: LUGAR_HIXSA, organizador: remitente(), asistentes: calendario,
    titulo: `Visita cancelada: ${v.nombre_completo} (${v.empresa}) a ${empresaVisita}`, descripcion: "El anfitrión no autorizó la visita.",
    metodo: "CANCEL", secuencia: 1,
  });
  try {
    await enviarCorreo({
      para: calendario, asunto: `Visita cancelada: ${v.nombre_completo} (${v.folio})`,
      html: plantilla({ titulo: "Visita cancelada", logo: await logoCorreo(db), cuerpo: tabla(v, empresaVisita) }),
      adjuntos: [{ filename: "cancelacion.ics", content: base64Texto(ics), content_type: "text/calendar; charset=utf-8; method=CANCEL" }],
    });
  } catch (e) {
    console.error("cancelación de calendario", e);
  }
}
