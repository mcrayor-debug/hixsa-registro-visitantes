// Envío de correo con la API de Resend (https://resend.com/docs/api-reference/emails/send-email).
export interface Adjunto {
  filename: string;
  content: string; // base64
  content_type?: string;
  content_id?: string; // para mostrar la imagen dentro del HTML con src="cid:..."
}

export interface Correo {
  para: string[];
  cc?: string[];
  asunto: string;
  html: string;
  texto?: string;
  adjuntos?: Adjunto[];
}

export async function enviarCorreo(c: Correo): Promise<{ id: string }> {
  const key = Deno.env.get("RESEND_API_KEY");
  if (!key) throw new Error("Falta RESEND_API_KEY.");
  const from = Deno.env.get("EMAIL_FROM") ?? "HIXSA Recepción <onboarding@resend.dev>";

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from,
      to: c.para,
      cc: c.cc && c.cc.length ? c.cc : undefined,
      subject: c.asunto,
      html: c.html,
      text: c.texto,
      attachments: c.adjuntos,
    }),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return await res.json();
}

export const escapar = (s: unknown): string =>
  String(s ?? "").replace(/[&<>"']/g, (ch) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!,
  );

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * Plantilla común de correo con la identidad de HIXSA (logo, franja azul y pie de privacidad).
 * `cuerpo` es HTML ya escapado por quien llama.
 */
export function plantilla(o: { titulo: string; cuerpo: string; logo?: string }): string {
  const cabecera = o.logo
    ? `<img src="${escapar(o.logo)}" alt="HIXSA" height="44" style="display:block;height:44px;width:auto;border:0">`
    : `<div style="font-size:22px;font-weight:800;letter-spacing:2px;color:#0047BA">HIXSA</div>`;
  return `<!doctype html><html lang="es"><body style="margin:0;background:#F4F7FA;font-family:Calibri,Arial,Helvetica,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F4F7FA;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#FFFFFF;border-radius:12px;overflow:hidden;border:1px solid #D3DCE6">
<tr><td style="padding:22px 28px 14px;border-bottom:4px solid #0047BA">${cabecera}
  <div style="font-size:15px;color:#5B6B7F;margin-top:8px">${escapar(o.titulo)}</div></td></tr>
<tr><td style="padding:24px 28px;font-size:15px;line-height:1.55;color:#1C2A3A">${o.cuerpo}</td></tr>
<tr><td style="padding:14px 28px;background:#F4F7FA;font-size:12px;color:#5B6B7F">
  Tus datos se tratan conforme al <a href="https://www.hixsa.com/sobre-nosotros/aviso-de-privacidad/" style="color:#0047BA">aviso de privacidad de HIXSA</a>.
</td></tr></table></td></tr></table></body></html>`;
}

/** Botón para correos (compatible con la mayoría de los clientes). */
export const botonCorreo = (url: string, texto: string, color = "#0047BA") =>
  `<a href="${escapar(url)}" style="display:inline-block;padding:12px 22px;margin:4px 8px 4px 0;background:${color};color:#FFFFFF;` +
  `text-decoration:none;font-weight:700;border-radius:8px">${escapar(texto)}</a>`;

/** Logo para correos: el configurado en el panel o el del sitio publicado. */
// deno-lint-ignore no-explicit-any
export async function logoCorreo(db: any): Promise<string> {
  const { data } = await db.from("configuracion").select("logo_url").eq("id", 1).maybeSingle();
  const sitio = (Deno.env.get("PUBLIC_SITE_URL") ?? "").replace(/\/$/, "");
  return data?.logo_url || (sitio ? `${sitio}/img/logo-hixsa.png` : "");
}
