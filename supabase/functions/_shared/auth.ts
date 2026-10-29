import type { SupabaseClient } from "npm:@supabase/supabase-js@2.45.4";

export interface Perfil {
  id: string;
  email: string;
  nombre: string;
  rol: "admin" | "consulta";
  activo: boolean;
}

/**
 * Identifica al usuario a partir del token de sesión (Authorization: Bearer ...)
 * y devuelve su perfil solo si está activo. Si no, devuelve null.
 */
export async function usuarioActivo(req: Request, admin: SupabaseClient): Promise<Perfil | null> {
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) return null;
  const { data: perfil } = await admin
    .from("perfiles")
    .select("id, email, nombre, rol, activo")
    .eq("id", data.user.id)
    .maybeSingle();
  return perfil && perfil.activo ? (perfil as Perfil) : null;
}
