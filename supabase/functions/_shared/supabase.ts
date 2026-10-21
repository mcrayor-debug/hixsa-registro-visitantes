import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.45.4";

/** Cliente con service_role: salta RLS. Solo existe dentro de las Edge Functions. */
export function clienteServicio(): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en el entorno.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
