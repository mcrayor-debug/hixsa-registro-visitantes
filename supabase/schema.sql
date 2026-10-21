-- =====================================================================
-- HIXSA - Registro de visitantes
-- Esquema de base de datos para Supabase (PostgreSQL)
-- Ejecutar completo en: Supabase > SQL Editor > New query > Run
-- Es idempotente: se puede volver a ejecutar sin romper nada.
-- =====================================================================

-- 1) TABLA ------------------------------------------------------------
create table if not exists public.visitantes (
  id              uuid        primary key default gen_random_uuid(),
  -- created_at: hora de llegada (la pone el servidor)
  created_at      timestamptz not null    default now(),
  nombre_completo text        not null,
  empresa         text        not null,
  correo          text        not null,
  telefono        text        not null,
  persona_visita  text        not null,
  motivo          text        not null,
  comentarios     text,
  acepta_aviso    boolean     not null    default false,

  -- Validaciones en el servidor (no dependen del navegador)
  constraint visitantes_nombre_len
    check (char_length(btrim(nombre_completo)) between 3 and 120),
  constraint visitantes_empresa_len
    check (char_length(btrim(empresa)) between 2 and 120),
  constraint visitantes_correo_formato check (
    char_length(correo) <= 254
    and correo ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]{2,}$'
  ),
  constraint visitantes_telefono_formato
    check (telefono ~ '^\+?[0-9]{10,15}$'),
  constraint visitantes_persona_len
    check (char_length(btrim(persona_visita)) between 3 and 120),
  constraint visitantes_motivo_valido check (motivo in (
    'Reunión', 'Entrevista', 'Proveedor o servicio', 'Entrega o paquetería', 'Otro'
  )),
  constraint visitantes_comentarios_len
    check (comentarios is null or char_length(comentarios) <= 500),
  constraint visitantes_acepta_aviso
    check (acepta_aviso is true)
);

comment on table public.visitantes
  is 'Registro de visitantes de las oficinas de HIXSA (formulario público).';
comment on column public.visitantes.created_at
  is 'Fecha y hora de llegada, asignada por el servidor.';
comment on column public.visitantes.acepta_aviso
  is 'Aceptó: https://www.hixsa.com/sobre-nosotros/aviso-de-privacidad/';

create index if not exists visitantes_created_at_idx
  on public.visitantes (created_at desc);

-- 2) SEGURIDAD A NIVEL DE FILA (RLS) ---------------------------------
alter table public.visitantes enable row level security;

-- Quitamos cualquier permiso por defecto a los roles públicos...
revoke all on table public.visitantes from anon, authenticated;

-- ...y damos al rol anónimo SOLO permiso de INSERT, y solo en estas columnas.
-- Así nadie puede falsificar id ni created_at desde el navegador.
grant insert (
  nombre_completo, empresa, correo, telefono,
  persona_visita, motivo, comentarios, acepta_aviso
) on table public.visitantes to anon;

-- Política: cualquier visitante anónimo puede registrarse si acepta el aviso.
drop policy if exists "Registro anonimo de visitantes" on public.visitantes;
create policy "Registro anonimo de visitantes"
  on public.visitantes
  as permissive
  for insert
  to anon
  with check (acepta_aviso is true);

-- No existen políticas SELECT / UPDATE / DELETE para anon:
-- desde el sitio público NADIE puede leer, editar ni borrar registros.
-- Los registros se consultan en Supabase > Table Editor.

-- 3) (OPCIONAL) Lectura para personal de recepción autenticado ---------
-- Descomenta si más adelante agregas un panel con inicio de sesión.
-- grant select on table public.visitantes to authenticated;
-- create policy "Recepcion puede leer visitantes"
--   on public.visitantes for select to authenticated using (true);
