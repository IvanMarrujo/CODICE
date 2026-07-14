# CÓDICE — Sistema de gestión de personal

Stack: Next.js 14 + Node/Express + PostgreSQL 16 + Redis 7 + Prisma + TypeScript  
Multi-tenant: PostgreSQL schema por tenant + Redis namespace por tenant  
OS de desarrollo: Windows 11 + WSL2 (Ubuntu) + Docker Desktop

---

## Setup inicial (correr UNA sola vez)

```bash
# 1. Clonar / entrar a la carpeta
cd codice

# 2. Instalar dependencias (desde WSL2)
npm install

# 3. Copiar variables de entorno
cp .env .env.local
# → Editar .env.local y poner tu ANTHROPIC_API_KEY

# 4. Levantar PostgreSQL + Redis + pgAdmin con Docker
npm run docker:up

# Verificar que los contenedores estén healthy:
docker ps

# 5. Generar el Prisma client (schema público)
npm run db:push

# 6. Provisionar el primer tenant (piloto GFP)
npx ts-node scripts/provisionTenant.ts \
  --slug gfp \
  --name "Grupo Food Packing Co." \
  --email admin@gfp.mx \
  --plan CORE \
  --industry MANUFACTURA_ALIMENTOS

# Guarda el password temporal que imprime el script.
```

---

## Desarrollo diario

```bash
# Levantar todo (API + Web en paralelo via Turborepo)
npm run dev

# API sola:  http://localhost:3001
# Web sola:  http://localhost:3000
# pgAdmin:   http://localhost:5050  (admin@codice.local / admin)

# Health check de la API:
curl http://localhost:3001/health
```

---

## Comandos útiles

```bash
# Ver logs de Docker
docker logs codice_postgres -f
docker logs codice_redis -f

# Prisma Studio (explorar DB en el browser)
npm run db:studio

# Provisionar otro tenant
npx ts-node scripts/provisionTenant.ts \
  --slug marrujo \
  --name "Marrujo & Asociados" \
  --email admin@marrujo.mx \
  --plan ENTERPRISE \
  --industry DESPACHO_JURIDICO

# Bajar los contenedores (preserva datos)
npm run docker:down

# Bajar y BORRAR datos (reset total)
docker compose -f docker/docker-compose.yml down -v
```

---

## Estructura del monorepo

```
codice/
├── apps/
│   ├── api/          Node.js + Express + TypeScript
│   │   └── src/
│   │       ├── routes/       Un archivo por recurso
│   │       ├── middleware/   tenant · auth · rateLimit · errorHandler
│   │       ├── services/     Lógica de negocio
│   │       ├── jobs/         BullMQ workers (ETL conectores)
│   │       ├── connectors/   contpaq/ · nomipaq/ · excel/
│   │       └── lib/          prisma · redis · errors
│   └── web/          Next.js 14 + Tailwind
│       └── src/
│           ├── app/          App Router pages
│           ├── components/   UI components
│           └── lib/          API client, hooks
├── packages/
│   ├── database/     Prisma schema (schema público) + tenant-schema.sql
│   ├── shared/       Tipos y utils compartidos
│   └── ui/           Componentes compartidos
├── scripts/
│   └── provisionTenant.ts   Provisiona un tenant nuevo en 30s
├── docker/
│   ├── docker-compose.yml
│   └── init/01_init.sql
└── .github/workflows/ci.yml
```

---

## Modelo multi-tenant

- **Schema público** (`public`): tenants, admin_users, subscriptions, audit_log global
- **Schema por tenant** (`tenant_{id}`): employees, contracts, payroll_records, requests, courses, actas, mentions, bonuses, notifications, signage_slides, audit_log
- **Redis**: namespace `t:{tenant_id}:*` por tenant
- **R2**: bucket `codice-{tenant_id}` por tenant

El middleware de Express setea `SET search_path = tenant_{id}` en cada request → Prisma opera exclusivamente en el schema de ese tenant.

---

## Conectores legacy

| Sistema  | Método fase 1       | Método fase 2            |
|----------|---------------------|--------------------------|
| Contpaq  | Upload XML CFDI     | SDK + microservicio C#   |
| Nomipaq  | Upload Excel export | Leer DBF (dbffile npm)   |
| Excel    | Upload .xlsx        | Google Sheets API        |

**Encoding crítico para Nomipaq DBF:** siempre `CP850` en `DBFFile.open()`.
