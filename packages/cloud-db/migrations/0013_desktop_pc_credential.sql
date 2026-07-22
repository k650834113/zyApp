CREATE TABLE cloud_employee_pc_credential (
  employee_id UUID PRIMARY KEY REFERENCES cloud_employee(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenant(id),
  password_hash TEXT NOT NULL,
  credential_version BIGINT NOT NULL DEFAULT 1 CHECK (credential_version >= 1),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_cloud_employee_pc_credential_tenant
  ON cloud_employee_pc_credential(tenant_id, updated_at);

ALTER TABLE device_pairing_code
  ADD COLUMN enrollment_request_id TEXT;

CREATE UNIQUE INDEX uq_device_pairing_code_enrollment_request
  ON device_pairing_code(enrollment_request_id)
  WHERE enrollment_request_id IS NOT NULL;
