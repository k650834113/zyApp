CREATE TABLE employee_financial_command (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenant(id),
  store_id UUID NOT NULL REFERENCES store(id),
  requested_by UUID NOT NULL REFERENCES cloud_employee(id),
  request_id TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  command_type TEXT NOT NULL
    CHECK (command_type IN (
      'cash_recharge',
      'monthly_card_purchase',
      'monthly_card_pause',
      'monthly_card_resume'
    )),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN (
      'pending',
      'claimed',
      'completed',
      'failed',
      'expired',
      'canceled'
    )),
  command_json JSONB NOT NULL,
  claimed_by_device UUID REFERENCES device(id),
  claimed_at TIMESTAMPTZ,
  lease_expires_at TIMESTAMPTZ,
  result_json JSONB,
  error_message TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(tenant_id, requested_by, request_id)
);

CREATE INDEX idx_employee_financial_command_store_status
  ON employee_financial_command(store_id, status, created_at);

CREATE INDEX idx_employee_financial_command_claim_lease
  ON employee_financial_command(store_id, lease_expires_at)
  WHERE status = 'claimed';

CREATE INDEX idx_employee_financial_command_expiry
  ON employee_financial_command(expires_at)
  WHERE status IN ('pending', 'claimed');
