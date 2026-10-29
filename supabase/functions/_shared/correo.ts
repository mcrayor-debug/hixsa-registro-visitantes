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
