import type { SupabaseClient } from "npm:@supabase/supabase-js@2.45.4";

export interface Rol {
  id: string;
  nombre: string;
  secciones: string[];
  alcance: "hoy" | "semana" | "sin_limite";
  puede_exportar: boolean;
}

export interface Perfil {
  id: string;
  email: string;
  nombre: string;
  rol: string;
  activo: boolean;
  roles: Rol;
}

/**
 * Identifica al usuario a partir del token de sesión (Authorization: Bearer ...)
 * y devuelve su perfil con su rol, solo si está activo. Si no, devuelve null.
 */
export async function usuarioActivo(req: Request, admin: SupabaseClient): Promise<Perfil | null> {
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) return null;
  const { data: perfil } = await admin
    .from("perfiles")
    .select("id, email, nombre, rol, activo, roles(id, nombre, secciones, alcance, puede_exportar)")
    .eq("id", data.user.id)
    .maybeSingle();
  return perfil && perfil.activo ? (perfil as unknown as Perfil) : null;
}

export const esSuperadmin = (p: Perfil) => p.rol === "superadmin";

/** El SUPERADMIN tiene todos los permisos; los demás, los de su rol. */
export const tienePermiso = (p: Perfil, seccion: string) =>
  esSuperadmin(p) || (p.roles?.secciones ?? []).includes(seccion);

/** Rango de fechas (YYYY-MM-DD, hora de CDMX) que el rol puede consultar; null = sin límite. */
export function rangoDelAlcance(p: Perfil): { desde: string; hasta: string } | null {
  const alcance = esSuperadmin(p) ? "sin_limite" : p.roles?.alcance ?? "hoy";
  if (alcance === "sin_limite") return null;
  const dia = (desfase: number) =>
    new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City", year: "numeric", month: "2-digit", day: "2-digit" })
      .format(new Date(Date.now() + desfase * 864e5));
  return alcance === "semana" ? { desde: dia(-6), hasta: dia(7) } : { desde: dia(0), hasta: dia(0) };
}

/** Configuración de auditoría: si está activa, solo se ve la empresa principal. */
export async function filtroAuditoria(admin: SupabaseClient): Promise<string | null> {
  const { data: cfg } = await admin.from("configuracion").select("modo_auditoria").eq("id", 1).maybeSingle();
  if (!cfg?.modo_auditoria) return null;
  const { data: e } = await admin.from("empresas").select("id").eq("es_principal", true).maybeSingle();
  return e?.id ?? null;
}

/** Registra en la bitácora un cambio hecho por una Edge Function, con su autor. */
export async function registrarCambio(
  admin: SupabaseClient, autor: Perfil, tabla: string, accion: "alta" | "edicion" | "baja",
  registroId: string, antes: unknown, despues: unknown,
) {
  await admin.from("bitacora_cambios").insert({
    usuario_id: autor.id, usuario_email: autor.email, tabla, accion, registro_id: registroId,
    antes: antes ?? null, despues: despues ?? null,
  });
}
