-- =====================================================================
-- HIXSA - Registro de visitantes
-- Migración v4.1.0: celular de usuarios, nombre corto de anfitriones,
-- invitaciones creadas por el personal.
-- Requiere: 20261112_v4_fase3.sql ya ejecutada. Idempotente.
-- =====================================================================

-- 1) Celular de los usuarios del panel
alter table public.perfiles add column if not exists celular text;
alter table public.perfiles drop constraint if exists perfiles_celular;
alter table public.perfiles
  add constraint perfiles_celular check (celular is null or celular ~ '^\+?[0-9]{10,15}$');

-- 2) Cómo se muestra el anfitrión en el formulario: solo nombre o nombre completo
alter table public.configuracion
  add column if not exists anfitrion_solo_nombre boolean not null default false;
grant update (anfitrion_solo_nombre) on table public.configuracion to authenticated;

-- Quien administra anfitriones también puede cambiar esa opción
drop policy if exists "Config actualiza configuracion" on public.configuracion;
create policy "Config actualiza configuracion" on public.configuracion for update to authenticated
  using ((select public.tiene_permiso('config_correos')) or (select public.tiene_permiso('config_empresas'))
         or (select public.tiene_permiso('config_anfitriones')))
  with check ((select public.tiene_permiso('config_correos')) or (select public.tiene_permiso('config_empresas'))
         or (select public.tiene_permiso('config_anfitriones')));

-- 3) Invitaciones creadas desde el panel: quién las creó
alter table public.visitantes
  add column if not exists creado_por uuid references auth.users (id) on delete set null;
comment on column public.visitantes.creado_por is 'Personal que creó la invitación desde el panel (null = registro del visitante).';

-- 4) Datos públicos del formulario: nombre del anfitrión según la opción
create or replace function public.config_publica()
returns jsonb language sql stable security definer set search_path = '' as $$
  with c as (select modo_auditoria, logo_url, anfitrion_solo_nombre from public.configuracion where id = 1)
  select jsonb_build_object(
    'modo_auditoria', public.modo_auditoria(),
    'logo_url', (select logo_url from c),
    'empresas', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', e.id, 'nombre', e.nombre, 'logo_url', e.logo_url,
               'mostrar_como', e.mostrar_como, 'es_principal', e.es_principal)
             order by e.orden, e.nombre)
        from public.empresas e
       where e.activa and public.empresa_visible(e.id)), '[]'::jsonb),
    'anfitriones', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', a.id,
               'nombre', case when coalesce((select anfitrion_solo_nombre from c), false)
                              then split_part(btrim(a.nombre), ' ', 1) else a.nombre end,
               'area', a.area,
               'empresas', (select coalesce(jsonb_agg(ae.empresa_id), '[]'::jsonb)
                              from public.anfitrion_empresas ae where ae.anfitrion_id = a.id))
             order by a.nombre)
        from public.anfitriones a
       where a.activo), '[]'::jsonb)
  );
$$;
revoke execute on function public.config_publica() from public;
grant  execute on function public.config_publica() to anon, authenticated;

select (select anfitrion_solo_nombre from public.configuracion where id = 1) as anfitrion_solo_nombre,
       (select count(*) from information_schema.columns where table_name = 'perfiles' and column_name = 'celular') as celular_usuarios;
