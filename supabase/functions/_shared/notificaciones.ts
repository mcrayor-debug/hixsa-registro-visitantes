// Notificaciones de la campana del panel.
//   audiencia "operacion": Recepción, SUPERVISOR, ADMIN y SUPERADMIN
//   audiencia "administracion": solo ADMIN y SUPERADMIN
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.45.4";

export async function notificar(
  db: SupabaseClient,
  n: { tipo: string; titulo: string; detalle?: string | null; folio?: string | null; empresa_id?: string | null; audiencia?: "operacion" | "administracion" },
) {
  try {
    await db.from("notificaciones").insert({
      tipo: n.tipo, audiencia: n.audiencia ?? "operacion", titulo: n.titulo.slice(0, 200),
      detalle: n.detalle?.slice(0, 300) ?? null, folio: n.folio ?? null, empresa_id: n.empresa_id ?? null,
    });
    // Se conservan 60 días
    await db.from("notificaciones").delete().lt("created_at", new Date(Date.now() - 60 * 864e5).toISOString());
  } catch (e) {
    console.error("notificación", e);
  }
}
