-- Cloud-authoritative activity registrations and immutable draw snapshots.
CREATE TABLE activity_lottery (
  activity_id UUID PRIMARY KEY REFERENCES cloud_activity_campaign(id),
  tenant_id UUID NOT NULL REFERENCES tenant(id), store_id UUID NOT NULL REFERENCES store(id),
  state_json JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX activity_lottery_store ON activity_lottery(tenant_id,store_id);
CREATE TABLE activity_lottery_event (
  id UUID PRIMARY KEY,tenant_id UUID NOT NULL REFERENCES tenant(id),store_id UUID NOT NULL REFERENCES store(id),
  activity_id UUID NOT NULL REFERENCES cloud_activity_campaign(id),actor_id UUID NOT NULL REFERENCES cloud_employee(id),
  device_id UUID NOT NULL REFERENCES device(id),request_id TEXT NOT NULL,request_hash TEXT NOT NULL,
  action TEXT NOT NULL,result_json JSONB NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(tenant_id,store_id,request_id)
);
