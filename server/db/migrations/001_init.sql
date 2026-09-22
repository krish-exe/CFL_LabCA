-- SecureClinic schema. Columns ending in _enc hold AES-256-GCM ciphertext ("v1:iv:tag:data"),
-- never plaintext. Primary keys are random UUIDs so record ids cannot be guessed or enumerated.

CREATE TYPE user_role AS ENUM ('patient', 'doctor', 'admin');
CREATE TYPE appointment_status AS ENUM ('requested', 'confirmed', 'completed', 'cancelled');
CREATE TYPE record_type AS ENUM ('prescription', 'lab_report', 'diagnosis', 'imaging', 'note', 'other');
CREATE TYPE grant_scope AS ENUM ('read', 'read_write');

CREATE TABLE users (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email                 text NOT NULL UNIQUE CHECK (email = lower(email)),
  password_hash         text NOT NULL,                 -- Argon2id PHC string
  role                  user_role NOT NULL,
  full_name             text NOT NULL,
  phone_enc             text,
  date_of_birth_enc     text,
  specialization        text,
  is_active             boolean NOT NULL DEFAULT true,
  must_change_password  boolean NOT NULL DEFAULT false,
  token_version         integer NOT NULL DEFAULT 0,    -- bumped to invalidate every issued token
  totp_enabled          boolean NOT NULL DEFAULT false,
  totp_secret_enc       text,
  totp_pending_enc      text,
  totp_last_step        bigint,                        -- last accepted TOTP time step (replay protection)
  failed_login_count    integer NOT NULL DEFAULT 0,
  locked_until          timestamptz,
  last_login_at         timestamptz,
  password_changed_at   timestamptz NOT NULL DEFAULT now(),
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE refresh_tokens (
  jti          uuid PRIMARY KEY,
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  family_id    uuid NOT NULL,                          -- one family per login; rotation keeps the family
  expires_at   timestamptz NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  revoked_at   timestamptz,
  replaced_by  uuid,
  ip           text,
  user_agent   text
);
CREATE INDEX refresh_tokens_user_idx ON refresh_tokens (user_id);
CREATE INDEX refresh_tokens_family_idx ON refresh_tokens (family_id);

CREATE TABLE appointments (
  id            uuid PRIMARY KEY,
  patient_id    uuid NOT NULL REFERENCES users(id),
  doctor_id     uuid NOT NULL REFERENCES users(id),
  scheduled_at  timestamptz NOT NULL,
  status        appointment_status NOT NULL DEFAULT 'requested',
  reason_enc    text NOT NULL,
  notes_enc     text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
-- A doctor or patient can't be double-booked, even under concurrent requests.
CREATE UNIQUE INDEX appointments_doctor_slot ON appointments (doctor_id, scheduled_at) WHERE status <> 'cancelled';
CREATE UNIQUE INDEX appointments_patient_slot ON appointments (patient_id, scheduled_at) WHERE status <> 'cancelled';

CREATE TABLE medical_records (
  id                 uuid PRIMARY KEY,
  patient_id         uuid NOT NULL REFERENCES users(id),
  created_by         uuid NOT NULL REFERENCES users(id),
  record_type        record_type NOT NULL,
  title_enc          text NOT NULL,
  description_enc    text,
  diagnosis_enc      text,
  file_storage_name  text,                             -- random name of the encrypted blob on disk
  file_name_enc      text,
  file_mime          text,
  file_size          integer,
  file_key_enc       text,                             -- per-file AES-256 key, wrapped by the master key
  file_sha256        text,                             -- SHA-256 of the plaintext, checked on download
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX medical_records_patient_idx ON medical_records (patient_id, created_at DESC);

CREATE TABLE access_grants (
  id          uuid PRIMARY KEY,
  patient_id  uuid NOT NULL REFERENCES users(id),
  doctor_id   uuid NOT NULL REFERENCES users(id),
  scope       grant_scope NOT NULL DEFAULT 'read',
  expires_at  timestamptz NOT NULL,
  revoked_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at > created_at)
);
CREATE INDEX access_grants_lookup_idx ON access_grants (doctor_id, patient_id);

-- Tamper-evident audit log: each row stores HMAC-SHA256(key, prev_hash | row contents).
CREATE TABLE audit_logs (
  id                  bigserial PRIMARY KEY,
  ts                  timestamptz NOT NULL,
  actor_id            uuid,
  actor_role          text,
  action              text NOT NULL,
  outcome             text NOT NULL CHECK (outcome IN ('success', 'failure', 'denied')),
  target_type         text,
  target_id           text,
  subject_patient_id  uuid,
  ip                  text,
  user_agent          text,
  details             jsonb NOT NULL DEFAULT '{}'::jsonb,
  prev_hash           text NOT NULL,
  hash                text NOT NULL
);
CREATE INDEX audit_logs_subject_idx ON audit_logs (subject_patient_id, id DESC);
CREATE INDEX audit_logs_actor_idx ON audit_logs (actor_id, id DESC);
CREATE INDEX audit_logs_ts_idx ON audit_logs (ts);

-- Append-only: the application can never edit or delete audit history.
CREATE FUNCTION audit_logs_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only';
END;
$$;
CREATE TRIGGER audit_logs_no_update BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION audit_logs_append_only();
CREATE TRIGGER audit_logs_no_truncate BEFORE TRUNCATE ON audit_logs
  FOR EACH STATEMENT EXECUTE FUNCTION audit_logs_append_only();
