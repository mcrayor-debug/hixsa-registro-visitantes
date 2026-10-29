// =====================================================================
// Edge Function: enviar-reporte (usuarios internos activos)
// Aplica los filtros del panel, arma un CSV y lo envía por correo.
// Cada envío queda registrado en bitacora_reportes.
// =====================================================================
import { json, leerJson, prepararPeticion } from "../_shared/http.ts";
import { clienteServicio } from "../_shared/supabase.ts";
import { usuarioActivo } from "../_shared/auth.ts";
import { EMAIL_RE, enviarCorreo, escapar } from "../_shared/correo.ts";
import { aplicarFiltros, type Filtros } from "../_shared/filtros.ts";
import { formatoFechaHora } from "../_shared/formato.ts";

const MAX_FILAS = 5000;

const COLUMNAS: [string, string][] = [
  ["folio", "Folio"], ["nombre_completo", "Nombre"], ["empresa", "Empresa"], ["correo", "Correo"],
  ["telefono", "Teléfono"], ["persona_visita", "Visita a"], ["motivo", "Motivo"],
  ["entrada", "Entrada"], ["salida", "Salida"], ["comentarios", "Comentarios"],
];

function aCsv(filas: Record<string, unknown>[]): string {
  const celda = (v: unknown) => {
    const s = String(v ?? "");
    // Evita fórmulas al abrir en Excel (inyección CSV) y escapa comillas
    const seguro = /^[=+\-@]/.test(s) ? `'${s}` : s;
    return `"${seguro.replace(/"/g, '""')}"`;
  };
  const encabezado = COLUMNAS.map(([, t]) => celda(t)).join(",");
  const cuerpo = filas.map((f) =>
    COLUMNAS.map(([k]) => celda(k === "entrada" || k === "salida" ? formatoFechaHora(String(f[k])) : f[k])).join(",")
  );
  return "\uFEFF" + [encabezado, ...cuerpo].join("\r\n");
}

function base64Utf8(texto: string): string {
  const bytes = new TextEncoder().encode(texto);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

Deno.serve(async (req) => {
  const previo = prepararPeticion(req);
  if (previo) return previo;

  const db = clienteServicio();
  const yo = await usuarioActivo(req, db);
  if (!yo) return json({ error: "Inicia sesión para continuar." }, 401);

  const p = await leerJson<{ filtros?: Filtros; destinatarios?: string[] }>(req);
  const filtros = p?.filtros ?? {};
  const destinatarios = [...new Set((p?.destinatarios ?? []).map((d) => String(d).trim().toLowerCase()).filter(Boolean))];
  if (!destinatarios.length) return json({ error: "Agrega al menos un destinatario." }, 422);
  if (destinatarios.length > 10) return json({ error: "Máximo 10 destinatarios por envío." }, 422);
  const invalidos = destinatarios.filter((d) => !EMAIL_RE.test(d));
  if (invalidos.length) return json({ error: `Correo inválido: ${invalidos.join(", ")}` }, 422);

  let q = db.from("visitantes").select(COLUMNAS.map(([k]) => k).join(", "));
  q = aplicarFiltros(q, filtros).order("entrada", { ascending: true }).limit(MAX_FILAS);
  const { data, error } = await q;
  if (error) {
    console.error(error);
    return json({ error: "No se pudo consultar la información." }, 500);
  }
  const filas = (data ?? []) as unknown as Record<string, unknown>[];

  // Resumen para el cuerpo del correo
  const porMotivo = new Map<string, number>();
  const porEmpresa = new Map<string, number>();
  for (const f of filas) {
    porMotivo.set(String(f.motivo), (porMotivo.get(String(f.motivo)) ?? 0) + 1);
    porEmpresa.set(String(f.empresa), (porEmpresa.get(String(f.empresa)) ?? 0) + 1);
  }
  const top = (m: Map<string, number>, n: number) =>
    [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n)
      .map(([k, v]) => `<li>${escapar(k)}: <b>${v}</b></li>`).join("");
  const rango = `${filtros.desde ?? "inicio"} a ${filtros.hasta ?? "hoy"}`;

  const html = `<div style="font-family:Arial,Helvetica,sans-serif;color:#1C2A3A;max-width:600px">
  <h2 style="color:#12365F;margin:0 0 8px">Reporte de visitas HIXSA</h2>
  <p style="margin:0 0 16px;color:#5B6B7F">Periodo: ${escapar(rango)}. Generado por ${escapar(yo.nombre)}.</p>
  <p style="font-size:16px"><b>${filas.length}</b> visitas en el periodo.</p>
  <h3 style="color:#12365F;font-size:15px">Por motivo</h3><ul>${top(porMotivo, 10) || "<li>Sin datos</li>"}</ul>
  <h3 style="color:#12365F;font-size:15px">Empresas con más visitas</h3><ul>${top(porEmpresa, 5) || "<li>Sin datos</li>"}</ul>
  <p style="color:#5B6B7F;font-size:13px">El detalle completo va en el archivo CSV adjunto (se abre con Excel).</p>
</div>`;

  try {
    await enviarCorreo({
      para: destinatarios,
      asunto: `Reporte de visitas HIXSA (${rango})`,
      html,
      adjuntos: [{
        filename: `visitas_${filtros.desde ?? "inicio"}_${filtros.hasta ?? "hoy"}.csv`,
        content: base64Utf8(aCsv(filas)),
        content_type: "text/csv",
      }],
    });
  } catch (e) {
    console.error(e);
    return json({ error: "No se pudo enviar el correo. Revisa la configuración de Resend." }, 502);
  }

  await db.from("bitacora_reportes").insert({
    origen: "panel",
    enviado_por: yo.id,
    destinatarios,
    filtros,
    total_registros: filas.length,
  });

  return json({ ok: true, total: filas.length, destinatarios });
});
