# Despliegue de la versión 4.2.1

Requiere la 4.2.0 desplegada. No hay cuentas ni secretos nuevos. **Ejecuta los comandos uno por uno.**

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
Copia el contenido de `v4.2.1-archivos.zip` encima de la carpeta del proyecto, reemplazando archivos.

## 3. Base de datos
Supabase, proyecto **hixsa-visitantes** (la dirección contiene `ziqfcmgufkeydulgtnvl`) → **SQL Editor → New query** → pega `supabase/migrations/20261120_v4_2_1.sql` → **Run**.

**Qué deberías ver:** `dias_inhabiles` (los que ya tenías) y `dias_especiales = 0`.

## 4. Funciones (3 actualizadas)
```powershell
npx supabase functions deploy registrar-visita --no-verify-jwt --use-api
```
```powershell
npx supabase functions deploy crear-invitacion --no-verify-jwt --use-api
```
```powershell
npx supabase functions deploy reporte-programado --no-verify-jwt --use-api
```
**Qué deberías ver** en cada uno: `Deployed Functions on project ziqfcmgufkeydulgtnvl`.

## 5. Publicar el sitio
```powershell
npm run build
```
```powershell
git add -A
git commit -m "fix: versión 4.2.1"
git push
```
**Qué deberías ver:** `✔ Build listo` y `main -> main` sin *rejected*. Cuando Cloudflare termine, recarga el panel con **Ctrl + F5**.

## 6. Verificación
1. **Consultas → Por visitante:** busca a alguien y abre su perfil; ya no se queda en blanco.
2. **Configuración → Calendario laboral:** agrega *Cena de fin de año*, 4 de diciembre, **Horario especial** de 09:00 a 14:00. Debe aparecer en la lista con `09:00 – 14:00`.
3. **Recepción:** en el calendario, el 4 de diciembre aparece en amarillo con `9–14`.
4. **Formulario:** al elegir el 4 de diciembre aparece el aviso del horario especial; una entrada a las 13:50 o una salida a las 15:00 se rechazan.
5. **Campana:** se cierra con **×**, con **Esc** o con clic fuera; *Marcar como leídas* es un botón.

## Notas
- Al agregar un horario especial, el aviso indica cuántas visitas ya registradas quedan fuera; **no se cancelan solas**. Revísalas en Consultas y cancélalas desde su ficha si hace falta.
- Pendiente: manuales y documentación técnica (cuando lo autorices).
