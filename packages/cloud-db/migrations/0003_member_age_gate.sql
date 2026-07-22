ALTER TABLE cloud_member
  ADD COLUMN age_gate_status TEXT NOT NULL DEFAULT 'confirmed_at_least_14'
    CHECK (age_gate_status IN (
      'confirmed_at_least_14',
      'under_14_verified',
      'recharge_disabled'
    ));
