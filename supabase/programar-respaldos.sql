-- =====================================================================
-- Programar los respaldos automáticos (semanal y mensual) en Supabase.
-- Se ejecuta UNA vez en: Supabase > SQL Editor. Requiere programar-reportes.sql
-- ya ejecutado (usa el mismo secreto "reportes_secreto" del Vault).
-- Reemplaza TU_PROJECT_REF y ejecuta (no guardes el archivo con valores reales).
--   Semanal: domingo 02:00 CDMX → '0 8 * * 0'
--   Mensual: día 1, 02:30 CDMX  → '30 8 1 * *'
-- Cada uno se puede apagar en el panel (Configuración → Respaldos).
-- =====================================================================
do $$
declare
  v_url text := 'https://TU_PROJECT_REF.supabase.co/functions/v1/respaldos';
  v_id  uuid;
begin
  if v_url like '%TU_PROJECT_REF%' then raise exception 'Reemplaza TU_PROJECT_REF antes de ejecutar.'; end if;
  select id into v_id from vault.secrets where name = 'respaldos_url';
  if v_id is null then perform vault.create_secret(v_url, 'respaldos_url', 'URL de la función respaldos');
  else perform vault.update_secret(v_id, v_url); end if;
end $$;

select cron.unschedule(jobid) from cron.job where jobname in ('hixsa-respaldo-semanal', 'hixsa-respaldo-mensual');

select cron.schedule('hixsa-respaldo-semanal', '0 8 * * 0', $job$
  select net.http_post(
    url     := (select decrypted_secret from vault.decrypted_secrets where name = 'respaldos_url'),
    headers := jsonb_build_object('Content-Type', 'application/json',
                 'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'reportes_secreto')),
    body    := jsonb_build_object('accion', 'generar', 'tipo', 'semanal'),
    timeout_milliseconds := 120000);
$job$);
select cron.schedule('hixsa-respaldo-mensual', '30 8 1 * *', $job$
  select net.http_post(
    url     := (select decrypted_secret from vault.decrypted_secrets where name = 'respaldos_url'),
    headers := jsonb_build_object('Content-Type', 'application/json',
                 'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'reportes_secreto')),
    body    := jsonb_build_object('accion', 'generar', 'tipo', 'mensual'),
    timeout_milliseconds := 120000);
$job$);

select jobname, schedule, active from cron.job where jobname like 'hixsa-%' order by jobname;
