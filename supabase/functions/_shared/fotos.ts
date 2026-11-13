// Validación y guardado de fotos (data URL) en el bucket privado "identificaciones".
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.45.4";

export interface Foto { bytes: Uint8Array; tipo: string; ext: string }
const MAX = 3 * 1024 * 1024;

/** null si no viene; texto si es inválida; Foto si es válida (se revisan los bytes reales). */
export function leerFoto(dataUrl: string | null | undefined): Foto | string | null {
  if (!dataUrl) return null;
  const m = String(dataUrl).match(/^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/);
  if (!m) return "La foto no es válida.";
  let bytes: Uint8Array;
  try { bytes = Uint8Array.from(atob(m[2]), (c) => c.charCodeAt(0)); } catch { return "La foto no se pudo leer."; }
  if (bytes.length > MAX) return "La foto pesa demasiado (máximo 3 MB).";
  const f = Array.from(bytes.slice(0, 12));
  if (f[0] === 0xff && f[1] === 0xd8 && f[2] === 0xff) return { bytes, tipo: "image/jpeg", ext: "jpg" };
  if (f[0] === 0x89 && f[1] === 0x50 && f[2] === 0x4e && f[3] === 0x47) return { bytes, tipo: "image/png", ext: "png" };
  if (String.fromCharCode(...f.slice(0, 4)) === "RIFF" && String.fromCharCode(...f.slice(8, 12)) === "WEBP") return { bytes, tipo: "image/webp", ext: "webp" };
  return "El archivo no es una imagen válida.";
}

export async function subirFoto(db: SupabaseClient, f: Foto, carpeta: string): Promise<string> {
  const ruta = `${carpeta}${new Date().toISOString().slice(0, 7)}/${crypto.randomUUID()}.${f.ext}`;
  const { error } = await db.storage.from("identificaciones").upload(ruta, f.bytes, { contentType: f.tipo, upsert: false });
  if (error) throw error;
  return ruta;
}
