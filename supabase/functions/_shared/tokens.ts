/** SHA-256 en hexadecimal (para guardar códigos y tokens sin el valor real). */
export async function sha256Hex(texto: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(texto));
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, "0")).join("");
}
/** Token aleatorio de 32 bytes en hexadecimal (64 caracteres). */
export const tokenAleatorio = () => Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, "0")).join("");
/** Código numérico de 6 dígitos, uniforme. */
export function codigo6(): string {
  const n = crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000;
  return String(n).padStart(6, "0");
}
export const TOKEN_RE = /^[a-f0-9]{64}$/;
