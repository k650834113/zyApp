CREATE TABLE cloud_membership_grant (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenant(id),
  store_id UUID NOT NULL REFERENCES store(id),
  member_id UUID NOT NULL REFERENCES cloud_member(id),
  source_type TEXT NOT NULL
    CHECK (source_type IN ('recharge', 'activity', 'manual', 'legacy')),
  source_id UUID,
  granted_tier TEXT NOT NULL CHECK (granted_tier = 'advanced'),
  reason TEXT NOT NULL,
  granted_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  UNIQUE(tenant_id, source_type, source_id)
);

CREATE INDEX idx_cloud_membership_grant_active
  ON cloud_membership_grant(tenant_id, member_id, revoked_at);

CREATE TABLE wechat_recharge_order (
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
  principal_fen BIGINT NOT NULL CHECK (principal_fen > 0),
  gift_fen BIGINT NOT NULL CHECK (gift_fen >= 0),
  gift_rule_snapshot_json JSONB NOT NULL,
  client_payment_json JSONB,
  status TEXT NOT NULL
    CHECK (status IN (
      'creating', 'pending_payment', 'settled', 'failed', 'expired'
    )),
  error_message TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  paid_at TIMESTAMPTZ,
  settled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(tenant_id, identity_id, request_id)
);

CREATE INDEX idx_wechat_recharge_order_member
  ON wechat_recharge_order(tenant_id, member_id, created_at);

CREATE INDEX idx_wechat_recharge_order_status_expiry
  ON wechat_recharge_order(status, expires_at);

CREATE TABLE payment_callback_inbox (
  provider TEXT NOT NULL,
  event_id TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  order_id UUID REFERENCES wechat_recharge_order(id),
  status TEXT NOT NULL CHECK (status IN ('received', 'processed', 'failed')),
  payload_json JSONB NOT NULL,
  error_message TEXT,
  received_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  processed_at TIMESTAMPTZ,
  PRIMARY KEY(provider, event_id)
);

CREATE INDEX idx_payment_callback_inbox_order
  ON payment_callback_inbox(order_id, received_at);
