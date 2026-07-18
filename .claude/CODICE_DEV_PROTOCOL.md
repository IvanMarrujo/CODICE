# CÓDICE — Multi-Terminal Development Protocol

## Regla de oro
Nunca `git add .` — siempre stagear archivos específicos explícitamente.

## Antes de empezar cualquier tarea
1. `git fetch origin`
2. `git pull --rebase origin main`
3. `git checkout -b feat/{nombre-descriptivo}`

## Durante el trabajo
- Stagear SOLO tus archivos: `git add apps/api/src/routes/miarchivo.ts`
- Nunca tocar archivos de otra terminal
- Si detectas conflicto: STOP — reportar a Ivan

## Antes de hacer push
1. `git fetch origin`
2. `git log origin/main..HEAD` — confirmar que no hay divergencia
3. `git push origin feat/{nombre}`
4. NUNCA `git push --force` en main

## Firma obligatoria al terminar
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✦ T{N} — {FEATURE} — COMPLETADO
Branch: feat/{nombre}
Commit: {hash}
Archivos modificados: {lista}
Endpoints nuevos: {lista o none}
Migraciones pendientes: {yes/no}
Notas: {lo que Ivan necesita saber}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

## Qué hacer si el trabajo ya está hecho
Si al revisar el código encuentras que otra terminal ya implementó
lo que te asignaron: reportarlo en la firma y NO hacer commit duplicado.

## Branches activos
- main: producción — solo merges, nunca trabajo directo
- feat/*: trabajo en progreso por terminal

## Merge a main
Solo Ivan o terminal designada hace merge de feat/* → main.
Siempre --no-ff para mantener historial limpio.
