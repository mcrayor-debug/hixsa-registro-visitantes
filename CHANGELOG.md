# Historial de versiones

## 4.1.0 (noviembre 2026)

### Nuevo
- **Favicon e ícono de app** de HIXSA (SVG, con versiones PNG de 32, 180 y 512 px).
- **Nueva invitación desde el panel** (Consultas → Por visitante, Configuración → Visitantes): reutiliza los datos e identificación del visitante, queda aprobada, avisa al anfitrión y envía un QR nuevo. Visitante restringido: la aprueba el anfitrión.
- **Editar usuarios**: nombre, correo (también el de acceso) y celular.
- **Editar visitantes**: nombre, correo, teléfono, empresa, identificación y selfie; aplica al perfil y a sus visitas próximas. Si cambia el correo, se reenvían sus pases.
- **Bitácora** con filtro de fechas y apartado, páginas de 25 y agrupada por día.
- **Reportes**: botón *Enviar ahora* (diario o semanal, eligiendo la fecha) para roles con permiso de exportar.
- **Calendario**: el correo de recepción recibe todas las visitas automáticamente; botón *Sincronizar visitas próximas*.
- **Gráficas de dona**: estado de las visitas (Consultas) y motivo (Tablero).
- **Formulario**: logos pequeños en la lista de empresas; opción de mostrar solo el nombre del anfitrión; al escribir un correo con perfil se envía el código automáticamente (aviso genérico).
- **Importación**: vista previa del servidor (nuevas, a actualizar, omitidas) y opción de actualizar lo ya importado.
- **Recepción**: *Visitas de hoy* muestra el rango de horas.

### Cambios
- Nueva Edge Function `crear-invitacion`; migración `20261113_v4_1_0.sql`.
- Estilo del botón *Enviarme otro código* en el formulario.

## 4.0.0 (noviembre 2026)

Versión 4 completa (fases 1 a 4).

### Nuevo
- **Documentación**: guía de instalación desde cero, documentación técnica (arquitectura, modelo de datos, seguridad, funciones, cómo hacer cambios), manual del visitante (modo normal y auditoría) y manual del personal, en Markdown y PDF con la identidad de HIXSA.
- Diagramas editables en `docs/diagramas/` (Mermaid).

### Mantenimiento
- jsPDF 4.2.1, jspdf-autotable 5.0.9 y DOMPurify 3.4.17: **0 vulnerabilidades** en el código que llega al navegador.
- Panel dividido en partes que cargan bajo demanda: la carga inicial baja de ~1.6 MB a ~540 KB; PDF y gráficas solo se descargan al usarse.
- Vite se mantiene en 5.4: sus avisos solo afectan a su servidor de desarrollo, que el proyecto no usa.

## 4.0.0-fase.3 (noviembre 2026)

### Nuevo
- **Consultas** en tres grupos: *por fecha* (con “quién estuvo”, “sin salida registrada” y duración promedio), *por visitante* (historial, estado actual de su invitación y **reenviar QR**) y *de seguridad* (activos ahora, QR usados fuera de horario, intentos con QR vencido y **log de auditoría** exportable).
- **Pestaña Reportes** semanal y mensual: Total, Únicos, Puntual y Exportar; visitas por día, horas pico, nuevos contra recurrentes, invitaciones vencidas sin uso, resumen del mes, top 10, ocupación por franja horaria y visitas por anfitrión y área.
- **PDF** con la identidad de HIXSA en consultas, reportes y log de auditoría; envío por correo con CSV y PDF.
- **Reportes automáticos desde Supabase** (pg_cron): diario de lunes a viernes 07:00 y semanal los lunes 07:05, con modo auditoría. Botón de prueba para el SUPERADMIN.
- **Calendario**: el pase incluye invitación `.ics` y enlace “Agregar a Google Calendar”; los correos configurados reciben **todas** las visitas como invitación (y la cancelación si el anfitrión rechaza).
- **Importación** de Glide (`visitantes.csv` y `Visitas.csv`) y de la plantilla HIXSA, con vista previa, sin duplicados y copia de fotos.
- **Borrado de perfiles** con filtros (solo SUPERADMIN): borra perfil y fotos y anonimiza el historial.
- Recepción ve **ACCESO NO PERMITIDO** también en pases de otro día (antes: “no encontrado”) y el intento queda registrado.
- Mensaje claro cuando una empresa no tiene anfitriones.

### Cambios
- Se retiraron el workflow de GitHub `reporte-diario.yml` y `scripts/reporte-diario.mjs`. **Ya no se usa la API de Claude.**
- Indicadores calculados en un solo módulo compartido: `supabase/functions/_shared/estadisticas.js` (panel y correos dan las mismas cifras).
- Visitas con `origen` (formulario, glide, importacion); las importadas no cuentan en puntualidad.

## 4.0.0-fase.2 (noviembre 2026)

### Nuevo
- **Validación de horario en el servidor**: la entrada solo se registra desde N minutos antes (configurable, 10 por defecto) hasta la tolerancia. Fuera de eso, Recepción ve **ACCESO NO PERMITIDO** con el motivo (llegada anticipada, tarde, fecha no asignada, pase caducado) y una sugerencia.
- **Entrada autorizada**: si el problema es autorizable (llegó antes o tarde el mismo día, o el anfitrión aún no aprueba), Recepción puede autorizar con **motivo obligatorio**; queda registrado y no cuenta como puntual. Las salidas siempre se permiten.
- **Intentos de acceso**: cada rechazo o autorización queda guardado (base de las consultas de seguridad de la fase 3).
- **Aprobación del anfitrión**: recibe un correo con **Aprobar / Rechazar** (página de confirmación, enlace de un solo uso). Sin anfitrión con correo, valida Recepción. Se avisa al visitante del resultado.
- **Visitantes recurrentes**: recuperan sus datos con su correo y un **código de 6 dígitos** (10 min, 5 intentos); se reutilizan sus fotos. Casilla “Guardar mis datos” para los nuevos.
- **Selfie obligatoria** para quien accede a salas de juntas.
- **Equipo de cómputo** opcional: tipo, marca y número de serie.
- **Perfiles de visitantes** y **bloqueos** (no deseado, restringido, bloqueado) en Configuración → Visitantes, con aviso por correo a los SUPERADMIN y a sus anfitriones.
- **Ficha de Recepción** con QR del pase, identificación, selfie, equipo, estado de aprobación, alertas e historial de intentos; diseño para celular y tablet con acciones siempre visibles.

### Cambios
- Los estados de visita ahora incluyen “Pendiente de aprobación”, “Rechazada” y “Vencido sin uso”.
- El botón de llegada se llama “Registrar entrada” y siempre valida en el servidor.
- Nuevas Edge Functions: `visitante-recurrente`, `aprobar-visita`, `gestionar-visitante`. Nueva página `aprobar.html`.

## 4.0.0-fase.1 (noviembre 2026)

### Nuevo
- **Identidad oficial HIXSA**: paleta del Manual de Identidad (azul #0047BA, cian #00A9E0, naranja #F38A00, amarillo #FFCD00), tipografía Calibri y logotipo en formulario, panel y correos.
- **Bienvenida por empresa**: pantalla completa para elegir la empresa a visitar (botones con logo y lista). En **modo auditoría** solo aparece HIXSA.
- **Empresas a visitar** configurables (nombre, logo, botón o lista, orden, activa) y **logo del sistema** editable.
- **Modo auditoría** aplicado en la base de datos: el panel y los reportes solo muestran la empresa principal.
- **Roles con permisos**: SUPERADMIN, ADMIN, SUPERVISOR, RECEPCIÓN y CONSULTA, con secciones, alcance de consulta (hoy, semana, sin límite) y permiso de exportar. El SUPERADMIN crea, edita y borra roles y usuarios.
- **Nombre y apellidos** por separado; **empresa de origen** y **empresa a visitar** como campos distintos.
- **Anfitriones**: celular, foto (privada) y varias empresas; el formulario los filtra por la empresa elegida.
- **Tolerancia de llegada** configurable (minutos).
- **Bitácora de cambios**: quién cambió qué y cuándo en usuarios, roles, empresas, anfitriones y configuración.
- Botón visible **“Acceso para personal”** en la bienvenida y en el formulario.

### Cambios
- El rol `admin` se conserva como ADMIN y `consulta` como CONSULTA; CONSULTA ya no exporta ni envía reportes.
- El formulario obtiene empresas y anfitriones con la función pública `config_publica()` (sin acceso directo a tablas).
- Ya no se cargan fuentes de Google; las cabeceras de seguridad se ajustaron.
- Migraciones en `supabase/migrations/` (la primera: `20261110_v4_fase1.sql`).

## 3.0.0 (noviembre 2026)

### Nuevo
- Panel interno migrado a **React 18 + Vite**, publicado en `/admin/` (`admin.html` redirige).
- **Recepción**: lector de QR con la cámara, ficha de la visita y registro de **llegada y salida reales**.
- **Aviso al anfitrión** por correo cuando llega su visita (activable en Configuración).
- **Directorio de anfitriones** administrable; el formulario muestra solo nombre y área.
- **Identificación** en el registro: tipo (INE, licencia, pasaporte, ID de empresa, otro) y foto, guardada en un bucket privado.
- **Tablero de estadísticas**: asistencia, en sitio, duración real, visitas por día, hora de llegada, motivos, anfitriones y empresas.
- Nueva Edge Function `registrar-acceso`.
- Reporte diario: asistencia, visitas que no se presentaron y visitas sin salida registrada.

### Cambios
- Cloudflare publica la carpeta `dist` (antes `public`); requiere `npm install` en local.
- `scripts/build-config.js` pasa a `build-config.cjs`; nuevo `scripts/build.mjs`.
- Cabeceras: cámara permitida para el sitio e imágenes de Supabase Storage.

## 2.0.0 (octubre 2026)

### Nuevo
- Fecha y hora de entrada y salida elegidas por el visitante.
- Pase con código QR (folio + huella de datos y horario) enviado por correo y mostrado en pantalla.
- Panel interno con inicio de sesión: Consultas (filtros, CSV, reporte por correo) y Configuración (usuarios, roles, correos, bitácora).
- Validación del pase al escanear el QR.
- Edge Functions: `registrar-visita`, `admin-usuarios`, `enviar-reporte`.
- Reporte diario automático con API de Supabase y API de Claude (GitHub Actions, 07:00 CDMX).
- Conexión MCP a Supabase (solo lectura) y skill `reporte-visitas` para Claude Code.
- Verificación automática (CI) en cada push.

### Cambios
- El público ya no inserta directo en la base: todo pasa por `registrar-visita`.
- Modelo de datos v2 con migración segura desde la v1.

## 1.0.0
- Formulario público de registro con paleta HIXSA, Supabase con RLS y despliegue en Cloudflare Pages.
