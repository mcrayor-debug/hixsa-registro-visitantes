# Despliegue de la versión 4.2.2

Requiere la 4.2.1 desplegada. **Sin cambios en la base de datos.** Ejecuta los comandos uno por uno.

## 1. Preparar la carpeta (antes de copiar el zip)

```powershell
cd "C:\Users\mario.rivera\Documents\MARIO\HIXSA\APP REG VISITAS CLAUDE\PROYECTO CLAUDE\VERSION_QR_ADMIN\files_regitro hixsa_2\hixsa-registro-visitantes\hixsa-registro-visitantes"
```
```powershell
git status --short
```
Si muestra cambios, guárdalos (`git add -A` y `git commit -m "cambios pendientes"`). Con la carpeta limpia:
```powershell
git pull --rebase origin main
```

## 2. Copiar los archivos
Copia el contenido de `v4.2.2-archivos.zip` encima de la carpeta del proyecto, reemplazando archivos.

## 3. Función (1 actualizada)
```powershell
npx supabase functions deploy reporte-programado --no-verify-jwt --use-api
```
**Qué deberías ver:** `Deployed Functions on project ziqfcmgufkeydulgtnvl`.

(Cambia solo el envío manual con detalle y se retira la leyenda de modo auditoría del correo; los reportes automáticos siguen igual.)

## 4. Publicar el sitio
```powershell
npm run build
```
```powershell
git add -A
git commit -m "fix: versión 4.2.2"
git push
```
**Qué deberías ver:** `✔ Build listo` y `main -> main` sin *rejected*. Cuando Cloudflare termine, recarga el panel con **Ctrl + F5** (en el celular, cierra y vuelve a abrir la pestaña).

## 5. Verificación
1. **Celular:** Dashboard, Reportes y Configuración ya no tienen tarjetas encimadas. Configuración muestra el selector *Apartado*.
2. **Modo auditoría:** solo aparece un punto amarillo junto al logo; en Dashboard, Consultas y Reportes se lee *Empresa a visitar: HIXSA*.
3. **Reportes → Mensual:** el campo *Mes que contiene* es igual al semanal.
4. **Reportes → Incluir detalle de visitantes:** aparece la tabla; el PDF incluye *Detalle de visitantes*.
5. **Enviar reporte ahora** con *Con detalle de visitantes*: el correo trae la tabla de visitas.
6. **Consultas → Por visitante:** resultados de 10 en 10.
