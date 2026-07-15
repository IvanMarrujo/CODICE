# CÓDICE — Start local dev environment
Write-Host "✦ CÓDICE — Iniciando stack de desarrollo..." -ForegroundColor Cyan

# Stop conflicting containers
Write-Host "Deteniendo contenedores en conflicto..." -ForegroundColor Yellow
docker stop talentstream-dev-postgres-1 2>$null
docker stop talentstream-dev-redis-1 2>$null

# Start CÓDICE containers
Write-Host "Levantando CÓDICE Docker stack..." -ForegroundColor Cyan
Set-Location $PSScriptRoot
docker compose -f docker/docker-compose.yml up -d

# Wait for healthy
Write-Host "Esperando containers healthy..." -ForegroundColor Yellow
Start-Sleep -Seconds 8

# Start API in background
Write-Host "Iniciando API en localhost:3001..." -ForegroundColor Cyan
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$PSScriptRoot\apps\api'; npm run dev"

# Start web in background
Write-Host "Iniciando Web en localhost:3000..." -ForegroundColor Cyan
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$PSScriptRoot\apps\web'; npx vite --port 3000 --host"

Write-Host ""
Write-Host "✅ CÓDICE corriendo:" -ForegroundColor Green
Write-Host "   Admin:       http://localhost:3000" -ForegroundColor White
Write-Host "   Colaborador: http://localhost:3000/empleado" -ForegroundColor White
Write-Host "   API:         http://localhost:3001" -ForegroundColor White
Write-Host "   pgAdmin:     http://localhost:5050" -ForegroundColor White
Write-Host ""
Write-Host "   Producción:  https://web-ten-snowy-53.vercel.app" -ForegroundColor Cyan
