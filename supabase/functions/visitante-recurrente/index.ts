// =====================================================================
// Edge Function: visitante-recurrente (pública)
//   solicitar: envía un código de 6 dígitos al correo (solo si es visitante recurrente).
//              La respuesta es la misma exista o no el correo (no revela quién está registrado).
//   verificar: valida el código (10 min, máx. 5 intentos) y devuelve sus datos guardados
//              y un token de 30 min para reutilizar sus fotos al registrar la visita.
// =====================================================================
import { json, leerJson, prepararPeticion } from "../_shared/http.ts";
import { clienteServicio } from "../_shared/supabase.ts";
import { EMAIL_RE, enviarCorreo, escapar, logoCorreo, plantilla } from "../_shared/correo.ts";
import { codigo6, sha256Hex, tokenAleatorio } from "../_shared/tokens.ts";

const MIN = 60_000;
const MENSAJE_GENERICO = "Si tu correo está registrado como visitante recurrente, te enviamos un código de 6 dígitos. Revisa tu bandeja de entrada y la carpeta de spam.";

Deno.serve(async (req) => {
  const previo = prepararPeticion(req);
  if (previo) return previo;
  const p = await leerJson<{ accion?: string; correo?: string; codigo?: string }>(req);
  const correo = String(p?.correo ?? "").trim().toLowerCase();
  if (!EMAIL_RE.test(correo)) return json({ error: "Revisa el formato del correo." }, 422);

  const db = clienteServicio();
  await db.from("verificaciones").delete().lt("expira_at", new Date(Date.now() - 24 * 60 * MIN).toISOString());

  if (p?.accion === "solicitar") {
    const { count } = await db.from("verificaciones").select("id", { count: "exact", head: true })
      .eq("correo", correo).eq("tipo", "codigo").gte("created_at", new Date(Date.now() - 15 * MIN).toISOString());
    if ((count ?? 0) >= 3) return json({ error: "Ya enviamos varios códigos. Espera unos minutos e intenta de nuevo." }, 429);

    const { data: persona } = await db.from("personas").select("id, nombre, recurrente, estado_bloqueo")
      .eq("correo", correo).maybeSingle();
    if (persona?.recurrente && persona.estado_bloqueo !== "bloqueado") {
      const codigo = codigo6();
      await db.from("verificaciones").insert({
        correo, tipo: "codigo", hash: await sha256Hex(`${correo}:${codigo}`),
        expira_at: new Date(Date.now() + 10 * MIN).toISOString(),
      });
      try {
        await enviarCorreo({
          para: [correo],
          asunto: `Tu código para registrar tu visita: ${codigo}`,
          html: plantilla({
            titulo: "Código de verificación", logo: await logoCorreo(db),
            cuerpo: `<p style="margin:0 0 16px">Hola ${escapar(persona.nombre ?? "")}, usa este código para recuperar tus datos de visitante:</p>
              <p style="margin:0 0 16px;font-size:32px;font-weight:800;letter-spacing:8px;color:#0047BA">${codigo}</p>
              <p style="margin:0;color:#5B6B7F">Vence en 10 minutos. Si no lo pediste, ignora este correo.</p>`,
          }),
          texto: `Tu código para registrar tu visita en HIXSA es ${codigo}. Vence en 10 minutos.`,
        });
      } catch (e) {
        console.error("envío de código", e);
      }
    }
    return json({ ok: true, mensaje: MENSAJE_GENERICO });
  }

  if (p?.accion === "verificar") {
    const codigo = String(p.codigo ?? "").trim();
    if (!/^\d{6}$/.test(codigo)) return json({ error: "El código tiene 6 dígitos." }, 422);
    const { data: fila } = await db.from("verificaciones").select("id, hash, intentos")
      .eq("correo", correo).eq("tipo", "codigo").is("usado_at", null).gt("expira_at", new Date().toISOString())
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (!fila) return json({ error: "Código incorrecto o vencido. Pide uno nuevo." }, 422);
    if (fila.intentos >= 5) return json({ error: "Demasiados intentos. Pide un código nuevo." }, 429);
    if (fila.hash !== (await sha256Hex(`${correo}:${codigo}`))) {
      await db.from("verificaciones").update({ intentos: fila.intentos + 1 }).eq("id", fila.id);
      return json({ error: "Código incorrecto o vencido. Pide uno nuevo." }, 422);
    }
    await db.from("verificaciones").update({ usado_at: new Date().toISOString() }).eq("id", fila.id);

    const { data: per } = await db.from("personas")
      .select("nombre, apellidos, telefono, empresa, tipo_identificacion, identificacion_detalle, identificacion_path, selfie_path, equipo_tipo, equipo_marca, equipo_serie, estado_bloqueo")
      .eq("correo", correo).maybeSingle();
    if (!per || per.estado_bloqueo === "bloqueado") return json({ error: "Código incorrecto o vencido. Pide uno nuevo." }, 422);

    const token = tokenAleatorio();
    await db.from("verificaciones").insert({
      correo, tipo: "token", hash: await sha256Hex(token), expira_at: new Date(Date.now() + 30 * MIN).toISOString(),
    });
    return json({
      ok: true, token,
      perfil: {
        nombre: per.nombre, apellidos: per.apellidos, telefono: per.telefono, empresa: per.empresa,
        tipo_identificacion: per.tipo_identificacion, identificacion_detalle: per.identificacion_detalle,
        equipo_tipo: per.equipo_tipo, equipo_marca: per.equipo_marca, equipo_serie: per.equipo_serie,
        tiene_identificacion: Boolean(per.identificacion_path), tiene_selfie: Boolean(per.selfie_path),
      },
    });
  }
  return json({ error: "Acción desconocida." }, 400);
});
