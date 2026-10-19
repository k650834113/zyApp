CREATE TABLE miniapp_meetup (
  id UUID PRIMARY KEY, tenant_id UUID NOT NULL REFERENCES tenant(id),
  store_id UUID NOT NULL REFERENCES store(id), owner_id UUID NOT NULL REFERENCES cloud_member(id),
  revision UUID NOT NULL, data_json JSONB NOT NULL,
  starts_at TIMESTAMPTZ NOT NULL, deadline TIMESTAMPTZ NOT NULL,
  capacity INTEGER NOT NULL CHECK (capacity BETWEEN 2 AND 20),
  status TEXT NOT NULL CHECK (status IN ('open','confirmed','cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX miniapp_meetup_store_start ON miniapp_meetup(store_id,starts_at,id);
CREATE INDEX miniapp_meetup_due ON miniapp_meetup(deadline) WHERE status = 'open';
CREATE TABLE miniapp_meetup_member (
  meetup_id UUID NOT NULL REFERENCES miniapp_meetup(id), member_id UUID NOT NULL REFERENCES cloud_member(id),
  joined_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (meetup_id,member_id)
);
CREATE INDEX miniapp_meetup_member_lookup ON miniapp_meetup_member(member_id,meetup_id);
CREATE TABLE miniapp_play (
  id UUID PRIMARY KEY, tenant_id UUID NOT NULL REFERENCES tenant(id), store_id UUID NOT NULL REFERENCES store(id),
  owner_id UUID NOT NULL REFERENCES cloud_member(id), revision UUID NOT NULL, data_json JSONB NOT NULL,
  played_on DATE NOT NULL, deleted_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX miniapp_play_owner_date ON miniapp_play(tenant_id,store_id,owner_id,played_on DESC,id) WHERE deleted_at IS NULL;
CREATE TABLE miniapp_community_event (
  id UUID PRIMARY KEY, tenant_id UUID NOT NULL, store_id UUID NOT NULL, actor_id UUID NOT NULL,
  request_id TEXT NOT NULL, request_hash TEXT NOT NULL, action TEXT NOT NULL, result_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (tenant_id,store_id,actor_id,request_id)
);
