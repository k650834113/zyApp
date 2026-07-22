CREATE TABLE device_pairing_code (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenant(id),
  store_id UUID NOT NULL REFERENCES store(id),
  code_hash TEXT NOT NULL UNIQUE,
  created_by_device_id UUID NOT NULL REFERENCES device(id),
  created_by_employee_id UUID NOT NULL REFERENCES cloud_employee(id),
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

CREATE INDEX idx_device_pairing_code_active
  ON device_pairing_code (code_hash, expires_at)
  WHERE consumed_at IS NULL;
