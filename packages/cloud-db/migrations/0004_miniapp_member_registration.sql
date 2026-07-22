CREATE TABLE miniapp_identity (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenant(id),
  store_id UUID NOT NULL REFERENCES store(id),
  provider TEXT NOT NULL CHECK (provider IN ('wechat', 'development')),
  provider_subject TEXT NOT NULL,
  member_id UUID REFERENCES cloud_member(id),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'disabled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(tenant_id, provider, provider_subject)
);

CREATE INDEX idx_miniapp_identity_member
  ON miniapp_identity(tenant_id, member_id);

CREATE TABLE miniapp_session (
  id UUID PRIMARY KEY,
  identity_id UUID NOT NULL REFERENCES miniapp_identity(id),
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_miniapp_session_identity_expiry
  ON miniapp_session(identity_id, expires_at);

CREATE TABLE phone_verification_challenge (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenant(id),
  store_id UUID NOT NULL REFERENCES store(id),
  identity_id UUID NOT NULL REFERENCES miniapp_identity(id),
  phone TEXT NOT NULL,
  purpose TEXT NOT NULL CHECK (purpose IN ('member_registration')),
  code_hash TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts INTEGER NOT NULL DEFAULT 5 CHECK (max_attempts BETWEEN 1 AND 20),
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_phone_verification_identity
  ON phone_verification_challenge(identity_id, purpose, created_at DESC);

CREATE INDEX idx_phone_verification_expiry
  ON phone_verification_challenge(expires_at)
  WHERE consumed_at IS NULL;
