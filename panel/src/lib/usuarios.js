import { supabase } from './supabase.js';
import { comprimirBlob } from './imagen.js';

// Fotos de usuarios del panel: bucket privado "usuarios", carpeta = id del usuario.
const cache = new Map();
export async function urlFotoUsuario(ruta) {
  if (!ruta) return null;
  const c = cache.get(ruta);
  if (c && c.vence > Date.now()) return c.url;
  const { data } = await supabase.storage.from('usuarios').createSignedUrl(ruta, 3600);
  if (data?.signedUrl) cache.set(ruta, { url: data.signedUrl, vence: Date.now() + 3300e3 });
  return data?.signedUrl ?? null;
}

/** Comprime (512 px, JPEG) y sube la foto; devuelve la ruta guardada. */
export async function subirFotoUsuario(idUsuario, archivo) {
  const blob = await comprimirBlob(archivo, 512, 0.85);
  const ruta = `${idUsuario}/${crypto.randomUUID()}.jpg`;
  const { error } = await supabase.storage.from('usuarios').upload(ruta, blob, { contentType: 'image/jpeg', upsert: false });
  if (error) throw new Error('No se pudo subir la foto.');
  return ruta;
}
export const quitarFotoUsuario = (ruta) => (ruta ? supabase.storage.from('usuarios').remove([ruta]) : null);
