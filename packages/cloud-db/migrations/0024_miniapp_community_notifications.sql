CREATE TABLE miniapp_community_notification (
  id UUID PRIMARY KEY, tenant_id UUID NOT NULL, store_id UUID NOT NULL,
  meetup_id UUID NOT NULL REFERENCES miniapp_meetup(id), recipient_member_id UUID NOT NULL REFERENCES cloud_member(id),
  event_type TEXT NOT NULL CHECK(event_type IN ('created','joined','left','full','cancelled','expired')),
  payload_json JSONB NOT NULL, status TEXT NOT NULL DEFAULT 'awaiting_configuration'
    CHECK(status IN ('awaiting_configuration','pending','sent','failed','unsubscribed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX miniapp_community_notification_pending ON miniapp_community_notification(status,created_at);
