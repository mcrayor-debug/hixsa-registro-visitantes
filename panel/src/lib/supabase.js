import { createClient } from '@supabase/supabase-js';
import { OFFSET } from './formato.js';

const cfg = window.HIXSA_CONFIG ?? {};
export const configurado = Boolean(cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY);
export const supabase = configurado ? createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY) : null;

/** Llama a una Edge Function y convierte sus errores en mensajes legibles. */
export async function invocar(nombre, body) {
  const { data, error } = await supabase.functions.invoke(nombre, { body });
  if (error) {
    let cuerpo = null;
    try { cuerpo = await error.context.json(); } catch { /* sin cuerpo */ }
    const err = new Error(cuerpo?.error ?? 'No se pudo completar la acción. Intenta de nuevo.');
    err.datos = cuerpo; // p. ej. ACCESO NO PERMITIDO con sus motivos
    throw err;
  }
  return data;
}

export const CAMPOS_VISITA = 'id, folio, nombre_completo, empresa, correo, telefono, persona_visita, anfitrion_id, motivo, comentarios, '
  + 'entrada, salida, llegada_at, salida_real_at, anfitrion_avisado_at, tipo_identificacion, identificacion_detalle, '
  + 'identificacion_path, qr_enviado_at, correo_error, nombre, apellidos, empresa_visita_id, empresas(nombre), '
  + 'sala_juntas, selfie_path, equipo_tipo, equipo_marca, equipo_serie, estado_aprobacion, aprobacion_por, aprobacion_at, '
  + 'entrada_fuera_horario, autorizacion_motivo, persona_id, origen, personas(estado_bloqueo, bloqueo_motivo, recurrente), anfitriones(nombre, correo)';

const limpiar = (s) => (s ?? '').replace(/[,()*%\\]/g, ' ').trim().slice(0, 80);

/** Consulta de visitas con los filtros del panel (la RLS limita a usuarios activos). */
export function consultaVisitas(f = {}, campos = CAMPOS_VISITA) {
  let q = supabase.from('visitantes').select(campos, { count: 'exact' });
  if (f.desde) q = q.gte('entrada', `${f.desde}T00:00:00${OFFSET}`);
  if (f.hasta) q = q.lte('entrada', `${f.hasta}T23:59:59.999${OFFSET}`);
  if (limpiar(f.empresa)) q = q.ilike('empresa', `%${limpiar(f.empresa)}%`);
  if (f.motivo) q = q.eq('motivo', f.motivo);
  if (f.empresa_visita_id) q = q.eq('empresa_visita_id', f.empresa_visita_id);
  const t = limpiar(f.texto);
  if (t) q = q.or(['nombre_completo', 'correo', 'folio', 'persona_visita'].map((c) => `${c}.ilike.%${t}%`).join(','));
  return q;
}
