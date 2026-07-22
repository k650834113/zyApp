CREATE TABLE device_registration_code (
  id UUID PRIMARY KEY,
  code_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  consumed_by_device_id UUID REFERENCES device(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (expires_at > created_at),
  CHECK (
    (consumed_at IS NULL AND consumed_by_device_id IS NULL)
    OR
    (consumed_at IS NOT NULL AND consumed_by_device_id IS NOT NULL)
  )
);

CREATE INDEX idx_device_registration_code_active
  ON device_registration_code (code_hash, expires_at)
  WHERE consumed_at IS NULL;
