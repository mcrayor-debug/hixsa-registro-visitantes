// =====================================================================
// Edge Function: registrar-acceso (permiso recepcion)
// Acciones:
//   llegada   → valida pase, bloqueo, aprobación y horario; si algo falla: ACCESO NO PERMITIDO
//   autorizar → registra la llegada pese a problemas autorizables (con motivo obligatorio)
//   aprobar   → Recepción valida una visita sin anfitrión (o con anfitrión sin correo)
//   salida    → siempre permitida si hubo llegada
// Todo rechazo o autorización queda en intentos_acceso.
// =====================================================================
import { json, leerJson, prepararPeticion } from "../_shared/http.ts";
import { clienteServicio } from "../_shared/supabase.ts";
import { filtroAuditoria, tienePermiso, usuarioActivo } from "../_shared/auth.ts";
import { enviarCorreo, escapar, logoCorreo, plantilla } from "../_shared/correo.ts";
import { formatoFecha, formatoHora, huellaPase } from "../_shared/formato.ts";
import { evaluarLlegada } from "../_shared/horario.ts";

const FOLIO_RE = /^HX-[0-9A-Z-]{6,20}$/;
const TEXTOS: Record<string, string> = {
  anticipado: "Llegó antes de su horario",
  tarde: "Llegó fuera de su horario",
  fecha_no_asignada: "Fecha no asignada",
  caducado: "Pase vencido o caducado",
  bloqueado: "Visitante bloqueado",
  restringido: "Visitante restringido: requiere aprobación del anfitrión",
  pendiente_aprobacion: "Pendiente de aprobación",
  rechazada_anfitrion: "El anfitrión rechazó la visita",
  no_coincide: "El pase no coincide con el registro",
};

interface Problema { motivo: string; detalle: string; autorizable: boolean; aprobable?: boolean }

Deno.serve(async (req) => {
  const previo = prepararPeticion(req);
  if (previo) return previo;
  const db = clienteServicio();
  const yo = await usuarioActivo(req, db);
  if (!yo) return json({ error: "Inicia sesión para continuar." }, 401);
  if (!tienePermiso(yo, "recepcion")) return json({ error: "Tu rol no tiene acceso a Recepción." }, 403);

  const p = await leerJson<{ folio?: string; accion?: string; h?: string; motivo?: string }>(req);
  const folio = String(p?.folio ?? "").trim().toUpperCase();
  const accion = String(p?.accion ?? "");
  if (!FOLIO_RE.test(folio)) return json({ error: "Folio inválido." }, 422);
  if (!["llegada", "autorizar", "aprobar", "salida", "consultar"].includes(accion)) return json({ error: "Acción inválida." }, 422);

  const { data: v } = await db.from("visitantes")
    .select("id, folio, correo, nombre_completo, empresa, motivo, persona_visita, entrada, salida, llegada_at, salida_real_at, " +
      "anfitrion_id, empresa_visita_id, estado_aprobacion, personas(estado_bloqueo, bloqueo_motivo), anfitriones(nombre, correo), empresas(nombre)")
    .eq("folio", folio).maybeSingle();
  const soloEmpresa = await filtroAuditoria(db);
  // deno-lint-ignore no-explicit-any
  const visita = v as any;
  if (!visita || (soloEmpresa && visita.empresa_visita_id !== soloEmpresa)) {
    return json({ error: `No existe una visita con el folio ${folio}.` }, 404);
  }
  const ahora = new Date();
  const registrarIntento = (pr: Problema, resultado: "rechazado" | "autorizado", autorizacion?: string) =>
    db.from("intentos_acceso").insert({
      visita_id: visita.id, folio, resultado, motivo: pr.motivo, detalle: pr.detalle.slice(0, 300),
      usuario_id: yo.id, usuario_email: yo.email, autorizacion_motivo: autorizacion ?? null,
    });

  // ---------- consultar: el panel no puede ver la visita (otro día o fuera del alcance del rol) ----------
  if (accion === "consultar") {
    const { data: cfgC } = await db.from("configuracion").select("tolerancia_min, minutos_anticipacion").eq("id", 1).maybeSingle();
    const evC = evaluarLlegada(visita, ahora, { anticipacion: cfgC?.minutos_anticipacion ?? 10, tolerancia: cfgC?.tolerancia_min ?? 15 });
    const resumen = {
      folio: visita.folio, nombre_completo: visita.nombre_completo, empresa: visita.empresa,
      empresa_visita: visita.empresas?.nombre ?? "", entrada: visita.entrada, salida: visita.salida,
    };
    if (evC.permitido || visita.llegada_at) return json({ ok: true, visita: resumen, fuera_de_alcance: true });
    const pr = { motivo: evC.motivo!, autorizable: false, detalle: evC.detalle! };
    await registrarIntento(pr, "rechazado");
    return json({
      error: "ACCESO NO PERMITIDO", codigo: pr.motivo, motivo: TEXTOS[pr.motivo], visita: resumen,
      problemas: [{ codigo: pr.motivo, motivo: TEXTOS[pr.motivo], detalle: pr.detalle }], autorizable: false, aprobable: false,
      sugerencia: "Sugiere al visitante hacer un nuevo registro con la fecha y el horario correctos.",
    }, 409);
  }

  // ---------- salida: siempre permitida ----------
  if (accion === "salida") {
    if (!visita.llegada_at) return json({ error: "Primero registra la llegada de esta visita." }, 409);
    if (visita.salida_real_at) return json({ error: `La salida ya se registró a las ${formatoHora(visita.salida_real_at)}.` }, 409);
    const { error } = await db.from("visitantes").update({ salida_real_at: ahora.toISOString(), salida_por: yo.id })
      .eq("id", visita.id).is("salida_real_at", null);
    if (error) return json({ error: "No se pudo registrar la salida." }, 500);
    return json({ ok: true, accion: "salida", salida_real_at: ahora.toISOString() });
  }

  const anfConCorreo = Boolean(visita.anfitriones?.correo);
  const bloqueo = visita.personas?.estado_bloqueo ?? "ninguno";

  // ---------- aprobar (visitas sin anfitrión con correo) ----------
  if (accion === "aprobar") {
    if (visita.estado_aprobacion !== "pendiente") return json({ error: "Esta visita no está pendiente de aprobación." }, 409);
    if (anfConCorreo) return json({ error: "Esta visita la aprueba su anfitrión. Si ya lo confirmaste, usa “Autorizar entrada”." }, 409);
    if (bloqueo === "bloqueado" || bloqueo === "restringido") {
      return json({ error: "Este visitante requiere la aprobación de un anfitrión; Recepción no puede aprobarlo." }, 409);
    }
    const { error } = await db.from("visitantes").update({
      estado_aprobacion: "aprobada", aprobacion_por: "recepcion", aprobacion_usuario: yo.id, aprobacion_at: ahora.toISOString(),
    }).eq("id", visita.id).eq("estado_aprobacion", "pendiente");
    if (error) return json({ error: "No se pudo aprobar la visita." }, 500);
    return json({ ok: true, accion: "aprobar" });
  }

  // ---------- llegada / autorizar ----------
  if (visita.llegada_at) return json({ error: `La llegada ya se registró a las ${formatoHora(visita.llegada_at)}.` }, 409);

  const problemas: Problema[] = [];
  if (p?.h && p.h !== (await huellaPase(visita))) {
    problemas.push({ motivo: "no_coincide", autorizable: false, detalle: "Los datos o el horario cambiaron después de emitir el pase. Verifica la identidad y pide un nuevo registro." });
  }
  if (bloqueo === "bloqueado") {
    problemas.push({ motivo: "bloqueado", autorizable: false, detalle: visita.personas?.bloqueo_motivo ?? "El visitante está bloqueado." });
  }
  if (visita.estado_aprobacion === "rechazada") {
    problemas.push({ motivo: "rechazada_anfitrion", autorizable: false, detalle: "El anfitrión no autorizó esta visita." });
  } else if (visita.estado_aprobacion === "pendiente") {
    if (bloqueo === "restringido") {
      problemas.push({ motivo: "restringido", autorizable: false, detalle: "Este visitante solo puede entrar con la aprobación de su anfitrión." });
    } else if (anfConCorreo) {
      problemas.push({ motivo: "pendiente_aprobacion", autorizable: true,
        detalle: `${visita.anfitriones.nombre} aún no aprueba la visita. Confírmalo con el anfitrión antes de autorizar.` });
    } else {
      problemas.push({ motivo: "pendiente_aprobacion", autorizable: false, aprobable: true,
        detalle: "La visita no tiene anfitrión: valida al visitante con el botón “Aprobar visita”." });
    }
  }
  const { data: cfg } = await db.from("configuracion").select("tolerancia_min, minutos_anticipacion, avisar_anfitrion").eq("id", 1).maybeSingle();
  const ev = evaluarLlegada(visita, ahora, { anticipacion: cfg?.minutos_anticipacion ?? 10, tolerancia: cfg?.tolerancia_min ?? 15 });
  if (!ev.permitido) problemas.push({ motivo: ev.motivo!, autorizable: Boolean(ev.autorizable), detalle: ev.detalle! });

  const noAutorizables = problemas.filter((x) => !x.autorizable);
  const motivoAut = String(p?.motivo ?? "").trim();

  if (problemas.length && !(accion === "autorizar" && !noAutorizables.length)) {
    await Promise.all(problemas.map((x) => registrarIntento(x, "rechazado")));
    const principal = noAutorizables[0] ?? problemas[0];
    const sugerencia = ["fecha_no_asignada", "caducado", "no_coincide"].includes(principal.motivo)
      ? "Sugiere al visitante hacer un nuevo registro con la fecha y el horario correctos."
      : principal.motivo === "pendiente_aprobacion" && principal.aprobable
        ? "Aprueba la visita y vuelve a registrar la llegada."
        : !noAutorizables.length ? "Puedes autorizar la entrada indicando el motivo, o pedir un nuevo registro." : "No se puede autorizar la entrada.";
    return json({
      error: "ACCESO NO PERMITIDO", codigo: principal.motivo, motivo: TEXTOS[principal.motivo],
      problemas: problemas.map((x) => ({ codigo: x.motivo, motivo: TEXTOS[x.motivo], detalle: x.detalle })),
      autorizable: !noAutorizables.length, aprobable: Boolean(principal.aprobable), sugerencia,
    }, 409);
  }

  if (accion === "autorizar" && problemas.length && motivoAut.length < 5) {
    return json({ error: "Escribe el motivo de la autorización (mínimo 5 caracteres)." }, 422);
  }

  const fueraHorario = problemas.some((x) => x.motivo === "anticipado" || x.motivo === "tarde");
  const cambios: Record<string, unknown> = { llegada_at: ahora.toISOString(), llegada_por: yo.id };
  if (problemas.length) {
    cambios.entrada_fuera_horario = fueraHorario;
    cambios.autorizacion_motivo = motivoAut;
    cambios.autorizado_por = yo.id;
    if (fueraHorario === false) cambios.entrada_fuera_horario = false;
    if (visita.estado_aprobacion === "pendiente") {
      Object.assign(cambios, { estado_aprobacion: "aprobada", aprobacion_por: "recepcion", aprobacion_usuario: yo.id, aprobacion_at: ahora.toISOString() });
    }
  }
  // La regla de la base exige motivo solo si es fuera de horario; si solo era aprobación, se guarda igual
  const { error } = await db.from("visitantes").update(cambios).eq("id", visita.id).is("llegada_at", null);
  if (error) return json({ error: "No se pudo registrar la llegada." }, 500);
  if (problemas.length) await Promise.all(problemas.map((x) => registrarIntento(x, "autorizado", motivoAut)));

  // Aviso al anfitrión
  let anfitrionAvisado = false;
  if (cfg?.avisar_anfitrion !== false && anfConCorreo) {
    try {
      await enviarCorreo({
        para: [visita.anfitriones.correo],
        asunto: `Tu visita llegó: ${visita.nombre_completo} (${visita.empresa})`,
        html: plantilla({
          titulo: "Aviso de recepción", logo: await logoCorreo(db),
          cuerpo: `<p style="margin:0 0 12px;font-size:16px">Hola ${escapar(visita.anfitriones.nombre.split(" ")[0])}, <b>${escapar(visita.nombre_completo)}</b> de <b>${escapar(visita.empresa)}</b> ya está en recepción.</p>
            <p style="margin:0;color:#5B6B7F">Llegada: ${formatoHora(ahora.toISOString())} h. Motivo: ${escapar(visita.motivo)}.<br>
            Horario registrado: ${formatoFecha(visita.entrada)}, ${formatoHora(visita.entrada)} a ${formatoHora(visita.salida)} h. Folio ${escapar(visita.folio)}.</p>
            ${problemas.length ? `<p style="margin:12px 0 0;padding:10px 12px;background:#FFF6DB;border-radius:8px">Entrada autorizada por Recepción: ${escapar(motivoAut)}</p>` : ""}`,
        }),
      });
      anfitrionAvisado = true;
      await db.from("visitantes").update({ anfitrion_avisado_at: new Date().toISOString() }).eq("id", visita.id);
    } catch (e) {
      console.error("aviso al anfitrión", e);
    }
  }
  return json({ ok: true, accion: "llegada", llegada_at: ahora.toISOString(), anfitrion_avisado: anfitrionAvisado, autorizada: problemas.length > 0 });
});
