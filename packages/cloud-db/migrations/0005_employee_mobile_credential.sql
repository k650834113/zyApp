CREATE TABLE cloud_employee_mobile_credential (
  employee_id UUID PRIMARY KEY REFERENCES cloud_employee(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenant(id),
  store_id UUID NOT NULL REFERENCES store(id),
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  password_hash TEXT,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX idx_cloud_employee_mobile_credential_store
  ON cloud_employee_mobile_credential(tenant_id, store_id, enabled);

ALTER TABLE miniapp_identity
  ADD COLUMN employee_id UUID REFERENCES cloud_employee(id);

CREATE INDEX idx_miniapp_identity_employee
  ON miniapp_identity(tenant_id, employee_id);
