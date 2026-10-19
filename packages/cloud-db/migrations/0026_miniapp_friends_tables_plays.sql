CREATE TABLE miniapp_friend (
  tenant_id UUID NOT NULL REFERENCES tenant(id), store_id UUID NOT NULL REFERENCES store(id),
  member_low UUID NOT NULL REFERENCES cloud_member(id), member_high UUID NOT NULL REFERENCES cloud_member(id),
  PRIMARY KEY (tenant_id,store_id,member_low,member_high), CHECK(member_low < member_high)
);
CREATE TABLE miniapp_friend_request (
  id UUID PRIMARY KEY, tenant_id UUID NOT NULL, store_id UUID NOT NULL,
  sender_id UUID NOT NULL REFERENCES cloud_member(id), recipient_id UUID NOT NULL REFERENCES cloud_member(id),
  status TEXT NOT NULL CHECK(status IN ('pending','accepted','rejected','cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, CHECK(sender_id <> recipient_id)
);
CREATE UNIQUE INDEX miniapp_friend_pending ON miniapp_friend_request(tenant_id,store_id,LEAST(sender_id,recipient_id),GREATEST(sender_id,recipient_id)) WHERE status='pending';
CREATE INDEX miniapp_friend_recipient ON miniapp_friend_request(tenant_id,store_id,recipient_id) WHERE status='pending';
CREATE TABLE miniapp_table (
  id UUID PRIMARY KEY, tenant_id UUID NOT NULL, store_id UUID NOT NULL,
  owner_id UUID NOT NULL REFERENCES cloud_member(id), expires_at TIMESTAMPTZ NOT NULL,
  closed BOOLEAN NOT NULL DEFAULT FALSE, created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE miniapp_table_member (
  table_id UUID NOT NULL REFERENCES miniapp_table(id), member_id UUID NOT NULL REFERENCES cloud_member(id),
  joined_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(table_id,member_id)
);
CREATE TABLE miniapp_invite (
  token TEXT PRIMARY KEY, tenant_id UUID NOT NULL, store_id UUID NOT NULL,
  owner_id UUID NOT NULL REFERENCES cloud_member(id), table_id UUID REFERENCES miniapp_table(id),
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE miniapp_play_member (
  play_id UUID NOT NULL REFERENCES miniapp_play(id), member_id UUID NOT NULL REFERENCES cloud_member(id),
  hidden BOOLEAN NOT NULL DEFAULT FALSE, active BOOLEAN NOT NULL DEFAULT TRUE, PRIMARY KEY(play_id,member_id)
);
INSERT INTO miniapp_play_member(play_id,member_id) SELECT id,owner_id FROM miniapp_play;
CREATE INDEX miniapp_play_member_visible ON miniapp_play_member(member_id,play_id) WHERE hidden=FALSE;
