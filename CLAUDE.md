# Contexto del proyecto para Claude Code

Sistema de registro de visitantes de HIXSA: formulario público con pase QR por correo,
panel interno con consultas, reportes y administración de usuarios, y reporte diario automático.

## Arquitectura

- `public/`: formulario público (HTML + CSS + JS vanilla). Llama a la Edge Function `registrar-visita`.
  `admin.html` solo redirige a `/admin/` (los QR antiguos apuntan ahí).
- `panel/`: panel interno en **React 18 + Vite** (`/admin/`). Pestañas Recepción (lector QR con jsQR),
  Tablero (Recharts), Consultas y Configuración (solo admin). Lee `window.HIXSA_CONFIG` de `/config.js`.
- `npm run build` → `dist/` (copia `public/`, genera `dist/config.js` y compila el panel en `dist/admin/`).
- `supabase/schema.sql`: modelo de datos y RLS (idempotente). `crear-admin.sql`: primer administrador.
- `supabase/functions/`: Edge Functions en Deno (`registrar-visita`, `registrar-acceso`, `admin-usuarios`, `enviar-reporte`).
- `scripts/reporte-diario.mjs`: automatización con API de Supabase + API de Claude (GitHub Actions).
- `.mcp.json`: servidor MCP de Supabase en solo lectura. `.claude/skills/reporte-visitas`: reporte semanal.

## Reglas de seguridad (no negociables)

- `anon` no tiene permisos sobre ninguna tabla. Todo registro público pasa por `registrar-visita`.
- La llave `service_role` / `sb_secret_` solo vive en Edge Functions y en secretos de GitHub. Nunca en `public/`.
- Toda salida de datos de usuario en el DOM se hace con `textContent` (helper `el()` en admin.js), nunca `innerHTML`.
- A la API de Claude solo se envían cifras agregadas, nunca nombres, correos ni teléfonos.
- El MCP de Supabase se usa en modo `read_only=true`.
- Las fotos de identificación viven en el bucket **privado** `identificaciones`. Solo se muestran con
  `createSignedUrl` de 5 minutos; nunca se envían por correo ni a la IA.
- El formulario público solo puede leer `id, nombre, area` de anfitriones activos (nunca el correo).

## Convenciones

- Textos en español de México. Zona horaria `America/Mexico_City` (UTC-6 fijo).
- Paleta y tipografía: variables de `:root` en `public/styles.css`.
- Commits con prefijos `feat:`, `fix:`, `docs:`, `style:`, `chore:`; un cambio lógico por commit.

## Al agregar un campo al formulario

1. `schema.sql`: columna + `check`.
2. `registrar-visita/index.ts`: validación y `datos`.
3. `public/index.html` + `app.js`: campo, regla y `body`.
4. `panel/src/lib/supabase.js` (`CAMPOS_VISITA`), `formato.js` (CSV) y la ficha; `enviar-reporte`: `COLUMNAS`.

## Verificación local

```bash
npm install && npm run dev       # formulario en http://localhost:3000 y panel en /admin/
npm run reporte:demo             # reporte diario con datos de ejemplo
cd supabase/functions && DENO_NO_PACKAGE_JSON=1 deno check */index.ts
```


## Versión 4 (en desarrollo por fases)

- **Despliegue real:** Cloudflare **Workers** con activos estáticos (`wrangler.jsonc`, carpeta `dist`),
  URL `https://hixsa-registro-visitantes.mcrayor.workers.dev`. Supabase: proyecto `ziqfcmgufkeydulgtnvl`.
- **Cambios de base de datos:** siempre como archivo nuevo en `supabase/migrations/AAAAMMDD_descripcion.sql`,
  idempotente. No editar migraciones ya ejecutadas. `schema.sql` es la base v3.
- **Roles y permisos:** tabla `roles` (secciones, alcance, puede_exportar). Funciones SQL `tiene_permiso(seccion)`,
  `es_superadmin()`, `visita_en_alcance(entrada)`, `empresa_visible(empresa)`. En el panel: `panel/src/lib/permisos.js`.
  En Edge Functions: `tienePermiso()`, `rangoDelAlcance()`, `filtroAuditoria()` en `_shared/auth.ts`.
  Toda regla de acceso va **en la base (RLS)**; el panel solo oculta lo que el rol no puede usar.
- **Modo auditoría:** `configuracion.modo_auditoria`. Cuando está activo, solo la empresa principal es visible
  para todos (RLS + funciones con service_role deben aplicar `filtroAuditoria()`).
- **Empresas:** `empresas` (empresa a visitar) ≠ `visitantes.empresa` (empresa de origen, texto libre).
  Anfitriones ↔ empresas en `anfitrion_empresas`.
- **Formulario público:** obtiene datos con `rpc('config_publica')`; no consulta tablas directamente.
- **Bitácora:** los triggers registran cambios hechos desde el panel; las Edge Functions con service_role
  registran los suyos con `registrarCambio()`.
- **Sin API de Claude:** los reportes usan resúmenes calculados.
- **Marca:** colores y fuentes solo desde las variables de `public/styles.css`. El logotipo no se deforma ni se recolorea.

### Fase 2 (recepción y seguridad)
- Reglas de horario en `supabase/functions/_shared/horario.ts`, con pruebas en `horario.test.ts` (corren en CI).
  Ventana: entrada − `minutos_anticipacion` a entrada + `tolerancia_min`, mismo día (CDMX). Salidas siempre permitidas.
- `registrar-acceso` acciones: `llegada`, `autorizar` (motivo ≥ 5), `aprobar`, `salida`. Todo rechazo/autorización → `intentos_acceso`.
- Perfiles en `personas` (uno por correo). Un perfil existente solo se actualiza con token de recurrente verificado (evita suplantación).
- Códigos y tokens en `verificaciones` (solo service_role). Nunca devolver datos de un perfil sin código verificado.
- Aprobación: token aleatorio, se guarda solo su SHA-256 en `visitantes.aprobacion_token_hash`; un solo uso.
  El enlace abre `public/aprobar.html` y requiere clic (los antivirus de correo que abren enlaces no aprueban).
- Fotos (identificación y selfie) en el bucket privado `identificaciones`; selfies en `selfies/`.
