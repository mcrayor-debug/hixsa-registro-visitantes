import { createClient } from '@supabase/supabase-js';
import { OFFSET } from './formato.js';

const cfg = window.HIXSA_CONFIG ?? {};
export const configurado = Boolean(cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY);
export const supabase = configurado ? createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY) : null;

/** Llama a una Edge Function y convierte sus errores en mensajes legibles. */
export async function invocar(nombre, body) {
  const { data, error } = await supabase.functions.invoke(nombre, { body });
  if (error) {
    let msg = null;
    try { msg = (await error.context.json()).error; } catch { /* sin cuerpo */ }
    throw new Error(msg ?? 'No se pudo completar la acción. Intenta de nuevo.');
  }
  return data;
}

export const CAMPOS_VISITA = 'id, folio, nombre_completo, empresa, correo, telefono, persona_visita, anfitrion_id, motivo, comentarios, '
  + 'entrada, salida, llegada_at, salida_real_at, anfitrion_avisado_at, tipo_identificacion, identificacion_detalle, '
  + 'identificacion_path, qr_enviado_at, correo_error, nombre, apellidos, empresa_visita_id, empresas(nombre)';

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
