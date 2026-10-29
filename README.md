# HIXSA · Registro de visitantes

Formulario web para que los visitantes de las oficinas de HIXSA se registren en menos de un minuto desde su celular o desde una tableta en recepción.

| Capa | Tecnología |
|---|---|
| Frontend | HTML, CSS y JavaScript (vanilla, sin framework) |
| Base de datos | Supabase (PostgreSQL + RLS) |
| Control de versiones | Git + GitHub |
| Despliegue | Cloudflare Pages |

## Estructura del proyecto

```
hixsa-registro-visitantes/
├── public/                 ← lo que se publica en internet
│   ├── index.html          ← estructura del formulario
│   ├── styles.css          ← diseño (paleta HIXSA en :root)
│   ├── app.js              ← validación y envío a Supabase
│   ├── _headers            ← cabeceras de seguridad para Cloudflare
│   └── config.js           ← SE GENERA SOLO (no se sube a GitHub)
├── scripts/
│   └── build-config.js     ← crea config.js desde las variables de entorno
├── supabase/
│   └── schema.sql          ← tabla + validaciones + políticas RLS
├── .env.example            ← plantilla de variables
├── .gitignore
├── CLAUDE.md               ← contexto del proyecto para Claude Code
├── package.json
└── README.md
```

## Campos del formulario

| Campo | Columna | Obligatorio |
|---|---|---|
| Nombre completo | `nombre_completo` | Sí |
| Empresa | `empresa` | Sí |
| Teléfono | `telefono` | Sí |
| Correo electrónico | `correo` | Sí |
| ¿A quién visitas? | `persona_visita` | Sí |
| Motivo de la visita | `motivo` | Sí |
| Comentarios | `comentarios` | No |
| Acepto el aviso de privacidad | `acepta_aviso` | Sí |
| Hora de llegada | `created_at` | Automática (servidor) |

## Paleta y tipografía

| Rol | Color |
|---|---|
| Azul corporativo (principal) | `#12365F` |
| Azul oscuro (hover) | `#0C2747` |
| Azul brillante (acento) | `#1FA6DB` |
| Acento suave (fondos) | `#E6F4FA` |
| Texto | `#1C2A3A` |
| Fondo general | `#F4F7FA` |

Títulos en **Montserrat**, texto en **Open Sans** (Google Fonts). Para afinar un tono, cambia solo las variables de `:root` en `public/styles.css`.

---

# Guía paso a paso

## Antes de empezar: instala estas herramientas

1. **Git**: descárgalo de <https://git-scm.com/downloads> e instálalo con las opciones por defecto. Verifica en una terminal:
   ```bash
   git --version
   ```
2. **Node.js (versión LTS)**: descárgalo de <https://nodejs.org>. Verifica:
   ```bash
   node --version
   ```
   Debe mostrar `v18` o superior.
3. **Un editor de código**, por ejemplo Visual Studio Code: <https://code.visualstudio.com>.
4. **Cuentas gratuitas** en <https://supabase.com>, <https://github.com> y <https://dash.cloudflare.com>.

> En Windows usa la terminal “Git Bash” (se instala con Git). En Mac usa “Terminal”.

---

## Parte 1. Configurar Supabase

### 1.1 Crear el proyecto

1. Entra a <https://supabase.com/dashboard> e inicia sesión (puedes usar tu cuenta de GitHub).
2. Haz clic en **New project**.
3. Llena los datos:
   - **Organization**: la tuya (se crea una por defecto).
   - **Project name**: `hixsa-visitantes`.
   - **Database password**: genera una contraseña segura y **guárdala** en un lugar seguro (no la usarás en el formulario, pero la necesitarás si administras la base).
   - **Region**: elige la más cercana a México, por ejemplo *East US (North Virginia)*.
4. Haz clic en **Create new project** y espera 1 a 2 minutos a que termine.

### 1.2 Crear la tabla y la seguridad

1. En el menú izquierdo entra a **SQL Editor**.
2. Haz clic en **New query**.
3. Abre el archivo `supabase/schema.sql` de este proyecto, copia **todo** su contenido y pégalo en el editor.
4. Haz clic en **Run** (o `Ctrl + Enter`). Debe decir *Success. No rows returned*.
5. Ve a **Table Editor** y confirma que existe la tabla `visitantes` con sus columnas y el candado de **RLS enabled**.

Qué hace el script, en resumen:

- Crea la tabla `visitantes` con validaciones del lado del servidor (formato de correo, teléfono de 10 a 15 dígitos, motivo dentro de la lista, aceptación del aviso obligatoria).
- Activa **Row Level Security (RLS)**.
- Permite al público (rol `anon`) **solo insertar** registros y solo en las columnas del formulario. Nadie desde internet puede leer, editar ni borrar datos, ni falsificar la hora de llegada.

### 1.3 (Opcional) Probar la seguridad

En el SQL Editor, ejecuta esto. Simula ser un visitante anónimo:

```sql
begin;
set local role anon;

-- Debe funcionar:
insert into public.visitantes
  (nombre_completo, empresa, correo, telefono, persona_visita, motivo, acepta_aviso)
values
  ('Prueba RLS', 'Hixsa', 'prueba@hixsa.com', '5512345678', 'Recepción', 'Otro', true);

-- Debe fallar con "permission denied" (el público no puede leer):
select * from public.visitantes;

rollback;
```

Si el `insert` pasa y el `select` marca *permission denied*, la seguridad está bien. El `rollback` deshace la prueba.

### 1.4 Obtener la URL y la API Key

1. En la parte superior del proyecto haz clic en el botón **Connect** (o ve a **Project Settings → API Keys** y **Project Settings → Data API**).
2. Copia estos dos valores:
   - **Project URL**: se ve como `https://abcdefghijk.supabase.co`.
   - **Llave pública**: la **Publishable key** (empieza con `sb_publishable_...`) o, en la pestaña *Legacy API keys*, la llave **anon public** (empieza con `eyJ...`). Cualquiera de las dos funciona.

> ⚠️ **Nunca uses la llave `service_role` ni la `secret` (`sb_secret_...`)** en este proyecto. Esas saltan todas las reglas de seguridad. La llave pública sí puede estar en el navegador porque RLS la limita a solo insertar. El script de build bloquea automáticamente las llaves secretas.

### 1.5 Probar en tu computadora

1. Abre una terminal dentro de la carpeta del proyecto:
   ```bash
   cd ruta/a/hixsa-registro-visitantes
   ```
2. Crea tu archivo `.env` a partir de la plantilla:
   ```bash
   cp .env.example .env
   ```
3. Abre `.env` en tu editor y reemplaza los valores con los del paso 1.4:
   ```
   SUPABASE_URL=https://abcdefghijk.supabase.co
   SUPABASE_ANON_KEY=sb_publishable_xxxxxxxxxxxxxxxx
   ```
4. Arranca el servidor local:
   ```bash
   npm run dev
   ```
5. Abre <http://localhost:3000>, llena el formulario y envíalo.
6. En Supabase → **Table Editor → visitantes** debe aparecer tu registro.

> Abrir `index.html` con doble clic **no funciona** (los navegadores bloquean los módulos de JavaScript desde archivos locales). Usa siempre `npm run dev`.

---

## Parte 2. Git y GitHub

### 2.1 Configurar Git (solo la primera vez en tu computadora)

```bash
git config --global user.name "Tu Nombre"
git config --global user.email "tu-correo@ejemplo.com"
git config --global init.defaultBranch main
```

Usa el mismo correo de tu cuenta de GitHub.

### 2.2 Inicializar el repositorio y guardar la primera versión

Dentro de la carpeta del proyecto:

```bash
git init
git status
```

`git status` muestra los archivos que se van a guardar. **Revisa que NO aparezcan `.env` ni `public/config.js`** (el `.gitignore` los excluye a propósito).

Guarda la primera versión:

```bash
git add .
git commit -m "feat: formulario de registro de visitantes HIXSA"
```

### 2.3 Crear el repositorio en GitHub

1. Entra a <https://github.com/new>.
2. **Repository name**: `hixsa-registro-visitantes`.
3. Visibilidad: **Public** (más fácil para la revisión del curso) o **Private**.
4. **No** marques *Add a README*, *.gitignore* ni *license* (ya los tienes).
5. Haz clic en **Create repository**.

### 2.4 Conectar y subir

GitHub te mostrará unos comandos; usa los de la sección *“…or push an existing repository”*. Se ven así (cambia `TU-USUARIO`):

```bash
git remote add origin https://github.com/TU-USUARIO/hixsa-registro-visitantes.git
git branch -M main
git push -u origin main
```

La primera vez se abrirá una ventana del navegador para iniciar sesión en GitHub. Si en lugar de eso te pide contraseña en la terminal, crea un **token** en GitHub → *Settings → Developer settings → Personal access tokens → Tokens (classic)* con permiso `repo`, y pégalo como contraseña.

Recarga la página del repositorio: deben aparecer todos los archivos.

### 2.5 Guardar nuevas versiones (flujo de trabajo diario)

Cada vez que hagas un cambio:

```bash
git status                       # ver qué cambió
git add .                        # preparar los cambios
git commit -m "fix: corrige texto del botón"   # guardar versión con un mensaje claro
git push                         # subir a GitHub (y Cloudflare lo publica solo)
```

Prefijos recomendados para los mensajes: `feat:` (función nueva), `fix:` (corrección), `style:` (diseño), `docs:` (documentación).

Para ver el historial de versiones:

```bash
git log --oneline
```

---

## Parte 3. Desplegar en Cloudflare Pages

### 3.1 Conectar el repositorio

1. Entra a <https://dash.cloudflare.com>.
2. En el menú izquierdo abre **Workers & Pages** (en algunas cuentas aparece dentro de **Compute**).
3. Haz clic en **Create** (o *Create application*) y elige la pestaña **Pages**.
   > Si solo ves opciones de *Workers*, busca el enlace *“Looking to deploy Pages? Get started”*.
4. Elige **Import an existing Git repository** y haz clic en **Connect GitHub**.
5. Autoriza a Cloudflare. Puedes darle acceso solo al repositorio `hixsa-registro-visitantes`.
6. Selecciona el repositorio y haz clic en **Begin setup**.

### 3.2 Configurar el build

| Opción | Valor |
|---|---|
| Project name | `hixsa-registro` (define tu URL: `hixsa-registro.pages.dev`) |
| Production branch | `main` |
| Framework preset | `None` |
| Build command | `npm run build` |
| Build output directory | `public` |

### 3.3 Agregar las variables de entorno

En la misma pantalla abre **Environment variables (advanced)** y agrega:

| Variable name | Value |
|---|---|
| `SUPABASE_URL` | tu Project URL de Supabase |
| `SUPABASE_ANON_KEY` | tu llave pública (publishable o anon) |
| `NODE_VERSION` | `20` |

Haz clic en **Save and Deploy**.

### 3.4 Verificar el despliegue

1. Espera a que el log termine con **Success**. En el log verás la línea `✔ public/config.js generado para https://...supabase.co`.
2. Abre la URL `https://hixsa-registro.pages.dev`.
3. Registra una visita de prueba y confírmala en Supabase → **Table Editor**.
4. Ábrela desde tu celular para revisar la versión móvil.

Desde ahora, **cada `git push` a `main` publica automáticamente** una nueva versión. Si subes otra rama, Cloudflare crea una URL de vista previa sin tocar producción.

### 3.5 Cambiar variables después del primer despliegue

Proyecto en Cloudflare → **Settings → Variables and Secrets** → edita → luego ve a **Deployments** y en el último despliegue elige **Retry deployment** (las variables solo se aplican en un build nuevo).

### 3.6 (Opcional) Dominio propio

Proyecto → **Custom domains → Set up a custom domain**, por ejemplo `visitas.hixsa.com`. Si el dominio ya está en Cloudflare, el DNS se configura solo.

---

## Lista de verificación para la entrega

- [ ] La tabla `visitantes` existe en Supabase con RLS activado.
- [ ] El formulario rechaza envíos con campos vacíos o con correo inválido.
- [ ] El checkbox de aviso de privacidad es obligatorio y enlaza a <https://www.hixsa.com/sobre-nosotros/aviso-de-privacidad/>.
- [ ] Un registro enviado desde la URL pública aparece en Supabase.
- [ ] El repositorio en GitHub **no** contiene `.env` ni `public/config.js`.
- [ ] El sitio se ve bien en celular y en computadora.
- [ ] Enlaces para entregar: URL del repositorio de GitHub y URL de Cloudflare Pages.

## Solución de problemas

| Síntoma | Causa probable | Solución |
|---|---|---|
| “El formulario aún no está conectado a la base de datos” | No existe `config.js` | Local: crea `.env` y corre `npm run dev`. Cloudflare: agrega las variables y vuelve a desplegar. |
| “El servidor rechazó el registro por permisos” | Falta la política RLS o el GRANT | Vuelve a ejecutar `supabase/schema.sql` completo. |
| “No existe la tabla de visitantes” | No se ejecutó el SQL, o en otro proyecto | Revisa que la URL de `.env` sea del proyecto donde corriste el SQL. |
| “Uno de los datos no tiene el formato esperado” | Una validación del servidor rechazó un dato | Revisa teléfono (10 a 15 dígitos) y correo. |
| El build de Cloudflare falla con “Faltan variables” | Variables mal escritas o no guardadas | Revisa los nombres exactos: `SUPABASE_URL`, `SUPABASE_ANON_KEY`. |
| `git push` pide contraseña y la rechaza | GitHub ya no acepta contraseñas | Usa un token personal (paso 2.4). |
| La página sale en blanco al abrir `index.html` con doble clic | Los módulos JS requieren servidor | Usa `npm run dev`. |

## Agregar un campo nuevo

1. En `supabase/schema.sql`: agrega la columna, su `check` y añádela al `grant insert (...)`. Ejecuta solo esos cambios con `alter table`.
2. En `public/index.html`: copia un bloque `.field` existente y cambia `id`, `name` y textos.
3. En `public/app.js`: agrega su regla en `rules` y su valor en `payload`.
