// =====================================================================
// Edge Function: registrar-acceso (personal activo)
// Registra la llegada o la salida real de una visita al escanear su QR.
// En la llegada avisa por correo al anfitrión (si está activado en Configuración).
// =====================================================================
import { json, leerJson, prepararPeticion } from "../_shared/http.ts";
import { clienteServicio } from "../_shared/supabase.ts";
import { usuarioActivo } from "../_shared/auth.ts";
import { enviarCorreo, escapar } from "../_shared/correo.ts";
import { formatoFecha, formatoHora } from "../_shared/formato.ts";

const FOLIO_RE = /^HX-[0-9A-Z-]{6,20}$/;

Deno.serve(async (req) => {
  const previo = prepararPeticion(req);
  if (previo) return previo;

  const db = clienteServicio();
  const yo = await usuarioActivo(req, db);
  if (!yo) return json({ error: "Inicia sesión para continuar." }, 401);

  const p = await leerJson<{ folio?: string; accion?: "llegada" | "salida" }>(req);
  const folio = String(p?.folio ?? "").trim().toUpperCase();
  if (!FOLIO_RE.test(folio)) return json({ error: "Folio inválido." }, 422);
  if (p?.accion !== "llegada" && p?.accion !== "salida") return json({ error: "Acción inválida." }, 422);

  const { data: v } = await db
    .from("visitantes")
    .select("id, folio, nombre_completo, empresa, motivo, persona_visita, entrada, salida, llegada_at, salida_real_at, anfitrion_id")
    .eq("folio", folio)
    .maybeSingle();
  if (!v) return json({ error: `No existe una visita con el folio ${folio}.` }, 404);

  const ahora = new Date().toISOString();

  if (p.accion === "llegada") {
    if (v.llegada_at) return json({ error: `La llegada ya se registró a las ${formatoHora(v.llegada_at)}.` }, 409);
    const { error } = await db.from("visitantes")
      .update({ llegada_at: ahora, llegada_por: yo.id }).eq("id", v.id).is("llegada_at", null);
    if (error) return json({ error: "No se pudo registrar la llegada." }, 500);

    // Aviso al anfitrión
    let anfitrionAvisado = false;
    const { data: cfg } = await db.from("configuracion").select("avisar_anfitrion").eq("id", 1).maybeSingle();
    if (cfg?.avisar_anfitrion !== false && v.anfitrion_id) {
      const { data: anf } = await db.from("anfitriones").select("nombre, correo").eq("id", v.anfitrion_id).maybeSingle();
      if (anf?.correo) {
        try {
          await enviarCorreo({
            para: [anf.correo],
            asunto: `Tu visita llegó: ${v.nombre_completo} (${v.empresa})`,
            html: `<div style="font-family:Arial,Helvetica,sans-serif;color:#1C2A3A;max-width:520px">
  <div style="background:#12365F;color:#fff;padding:18px 22px;border-radius:10px 10px 0 0">
    <div style="font-size:18px;font-weight:800;letter-spacing:2px">HIXSA</div>
    <div style="color:#CFE3F2;margin-top:4px">Aviso de recepción</div>
  </div>
  <div style="border:1px solid #D3DCE6;border-top:0;padding:22px;border-radius:0 0 10px 10px">
    <p style="margin:0 0 12px;font-size:16px">Hola ${escapar(anf.nombre.split(" ")[0])}, <b>${escapar(v.nombre_completo)}</b> de <b>${escapar(v.empresa)}</b> ya está en recepción.</p>
    <p style="margin:0;color:#5B6B7F">Llegada: ${formatoHora(ahora)} h. Motivo: ${escapar(v.motivo)}.<br>
    Horario registrado: ${formatoFecha(v.entrada)}, ${formatoHora(v.entrada)} a ${formatoHora(v.salida)} h. Folio ${escapar(v.folio)}.</p>
  </div></div>`,
          });
          anfitrionAvisado = true;
          await db.from("visitantes").update({ anfitrion_avisado_at: new Date().toISOString() }).eq("id", v.id);
        } catch (e) {
          console.error("aviso al anfitrión", e);
        }
      }
    }
    return json({ ok: true, accion: "llegada", llegada_at: ahora, anfitrion_avisado: anfitrionAvisado });
  }

  // Salida
  if (!v.llegada_at) return json({ error: "Primero registra la llegada de esta visita." }, 409);
  if (v.salida_real_at) return json({ error: `La salida ya se registró a las ${formatoHora(v.salida_real_at)}.` }, 409);
  const { error } = await db.from("visitantes")
    .update({ salida_real_at: ahora, salida_por: yo.id }).eq("id", v.id).is("salida_real_at", null);
  if (error) return json({ error: "No se pudo registrar la salida." }, 500);
  return json({ ok: true, accion: "salida", salida_real_at: ahora });
});
