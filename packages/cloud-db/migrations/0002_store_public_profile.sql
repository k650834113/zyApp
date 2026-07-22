ALTER TABLE store
  ADD COLUMN address TEXT,
  ADD COLUMN contact_phone TEXT,
  ADD COLUMN business_open_minute INTEGER NOT NULL DEFAULT 780
    CHECK (business_open_minute BETWEEN 0 AND 1439),
  ADD COLUMN business_close_minute INTEGER NOT NULL DEFAULT 1380
    CHECK (business_close_minute BETWEEN 0 AND 1439),
  ADD COLUMN status_override TEXT NOT NULL DEFAULT 'automatic'
    CHECK (status_override IN ('automatic', 'open', 'closed')),
  ADD COLUMN custom_status_text TEXT;

ALTER TABLE store
  ADD CONSTRAINT chk_store_business_hours_different
  CHECK (business_open_minute <> business_close_minute);
