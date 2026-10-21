# Contexto del proyecto para Claude Code

Formulario público de registro de visitantes para HIXSA.

- Frontend estático en `public/` (HTML + CSS + JS vanilla, sin framework).
- Datos en Supabase, tabla `public.visitantes` (ver `supabase/schema.sql`).
- El rol `anon` solo tiene INSERT en columnas específicas; no puede leer, editar ni borrar.
- `public/config.js` se genera con `npm run build` desde `.env` o variables de Cloudflare. Nunca se versiona.
- Despliegue: Cloudflare Pages, build `npm run build`, salida `public`.

Reglas:
- Si agregas un campo al formulario, agrégalo también en `schema.sql` (columna + CHECK + GRANT INSERT) y en el `payload` de `public/app.js`.
- Nunca usar la llave `service_role` / `sb_secret_` en el frontend.
- Mantener los textos en español de México y la paleta definida en `:root` de `styles.css`.
