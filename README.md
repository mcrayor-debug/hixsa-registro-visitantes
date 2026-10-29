# HIXSA: Registro de visitantes

Sistema para que los visitantes de HIXSA registren su visita en línea, reciban un **pase con código QR** por correo y lo muestren en recepción. El personal consulta las visitas, emite reportes y administra usuarios desde un **panel con inicio de sesión**, y cada mañana Dirección recibe un **reporte automático** analizado con la API de Claude.

> **¿Primera vez?** Sigue la guía para principiantes con imágenes: [`docs/GUIA_DESPLIEGUE.md`](docs/GUIA_DESPLIEGUE.md)
>
> Documentación de los entregables del curso: [`docs/ENTREGABLES.md`](docs/ENTREGABLES.md)

| Capa | Tecnología |
|---|---|
| Frontend | HTML, CSS y JavaScript (vanilla) en Cloudflare Pages |
| Base de datos y autenticación | Supabase (PostgreSQL + RLS + Auth) |
| Backend | Supabase Edge Functions (Deno / TypeScript) |
| Correo | Resend |
| IA | API de Claude (reporte diario) |
| Automatización | GitHub Actions |
| Integración con Claude Code | MCP de Supabase + skill `reporte-visitas` |

## Funciones principales

- **Registro público** (`index.html`): datos del visitante, correo obligatorio, **fecha y hora de entrada y salida**, aceptación del aviso de privacidad.
- **Pase QR por correo**: se genera con el folio y una huella de los datos y el horario registrados. También se muestra en pantalla para descargarlo.
- **Panel interno** (`admin.html`), requiere inicio de sesión:
  - **Consultas**: filtros por periodo, empresa, motivo y texto; estado de cada visita; descarga CSV; **envío del reporte por correo**.
  - **Configuración** (solo administrador): alta de usuarios de consulta, roles, activación, contraseñas temporales, correos de recepción y destinatarios.
  - **Validación de pase**: al escanear el QR, el personal ve si el pase es válido y si está dentro de horario.
- **Reporte diario automático** (lunes a viernes, 07:00): indicadores del día anterior, resumen con IA y agenda del día.

## Estructura del proyecto

```text
hixsa-registro-visitantes/
├── public/                         ← sitio publicado en Cloudflare Pages
│   ├── index.html · app.js         ← formulario público
│   ├── admin.html · admin.js       ← panel interno
│   ├── styles.css · admin.css      ← diseño (paleta HIXSA en :root)
│   ├── _headers                    ← cabeceras de seguridad
│   └── config.js                   ← se genera con npm run build (no se versiona)
├── supabase/
│   ├── schema.sql                  ← tablas, validaciones y RLS
│   ├── crear-admin.sql             ← primer administrador
│   ├── config.toml                 ← configuración de Edge Functions
│   └── functions/
│       ├── registrar-visita/       ← guarda, genera QR y envía el pase
│       ├── admin-usuarios/         ← alta y gestión de usuarios
│       ├── enviar-reporte/         ← reporte CSV por correo
│       └── _shared/                ← utilidades comunes
├── scripts/
│   ├── build-config.js             ← genera public/config.js
│   └── reporte-diario.mjs          ← automatización con API de Claude
├── .github/workflows/
│   ├── ci.yml                      ← verificación en cada push
│   └── reporte-diario.yml          ← reporte automático 07:00
├── .claude/skills/reporte-visitas/ ← skill de Claude Code
├── .mcp.json                       ← MCP de Supabase (solo lectura)
├── docs/ENTREGABLES.md             ← documentación del curso
├── CLAUDE.md                       ← contexto para Claude Code
└── CHANGELOG.md
```

---

# Guía de instalación paso a paso

## Parte 0. Herramientas y cuentas

1. Instala **Git** (<https://git-scm.com/downloads>), **Node.js LTS** (<https://nodejs.org>) y **Claude Code** (<https://docs.claude.com/en/docs/claude-code/overview>).
2. Crea cuentas gratuitas en **Supabase** (<https://supabase.com>), **GitHub** (<https://github.com>), **Cloudflare** (<https://dash.cloudflare.com>) y **Resend** (<https://resend.com>).
3. Para el reporte con IA, obtén una llave en la **Consola de Claude** (<https://console.anthropic.com>).

```bash
git --version
node --version     # v18 o superior
```

## Parte 1. Supabase: base de datos y usuarios

### 1.1 Crear el proyecto

1. En <https://supabase.com/dashboard> haz clic en **New project**.
2. Nombre: `hixsa-visitantes`. Guarda la contraseña de la base de datos. Región: *East US (North Virginia)* o la más cercana.
3. Espera a que termine de crearse.

### 1.2 Crear tablas y seguridad

1. Abre **SQL Editor → New query**.
2. Pega el contenido completo de `supabase/schema.sql` y haz clic en **Run**.
3. En **Table Editor** deben aparecer `visitantes`, `perfiles`, `configuracion` y `bitacora_reportes`, todas con **RLS enabled**.

> Si ya tenías la versión 1 instalada, ejecuta el mismo script: actualiza la tabla sin perder registros.

### 1.3 Crear el usuario administrador

1. Ve a **Authentication → Users → Add user → Create new user**.
2. Correo: `admin@hixsa.com` (o el que prefieras). Contraseña segura. Marca **Auto Confirm User**.
3. En **SQL Editor**, ejecuta `supabase/crear-admin.sql` (cambia el correo si usaste otro).
4. El resultado debe mostrar una fila con `rol = admin`.

Los demás usuarios se dan de alta desde el panel, en **Configuración → Agregar usuario**.

### 1.4 Obtener las llaves

En **Project Settings → API Keys** (o el botón **Connect**):

| Dato | Dónde se usa | ¿Es secreto? |
|---|---|---|
| Project URL (`https://xxxx.supabase.co`) | Frontend, script, MCP | No |
| Publishable key (`sb_publishable_…`) o anon key | Frontend (`SUPABASE_ANON_KEY`) | No |
| Secret key (`sb_secret_…`) o service_role | Solo script del reporte (GitHub Secrets) | **Sí** |
| Project ref (la parte `xxxx` de la URL) | CLI y MCP | No |

> ⚠️ La llave secreta nunca va en `public/` ni en el `.env` que se sube a GitHub. Las Edge Functions ya la reciben automáticamente.

## Parte 2. Resend: envío de correos

1. En <https://resend.com> ve a **API Keys → Create API Key** y copia la llave (`re_…`).
2. **Para producción**: en **Domains → Add Domain** agrega `hixsa.com` (o un subdominio como `visitas.hixsa.com`) y crea en el DNS los registros que te indique. Así podrás enviar desde `recepcion@hixsa.com` a cualquier persona.
3. **Para pruebas**: sin dominio verificado puedes usar el remitente `onboarding@resend.dev`, pero Resend solo entrega a tu propio correo de la cuenta.

## Parte 3. Desplegar las Edge Functions

Desde la carpeta del proyecto:

```bash
npx supabase login
npx supabase link --project-ref TU_PROJECT_REF
```

Configura los secretos de las funciones (cambia los valores):

```bash
npx supabase secrets set RESEND_API_KEY=re_xxxxxxxx
npx supabase secrets set EMAIL_FROM="HIXSA Recepción <recepcion@hixsa.com>"
npx supabase secrets set PUBLIC_SITE_URL=https://hixsa-registro.pages.dev
npx supabase secrets set ALLOWED_ORIGIN=https://hixsa-registro.pages.dev
```

| Secreto | Para qué sirve |
|---|---|
| `RESEND_API_KEY` | Enviar pases y reportes |
| `EMAIL_FROM` | Remitente de los correos |
| `PUBLIC_SITE_URL` | El QR apunta a `PUBLIC_SITE_URL/admin.html?pase=…` para validarlo |
| `ALLOWED_ORIGIN` | Solo tu sitio puede llamar a las funciones (usa `*` mientras pruebas en local) |

Despliega las tres funciones:

```bash
npx supabase functions deploy registrar-visita --no-verify-jwt
npx supabase functions deploy admin-usuarios --no-verify-jwt
npx supabase functions deploy enviar-reporte --no-verify-jwt
```

> `--no-verify-jwt` es correcto: `registrar-visita` es pública y las otras dos verifican la sesión y el rol dentro del código.

Verifica en **Supabase → Edge Functions** que aparezcan las tres.

## Parte 4. Probar en tu computadora

```bash
cp .env.example .env
```

Edita `.env` con tu URL y tu llave pública:

```text
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_ANON_KEY=sb_publishable_xxxxxxxx
```

```bash
npm run dev
```

1. Abre <http://localhost:3000>, registra una visita con **tu correo** y revisa que llegue el pase.
2. Abre <http://localhost:3000/admin.html>, entra con el administrador y revisa la visita en **Consultas**.
3. En **Configuración**, agrega un usuario de consulta y guarda los correos de recepción y destinatarios.

## Parte 5. Git y GitHub

Este proyecto ya incluye su historial de cambios (carpeta `.git`). Solo conéctalo a tu repositorio:

1. Crea un repositorio vacío en <https://github.com/new> llamado `hixsa-registro-visitantes` (sin README ni .gitignore).
2. Opcional: pon tu nombre como autor de todos los commits.

```bash
git config user.name "Tu Nombre"
git config user.email "tu-correo@ejemplo.com"
git rebase -r --root --exec "git commit --amend --no-edit --reset-author"
```

3. Sube el proyecto:

```bash
git remote add origin https://github.com/TU-USUARIO/hixsa-registro-visitantes.git
git push -u origin main
```

Para cada cambio nuevo:

```bash
git add .
git commit -m "fix: descripción corta del cambio"
git push
```

## Parte 6. Cloudflare Pages

1. En <https://dash.cloudflare.com> abre **Workers & Pages → Create → Pages → Import an existing Git repository**.
2. Conecta GitHub y elige el repositorio.
3. Configura el build:

| Opción | Valor |
|---|---|
| Framework preset | `None` |
| Build command | `npm run build` |
| Build output directory | `public` |

4. En **Environment variables** agrega `SUPABASE_URL`, `SUPABASE_ANON_KEY` (la pública) y `NODE_VERSION` = `20`.
5. **Save and Deploy**. Tu sitio queda en `https://NOMBRE.pages.dev` y el panel en `https://NOMBRE.pages.dev/admin.html`.
6. Si el nombre final es distinto al que pusiste en `PUBLIC_SITE_URL` y `ALLOWED_ORIGIN`, actualiza esos secretos (Parte 3) y vuelve a desplegar las funciones.

## Parte 7. Reporte diario automático (GitHub Actions)

1. En GitHub: **Settings → Secrets and variables → Actions → New repository secret**. Crea:

| Secreto | Valor |
|---|---|
| `SUPABASE_URL` | Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Llave secreta (`sb_secret_…` o service_role) |
| `ANTHROPIC_API_KEY` | Llave de la API de Claude |
| `RESEND_API_KEY` | Llave de Resend |
| `EMAIL_FROM` | Remitente, por ejemplo `HIXSA Recepción <recepcion@hixsa.com>` |

2. Opcional: en la pestaña **Variables**, crea `CLAUDE_MODEL` para cambiar el modelo (por defecto `claude-haiku-5-5`).
3. Los destinatarios se configuran en el panel: **Configuración → Destinatarios del reporte**.
4. Prueba manual: **Actions → Reporte diario de visitas → Run workflow**. Marca *dry run* para generar solo la vista previa (se descarga como artefacto).

Prueba local sin enviar nada:

```bash
npm run reporte:demo
```

## Parte 8. MCP y skill en Claude Code

1. Exporta el identificador del proyecto y abre Claude Code en la carpeta:

```bash
export SUPABASE_PROJECT_REF=xxxx
claude
```

2. Claude Code detecta `.mcp.json` y pregunta si quieres usar el servidor `supabase`: acepta.
3. Escribe `/mcp`, elige `supabase` y autentícate en el navegador con tu cuenta de Supabase.
4. Pide: *“Genera el reporte semanal de visitas”*. Claude Code usa la skill `reporte-visitas`, consulta la base real por MCP y guarda el reporte en `reportes/`.

---

## Lista de verificación

- [ ] Las 4 tablas existen con RLS y el administrador puede entrar al panel.
- [ ] Un registro desde la URL pública envía el pase QR al correo.
- [ ] Al escanear el QR con el celular y entrar al panel aparece “Pase válido”.
- [ ] Un usuario de consulta ve **Consultas** pero no **Configuración**.
- [ ] El reporte por correo llega con el CSV adjunto.
- [ ] El workflow **Reporte diario de visitas** termina en verde.
- [ ] Claude Code muestra el MCP `supabase` conectado y genera el reporte semanal.
- [ ] El repositorio no contiene `.env` ni `public/config.js`.

## Solución de problemas

| Síntoma | Causa probable | Solución |
|---|---|---|
| “No hay conexión con el servidor” al registrar | Función no desplegada o `ALLOWED_ORIGIN` distinto al sitio | Revisa la Parte 3 y que el origen coincida exactamente (sin `/` final). |
| El registro funciona pero no llega el correo | Dominio no verificado en Resend | Verifica el dominio o prueba con el correo de tu cuenta de Resend. En el panel la visita aparece con “Error de envío”. |
| “Tu cuenta no tiene acceso al panel” | El usuario no tiene perfil o está inactivo | Ejecuta `crear-admin.sql` o actívalo desde Configuración. |
| El QR abre el panel pero dice “no coincide” | Se cambió la visita después de emitir el pase | Es el comportamiento esperado: verificar identidad. |
| El workflow falla con 401 de Supabase | Llave secreta incorrecta | Revisa `SUPABASE_SERVICE_ROLE_KEY` en GitHub Secrets. |
| El reporte dice “resumen generado sin IA” | Falta `ANTHROPIC_API_KEY` o hubo un error temporal | Revisa el secreto; el reporte se envía igual. |
| `/mcp` no muestra `supabase` | Falta `SUPABASE_PROJECT_REF` | Expórtalo antes de abrir Claude Code y reinicia. |
# hixsa-registro-visitantes
