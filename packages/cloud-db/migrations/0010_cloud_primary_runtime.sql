ALTER TABLE sync_operation
  ADD COLUMN protocol_version INTEGER NOT NULL DEFAULT 1
    CHECK (protocol_version IN (1, 2)),
  ADD COLUMN changed_fields JSONB,
  ADD COLUMN result_json JSONB,
  ADD COLUMN completed_at TIMESTAMPTZ;

CREATE INDEX idx_sync_operation_pending_outcome
  ON sync_operation(tenant_id, store_id, device_id, status, received_at);

CREATE TABLE cloud_mirror_epoch (
  tenant_id UUID NOT NULL REFERENCES tenant(id),
  store_id UUID NOT NULL REFERENCES store(id),
  initiated_by_device_id UUID NOT NULL REFERENCES device(id),
  epoch_id UUID NOT NULL,
  activated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  first_business_write_at TIMESTAMPTZ,
  archived_local_sha256 TEXT,
  PRIMARY KEY (tenant_id, store_id),
  UNIQUE (epoch_id)
);

CREATE INDEX idx_cloud_mirror_epoch_store
  ON cloud_mirror_epoch(tenant_id, store_id, activated_at);

CREATE TABLE cloud_offline_writer_lease (
  tenant_id UUID NOT NULL REFERENCES tenant(id),
  store_id UUID NOT NULL REFERENCES store(id),
  device_id UUID NOT NULL REFERENCES device(id),
  lease_version BIGINT NOT NULL DEFAULT 1,
  expires_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant_id, store_id)
);

CREATE INDEX idx_cloud_offline_writer_lease_device
  ON cloud_offline_writer_lease(device_id, expires_at);
