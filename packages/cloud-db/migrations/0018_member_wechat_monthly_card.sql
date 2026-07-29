CREATE TABLE wechat_monthly_card_order (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenant(id),
  store_id UUID NOT NULL REFERENCES store(id),
  member_id UUID NOT NULL REFERENCES cloud_member(id),
  identity_id UUID NOT NULL REFERENCES miniapp_identity(id),
  request_id TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  out_trade_no TEXT NOT NULL UNIQUE,
  provider_mode TEXT NOT NULL CHECK (provider_mode IN ('mock', 'wechat')),
  provider_prepay_id TEXT,
  provider_transaction_id TEXT UNIQUE,
  plan_name TEXT NOT NULL,
  price_fen BIGINT NOT NULL CHECK (price_fen > 0),
  duration_days INTEGER NOT NULL CHECK (duration_days > 0),
  scope_type TEXT NOT NULL CHECK (scope_type IN ('tenant', 'store')),
  client_payment_json JSONB,
  status TEXT NOT NULL CHECK (status IN (
    'creating', 'pending_payment', 'settled', 'failed', 'expired'
  )),
  target_card_id UUID REFERENCES cloud_monthly_card(id),
  expires_before TIMESTAMPTZ,
  expires_after TIMESTAMPTZ,
  error_message TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  paid_at TIMESTAMPTZ,
  settled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(tenant_id, identity_id, request_id)
);

CREATE INDEX idx_wechat_monthly_card_order_member
  ON wechat_monthly_card_order(tenant_id, member_id, created_at);
CREATE INDEX idx_wechat_monthly_card_order_status
  ON wechat_monthly_card_order(status, expires_at);

ALTER TABLE payment_callback_inbox
  ADD COLUMN monthly_card_order_id UUID
  REFERENCES wechat_monthly_card_order(id);

CREATE INDEX idx_payment_callback_inbox_monthly_card_order
  ON payment_callback_inbox(monthly_card_order_id, received_at);
