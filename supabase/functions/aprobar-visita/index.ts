// =====================================================================
// Edge Function: aprobar-visita (pública, con token de un solo uso)
// El anfitrión recibe por correo un enlace a /aprobar.html?t=...; esa página
// pide confirmar y llama aquí con { token, accion: "aprobar" | "rechazar" }.
// =====================================================================
import { json, leerJson, prepararPeticion } from "../_shared/http.ts";
import { clienteServicio } from "../_shared/supabase.ts";
import { enviarCorreo, escapar, logoCorreo, plantilla } from "../_shared/correo.ts";
import { formatoFecha, formatoHora } from "../_shared/formato.ts";
import { sha256Hex, TOKEN_RE } from "../_shared/tokens.ts";
import { cancelarCalendario } from "../_shared/pase.ts";

Deno.serve(async (req) => {
  const previo = prepararPeticion(req);
  if (previo) return previo;
  const p = await leerJson<{ token?: string; accion?: string; consultar?: boolean }>(req);
  const token = String(p?.token ?? "");
  if (!TOKEN_RE.test(token)) return json({ error: "El enlace no es válido." }, 400);

  const db = clienteServicio();
  const { data: v } = await db.from("visitantes")
    .select("id, folio, nombre, nombre_completo, correo, empresa, persona_visita, motivo, entrada, salida, estado_aprobacion, empresas(nombre)")
    .eq("aprobacion_token_hash", await sha256Hex(token)).maybeSingle();
  if (!v) return json({ error: "Este enlace ya se usó o no es válido." }, 404);

  const resumen = {
    folio: v.folio, visitante: v.nombre_completo, empresa_origen: v.empresa,
    empresa_visita: (v.empresas as { nombre?: string } | null)?.nombre ?? "",
    motivo: v.motivo, entrada: v.entrada, salida: v.salida, estado: v.estado_aprobacion,
  };
  if (p?.consultar) return json({ ok: true, visita: resumen });
  if (p?.accion !== "aprobar" && p?.accion !== "rechazar") return json({ error: "Acción inválida." }, 422);
  if (v.estado_aprobacion !== "pendiente") return json({ error: "Esta visita ya fue respondida.", visita: resumen }, 409);
  if (new Date(v.salida).getTime() < Date.now()) return json({ error: "El horario de esta visita ya pasó.", visita: resumen }, 410);

  const estado = p.accion === "aprobar" ? "aprobada" : "rechazada";
  const { error } = await db.from("visitantes").update({
    estado_aprobacion: estado, aprobacion_por: "anfitrion", aprobacion_at: new Date().toISOString(), aprobacion_token_hash: null,
  }).eq("id", v.id).eq("estado_aprobacion", "pendiente");
  if (error) return json({ error: "No se pudo guardar tu respuesta. Intenta de nuevo." }, 500);

  if (estado === "rechazada") await cancelarCalendario(db, v, resumen.empresa_visita);
  try {
    const cuando = `${formatoFecha(v.entrada)}, ${formatoHora(v.entrada)} h`;
    await enviarCorreo({
      para: [v.correo],
      asunto: estado === "aprobada" ? `Tu visita a ${resumen.empresa_visita} fue confirmada` : `Tu visita a ${resumen.empresa_visita} no fue autorizada`,
      html: plantilla({
        titulo: estado === "aprobada" ? "Visita confirmada" : "Visita no autorizada", logo: await logoCorreo(db),
        cuerpo: estado === "aprobada"
          ? `<p style="margin:0 0 12px">Hola ${escapar(v.nombre_completo.split(" ")[0])}, <b>${escapar(v.persona_visita)}</b> confirmó tu visita del <b>${escapar(cuando)}</b>.</p>
             <p style="margin:0">Muestra en recepción el código QR que recibiste al registrarte (folio <b>${escapar(v.folio)}</b>).</p>`
          : `<p style="margin:0 0 12px">Hola ${escapar(v.nombre_completo.split(" ")[0])}, tu visita del <b>${escapar(cuando)}</b> no fue autorizada.</p>
             <p style="margin:0">Si crees que es un error, comunícate con la persona que ibas a visitar.</p>`,
      }),
    });
  } catch (e) {
    console.error("aviso al visitante", e);
  }
  return json({ ok: true, visita: { ...resumen, estado } });
});
