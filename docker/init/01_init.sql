-- ============================================================
-- CÓDICE · PostgreSQL initialization
-- Runs once when the container is first created
-- ============================================================

-- Extensions
CREATE EXTENSION IF NOT EXISTS "pgcrypto";    -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS "pg_trgm";     -- fuzzy search en nombres
CREATE EXTENSION IF NOT EXISTS "unaccent";    -- búsqueda sin acentos (García = garcia)
-- CREATE EXTENSION IF NOT EXISTS "vector";   -- pgvector — habilitar en fase 2 (IA)

-- App role con permisos limitados (el API nunca usa superuser)
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'codice_app') THEN
    CREATE ROLE codice_app LOGIN PASSWORD 'codice_app_2024';
  END IF;
END
$$;

GRANT CONNECT ON DATABASE codice_main TO codice_app;
GRANT USAGE  ON SCHEMA public TO codice_app;

-- Función helper para setear el tenant en cada request
-- El middleware de Express llama: SET app.current_tenant = 'tenant_abc123'
CREATE OR REPLACE FUNCTION current_tenant_id() RETURNS TEXT AS $$
  SELECT current_setting('app.current_tenant', true)
$$ LANGUAGE sql STABLE;

COMMENT ON FUNCTION current_tenant_id() IS
  'Retorna el tenant_id activo seteado por el middleware de Express en cada request. Usado por RLS.';
