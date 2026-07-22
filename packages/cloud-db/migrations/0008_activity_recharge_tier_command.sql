ALTER TABLE employee_financial_command
  DROP CONSTRAINT IF EXISTS employee_financial_command_command_type_check;

ALTER TABLE employee_financial_command
  ADD CONSTRAINT employee_financial_command_command_type_check
  CHECK (command_type IN (
    'cash_recharge',
    'monthly_card_purchase',
    'monthly_card_pause',
    'monthly_card_resume',
    'apply_activity_recharge_tiers'
  ));
