// =====================================================================
// Edge Function: admin-usuarios (permiso config_usuarios)
// Acciones: listar | crear | actualizar | eliminar
// Reglas: solo el SUPERADMIN asigna el rol superadmin, modifica a otro SUPERADMIN
// o elimina usuarios. Nunca se puede quedar el sistema sin un SUPERADMIN activo.
// =====================================================================
import { json, leerJson, prepararPeticion } from "../_shared/http.ts";
import { clienteServicio } from "../_shared/supabase.ts";
import { esSuperadmin, registrarCambio, tienePermiso, usuarioActivo } from "../_shared/auth.ts";
import { EMAIL_RE } from "../_shared/correo.ts";

interface Peticion {
  accion?: "listar" | "crear" | "actualizar" | "eliminar";
  id?: string;
  email?: string;
  nombre?: string;
  rol?: string;
  activo?: boolean;
  restablecer_password?: boolean;
}

/** Contraseña temporal legible de 14 caracteres (sin caracteres ambiguos). */
function passwordTemporal(): string {
  const abc = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  return Array.from(crypto.getRandomValues(new Uint8Array(14)), (b) => abc[b % abc.length]).join("");
}

Deno.serve(async (req) => {
  const previo = prepararPeticion(req);
  if (previo) return previo;

  const db = clienteServicio();
  const yo = await usuarioActivo(req, db);
  if (!yo) return json({ error: "Inicia sesión para continuar." }, 401);
  if (!tienePermiso(yo, "config_usuarios")) return json({ error: "Tu rol no tiene permiso para gestionar usuarios." }, 403);

  const p = await leerJson<Peticion>(req);
  if (!p?.accion) return json({ error: "Falta la acción." }, 400);

  const superadminsActivos = async () => {
    const { count } = await db.from("perfiles").select("id", { count: "exact", head: true })
      .eq("rol", "superadmin").eq("activo", true);
    return count ?? 0;
  };
  const rolExiste = async (rol: string) =>
    Boolean((await db.from("roles").select("id").eq("id", rol).maybeSingle()).data);

  // ---------- listar ----------
  if (p.accion === "listar") {
    const { data, error } = await db.from("perfiles")
      .select("id, email, nombre, rol, activo, created_at").order("created_at", { ascending: true });
    if (error) return json({ error: "No se pudo leer la lista de usuarios." }, 500);
    return json({ usuarios: data });
  }

  // ---------- crear ----------
  if (p.accion === "crear") {
    const email = String(p.email ?? "").trim().toLowerCase();
    const nombre = String(p.nombre ?? "").trim().replace(/\s+/g, " ");
    const rol = String(p.rol ?? "recepcion");
    if (!EMAIL_RE.test(email)) return json({ error: "Correo inválido." }, 422);
    if (nombre.length < 3) return json({ error: "Escribe el nombre completo." }, 422);
    if (!(await rolExiste(rol))) return json({ error: "Rol inválido." }, 422);
    if (rol === "superadmin" && !esSuperadmin(yo)) return json({ error: "Solo un SUPERADMIN puede crear otro SUPERADMIN." }, 403);

    const password = passwordTemporal();
    const { data: creado, error } = await db.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { nombre } });
    if (error || !creado.user) {
      const existe = /already|registered|exists/i.test(error?.message ?? "");
      return json({ error: existe ? "Ya existe un usuario con ese correo." : "No se pudo crear el usuario." }, existe ? 409 : 500);
    }
    const nuevo = { id: creado.user.id, email, nombre, rol, activo: true };
    const { error: errPerfil } = await db.from("perfiles").insert(nuevo);
    if (errPerfil) {
      await db.auth.admin.deleteUser(creado.user.id); // no dejar usuarios sin perfil
      return json({ error: "No se pudo guardar el perfil." }, 500);
    }
    await registrarCambio(db, yo, "perfiles", "alta", nuevo.id, null, nuevo);
    return json({ ok: true, usuario: nuevo, password_temporal: password }, 201);
  }

  // ---------- actualizar / eliminar: cargar al usuario objetivo ----------
  if (!p.id) return json({ error: "Falta el usuario." }, 400);
  const { data: objetivo } = await db.from("perfiles").select("id, email, nombre, rol, activo").eq("id", p.id).maybeSingle();
  if (!objetivo) return json({ error: "El usuario no existe." }, 404);
  const esYo = objetivo.id === yo.id;
  if (objetivo.rol === "superadmin" && !esSuperadmin(yo)) {
    return json({ error: "Solo un SUPERADMIN puede modificar a otro SUPERADMIN." }, 403);
  }

  // ---------- eliminar ----------
  if (p.accion === "eliminar") {
    if (!esSuperadmin(yo)) return json({ error: "Solo un SUPERADMIN puede eliminar usuarios." }, 403);
    if (esYo) return json({ error: "No puedes eliminar tu propio usuario." }, 422);
    if (objetivo.rol === "superadmin" && objetivo.activo && (await superadminsActivos()) <= 1) {
      return json({ error: "Debe quedar al menos un SUPERADMIN activo." }, 422);
    }
    const { error } = await db.auth.admin.deleteUser(objetivo.id); // el perfil se borra en cascada
    if (error) return json({ error: "No se pudo eliminar el usuario." }, 500);
    await registrarCambio(db, yo, "perfiles", "baja", objetivo.id, objetivo, null);
    return json({ ok: true });
  }

  // ---------- actualizar ----------
  if (p.accion === "actualizar") {
    if (esYo && (p.activo === false || (p.rol && p.rol !== objetivo.rol))) {
      return json({ error: "No puedes cambiar tu propio rol ni desactivarte." }, 422);
    }
    const cambios: Record<string, unknown> = {};
    if (p.rol !== undefined && p.rol !== objetivo.rol) {
      if (!(await rolExiste(p.rol))) return json({ error: "Rol inválido." }, 422);
      if (p.rol === "superadmin" && !esSuperadmin(yo)) return json({ error: "Solo un SUPERADMIN puede asignar ese rol." }, 403);
      cambios.rol = p.rol;
    }
    if (p.activo !== undefined) cambios.activo = Boolean(p.activo);
    if (p.nombre) cambios.nombre = String(p.nombre).trim();

    const quitaSuperadmin = objetivo.rol === "superadmin" && objetivo.activo &&
      ((cambios.rol && cambios.rol !== "superadmin") || cambios.activo === false);
    if (quitaSuperadmin && (await superadminsActivos()) <= 1) {
      return json({ error: "Debe quedar al menos un SUPERADMIN activo." }, 422);
    }

    if (Object.keys(cambios).length) {
      const { error } = await db.from("perfiles").update(cambios).eq("id", objetivo.id);
      if (error) return json({ error: "No se pudo actualizar el perfil." }, 500);
    }
    const authCambios: Record<string, unknown> = {};
    if (p.activo !== undefined) authCambios.ban_duration = p.activo ? "none" : "876000h";
    let password: string | undefined;
    if (p.restablecer_password) {
      password = passwordTemporal();
      authCambios.password = password;
    }
    if (Object.keys(authCambios).length) {
      const { error } = await db.auth.admin.updateUserById(objetivo.id, authCambios);
      if (error) return json({ error: "Se actualizó el perfil, pero no la cuenta de acceso." }, 500);
    }
    await registrarCambio(db, yo, "perfiles", "edicion", objetivo.id, objetivo,
      { ...objetivo, ...cambios, ...(password ? { password: "(restablecida)" } : {}) });
    return json({ ok: true, password_temporal: password });
  }

  return json({ error: "Acción desconocida." }, 400);
});
