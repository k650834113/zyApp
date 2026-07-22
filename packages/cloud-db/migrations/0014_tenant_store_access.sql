CREATE TABLE tenant_administrator (
  tenant_id UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES cloud_employee(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'disabled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant_id, employee_id)
);

INSERT INTO tenant_administrator (tenant_id, employee_id)
SELECT DISTINCT tenant_id, id
FROM cloud_employee
WHERE role = 'manager' AND status = 'active'
ON CONFLICT DO NOTHING;

CREATE TABLE cloud_employee_store_access (
  employee_id UUID NOT NULL REFERENCES cloud_employee(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  store_id UUID NOT NULL REFERENCES store(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('manager', 'staff')),
  status TEXT NOT NULL CHECK (status IN ('active', 'disabled')),
  authorization_version BIGINT NOT NULL DEFAULT 1
    CHECK (authorization_version >= 1),
  granted_by UUID REFERENCES cloud_employee(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (employee_id, store_id)
);

CREATE INDEX idx_employee_store_access_store
  ON cloud_employee_store_access(tenant_id, store_id, status, role);

INSERT INTO cloud_employee_store_access
  (employee_id, tenant_id, store_id, role, status, authorization_version,
   created_at, updated_at)
SELECT id, tenant_id, store_id, role, status,
       GREATEST(server_version, 1), created_at, updated_at
FROM cloud_employee
ON CONFLICT DO NOTHING;

ALTER TABLE device_registration_code
  ADD COLUMN action TEXT NOT NULL DEFAULT 'create_tenant_store'
    CHECK (action IN ('create_tenant_store', 'activate_store')),
  ADD COLUMN tenant_id UUID REFERENCES tenant(id),
  ADD COLUMN store_id UUID REFERENCES store(id),
  ADD COLUMN created_by_employee_id UUID REFERENCES cloud_employee(id),
  ADD COLUMN enrollment_request_id TEXT;

CREATE UNIQUE INDEX uq_device_registration_code_enrollment_request
  ON device_registration_code(enrollment_request_id)
  WHERE enrollment_request_id IS NOT NULL;

CREATE INDEX idx_device_registration_code_scope
  ON device_registration_code(tenant_id, store_id, action, expires_at)
  WHERE consumed_at IS NULL;
