-- ============================================================
-- CÓDICE · Tenant schema template
-- Se ejecuta una vez por tenant al provisionar.
-- Reemplazar {SCHEMA} con el dbSchema del tenant, ej: tenant_abc123
-- ============================================================

-- ─── EMPLOYEES ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS {SCHEMA}.employees (
  id                TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  tenant_id         TEXT        NOT NULL,

  -- Identificación
  employee_code     TEXT,                    -- clave interna (ej: GFP-1038)
  rfc               TEXT,
  curp              TEXT,
  nss               TEXT,                    -- número seguridad social IMSS

  -- Nombre
  first_name        TEXT        NOT NULL,
  last_name         TEXT        NOT NULL,
  full_name         TEXT GENERATED ALWAYS AS (first_name || ' ' || last_name) STORED,

  -- Puesto
  department        TEXT,
  position          TEXT,
  plant             TEXT,                    -- planta / sucursal
  shift             TEXT,                    -- turno: Matutino, Vespertino, Nocturno
  supervisor_name   TEXT,                    -- nombre del jefe directo (Supervisor Shell — ver AdminUser.assignedDepartment)

  -- Contrato
  contract_type     TEXT        DEFAULT 'Indeterminado',
  hire_date         DATE,
  termination_date  DATE,
  trial_end_date    DATE,                    -- fin de periodo de prueba

  -- Salario
  daily_salary      NUMERIC(10,2),
  monthly_salary    NUMERIC(10,2),
  salary_base_imss  NUMERIC(10,2),          -- salario base de cotización

  -- Contacto
  email             TEXT,
  phone             TEXT,
  personal_email    TEXT,
  bank_clabe        TEXT,
  bank_name         TEXT,

  -- Status
  status            TEXT        DEFAULT 'Activo',
  -- Activo | Vacaciones | Incapacidad | Permiso | Periodo de prueba | Baja pendiente | Baja

  -- Origen del dato
  source            TEXT        DEFAULT 'MANUAL',
  -- CONTPAQ_XML | NOMIPAQ_DBF | NOMIPAQ_EXCEL | EXCEL_GENERIC | MANUAL

  -- Gamificación
  xp_points         INTEGER     DEFAULT 0,
  xp_level          INTEGER     DEFAULT 1,
  streak_days       INTEGER     DEFAULT 0,
  streak_last_date  DATE,
  badges            JSONB       DEFAULT '[]',

  -- Metadata
  avatar_url        TEXT,
  notes             TEXT,
  raw_source_data   JSONB,                  -- datos originales del conector, para debug
  custom_fields     JSONB       DEFAULT '{}', -- campos ad-hoc creados en el wizard de conectores (Step 3)

  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW(),

  CONSTRAINT uq_employee_rfc    UNIQUE (tenant_id, rfc),
  CONSTRAINT uq_employee_code   UNIQUE (tenant_id, employee_code)
);

CREATE INDEX idx_emp_tenant   ON {SCHEMA}.employees (tenant_id);
CREATE INDEX idx_emp_status   ON {SCHEMA}.employees (status);
CREATE INDEX idx_emp_dept     ON {SCHEMA}.employees (department);
CREATE INDEX idx_emp_fullname ON {SCHEMA}.employees USING gin (full_name gin_trgm_ops);
-- ^ permite búsqueda fuzzy: WHERE full_name % 'garcia' (unaccent en fase 2)

-- ─── CONTRACTS ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS {SCHEMA}.contracts (
  id              TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  tenant_id       TEXT        NOT NULL,
  employee_id     TEXT        REFERENCES {SCHEMA}.employees(id) ON DELETE CASCADE,

  contract_type   TEXT        NOT NULL,
  -- Indeterminado | Determinado | Obra/Proyecto | Periodo de prueba | Capacitación inicial

  start_date      DATE        NOT NULL,
  end_date        DATE,
  duration_desc   TEXT,                    -- "12 meses", "Proyecto Alpha"

  monthly_salary  NUMERIC(10,2),
  daily_salary    NUMERIC(10,2),
  position        TEXT,
  plant           TEXT,

  -- Generación
  generated_by    TEXT,                    -- admin user id
  template_used   TEXT,                    -- blueprint utilizado
  pdf_url         TEXT,                    -- URL en R2
  html_content    TEXT,                    -- HTML del contrato para regenerar PDF

  signed_at       DATE,
  signed_by_worker   BOOLEAN  DEFAULT false,
  signed_by_employer BOOLEAN  DEFAULT false,

  notes           TEXT,
  status          TEXT        DEFAULT 'Borrador',
  -- Borrador | Firmado | Vigente | Vencido | Cancelado

  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_contracts_emp    ON {SCHEMA}.contracts (employee_id);
CREATE INDEX idx_contracts_status ON {SCHEMA}.contracts (status);
CREATE INDEX idx_contracts_type   ON {SCHEMA}.contracts (contract_type);

-- ─── PAYROLL RECORDS ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS {SCHEMA}.payroll_records (
  id              TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  tenant_id       TEXT        NOT NULL,
  employee_id     TEXT        REFERENCES {SCHEMA}.employees(id) ON DELETE CASCADE,

  -- Identificación del recibo
  folio           TEXT,
  uuid_sat        TEXT,                    -- UUID del timbre fiscal (CFDI)
  cfdi_xml_url    TEXT,                    -- URL del XML en R2

  -- Período
  payroll_type    TEXT        DEFAULT 'Quincenal',
  -- Quincenal | Semanal | Mensual | Aguinaldo | Prima vacacional | Finiquito
  period_start    DATE,
  period_end      DATE,
  payment_date    DATE,
  days_paid       NUMERIC(5,2),
  period_label    TEXT,                    -- "Q13 2026" etc. — Excel genérico sin folio/UUID
                                            -- fiscal ni rango de fechas confiable; junto con
                                            -- payment_date es la llave de upsert (ver connectors.ts)

  -- Percepciones (MXN)
  gross_taxable   NUMERIC(10,2) DEFAULT 0,  -- percepciones gravadas
  gross_exempt    NUMERIC(10,2) DEFAULT 0,  -- percepciones exentas
  total_income    NUMERIC(10,2) DEFAULT 0,

  -- Deducciones (MXN)
  isr             NUMERIC(10,2) DEFAULT 0,
  imss_employee   NUMERIC(10,2) DEFAULT 0,
  infonavit       NUMERIC(10,2) DEFAULT 0,
  other_deductions NUMERIC(10,2) DEFAULT 0,
  total_deductions NUMERIC(10,2) DEFAULT 0,

  -- Neto
  net_pay         NUMERIC(10,2) DEFAULT 0,

  -- Origen
  source          TEXT        DEFAULT 'MANUAL',

  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW(),

  CONSTRAINT uq_payroll_uuid UNIQUE (tenant_id, uuid_sat)
);

CREATE INDEX idx_payroll_emp    ON {SCHEMA}.payroll_records (employee_id);
CREATE INDEX idx_payroll_date   ON {SCHEMA}.payroll_records (payment_date);
CREATE INDEX idx_payroll_period ON {SCHEMA}.payroll_records (period_start, period_end);

-- ─── TIME OFF (vacaciones, permisos, incapacidades) ───────────

CREATE TABLE IF NOT EXISTS {SCHEMA}.time_off (
  id              TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  tenant_id       TEXT        NOT NULL,
  employee_id     TEXT        REFERENCES {SCHEMA}.employees(id) ON DELETE CASCADE,

  type            TEXT        NOT NULL,
  -- Vacaciones | Permiso con goce | Permiso sin goce | Incapacidad IMSS | Maternidad | Paternidad

  start_date      DATE        NOT NULL,
  end_date        DATE        NOT NULL,
  days            INTEGER     NOT NULL,

  notes           TEXT,
  document_url    TEXT,                    -- constancia médica, etc. en R2

  status          TEXT        DEFAULT 'Pendiente',
  -- Pendiente | Aprobada | Rechazada | Cancelada

  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_timeoff_emp    ON {SCHEMA}.time_off (employee_id);
CREATE INDEX idx_timeoff_status ON {SCHEMA}.time_off (status);
CREATE INDEX idx_timeoff_dates  ON {SCHEMA}.time_off (start_date, end_date);

-- ─── REQUESTS (solicitudes con flujo jefe→WKF) ───────────────

CREATE TABLE IF NOT EXISTS {SCHEMA}.requests (
  id              TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  tenant_id       TEXT        NOT NULL,
  employee_id     TEXT        REFERENCES {SCHEMA}.employees(id) ON DELETE CASCADE,

  type            TEXT        NOT NULL,
  -- Vacaciones | Permiso | Constancia laboral | Cambio de turno |
  -- Anticipo de nómina | Actualización de datos | Otro

  detail          TEXT,
  notes           TEXT,

  -- Flujo de aprobación (jefe directo → Workforce)
  stage           TEXT        DEFAULT 'MANAGER',
  -- MANAGER (pend. jefe) | WORKFORCE (pend. RH) | APPROVED | REJECTED | CANCELLED

  manager_id      TEXT,                    -- employee_id del jefe directo
  manager_name    TEXT,
  manager_approved_at TIMESTAMPTZ,
  manager_notes   TEXT,

  wkf_user_id     TEXT,                    -- admin user id de Workforce
  wkf_approved_at TIMESTAMPTZ,
  wkf_notes       TEXT,

  -- Si la solicitud generó un documento (constancia, etc.)
  document_url    TEXT,

  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_req_emp    ON {SCHEMA}.requests (employee_id);
CREATE INDEX idx_req_stage  ON {SCHEMA}.requests (stage);
CREATE INDEX idx_req_type   ON {SCHEMA}.requests (type);

-- ─── ATTENDANCE (check-in / check-out — MOCK: sin checadora física,
-- ver checin/checkout en routes/attendance.ts) ────────────────
-- Un registro por colaborador por día (upsert vía check_in_at::date).

CREATE TABLE IF NOT EXISTS {SCHEMA}.attendance_records (
  id              TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  tenant_id       TEXT        NOT NULL,
  employee_id     TEXT        REFERENCES {SCHEMA}.employees(id) ON DELETE CASCADE,

  check_in_at     TIMESTAMPTZ NOT NULL,
  check_out_at    TIMESTAMPTZ,

  plant           TEXT,                    -- ubicación mock, ej: "Planta Vallejo · Acceso principal"
  method          TEXT        DEFAULT 'QR',
  -- QR | MANUAL | KIOSK | MOCK_SEED | ZKTECO_ADMS

  -- Checadora biométrica (ZKTeco ADMS push) — NULL para todo lo que no
  -- venga de un dispositivo físico. Reusa `method` para la fuente en vez
  -- de una columna `source` separada (ver webhook/attendance/zkteco.ts).
  verify_mode     TEXT,                    -- fingerprint | card | face
  device_sn       TEXT,
  mock            BOOLEAN     DEFAULT true, -- false únicamente en filas de checadora real

  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_attendance_emp  ON {SCHEMA}.attendance_records (employee_id);
CREATE INDEX idx_attendance_date ON {SCHEMA}.attendance_records (check_in_at);

-- ─── ZKTECO ADMS — checadoras biométricas ─────────────────────
-- Metadata rica por dispositivo para el admin shell (alias, ubicación,
-- último ping). La resolución SN → tenant al recibir un push NO usa esta
-- tabla (no se sabe a qué tenant pertenece un SN todavía) — usa la tabla
-- global `public.zkteco_devices` (ver scripts/seedZktecoDevices.ts).

CREATE TABLE IF NOT EXISTS {SCHEMA}.zkteco_devices (
  id          TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  tenant_id   TEXT        NOT NULL,
  sn          TEXT        NOT NULL UNIQUE,
  alias       TEXT,
  location    TEXT,
  ip_address  TEXT,
  model       TEXT        DEFAULT 'UA760',
  last_ping   TIMESTAMPTZ,
  status      TEXT        DEFAULT 'ACTIVE',
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_zkteco_devices_tenant ON {SCHEMA}.zkteco_devices (tenant_id);

-- ─── ACTAS ADMINISTRATIVAS ────────────────────────────────────

CREATE TABLE IF NOT EXISTS {SCHEMA}.actas (
  id              TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  tenant_id       TEXT        NOT NULL,
  employee_id     TEXT        REFERENCES {SCHEMA}.employees(id) ON DELETE CASCADE,

  folio           TEXT,                    -- A-0031
  type            TEXT        NOT NULL,
  -- Acta administrativa | Amonestación verbal | Amonestación escrita |
  -- Suspensión | Baja justificada

  reason          TEXT        NOT NULL,
  incident_date   DATE,
  issue_date      DATE        NOT NULL,

  -- Firma
  worker_signed   BOOLEAN     DEFAULT false,
  worker_refused  BOOLEAN     DEFAULT false,   -- firmó de recibido pero en inconformidad
  witness_1       TEXT,
  witness_2       TEXT,

  pdf_url         TEXT,
  notes           TEXT,

  status          TEXT        DEFAULT 'Borrador',
  -- Borrador | Firmada | Impugnada | Archivada

  -- Testigo digital — cadena de custodia (ver acta_signatures abajo)
  document_hash    TEXT,        -- SHA256 del documento final, una vez FIRMADA
  finalized_at      TIMESTAMPTZ, -- cuándo se completaron las 4 firmas
  signature_count   INTEGER     DEFAULT 0,

  issued_by       TEXT,                    -- admin user id
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_actas_emp    ON {SCHEMA}.actas (employee_id);
CREATE INDEX idx_actas_status ON {SCHEMA}.actas (status);

-- ─── SUPERVISOR INCIDENTS ─────────────────────────────────────
-- Registro rápido de incidencias de piso (Supervisor Shell) — mucho más
-- ligero que `actas` (sin firma/folio/status de workflow): un supervisor
-- lo llena en segundos desde el celular. Severidad "grave" dispara WhatsApp
-- a RH (ver routes/supervisor.ts). No sustituye el acta administrativa
-- formal si el caso escala — eso sigue viviendo en `actas`.

CREATE TABLE IF NOT EXISTS {SCHEMA}.supervisor_incidents (
  id              TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  tenant_id       TEXT        NOT NULL,
  employee_id     TEXT        REFERENCES {SCHEMA}.employees(id) ON DELETE CASCADE,
  reported_by     TEXT        NOT NULL,        -- admin_user id (el supervisor)

  type            TEXT        NOT NULL,
  -- Retardo | Falta injustificada | Accidente leve | Accidente moderado/grave |
  -- Conducta inapropiada | Daño a equipo
  description     TEXT,
  severity        TEXT        NOT NULL,        -- leve | moderado | grave

  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_supervisor_incidents_emp    ON {SCHEMA}.supervisor_incidents (employee_id);
CREATE INDEX idx_supervisor_incidents_reporter ON {SCHEMA}.supervisor_incidents (reported_by);
CREATE INDEX idx_supervisor_incidents_date   ON {SCHEMA}.supervisor_incidents (created_at DESC);

-- ─── ACTA SIGNATURES (testigo digital) ─────────────────────────
-- Cadena de custodia inmutable para tribunales JFCA: un renglón por firmante
-- (colaborador, 2 testigos, RH) con hash SHA256, IP, dispositivo y geo.

CREATE TABLE IF NOT EXISTS {SCHEMA}.acta_signatures (
  id              TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  acta_id         TEXT        REFERENCES {SCHEMA}.actas(id) ON DELETE CASCADE,
  employee_id     TEXT        REFERENCES {SCHEMA}.employees(id),
  role            TEXT        NOT NULL,
  -- subject | witness_1 | witness_2 | hr_manager

  signed_at       TIMESTAMPTZ,
  signature_hash  TEXT,        -- SHA256(acta_id + employee_id + signed_at + secret)
  ip_address      TEXT,
  device_info     TEXT,
  location_lat    NUMERIC,
  location_lng    NUMERIC,
  location_mock   BOOLEAN     DEFAULT true,

  declined        BOOLEAN     DEFAULT false,   -- "no estoy de acuerdo" — no bloquea el acta
  declined_reason TEXT,

  created_at      TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT uq_acta_signature_role UNIQUE (acta_id, role)
);

CREATE INDEX idx_acta_signatures_acta ON {SCHEMA}.acta_signatures (acta_id);

-- ─── COURSES (LMS) ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS {SCHEMA}.courses (
  id              TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  tenant_id       TEXT        NOT NULL,

  title           TEXT        NOT NULL,
  category        TEXT,      -- Inocuidad | Calidad | Seguridad | Onboarding
  description     TEXT,
  duration_min    INTEGER,                  -- duración en minutos
  is_mandatory    BOOLEAN     DEFAULT false,
  expires_months  INTEGER,                  -- meses hasta vencimiento (null = nunca vence)

  -- Quiz
  quiz_questions  JSONB,                   -- array de { question, options[], correctIndex }
  pass_score      INTEGER     DEFAULT 70,   -- puntaje mínimo para aprobar (%)

  xp_reward       INTEGER     DEFAULT 100,  -- XP que da al completarlo
  thumbnail_url   TEXT,
  content_url     TEXT,                    -- video o PDF en R2

  is_active       BOOLEAN     DEFAULT true,
  created_by      TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_courses_cat      ON {SCHEMA}.courses (category);
CREATE INDEX idx_courses_mandatory ON {SCHEMA}.courses (is_mandatory);

-- ─── COURSE PROGRESS (progreso por empleado) ─────────────────

CREATE TABLE IF NOT EXISTS {SCHEMA}.course_progress (
  id              TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  tenant_id       TEXT        NOT NULL,
  employee_id     TEXT        REFERENCES {SCHEMA}.employees(id) ON DELETE CASCADE,
  course_id       TEXT        REFERENCES {SCHEMA}.courses(id)   ON DELETE CASCADE,

  progress_pct    INTEGER     DEFAULT 0,    -- 0-100
  score           INTEGER,                  -- calificación del quiz (0-100)
  attempts        INTEGER     DEFAULT 0,
  passed          BOOLEAN     DEFAULT false,
  xp_earned       INTEGER     DEFAULT 0,

  started_at      TIMESTAMPTZ,
  completed_at    TIMESTAMPTZ,
  expires_at      DATE,                    -- fecha de vencimiento de esta constancia
  constancia_url  TEXT,                    -- PDF en R2

  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW(),

  CONSTRAINT uq_progress UNIQUE (employee_id, course_id)
);

CREATE INDEX idx_progress_emp    ON {SCHEMA}.course_progress (employee_id);
CREATE INDEX idx_progress_course ON {SCHEMA}.course_progress (course_id);
CREATE INDEX idx_progress_passed ON {SCHEMA}.course_progress (passed);

-- ─── MENTIONS / RECONOCIMIENTOS ───────────────────────────────

CREATE TABLE IF NOT EXISTS {SCHEMA}.mentions (
  id              TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  tenant_id       TEXT        NOT NULL,
  employee_id     TEXT        REFERENCES {SCHEMA}.employees(id) ON DELETE CASCADE,

  type            TEXT        NOT NULL,    -- "Colaborador del mes", "Safety Day", etc.
  description     TEXT,
  awarded_by      TEXT,                   -- depto o persona que otorga
  awarded_date    DATE        NOT NULL,
  xp_bonus        INTEGER     DEFAULT 50,

  show_in_signage BOOLEAN     DEFAULT true,  -- mostrar en pantallas de planta
  image_url       TEXT,

  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_mentions_emp  ON {SCHEMA}.mentions (employee_id);
CREATE INDEX idx_mentions_date ON {SCHEMA}.mentions (awarded_date DESC);

-- ─── XP EVENTS (gamificación) ─────────────────────────────────
-- Historial de cada otorgamiento de XP — ver apps/api/src/lib/gamification.ts

CREATE TABLE IF NOT EXISTS {SCHEMA}.xp_events (
  id              TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  employee_id     TEXT        REFERENCES {SCHEMA}.employees(id) ON DELETE CASCADE,
  type            TEXT        NOT NULL,
  -- DAILY_ATTENDANCE | COURSE_COMPLETED | REQUEST_RESOLVED | RECOGNITION_RECEIVED |
  -- STREAK_7_DAYS | STREAK_30_DAYS | STREAK_100_DAYS
  xp_earned       INTEGER     NOT NULL,
  description     TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_xp_events_emp  ON {SCHEMA}.xp_events (employee_id);
CREATE INDEX idx_xp_events_date ON {SCHEMA}.xp_events (created_at DESC);

-- ─── BONUSES ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS {SCHEMA}.bonuses (
  id              TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  tenant_id       TEXT        NOT NULL,
  employee_id     TEXT        REFERENCES {SCHEMA}.employees(id) ON DELETE CASCADE,

  type            TEXT        NOT NULL,
  -- Puntualidad | Productividad | Asistencia perfecta | PTU | Otro
  period          TEXT,                   -- "May 2026", "Q1 2026"
  amount          NUMERIC(10,2) NOT NULL,

  status          TEXT        DEFAULT 'Pendiente',
  -- Pendiente | Pagado | Cancelado

  payment_date    DATE,
  notes           TEXT,

  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_bonuses_emp    ON {SCHEMA}.bonuses (employee_id);
CREATE INDEX idx_bonuses_status ON {SCHEMA}.bonuses (status);

-- ─── NOTIFICATIONS ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS {SCHEMA}.notifications (
  id              TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  tenant_id       TEXT        NOT NULL,
  employee_id     TEXT        REFERENCES {SCHEMA}.employees(id) ON DELETE CASCADE,

  type            TEXT        NOT NULL,
  -- REQUEST_APPROVED | REQUEST_REJECTED | COURSE_EXPIRING |
  -- CONTRACT_EXPIRING | BONUS_PAID | MENTION_RECEIVED

  title           TEXT        NOT NULL,
  body            TEXT,
  link            TEXT,                   -- ruta dentro de la app

  read            BOOLEAN     DEFAULT false,
  read_at         TIMESTAMPTZ,

  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_notif_emp    ON {SCHEMA}.notifications (employee_id);
CREATE INDEX idx_notif_read   ON {SCHEMA}.notifications (read);
CREATE INDEX idx_notif_date   ON {SCHEMA}.notifications (created_at DESC);

-- ─── SIGNAGE SLIDES ───────────────────────────────────────────

CREATE TABLE IF NOT EXISTS {SCHEMA}.signage_slides (
  id              TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  tenant_id       TEXT        NOT NULL,

  type            TEXT        NOT NULL,
  -- kpi | comunicado | reconocimiento | capacitacion | custom

  title           TEXT,
  content         JSONB,                  -- estructura del slide (KPIs, texto, etc.)
  plant           TEXT,                   -- null = todas las plantas

  duration_sec    INTEGER     DEFAULT 5,
  order_index     INTEGER     DEFAULT 0,
  is_active       BOOLEAN     DEFAULT true,

  valid_from      DATE,
  valid_until     DATE,

  created_by      TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_slides_plant  ON {SCHEMA}.signage_slides (plant);
CREATE INDEX idx_slides_active ON {SCHEMA}.signage_slides (is_active);

-- ─── CONNECTED SOURCES (live-wire file connections) ──────────
-- El archivo conectado es la fuente de verdad: se guarda su contenido
-- (base64) para poder re-correr el ETL sin pedir un nuevo upload.
-- Un tenant puede tener hasta 3 conexiones simultáneas, una por tipo.

CREATE TABLE IF NOT EXISTS {SCHEMA}.connected_sources (
  id                    TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  tenant_id             TEXT        NOT NULL,

  type                  TEXT        NOT NULL,
  -- EXCEL | DBF | CFDI

  file_name             TEXT        NOT NULL,
  file_content           TEXT        NOT NULL,   -- base64 del archivo original
  checksum              TEXT        NOT NULL,    -- MD5 de file_content

  auto_sync             BOOLEAN     DEFAULT false,
  sync_interval_minutes INTEGER     DEFAULT 15,

  status                TEXT        DEFAULT 'CONNECTED',
  -- CONNECTED | STALE | ERROR
  last_error            TEXT,

  last_read_at          TIMESTAMPTZ,             -- último reload/auto-sync exitoso
  last_modified_at      TIMESTAMPTZ DEFAULT NOW(), -- último reemplazo de archivo

  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW(),

  CONSTRAINT uq_connected_source_type UNIQUE (tenant_id, type)
);

CREATE INDEX idx_connected_sources_tenant ON {SCHEMA}.connected_sources (tenant_id);

-- ─── HEALTH PROFILES (perfil de salud del colaborador) ────────
-- Confidencial — LFPDPPP Art. 8. Solo accesible vía requireHR.

CREATE TABLE IF NOT EXISTS {SCHEMA}.health_profiles (
  id                    TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  tenant_id             TEXT        NOT NULL,
  employee_id           TEXT        REFERENCES {SCHEMA}.employees(id) ON DELETE CASCADE,

  tipo_sangre           TEXT,                    -- A+ | A- | B+ | B- | AB+ | AB- | O+ | O-
  alergias              JSONB       DEFAULT '[]',
  condiciones_declaradas JSONB      DEFAULT '[]',
  medicamentos          JSONB       DEFAULT '[]',

  contacto_emergencia_nombre    TEXT,
  contacto_emergencia_telefono  TEXT,
  contacto_emergencia_relacion  TEXT,

  fecha_ultimo_examen   DATE,
  notas_medicas         TEXT,
  documentos            JSONB       DEFAULT '[]',  -- [{ id, filename, key, size, mimeType, uploadedAt, uploadedBy }]

  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW(),

  CONSTRAINT uq_health_profile UNIQUE (tenant_id, employee_id)
);

CREATE INDEX idx_health_profiles_emp ON {SCHEMA}.health_profiles (employee_id);

-- ─── VACATION POLICY (política interna de vacaciones) ─────────
-- Debe ser siempre >= mínimos LFT 2026 — se valida en el endpoint,
-- no aquí (una fila por tenant, sin CHECK constraints por columna
-- para no tener que migrar el schema si la tabla LFT cambia).

CREATE TABLE IF NOT EXISTS {SCHEMA}.vacation_policy (
  id                            TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  tenant_id                     TEXT        NOT NULL,

  year_1_days                   INTEGER     DEFAULT 12,
  year_2_days                   INTEGER     DEFAULT 14,
  year_3_days                   INTEGER     DEFAULT 16,
  year_4_days                   INTEGER     DEFAULT 18,
  year_5_days                   INTEGER     DEFAULT 20,
  additional_days_per_5_years   INTEGER     DEFAULT 2,
  accrual_type                  TEXT        DEFAULT 'ANNUAL',  -- ANNUAL | MONTHLY | BIWEEKLY
  carry_over_days               INTEGER     DEFAULT 0,
  max_days                      INTEGER     DEFAULT 30,
  notes                         TEXT,

  created_at                    TIMESTAMPTZ DEFAULT NOW(),
  updated_at                    TIMESTAMPTZ DEFAULT NOW(),

  CONSTRAINT uq_vacation_policy UNIQUE (tenant_id)
);

-- ─── TENANT AUDIT LOG (per-tenant) ───────────────────────────

CREATE TABLE IF NOT EXISTS {SCHEMA}.audit_log (
  id          TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  tenant_id   TEXT        NOT NULL,
  actor_id    TEXT,                       -- admin user o employee id
  actor_type  TEXT,                       -- 'admin' | 'employee' | 'system'
  actor_email TEXT,

  action      TEXT        NOT NULL,       -- 'employee.status_changed', 'contract.created'
  resource    TEXT,                       -- 'employee:GFP-1038'
  changes     JSONB,                      -- { before: {}, after: {} }
  ip          TEXT,

  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_audit_tenant ON {SCHEMA}.audit_log (tenant_id);
CREATE INDEX idx_audit_action ON {SCHEMA}.audit_log (action);
CREATE INDEX idx_audit_date   ON {SCHEMA}.audit_log (created_at DESC);

-- ─── DEPARTMENT RISK PROFILES (CÓDICE Radar) ──────────────────
-- Perfil de riesgo ocupacional por departamento — pre-sembrado desde
-- la KB estática (occupational-risk-kb.ts), editable por RH.

CREATE TABLE IF NOT EXISTS {SCHEMA}.department_risk_profiles (
  id                    TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  tenant_id             TEXT        NOT NULL,
  department            TEXT        NOT NULL,

  perfil_optimo         JSONB       DEFAULT '{}',   -- { edadMin, edadMax, examenRequerido }
  riesgos_ocupacionales JSONB       DEFAULT '[]',   -- [{ nombre, frecuencia: Alta|Media|Baja }]
  historial_accidentes  JSONB       DEFAULT '[]',   -- [{ id, fecha, tipo, severidad, descripcion, employeeId }]
  alertas_automaticas   JSONB       DEFAULT '[]',
  fuentes_normativas    JSONB       DEFAULT '[]',   -- [{ clave, titulo, url }]

  ultima_revision       DATE,
  updated_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_by            TEXT,

  CONSTRAINT uq_dept_risk UNIQUE (tenant_id, department)
);

CREATE INDEX idx_dept_risk_tenant ON {SCHEMA}.department_risk_profiles (tenant_id);

-- ─── RADAR DIGESTS (CÓDICE Radar) ──────────────────────────────
-- Un registro por corrida del job semanal (jobs/radarWeekly.ts) —
-- el más reciente también se cachea en Redis (t:{tid}:radar:latest).

CREATE TABLE IF NOT EXISTS {SCHEMA}.radar_digests (
  id                TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  tenant_id         TEXT        NOT NULL,
  generated_at      TIMESTAMPTZ DEFAULT NOW(),
  items             JSONB       DEFAULT '[]',  -- [{ titulo, resumen, urgencia, url, norma }]
  alta_count        INTEGER     DEFAULT 0,
  media_count       INTEGER     DEFAULT 0,
  baja_count        INTEGER     DEFAULT 0,
  sources_searched  JSONB       DEFAULT '[]'
);

CREATE INDEX idx_radar_digests_tenant ON {SCHEMA}.radar_digests (tenant_id, generated_at DESC);

-- ─── UPDATED_AT trigger (aplica a todas las tablas con ese campo)

CREATE OR REPLACE FUNCTION {SCHEMA}.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Aplica el trigger a cada tabla que tenga updated_at
DO $$ DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'employees','contracts','payroll_records','time_off',
    'requests','attendance_records','actas','courses','course_progress',
    'bonuses','signage_slides','connected_sources','health_profiles','vacation_policy',
    'department_risk_profiles'
  ]
  LOOP
    EXECUTE format(
      'CREATE TRIGGER trg_updated_at BEFORE UPDATE ON {SCHEMA}.%I
       FOR EACH ROW EXECUTE FUNCTION {SCHEMA}.set_updated_at()',
      t
    );
  END LOOP;
END $$;
