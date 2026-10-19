-- Preserve every historical event while allowing audited conflict corrections.
ALTER TABLE cloud_monthly_card_event
  DROP CONSTRAINT cloud_monthly_card_event_event_type_check;
ALTER TABLE cloud_monthly_card_event
  ADD CONSTRAINT cloud_monthly_card_event_event_type_check CHECK (event_type IN (
    'purchased', 'paused', 'resumed', 'used', 'refunded', 'expired',
    'snapshot', 'manual_extended', 'reconciled'
  ));
