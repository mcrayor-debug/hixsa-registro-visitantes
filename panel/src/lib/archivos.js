import { supabase } from './supabase.js';

const TIPOS = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };

/** Sube una imagen (PNG, JPG o WebP) a un bucket y devuelve su ruta. */
export async function subirImagen(bucket, carpeta, archivo, maxBytes) {
  const ext = TIPOS[archivo?.type];
  if (!ext) throw new Error('La imagen debe ser PNG, JPG o WebP.');
  if (archivo.size > maxBytes) throw new Error(`La imagen pesa demasiado (máximo ${Math.round(maxBytes / 1024)} KB).`);
  const ruta = `${carpeta}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from(bucket).upload(ruta, archivo, { contentType: archivo.type, upsert: false });
  if (error) throw new Error('No se pudo subir la imagen.');
  return ruta;
}

export const urlPublica = (bucket, ruta) => supabase.storage.from(bucket).getPublicUrl(ruta).data.publicUrl;

/** Convierte errores de PostgREST en mensajes legibles. */
export function mensajeError(error, porDefecto = 'No se pudo guardar.') {
  if (!error) return '';
  if (error.code === '23505') return 'Ya existe un registro con ese nombre.';
  if (error.code === '23503') return 'Está en uso por otros registros; desactívalo en lugar de eliminarlo.';
  if (error.code === '23514') return 'Algún dato no tiene el formato esperado.';
  if (error.code === '42501') return 'Tu rol no tiene permiso para esta acción.';
  return porDefecto;
}
