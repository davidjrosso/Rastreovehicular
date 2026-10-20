CREATE TABLE IF NOT EXISTS departments (
  id UUID PRIMARY KEY, name TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK (kind IN ('policia','fiscalia','municipal'))
);
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY, name TEXT NOT NULL, username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK (role IN ('admin','supervisor','operador','externo')),
  department_id UUID REFERENCES departments(id), active BOOLEAN NOT NULL DEFAULT true,
  CHECK (role <> 'externo' OR department_id IS NOT NULL)
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY, user_id UUID NOT NULL REFERENCES users(id),
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE IF NOT EXISTS cameras (
  id UUID PRIMARY KEY, number INTEGER NOT NULL UNIQUE, name TEXT NOT NULL,
  lon DOUBLE PRECISION NOT NULL, lat DOUBLE PRECISION NOT NULL, active BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE SEQUENCE IF NOT EXISTS case_number;
CREATE TABLE IF NOT EXISTS cases (
  id UUID PRIMARY KEY, number TEXT NOT NULL UNIQUE,
  department_id UUID NOT NULL REFERENCES departments(id),
  requester_id UUID NOT NULL REFERENCES users(id),
  title TEXT NOT NULL, description TEXT NOT NULL, reference TEXT NOT NULL DEFAULT '',
  starts_at TIMESTAMPTZ NOT NULL, ends_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'pedida' CHECK (status IN ('pedida','en_curso','en_revision','entregada','archivada','rechazada')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (ends_at >= starts_at)
);
CREATE INDEX IF NOT EXISTS cases_department ON cases(department_id);
CREATE TABLE IF NOT EXISTS targets (
  id UUID PRIMARY KEY, case_id UUID NOT NULL REFERENCES cases(id),
  kind TEXT NOT NULL CHECK (kind IN ('vehiculo','persona','otro')),
  description TEXT NOT NULL, plate TEXT NOT NULL DEFAULT '', color TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS entries (
  id UUID PRIMARY KEY, case_id UUID NOT NULL REFERENCES cases(id),
  kind TEXT NOT NULL CHECK (kind IN ('captura','revision','aporte','mensaje')),
  payload JSONB NOT NULL, user_id UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), deleted_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS entries_case ON entries(case_id, created_at);
CREATE TABLE IF NOT EXISTS attachments (
  id UUID PRIMARY KEY, case_id UUID NOT NULL REFERENCES cases(id),
  entry_id UUID NOT NULL REFERENCES entries(id), user_id UUID NOT NULL REFERENCES users(id),
  name TEXT NOT NULL, mime TEXT NOT NULL, size INTEGER NOT NULL, sha256 TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS audit (
  id UUID PRIMARY KEY, case_id UUID REFERENCES cases(id), user_id UUID NOT NULL REFERENCES users(id),
  action TEXT NOT NULL, detail JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_case ON audit(case_id, created_at);
CREATE TABLE IF NOT EXISTS notices (
  id UUID PRIMARY KEY, user_id UUID NOT NULL REFERENCES users(id),
  case_id UUID REFERENCES cases(id), text TEXT NOT NULL, read BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
