-- =====================================================================
-- Crear el PRIMER usuario administrador
-- 1. Supabase > Authentication > Users > Add user > Create new user
--    Correo: admin@hixsa.com (o el que prefieras)
--    Contraseña: una segura. Marca "Auto Confirm User".
-- 2. Cambia el correo de abajo si usaste otro y ejecuta este script.
-- Los siguientes usuarios se dan de alta desde el panel (Configuración).
-- =====================================================================
insert into public.perfiles (id, email, nombre, rol, activo)
select id, email, 'Administrador HIXSA', 'admin', true
from auth.users
where email = 'admin@hixsa.com'
on conflict (id) do update
  set rol = 'admin', activo = true;

-- Verificación: debe mostrar una fila con rol = admin
select email, nombre, rol, activo from public.perfiles where rol = 'admin';
