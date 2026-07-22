ALTER TABLE cloud_monthly_card
  ADD COLUMN scope_type TEXT NOT NULL DEFAULT 'store'
    CHECK (scope_type IN ('tenant', 'store'));

DROP INDEX idx_cloud_monthly_card_current;
CREATE UNIQUE INDEX idx_cloud_monthly_card_current_store
  ON cloud_monthly_card(tenant_id, member_id, store_id)
  WHERE status IN ('active', 'paused') AND scope_type = 'store';
CREATE UNIQUE INDEX idx_cloud_monthly_card_current_tenant
  ON cloud_monthly_card(tenant_id, member_id)
  WHERE status IN ('active', 'paused') AND scope_type = 'tenant';

ALTER TABLE cloud_monthly_card_event
  DROP CONSTRAINT cloud_monthly_card_event_event_type_check;
ALTER TABLE cloud_monthly_card_event
  ADD CONSTRAINT cloud_monthly_card_event_event_type_check
  CHECK (event_type IN (
    'purchased', 'paused', 'resumed', 'used', 'refunded', 'expired',
    'snapshot', 'manual_extended'
  ));

CREATE TABLE cloud_merchant_business_template (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenant(id),
  template_type TEXT NOT NULL CHECK (template_type IN (
    'recharge_gift_tier', 'monthly_card_plan', 'activity'
  )),
  name TEXT NOT NULL,
  payload_json JSONB NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (tenant_id, template_type, name)
);

CREATE TABLE cloud_store_business_template_override (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenant(id),
  store_id UUID NOT NULL REFERENCES store(id),
  template_id UUID NOT NULL REFERENCES cloud_merchant_business_template(id),
  payload_json JSONB NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  updated_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (tenant_id, store_id, template_id)
);

ALTER TABLE cloud_recharge_gift_tier ADD COLUMN source_template_id UUID
  REFERENCES cloud_merchant_business_template(id);
ALTER TABLE cloud_activity_campaign ADD COLUMN source_template_id UUID
  REFERENCES cloud_merchant_business_template(id);

CREATE TABLE cloud_catalog_store_config (
  tenant_id UUID NOT NULL REFERENCES tenant(id),
  store_id UUID NOT NULL REFERENCES store(id),
  catalog_item_id UUID NOT NULL REFERENCES cloud_catalog_item(id),
  regular_price_fen BIGINT NOT NULL CHECK (regular_price_fen >= 0),
  advanced_price_fen BIGINT NOT NULL CHECK (advanced_price_fen >= 0),
  status TEXT NOT NULL CHECK (status IN ('active', 'disabled')),
  availability TEXT NOT NULL CHECK (availability IN ('available', 'sold_out')),
  note TEXT,
  server_version BIGINT NOT NULL DEFAULT 0 CHECK (server_version >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant_id, store_id, catalog_item_id)
);
INSERT INTO cloud_catalog_store_config
(tenant_id, store_id, catalog_item_id, regular_price_fen, advanced_price_fen,
 status, availability, note, server_version, updated_at)
SELECT tenant_id, store_id, id, regular_price_fen, advanced_price_fen,
       status, availability, note, server_version, updated_at
FROM cloud_catalog_item;

CREATE TABLE cloud_board_game_store_config (
  tenant_id UUID NOT NULL REFERENCES tenant(id),
  store_id UUID NOT NULL REFERENCES store(id),
  board_game_id UUID NOT NULL REFERENCES cloud_board_game(id),
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity >= 0),
  record_status TEXT NOT NULL,
  available BOOLEAN NOT NULL,
  customer_consigned BOOLEAN NOT NULL,
  missing_pieces BOOLEAN NOT NULL,
  private BOOLEAN NOT NULL,
  recommended BOOLEAN NOT NULL,
  customer_note TEXT,
  internal_note TEXT,
  consignor_nickname TEXT,
  missing_parts_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  server_version BIGINT NOT NULL DEFAULT 0 CHECK (server_version >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant_id, store_id, board_game_id)
);
INSERT INTO cloud_board_game_store_config
(tenant_id, store_id, board_game_id, quantity, record_status, available,
 customer_consigned, missing_pieces, private, recommended, customer_note,
 internal_note, consignor_nickname, missing_parts_json, server_version, updated_at)
SELECT tenant_id, store_id, id, quantity, record_status, available,
       customer_consigned, missing_pieces, private, recommended, customer_note,
       internal_note, consignor_nickname, missing_parts_json, server_version, updated_at
FROM cloud_board_game;
