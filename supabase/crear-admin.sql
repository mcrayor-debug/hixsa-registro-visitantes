-- =====================================================================
-- Crear el PRIMER usuario SUPERADMIN (instalación nueva)
-- Requiere: schema.sql y todas las migraciones de supabase/migrations/ ya ejecutadas.
-- 1. Supabase > Authentication > Users > Add user > Create new user
--    Correo institucional. Contraseña segura. Marca "Auto Confirm User".
-- 2. Cambia el correo de abajo si usaste otro y ejecuta este script.
-- Los demás usuarios se dan de alta desde el panel (Configuración > Usuarios).
-- =====================================================================
insert into public.perfiles (id, email, nombre, rol, activo)
select id, email, 'Administrador HIXSA', 'superadmin', true
from auth.users
where lower(email) = 'mario.rivera@hixsa.com'
on conflict (id) do update
  set rol = 'superadmin', activo = true;

-- Verificación: debe mostrar una fila con rol = superadmin
select email, nombre, rol, activo from public.perfiles where rol = 'superadmin';
