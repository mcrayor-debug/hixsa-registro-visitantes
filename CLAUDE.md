# Contexto del proyecto para Claude Code

Sistema de registro de visitantes de HIXSA: formulario público con pase QR por correo,
panel interno con consultas, reportes y administración de usuarios, y reporte diario automático.

## Arquitectura

- `public/`: sitio estático en Cloudflare Pages (HTML + CSS + JS vanilla, sin framework).
  - `index.html` + `app.js`: formulario público. Llama a la Edge Function `registrar-visita`.
  - `admin.html` + `admin.js`: panel con Supabase Auth. Pestañas Consultas y Configuración (solo admin).
- `supabase/schema.sql`: modelo de datos y RLS (idempotente). `crear-admin.sql`: primer administrador.
- `supabase/functions/`: Edge Functions en Deno (`registrar-visita`, `admin-usuarios`, `enviar-reporte`).
- `scripts/reporte-diario.mjs`: automatización con API de Supabase + API de Claude (GitHub Actions).
- `.mcp.json`: servidor MCP de Supabase en solo lectura. `.claude/skills/reporte-visitas`: reporte semanal.

## Reglas de seguridad (no negociables)

- `anon` no tiene permisos sobre ninguna tabla. Todo registro público pasa por `registrar-visita`.
- La llave `service_role` / `sb_secret_` solo vive en Edge Functions y en secretos de GitHub. Nunca en `public/`.
- Toda salida de datos de usuario en el DOM se hace con `textContent` (helper `el()` en admin.js), nunca `innerHTML`.
- A la API de Claude solo se envían cifras agregadas, nunca nombres, correos ni teléfonos.
- El MCP de Supabase se usa en modo `read_only=true`.

## Convenciones

- Textos en español de México. Zona horaria `America/Mexico_City` (UTC-6 fijo).
- Paleta y tipografía: variables de `:root` en `public/styles.css`.
- Commits con prefijos `feat:`, `fix:`, `docs:`, `style:`, `chore:`; un cambio lógico por commit.

## Al agregar un campo al formulario

1. `schema.sql`: columna + `check`.
2. `registrar-visita/index.ts`: validación y `datos`.
3. `public/index.html` + `app.js`: campo, regla y `body`.
4. `admin.js`: columna de la tabla y del CSV; `enviar-reporte`: `COLUMNAS`.

## Verificación local

```bash
npm run dev                      # sitio en http://localhost:3000
npm run reporte:demo             # reporte diario con datos de ejemplo
cd supabase/functions && DENO_NO_PACKAGE_JSON=1 deno check */index.ts
```
