// =====================================================================
// Edge Function: admin-usuarios (solo administradores)
// Acciones: listar | crear | actualizar
// El primer admin se crea con supabase/crear-admin.sql; los demás, aquí.
// =====================================================================
import { json, leerJson, prepararPeticion } from "../_shared/http.ts";
import { clienteServicio } from "../_shared/supabase.ts";
import { usuarioActivo } from "../_shared/auth.ts";
import { EMAIL_RE } from "../_shared/correo.ts";

interface Peticion {
  accion?: "listar" | "crear" | "actualizar";
  id?: string;
  email?: string;
  nombre?: string;
  rol?: "admin" | "consulta";
  activo?: boolean;
  restablecer_password?: boolean;
}

const ROLES = ["admin", "consulta"];

/** Contraseña temporal legible de 14 caracteres (sin caracteres ambiguos). */
function passwordTemporal(): string {
  const abc = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(14));
  return Array.from(bytes, (b) => abc[b % abc.length]).join("");
}

Deno.serve(async (req) => {
  const previo = prepararPeticion(req);
  if (previo) return previo;

  const db = clienteServicio();
  const yo = await usuarioActivo(req, db);
  if (!yo) return json({ error: "Inicia sesión para continuar." }, 401);
  if (yo.rol !== "admin") return json({ error: "Solo un administrador puede gestionar usuarios." }, 403);

  const p = await leerJson<Peticion>(req);
  if (!p?.accion) return json({ error: "Falta la acción." }, 400);

  // ---------- listar ----------
  if (p.accion === "listar") {
    const { data, error } = await db
      .from("perfiles")
      .select("id, email, nombre, rol, activo, created_at")
      .order("created_at", { ascending: true });
    if (error) return json({ error: "No se pudo leer la lista de usuarios." }, 500);
    return json({ usuarios: data });
  }

  // ---------- crear ----------
  if (p.accion === "crear") {
    const email = String(p.email ?? "").trim().toLowerCase();
    const nombre = String(p.nombre ?? "").trim().replace(/\s+/g, " ");
    const rol = p.rol ?? "consulta";
    if (!EMAIL_RE.test(email)) return json({ error: "Correo inválido." }, 422);
    if (nombre.length < 3) return json({ error: "Escribe el nombre completo." }, 422);
    if (!ROLES.includes(rol)) return json({ error: "Rol inválido." }, 422);

    const password = passwordTemporal();
    const { data: creado, error } = await db.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { nombre },
    });
    if (error || !creado.user) {
      const existe = /already|registered|exists/i.test(error?.message ?? "");
      return json({ error: existe ? "Ya existe un usuario con ese correo." : "No se pudo crear el usuario." }, existe ? 409 : 500);
    }
    const { error: errPerfil } = await db.from("perfiles").insert({ id: creado.user.id, email, nombre, rol, activo: true });
    if (errPerfil) {
      await db.auth.admin.deleteUser(creado.user.id); // deshacer para no dejar usuarios sin perfil
      return json({ error: "No se pudo guardar el perfil." }, 500);
    }
    return json({ ok: true, usuario: { id: creado.user.id, email, nombre, rol, activo: true }, password_temporal: password }, 201);
  }

  // ---------- actualizar ----------
  if (p.accion === "actualizar") {
    if (!p.id) return json({ error: "Falta el usuario." }, 400);
    const esYo = p.id === yo.id;
    if (esYo && (p.activo === false || (p.rol && p.rol !== "admin"))) {
      return json({ error: "No puedes quitarte el rol de administrador ni desactivarte." }, 422);
    }
    const cambios: Record<string, unknown> = {};
    if (p.rol !== undefined) {
      if (!ROLES.includes(p.rol)) return json({ error: "Rol inválido." }, 422);
      cambios.rol = p.rol;
    }
    if (p.activo !== undefined) cambios.activo = Boolean(p.activo);
    if (p.nombre) cambios.nombre = String(p.nombre).trim();

    if (Object.keys(cambios).length) {
      const { error } = await db.from("perfiles").update(cambios).eq("id", p.id);
      if (error) return json({ error: "No se pudo actualizar el perfil." }, 500);
    }

    // Un usuario desactivado tampoco puede iniciar sesión
    const authCambios: Record<string, unknown> = {};
    if (p.activo !== undefined) authCambios.ban_duration = p.activo ? "none" : "876000h";
    let password: string | undefined;
    if (p.restablecer_password) {
      password = passwordTemporal();
      authCambios.password = password;
    }
    if (Object.keys(authCambios).length) {
      const { error } = await db.auth.admin.updateUserById(p.id, authCambios);
      if (error) return json({ error: "Se actualizó el perfil, pero no la cuenta de acceso." }, 500);
    }
    return json({ ok: true, password_temporal: password });
  }

  return json({ error: "Acción desconocida." }, 400);
});
