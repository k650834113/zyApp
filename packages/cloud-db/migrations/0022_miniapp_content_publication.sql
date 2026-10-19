-- Cloud-owned operational snapshots. No financial or PC ledger mutations.
CREATE TABLE miniapp_content_workspace (
  store_id UUID PRIMARY KEY REFERENCES store(id),
  tenant_id UUID NOT NULL REFERENCES tenant(id),
  revision UUID,
  draft_json JSONB,
  published_json JSONB,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE miniapp_content_event (
  revision UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenant(id),
  store_id UUID NOT NULL REFERENCES store(id),
  device_id UUID NOT NULL,
  actor_id UUID NOT NULL,
  request_id TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('save', 'publish', 'withdraw', 'restore')),
  result_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (tenant_id, store_id, request_id)
);
CREATE INDEX miniapp_content_event_store ON miniapp_content_event (store_id, created_at DESC);

CREATE TABLE miniapp_content_media (
  tenant_id UUID NOT NULL REFERENCES tenant(id),
  store_id UUID NOT NULL REFERENCES store(id),
  url TEXT NOT NULL,
  actor_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant_id, store_id, url)
);
