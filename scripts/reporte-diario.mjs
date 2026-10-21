#!/usr/bin/env node
// =====================================================================
// HIXSA - Reporte diario de visitas (área: Recepción y Seguridad)
//
// Corre sin intervención manual (GitHub Actions, lunes a viernes 07:00 CDMX):
//   1. Lee de Supabase (API REST) las visitas del día anterior y la agenda de hoy.
//   2. Calcula indicadores (por motivo, empresa, hora, pases sin enviar, etc.).
//   3. Pide a la API de Claude un resumen ejecutivo y alertas.
//      Solo se envían cifras agregadas; ningún dato personal sale hacia la IA.
//   4. Envía el reporte por correo (Resend) y lo registra en bitacora_reportes.
//
// Uso:
//   node scripts/reporte-diario.mjs                 # día anterior, envía correo
//   node scripts/reporte-diario.mjs --fecha=2026-10-20
//   node scripts/reporte-diario.mjs --dry-run       # no envía ni registra; guarda HTML
//   node scripts/reporte-diario.mjs --demo          # datos de ejemplo, sin Supabase
// =====================================================================
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const TZ = 'America/Mexico_City';
const OFFSET = '-06:00';

// ---------- Configuración ----------
cargarEnv(join(RAIZ, '.env'));
const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, v] = a.replace(/^--/, '').split('=');
  return [k, v ?? true];
}));
const DEMO = Boolean(args.demo);
const DRY = Boolean(args['dry-run']) || DEMO;
const env = process.env;
const MODELO = env.CLAUDE_MODEL || 'claude-haiku-5-5';

function cargarEnv(ruta) {
  if (!existsSync(ruta)) return;
  for (const linea of readFileSync(ruta, 'utf8').split(/\r?\n/)) {
    const m = linea.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

function requerir(...nombres) {
  const faltan = nombres.filter((n) => !env[n]);
  if (faltan.length) {
    console.error(`✖ Faltan variables de entorno: ${faltan.join(', ')}`);
    process.exit(1);
  }
}

// ---------- Fechas ----------
const ymd = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
const hora = (iso) => new Intl.DateTimeFormat('es-MX', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso));
const horaNum = (iso) => Number(new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: '2-digit', hour12: false }).format(new Date(iso))) % 24;
const fechaLarga = (s) => new Intl.DateTimeFormat('es-MX', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long' })
  .format(new Date(`${s}T12:00:00${OFFSET}`));

const hoy = ymd(new Date());
const dia = typeof args.fecha === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(args.fecha)
  ? args.fecha
  : ymd(new Date(Date.now() - 864e5));

// ---------- Supabase (API REST con service_role) ----------
async function supabase(ruta, opciones = {}) {
  const res = await fetch(`${env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/${ruta}`, {
    ...opciones,
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      // Las llaves legacy (JWT, empiezan con eyJ) también van en Authorization; las nuevas sb_secret_ solo en apikey.
      ...(env.SUPABASE_SERVICE_ROLE_KEY.startsWith('eyJ') ? { Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` } : {}),
      'Content-Type': 'application/json',
      ...(opciones.headers ?? {}),
    },
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.status === 204 || opciones.method === 'POST' ? null : res.json();
}

const CAMPOS = 'folio,nombre_completo,empresa,persona_visita,motivo,entrada,salida,qr_enviado_at,correo_error';
const rango = (d) => `entrada=gte.${encodeURIComponent(`${d}T00:00:00${OFFSET}`)}&entrada=lte.${encodeURIComponent(`${d}T23:59:59.999${OFFSET}`)}`;

async function obtenerDatos() {
  if (DEMO) return datosDemo();
  const [ayer, agenda, config] = await Promise.all([
    supabase(`visitantes?select=${CAMPOS}&${rango(dia)}&order=entrada.asc`),
    supabase(`visitantes?select=${CAMPOS}&${rango(hoy)}&order=entrada.asc`),
    supabase('configuracion?select=destinatarios_reporte&id=eq.1'),
  ]);
  return { ayer, agenda, destinatarios: config?.[0]?.destinatarios_reporte ?? [] };
}

// ---------- Indicadores ----------
function contar(lista, clave) {
  const m = new Map();
  lista.forEach((x) => m.set(clave(x), (m.get(clave(x)) ?? 0) + 1));
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}

function indicadores(ayer, agenda) {
  const duraciones = ayer.map((v) => (new Date(v.salida) - new Date(v.entrada)) / 36e5);
  const porHora = contar(ayer, (v) => horaNum(v.entrada));
  return {
    fecha_analizada: dia,
    total_visitas: ayer.length,
    empresas_distintas: new Set(ayer.map((v) => v.empresa.toLowerCase())).size,
    por_motivo: Object.fromEntries(contar(ayer, (v) => v.motivo)),
    top_empresas: contar(ayer, (v) => v.empresa).slice(0, 5).map(([empresa, visitas]) => ({ empresa, visitas })),
    top_anfitriones: contar(ayer, (v) => v.persona_visita).slice(0, 5).map(([anfitrion, visitas]) => ({ anfitrion, visitas })),
    hora_pico: porHora[0] ? { hora: `${String(porHora[0][0]).padStart(2, '0')}:00`, visitas: porHora[0][1] } : null,
    duracion_promedio_horas: duraciones.length ? +(duraciones.reduce((a, b) => a + b, 0) / duraciones.length).toFixed(1) : 0,
    visitas_mayores_8h: duraciones.filter((h) => h > 8).length,
    pases_con_error_de_envio: ayer.filter((v) => v.correo_error).length,
    visitas_programadas_hoy: agenda.length,
    entregas_programadas_hoy: agenda.filter((v) => v.motivo === 'Entrega o paquetería').length,
  };
}

// ---------- Claude API ----------
async function resumenConClaude(kpi) {
  if (!env.ANTHROPIC_API_KEY) return resumenBasico(kpi, 'Sin ANTHROPIC_API_KEY: resumen generado sin IA.');
  const sistema = 'Eres analista de operaciones de la recepción corporativa de HIXSA (Torre Mitikah, CDMX). ' +
    'Recibes indicadores agregados de visitas. Escribe en español de México, tono ejecutivo y directo, sin inventar datos. ' +
    'Responde SOLO con JSON válido, sin texto adicional ni bloques de código, con esta forma: ' +
    '{"resumen": "3 a 4 oraciones", "alertas": ["máximo 3 alertas accionables; lista vacía si no hay"], ' +
    '"recomendacion": "una acción concreta para recepción hoy"}';
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: MODELO,
        max_tokens: 700,
        system: sistema,
        messages: [{ role: 'user', content: `Indicadores:\n${JSON.stringify(kpi, null, 2)}` }],
      }),
    });
    if (!res.ok) throw new Error(`Claude API ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = await res.json();
    const texto = data.content.filter((b) => b.type === 'text').map((b) => b.text).join('').replace(/```json|```/g, '').trim();
    const r = JSON.parse(texto);
    return { resumen: String(r.resumen ?? ''), alertas: (r.alertas ?? []).map(String).slice(0, 3), recomendacion: String(r.recomendacion ?? ''), fuente: `Claude (${MODELO})` };
  } catch (e) {
    console.warn(`⚠ No se pudo usar Claude: ${e.message}. Se usa el resumen básico.`);
    return resumenBasico(kpi, 'Resumen generado sin IA por un error temporal.');
  }
}

function resumenBasico(k, nota) {
  const alertas = [];
  if (k.pases_con_error_de_envio) alertas.push(`${k.pases_con_error_de_envio} pases no se pudieron enviar por correo.`);
  if (k.visitas_mayores_8h) alertas.push(`${k.visitas_mayores_8h} visitas duraron más de 8 horas.`);
  return {
    resumen: `El ${fechaLarga(k.fecha_analizada)} hubo ${k.total_visitas} visitas de ${k.empresas_distintas} empresas. ` +
      (k.hora_pico ? `La hora pico fue a las ${k.hora_pico.hora}. ` : '') +
      `Hoy hay ${k.visitas_programadas_hoy} visitas programadas.`,
    alertas,
    recomendacion: k.entregas_programadas_hoy ? `Prever espacio para ${k.entregas_programadas_hoy} entregas programadas hoy.` : '',
    fuente: nota,
  };
}

// ---------- Correo ----------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function html(kpi, ia, agenda) {
  const kpiCelda = (n, t) => `<td style="padding:12px;background:#F4F7FA;border-radius:8px;text-align:center">
    <div style="font-size:26px;font-weight:700;color:#12365F">${n}</div><div style="font-size:12px;color:#5B6B7F">${t}</div></td>`;
  const filasAgenda = agenda.map((v) => `<tr>
    <td style="padding:8px;border-bottom:1px solid #EDF1F5;white-space:nowrap">${hora(v.entrada)} a ${hora(v.salida)}</td>
    <td style="padding:8px;border-bottom:1px solid #EDF1F5"><b>${esc(v.nombre_completo)}</b><br><span style="color:#5B6B7F">${esc(v.empresa)}</span></td>
    <td style="padding:8px;border-bottom:1px solid #EDF1F5">${esc(v.persona_visita)}</td>
    <td style="padding:8px;border-bottom:1px solid #EDF1F5">${esc(v.motivo)}</td></tr>`).join('');
  return `<!doctype html><html lang="es"><body style="margin:0;background:#F4F7FA;font-family:Arial,Helvetica,sans-serif;color:#1C2A3A">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:680px;background:#fff;border:1px solid #D3DCE6;border-radius:12px;overflow:hidden">
<tr><td style="background:#12365F;color:#fff;padding:22px 28px">
  <div style="font-size:20px;font-weight:800;letter-spacing:2px">HIXSA</div>
  <div style="font-size:15px;color:#CFE3F2;margin-top:4px">Reporte diario de visitas: ${esc(fechaLarga(dia))}</div>
</td></tr>
<tr><td style="padding:24px 28px">
  <h2 style="margin:0 0 8px;font-size:17px;color:#12365F">Resumen</h2>
  <p style="margin:0 0 16px;line-height:1.55">${esc(ia.resumen)}</p>
  <table role="presentation" width="100%" cellspacing="8" style="margin:0 -8px 8px"><tr>
    ${kpiCelda(kpi.total_visitas, 'visitas')}${kpiCelda(kpi.empresas_distintas, 'empresas')}
    ${kpiCelda(kpi.hora_pico?.hora ?? '—', 'hora pico')}${kpiCelda(kpi.visitas_programadas_hoy, 'programadas hoy')}
  </tr></table>
  ${ia.alertas.length ? `<h2 style="margin:16px 0 8px;font-size:17px;color:#12365F">Alertas</h2><ul style="margin:0;padding-left:20px;line-height:1.6">${ia.alertas.map((a) => `<li>${esc(a)}</li>`).join('')}</ul>` : ''}
  ${ia.recomendacion ? `<p style="margin:16px 0;padding:12px 14px;background:#E6F4FA;border-radius:8px"><b>Para hoy:</b> ${esc(ia.recomendacion)}</p>` : ''}
  <h2 style="margin:20px 0 8px;font-size:17px;color:#12365F">Agenda de hoy (${agenda.length})</h2>
  ${agenda.length ? `<table width="100%" cellpadding="0" cellspacing="0" style="font-size:13px;border-collapse:collapse">
    <tr style="color:#5B6B7F;text-align:left"><th style="padding:8px">Horario</th><th style="padding:8px">Visitante</th><th style="padding:8px">Visita a</th><th style="padding:8px">Motivo</th></tr>
    ${filasAgenda}</table>` : '<p style="color:#5B6B7F">No hay visitas programadas para hoy.</p>'}
</td></tr>
<tr><td style="padding:14px 28px;background:#F4F7FA;font-size:12px;color:#5B6B7F">
  Generado automáticamente. Análisis: ${esc(ia.fuente)}. A la IA solo se envían cifras agregadas, sin datos personales.
</td></tr></table></td></tr></table></body></html>`;
}

async function enviarCorreo(para, asunto, cuerpo) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: env.EMAIL_FROM || 'HIXSA Recepción <onboarding@resend.dev>', to: para, subject: asunto, html: cuerpo }),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

// ---------- Datos de ejemplo (--demo) ----------
function datosDemo() {
  const v = (d, h1, h2, nombre, empresa, persona, motivo, error = null) => ({
    folio: `HX-DEMO-${Math.random().toString(16).slice(2, 7).toUpperCase()}`, nombre_completo: nombre, empresa, persona_visita: persona,
    motivo, entrada: `${d}T${h1}:00${OFFSET}`, salida: `${d}T${h2}:00${OFFSET}`, qr_enviado_at: error ? null : 'x', correo_error: error,
  });
  return {
    destinatarios: ['direccion@hixsa.com'],
    ayer: [
      v(dia, '09:00', '10:30', 'Ana López', 'Grupo Norte', 'Carlos Méndez', 'Reunión'),
      v(dia, '10:00', '11:00', 'Luis Hernández', 'Logística MX', 'Recepción', 'Entrega o paquetería'),
      v(dia, '10:15', '12:00', 'Sofía Ruiz', 'Grupo Norte', 'Carlos Méndez', 'Reunión'),
      v(dia, '10:30', '19:30', 'Jorge Ramírez', 'SecureNet', 'Ing. Patricia Gómez', 'Proveedor o servicio'),
      v(dia, '12:00', '13:00', 'Mariana Torres', 'Particular', 'Recursos Humanos', 'Entrevista', 'Resend 422'),
      v(dia, '16:00', '17:00', 'Raúl Díaz', 'Banco Central', 'Dirección Comercial', 'Reunión'),
    ],
    agenda: [
      v(hoy, '09:30', '10:30', 'Elena Castro', 'Aseguradora Sol', 'Dirección Comercial', 'Reunión'),
      v(hoy, '11:00', '11:30', 'Paquetería Express', 'DHL', 'Recepción', 'Entrega o paquetería'),
      v(hoy, '13:00', '14:00', 'Daniel Vega', 'Particular', 'Recursos Humanos', 'Entrevista'),
    ],
  };
}

// ---------- Principal ----------
async function main() {
  if (!DEMO) requerir('SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY');
  if (!DRY) requerir('RESEND_API_KEY');

  console.log(`▶ Reporte de visitas del ${dia}${DEMO ? ' (demo)' : ''}${DRY ? ' [sin envío]' : ''}`);
  const { ayer, agenda, destinatarios: cfgDest } = await obtenerDatos();
  const kpi = indicadores(ayer, agenda);
  console.log(`  ${kpi.total_visitas} visitas analizadas, ${kpi.visitas_programadas_hoy} programadas hoy.`);

  const ia = await resumenConClaude(kpi);
  console.log(`  Análisis: ${ia.fuente}`);
  const cuerpo = html(kpi, ia, agenda);

  const destinatarios = (env.REPORTE_DESTINATARIOS ? env.REPORTE_DESTINATARIOS.split(',') : cfgDest)
    .map((s) => s.trim()).filter(Boolean);

  if (DRY) {
    const dir = join(RAIZ, 'reportes');
    mkdirSync(dir, { recursive: true });
    const archivo = join(dir, `reporte-${dia}.html`);
    writeFileSync(archivo, cuerpo);
    console.log(`✔ Vista previa guardada en ${archivo}`);
    console.log(JSON.stringify({ kpi, ia, destinatarios }, null, 2));
    return;
  }

  if (!destinatarios.length) {
    console.error('✖ No hay destinatarios. Configúralos en el panel (Configuración > Correos) o en REPORTE_DESTINATARIOS.');
    process.exit(1);
  }
  await enviarCorreo(destinatarios, `Reporte diario de visitas HIXSA (${dia})`, cuerpo);
  await supabase('bitacora_reportes', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ origen: 'automatico', destinatarios, filtros: { desde: dia, hasta: dia }, total_registros: kpi.total_visitas }),
  });
  console.log(`✔ Reporte enviado a ${destinatarios.join(', ')}`);
}

main().catch((e) => {
  console.error(`✖ ${e.message}`);
  process.exit(1);
});
