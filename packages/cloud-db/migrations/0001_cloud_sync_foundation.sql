CREATE TABLE tenant (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'disabled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE store (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenant(id),
  name TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'Asia/Shanghai',
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'disabled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_store_tenant ON store(tenant_id);

CREATE TABLE device (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenant(id),
  store_id UUID NOT NULL REFERENCES store(id),
  name TEXT NOT NULL,
  credential_hash TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'active', 'disabled')),
  last_device_seq BIGINT NOT NULL DEFAULT 0 CHECK (last_device_seq >= 0),
  last_seen_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_device_tenant_store ON device(tenant_id, store_id);

CREATE TABLE cloud_employee (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenant(id),
  store_id UUID NOT NULL REFERENCES store(id),
  username TEXT NOT NULL,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('manager', 'staff')),
  status TEXT NOT NULL CHECK (status IN ('active', 'disabled')),
  server_version BIGINT NOT NULL CHECK (server_version >= 0),
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  UNIQUE(tenant_id, username)
);

CREATE INDEX idx_cloud_employee_store
  ON cloud_employee(tenant_id, store_id, status);

CREATE TABLE cloud_member (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenant(id),
  store_id UUID NOT NULL REFERENCES store(id),
  member_number TEXT NOT NULL,
  phone TEXT NOT NULL,
  nickname TEXT NOT NULL,
  tier TEXT NOT NULL CHECK (tier IN ('ordinary', 'advanced')),
  status TEXT NOT NULL CHECK (status IN ('active', 'disabled')),
  birthday_month INTEGER CHECK (birthday_month BETWEEN 1 AND 12),
  birthday_day INTEGER CHECK (birthday_day BETWEEN 1 AND 31),
  birthday_source TEXT,
  note TEXT,
  source TEXT NOT NULL,
  server_version BIGINT NOT NULL CHECK (server_version >= 0),
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  UNIQUE(tenant_id, member_number),
  UNIQUE(tenant_id, phone)
);

CREATE INDEX idx_cloud_member_store
  ON cloud_member(tenant_id, store_id, status);

CREATE TABLE cloud_catalog_item (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenant(id),
  store_id UUID NOT NULL REFERENCES store(id),
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  item_type TEXT NOT NULL
    CHECK (item_type IN ('admission', 'service', 'product', 'activity', 'custom')),
  regular_price_fen BIGINT NOT NULL CHECK (regular_price_fen >= 0),
  advanced_price_fen BIGINT NOT NULL CHECK (advanced_price_fen >= 0),
  status TEXT NOT NULL CHECK (status IN ('active', 'disabled')),
  availability TEXT NOT NULL CHECK (availability IN ('available', 'sold_out')),
  note TEXT,
  server_version BIGINT NOT NULL CHECK (server_version >= 0),
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  UNIQUE(store_id, code)
);

CREATE INDEX idx_cloud_catalog_store
  ON cloud_catalog_item(tenant_id, store_id, status);

CREATE TABLE cloud_activity_campaign (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenant(id),
  store_id UUID NOT NULL REFERENCES store(id),
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  content TEXT NOT NULL,
  activity_type TEXT NOT NULL CHECK (activity_type IN ('recharge', 'general')),
  status TEXT NOT NULL CHECK (status IN ('draft', 'published', 'disabled')),
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  pinned BOOLEAN NOT NULL DEFAULT FALSE,
  regular_price_fen BIGINT CHECK (regular_price_fen >= 0),
  advanced_price_fen BIGINT CHECK (advanced_price_fen >= 0),
  allow_stored_value BOOLEAN NOT NULL DEFAULT TRUE,
  allow_wechat BOOLEAN NOT NULL DEFAULT TRUE,
  recharge_tiers_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  server_version BIGINT NOT NULL CHECK (server_version >= 0),
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  CHECK (ends_at > starts_at)
);

CREATE INDEX idx_cloud_activity_schedule
  ON cloud_activity_campaign(tenant_id, store_id, status, starts_at, ends_at);

CREATE TABLE cloud_announcement (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenant(id),
  store_id UUID NOT NULL REFERENCES store(id),
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft', 'published', 'disabled')),
  pinned BOOLEAN NOT NULL DEFAULT FALSE,
  visible_from TIMESTAMPTZ NOT NULL,
  visible_until TIMESTAMPTZ,
  published_at TIMESTAMPTZ,
  server_version BIGINT NOT NULL CHECK (server_version >= 0),
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  CHECK (visible_until IS NULL OR visible_until > visible_from)
);

CREATE INDEX idx_cloud_announcement_visibility
  ON cloud_announcement(
    tenant_id, store_id, status, pinned, visible_from, visible_until
  );

CREATE TABLE cloud_board_game (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenant(id),
  store_id UUID NOT NULL REFERENCES store(id),
  name TEXT NOT NULL,
  introduction TEXT NOT NULL,
  categories_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  min_players INTEGER NOT NULL CHECK (min_players > 0),
  max_players INTEGER NOT NULL CHECK (max_players >= min_players),
  min_minutes INTEGER CHECK (min_minutes > 0),
  max_minutes INTEGER CHECK (
    max_minutes IS NULL OR
    (max_minutes > 0 AND (min_minutes IS NULL OR max_minutes >= min_minutes))
  ),
  difficulty TEXT NOT NULL CHECK (difficulty IN ('light', 'medium', 'heavy')),
  quantity INTEGER NOT NULL CHECK (quantity >= 0),
  record_status TEXT NOT NULL CHECK (record_status IN ('active', 'disabled')),
  available BOOLEAN NOT NULL DEFAULT TRUE,
  customer_consigned BOOLEAN NOT NULL DEFAULT FALSE,
  missing_pieces BOOLEAN NOT NULL DEFAULT FALSE,
  private BOOLEAN NOT NULL DEFAULT FALSE,
  recommended BOOLEAN NOT NULL DEFAULT FALSE,
  image_url TEXT,
  bgg_id BIGINT CHECK (bgg_id > 0),
  customer_note TEXT,
  internal_note TEXT,
  consignor_nickname TEXT,
  missing_parts_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  server_version BIGINT NOT NULL CHECK (server_version >= 0),
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX idx_cloud_board_game_public
  ON cloud_board_game(
    tenant_id, store_id, record_status, private, recommended, available
  );

CREATE TABLE cloud_recharge_gift_tier (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenant(id),
  store_id UUID NOT NULL REFERENCES store(id),
  principal_fen BIGINT NOT NULL CHECK (principal_fen > 0),
  gift_fen BIGINT NOT NULL CHECK (gift_fen >= 0),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  server_version BIGINT NOT NULL CHECK (server_version >= 0),
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  UNIQUE(store_id, principal_fen)
);

CREATE TABLE cloud_wallet_account (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenant(id),
  store_id UUID NOT NULL REFERENCES store(id),
  member_id UUID NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'frozen')),
  principal_balance_fen BIGINT NOT NULL CHECK (principal_balance_fen >= 0),
  gift_balance_fen BIGINT NOT NULL CHECK (gift_balance_fen >= 0),
  server_version BIGINT NOT NULL CHECK (server_version >= 0),
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  UNIQUE(tenant_id, member_id)
);

CREATE INDEX idx_cloud_wallet_member
  ON cloud_wallet_account(tenant_id, member_id);

CREATE TABLE cloud_wallet_ledger (
  operation_id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenant(id),
  store_id UUID NOT NULL REFERENCES store(id),
  wallet_account_id UUID NOT NULL REFERENCES cloud_wallet_account(id),
  member_id UUID NOT NULL,
  event_type TEXT NOT NULL,
  source_operation_id TEXT NOT NULL,
  principal_delta_fen BIGINT NOT NULL,
  gift_delta_fen BIGINT NOT NULL,
  principal_balance_after_fen BIGINT NOT NULL
    CHECK (principal_balance_after_fen >= 0),
  gift_balance_after_fen BIGINT NOT NULL
    CHECK (gift_balance_after_fen >= 0),
  reason TEXT,
  payload_json JSONB NOT NULL,
  server_version BIGINT NOT NULL CHECK (server_version >= 0),
  occurred_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX idx_cloud_wallet_ledger_account
  ON cloud_wallet_ledger(tenant_id, wallet_account_id, occurred_at);

CREATE TABLE cloud_monthly_card (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenant(id),
  store_id UUID NOT NULL REFERENCES store(id),
  member_id UUID NOT NULL,
  plan_name TEXT NOT NULL,
  price_fen BIGINT NOT NULL CHECK (price_fen > 0),
  payment_method TEXT NOT NULL CHECK (payment_method IN ('cash', 'wechat')),
  status TEXT NOT NULL
    CHECK (status IN ('active', 'paused', 'expired', 'refunded')),
  purchased_at TIMESTAMPTZ NOT NULL,
  starts_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  paused_at TIMESTAMPTZ,
  usage_count INTEGER NOT NULL CHECK (usage_count >= 0),
  server_version BIGINT NOT NULL CHECK (server_version >= 0),
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX idx_cloud_monthly_card_member
  ON cloud_monthly_card(tenant_id, member_id, purchased_at);

CREATE UNIQUE INDEX idx_cloud_monthly_card_current
  ON cloud_monthly_card(tenant_id, member_id)
  WHERE status IN ('active', 'paused');

CREATE TABLE cloud_monthly_card_event (
  operation_id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenant(id),
  store_id UUID NOT NULL REFERENCES store(id),
  card_id UUID NOT NULL REFERENCES cloud_monthly_card(id),
  member_id UUID NOT NULL,
  event_type TEXT NOT NULL
    CHECK (event_type IN (
      'purchased', 'paused', 'resumed', 'used', 'refunded', 'expired', 'snapshot'
    )),
  reason TEXT,
  payload_json JSONB NOT NULL,
  server_version BIGINT NOT NULL CHECK (server_version >= 0),
  occurred_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX idx_cloud_monthly_card_event_card
  ON cloud_monthly_card_event(tenant_id, card_id, occurred_at);

CREATE TABLE cloud_sales_order (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenant(id),
  store_id UUID NOT NULL REFERENCES store(id),
  order_number TEXT NOT NULL,
  visit_batch_id UUID NOT NULL,
  customer_member_id UUID,
  payment_method TEXT NOT NULL CHECK (payment_method IN ('cash', 'stored_value')),
  wallet_member_id UUID,
  status TEXT NOT NULL CHECK (status = 'completed'),
  total_fen BIGINT NOT NULL CHECK (total_fen >= 0),
  note TEXT,
  completed_at TIMESTAMPTZ NOT NULL,
  payload_json JSONB NOT NULL,
  server_version BIGINT NOT NULL CHECK (server_version >= 0),
  UNIQUE(tenant_id, order_number)
);

CREATE INDEX idx_cloud_sales_order_store_time
  ON cloud_sales_order(tenant_id, store_id, completed_at);

CREATE TABLE cloud_sales_order_item (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenant(id),
  store_id UUID NOT NULL REFERENCES store(id),
  order_id UUID NOT NULL REFERENCES cloud_sales_order(id),
  catalog_item_id UUID NOT NULL,
  item_name TEXT NOT NULL,
  item_type TEXT NOT NULL
    CHECK (item_type IN ('admission', 'product', 'service', 'activity', 'custom')),
  regular_price_fen BIGINT NOT NULL CHECK (regular_price_fen >= 0),
  advanced_price_fen BIGINT NOT NULL CHECK (advanced_price_fen >= 0),
  applied_unit_price_fen BIGINT NOT NULL CHECK (applied_unit_price_fen >= 0),
  pricing_tier TEXT NOT NULL CHECK (pricing_tier IN ('regular', 'advanced')),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  line_total_fen BIGINT NOT NULL CHECK (line_total_fen >= 0),
  benefit_type TEXT NOT NULL
    CHECK (benefit_type IN ('none', 'birthday', 'monthly_card', 'repeat_admission')),
  beneficiary_member_id UUID
);

CREATE INDEX idx_cloud_sales_order_item_order
  ON cloud_sales_order_item(tenant_id, order_id);

CREATE TABLE cloud_refund_request (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenant(id),
  store_id UUID NOT NULL REFERENCES store(id),
  refund_number TEXT NOT NULL,
  order_id UUID NOT NULL,
  order_number TEXT NOT NULL,
  payment_method TEXT NOT NULL CHECK (payment_method IN ('cash', 'stored_value')),
  wallet_member_id UUID,
  status TEXT NOT NULL CHECK (status IN ('pending', 'completed', 'rejected')),
  total_fen BIGINT NOT NULL CHECK (total_fen > 0),
  requested_by UUID NOT NULL,
  requested_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  payload_json JSONB NOT NULL,
  server_version BIGINT NOT NULL CHECK (server_version >= 0),
  updated_at TIMESTAMPTZ NOT NULL,
  UNIQUE(tenant_id, refund_number)
);

CREATE INDEX idx_cloud_refund_store_time
  ON cloud_refund_request(tenant_id, store_id, requested_at);

CREATE TABLE cloud_refund_event (
  operation_id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenant(id),
  store_id UUID NOT NULL REFERENCES store(id),
  refund_id UUID NOT NULL REFERENCES cloud_refund_request(id),
  event_type TEXT NOT NULL,
  payload_json JSONB NOT NULL,
  server_version BIGINT NOT NULL CHECK (server_version >= 0),
  occurred_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE cloud_financial_refund_request (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenant(id),
  store_id UUID NOT NULL REFERENCES store(id),
  request_number TEXT NOT NULL,
  target_type TEXT NOT NULL CHECK (target_type IN ('monthly_card', 'cash_recharge')),
  target_id UUID NOT NULL,
  member_id UUID NOT NULL,
  payment_method TEXT NOT NULL CHECK (payment_method IN ('cash', 'wechat')),
  status TEXT NOT NULL CHECK (status IN ('pending', 'completed', 'rejected')),
  refund_principal_fen BIGINT NOT NULL CHECK (refund_principal_fen > 0),
  reclaim_gift_fen BIGINT NOT NULL CHECK (reclaim_gift_fen >= 0),
  requested_by UUID NOT NULL,
  requested_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  payload_json JSONB NOT NULL,
  server_version BIGINT NOT NULL CHECK (server_version >= 0),
  updated_at TIMESTAMPTZ NOT NULL,
  UNIQUE(tenant_id, request_number)
);

CREATE INDEX idx_cloud_financial_refund_store_time
  ON cloud_financial_refund_request(tenant_id, store_id, requested_at);

CREATE TABLE cloud_financial_refund_event (
  operation_id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenant(id),
  store_id UUID NOT NULL REFERENCES store(id),
  financial_refund_id UUID NOT NULL REFERENCES cloud_financial_refund_request(id),
  event_type TEXT NOT NULL,
  payload_json JSONB NOT NULL,
  server_version BIGINT NOT NULL CHECK (server_version >= 0),
  occurred_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE sync_operation (
  operation_id UUID PRIMARY KEY,
  device_id UUID NOT NULL REFERENCES device(id),
  device_seq BIGINT NOT NULL CHECK (device_seq > 0),
  tenant_id UUID NOT NULL REFERENCES tenant(id),
  store_id UUID NOT NULL REFERENCES store(id),
  actor_id UUID,
  operation_type TEXT NOT NULL,
  aggregate_id TEXT NOT NULL,
  base_version BIGINT,
  occurred_at TIMESTAMPTZ NOT NULL,
  payload_json JSONB NOT NULL,
  payload_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'received'
    CHECK (status IN ('received', 'confirmed', 'conflict', 'rejected')),
  server_version BIGINT,
  received_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(device_id, device_seq)
);

CREATE INDEX idx_sync_operation_store_received
  ON sync_operation(tenant_id, store_id, received_at);

CREATE TABLE sync_conflict (
  id UUID PRIMARY KEY,
  operation_id UUID NOT NULL UNIQUE REFERENCES sync_operation(operation_id),
  tenant_id UUID NOT NULL REFERENCES tenant(id),
  store_id UUID NOT NULL REFERENCES store(id),
  device_id UUID NOT NULL REFERENCES device(id),
  conflict_type TEXT NOT NULL,
  local_payload_json JSONB NOT NULL,
  server_payload_json JSONB,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'resolved', 'ignored')),
  resolution_json JSONB,
  resolved_by UUID,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_sync_conflict_store_status
  ON sync_conflict(tenant_id, store_id, status);

CREATE TABLE cloud_event (
  sequence BIGSERIAL PRIMARY KEY,
  event_id UUID NOT NULL UNIQUE,
  tenant_id UUID NOT NULL REFERENCES tenant(id),
  store_id UUID NOT NULL REFERENCES store(id),
  aggregate_type TEXT NOT NULL,
  aggregate_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload_json JSONB NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_cloud_event_store_sequence
  ON cloud_event(tenant_id, store_id, sequence);

CREATE TABLE cloud_audit_log (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenant(id),
  store_id UUID NOT NULL REFERENCES store(id),
  device_id UUID REFERENCES device(id),
  actor_id UUID,
  action TEXT NOT NULL,
  aggregate_type TEXT NOT NULL,
  aggregate_id TEXT NOT NULL,
  metadata_json JSONB NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_cloud_audit_store_time
  ON cloud_audit_log(tenant_id, store_id, occurred_at);

CREATE TABLE api_idempotency (
  tenant_id UUID NOT NULL REFERENCES tenant(id),
  key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  response_status INTEGER,
  response_json JSONB,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(tenant_id, key)
);

CREATE INDEX idx_api_idempotency_expiry ON api_idempotency(expires_at);
