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

## Pruebas contra datos reales / producción
Cuando cualquier feature necesite verificarse "en vivo" contra un tenant
real (contratos, separación laboral, nómina, cualquier flujo que escriba
filas reales), NUNCA uses un empleado real existente para la prueba.
Usa siempre `scripts/seedSyntheticTestEmployee.ts`:

- Insertar: `npx ts-node scripts/seedSyntheticTestEmployee.ts --tenant={slug}`
- Limpiar:  `npx ts-node scripts/seedSyntheticTestEmployee.ts --tenant={slug} --cleanup`

Corre siempre el `--cleanup` al terminar la verificación, en la misma
sesión donde se insertó — no dejes empleados sintéticos residuales en
ningún tenant, ni en producción ni en local.

Si `scripts/seedSyntheticTestEmployee.ts` no existe todavía en la
branch/worktree donde estás trabajando, créalo primero (revisa si ya
existe en otra branch antes de reinventarlo) siguiendo este patrón:
nombre obviamente falso (ej. "ZZZ PRUEBA QA"), CURP/NSS con prefijo
reconocible que nunca choque con datos reales, `--tenant` como parámetro
dinámico (nunca hardcodeado a un tenant), con su propio `--cleanup`
correspondiente que borre el empleado y cualquier registro relacionado
que haya generado (contratos, procesos de separación, asistencia, etc.).
