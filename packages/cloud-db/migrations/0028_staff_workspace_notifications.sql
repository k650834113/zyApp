CREATE TABLE miniapp_registration_batch (
 id UUID PRIMARY KEY, tenant_id UUID NOT NULL REFERENCES tenant(id), store_id UUID NOT NULL REFERENCES store(id),
 activity_id UUID NOT NULL REFERENCES activity_lottery(activity_id), actor_id UUID NOT NULL REFERENCES cloud_employee(id),
 request_id TEXT NOT NULL, capacity INTEGER NOT NULL CHECK(capacity BETWEEN 1 AND 100),
 scene TEXT NOT NULL UNIQUE, env_version TEXT NOT NULL CHECK(env_version IN ('release','trial','develop')),
 expires_at TIMESTAMPTZ NOT NULL, revoked_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(tenant_id,store_id,actor_id,request_id)
);
CREATE INDEX miniapp_registration_batch_activity ON miniapp_registration_batch(tenant_id,store_id,activity_id);
CREATE TABLE miniapp_registration_admission (
 id UUID PRIMARY KEY, batch_id UUID NOT NULL REFERENCES miniapp_registration_batch(id),
 identity_id UUID NOT NULL REFERENCES miniapp_identity(id), member_id UUID REFERENCES cloud_member(id),
 entry_id UUID, expires_at TIMESTAMPTZ NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 cancelled_at TIMESTAMPTZ, UNIQUE(batch_id,identity_id)
);
CREATE INDEX miniapp_registration_admission_batch ON miniapp_registration_admission(batch_id,expires_at);
CREATE TABLE miniapp_notice_scene (
 tenant_id UUID NOT NULL REFERENCES tenant(id),store_id UUID NOT NULL REFERENCES store(id),key TEXT NOT NULL,
 title TEXT NOT NULL,description TEXT NOT NULL,template_id TEXT,enabled BOOLEAN NOT NULL DEFAULT false,
 fields_json JSONB NOT NULL DEFAULT '{}',updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(tenant_id,store_id,key)
);
CREATE TABLE miniapp_subscription_ticket (
 id UUID PRIMARY KEY,tenant_id UUID NOT NULL REFERENCES tenant(id),store_id UUID NOT NULL REFERENCES store(id),
 identity_id UUID NOT NULL REFERENCES miniapp_identity(id),scene TEXT NOT NULL,template_id TEXT NOT NULL,
 business_id UUID,result TEXT,used_at TIMESTAMPTZ,expires_at TIMESTAMPTZ NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX miniapp_subscription_ticket_available ON miniapp_subscription_ticket(identity_id,scene,business_id) WHERE result='accept' AND used_at IS NULL;
CREATE TABLE miniapp_notice (
 id UUID PRIMARY KEY,tenant_id UUID NOT NULL REFERENCES tenant(id),store_id UUID NOT NULL REFERENCES store(id),
 member_id UUID NOT NULL REFERENCES cloud_member(id),scene TEXT NOT NULL,event_key TEXT NOT NULL,
 business_id UUID,title TEXT NOT NULL,body TEXT NOT NULL,data_json JSONB NOT NULL DEFAULT '{}',
 read_at TIMESTAMPTZ,delivery TEXT NOT NULL DEFAULT 'pending' CHECK(delivery IN ('pending','sending','sent','unsubscribed','failed','uncertain','disabled')),
 attempts INTEGER NOT NULL DEFAULT 0,next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 error_code TEXT,sending_at TIMESTAMPTZ,created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(tenant_id,store_id,member_id,event_key)
);
CREATE INDEX miniapp_notice_member ON miniapp_notice(tenant_id,store_id,member_id,created_at DESC);
CREATE INDEX miniapp_notice_pending ON miniapp_notice(next_attempt_at) WHERE delivery='pending';
