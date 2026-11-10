-- =====================================================================
-- HIXSA - Registro de visitantes
-- Migración v4, fase 3: consultas, reportes, calendario, importación y depuración.
-- Requiere: 20261111_v4_fase2.sql ya ejecutada. Idempotente.
-- Los reportes automáticos se programan aparte con supabase/programar-reportes.sql.
-- =====================================================================

-- 1) Correos que reciben TODAS las visitas como invitación de calendario (.ics)
alter table public.configuracion
  add column if not exists correos_calendario text[] not null default '{}';
alter table public.configuracion drop constraint if exists configuracion_max_calendario;
alter table public.configuracion
  add constraint configuracion_max_calendario check (coalesce(array_length(correos_calendario, 1), 0) <= 10);
grant update (correos_calendario) on table public.configuracion to authenticated;

-- 2) Origen de cada visita: formulario, importación de Glide o plantilla
alter table public.visitantes
  add column if not exists origen    text not null default 'formulario',
  add column if not exists origen_id text;
alter table public.visitantes drop constraint if exists visitantes_origen;
alter table public.visitantes
  add constraint visitantes_origen check (origen in ('formulario', 'glide', 'importacion'));
-- Importar dos veces el mismo archivo no duplica registros
create unique index if not exists visitantes_origen_unico on public.visitantes (origen, origen_id) where origen_id is not null;
create unique index if not exists personas_origen_unico on public.personas (origen, origen_id) where origen_id is not null;

comment on column public.visitantes.origen is 'formulario | glide | importacion. Las importadas no cuentan en puntualidad.';

-- 3) Bitácora de reportes: nuevos orígenes
alter table public.bitacora_reportes drop constraint if exists bitacora_origen_valido;
alter table public.bitacora_reportes
  add constraint bitacora_origen_valido check (origen in ('panel', 'automatico', 'claude-code', 'programado'));

-- Verificación
select (select count(*) from public.visitantes where origen = 'formulario') as visitas_formulario,
       (select correos_calendario from public.configuracion where id = 1) as correos_calendario;
