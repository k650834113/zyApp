import type { DatabaseSync } from 'node:sqlite'

type Migration = {
  version: number
  name: string
  sql: string
}

const migrations: Migration[] = [
  {
    version: 1,
    name: 'foundation',
    sql: `
      CREATE TABLE app_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE store (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        name TEXT NOT NULL,
        timezone TEXT NOT NULL DEFAULT 'Asia/Shanghai',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE device (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        store_id TEXT NOT NULL REFERENCES store(id),
        name TEXT NOT NULL,
        next_sequence INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE employee (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        store_id TEXT NOT NULL REFERENCES store(id),
        username TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        display_name TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('manager', 'staff')),
        status TEXT NOT NULL CHECK (status IN ('active', 'disabled')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (tenant_id, username)
      ) STRICT;

      CREATE TABLE audit_log (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        store_id TEXT NOT NULL,
        device_id TEXT NOT NULL,
        actor_id TEXT,
        action TEXT NOT NULL,
        aggregate_type TEXT NOT NULL,
        aggregate_id TEXT NOT NULL,
        reason TEXT,
        before_json TEXT,
        after_json TEXT,
        occurred_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE outbox_operation (
        operation_id TEXT PRIMARY KEY,
        device_id TEXT NOT NULL,
        device_seq INTEGER NOT NULL,
        tenant_id TEXT NOT NULL,
        store_id TEXT NOT NULL,
        actor_id TEXT,
        operation_type TEXT NOT NULL,
        aggregate_id TEXT NOT NULL,
        base_version INTEGER,
        occurred_at TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        payload_hash TEXT NOT NULL,
        sync_status TEXT NOT NULL DEFAULT 'pending'
          CHECK (sync_status IN ('pending', 'confirmed', 'conflict')),
        UNIQUE (device_id, device_seq)
      ) STRICT;

      CREATE INDEX idx_audit_log_aggregate
        ON audit_log (aggregate_type, aggregate_id, occurred_at);
      CREATE INDEX idx_outbox_sync_status
        ON outbox_operation (sync_status, device_id, device_seq);
    `
  },
  {
    version: 2,
    name: 'employee-login-metadata',
    sql: `
      ALTER TABLE employee ADD COLUMN last_login_at TEXT;
      ALTER TABLE employee ADD COLUMN password_changed_at TEXT;
      ALTER TABLE employee ADD COLUMN disabled_at TEXT;

      CREATE INDEX idx_employee_login
        ON employee (tenant_id, username, status);
    `
  },
  {
    version: 3,
    name: 'member-foundation',
    sql: `
      CREATE TABLE member (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        store_id TEXT NOT NULL REFERENCES store(id),
        member_number TEXT NOT NULL,
        phone TEXT NOT NULL,
        nickname TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('active', 'disabled')),
        birthday_month INTEGER,
        birthday_day INTEGER,
        birthday_source TEXT
          CHECK (birthday_source IN ('customer', 'manager_correction', 'legacy')),
        birthday_locked INTEGER NOT NULL DEFAULT 0 CHECK (birthday_locked IN (0, 1)),
        confirmed_at_least_14 INTEGER NOT NULL DEFAULT 1
          CHECK (confirmed_at_least_14 IN (0, 1)),
        note TEXT,
        source TEXT NOT NULL DEFAULT 'desktop'
          CHECK (source IN ('desktop', 'miniapp', 'legacy')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (tenant_id, member_number),
        UNIQUE (tenant_id, phone),
        CHECK (
          (birthday_month IS NULL AND birthday_day IS NULL AND birthday_source IS NULL)
          OR
          (birthday_month BETWEEN 1 AND 12 AND birthday_day BETWEEN 1 AND 31
           AND birthday_source IS NOT NULL)
        )
      ) STRICT;

      CREATE TABLE membership_grant (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        store_id TEXT NOT NULL,
        member_id TEXT NOT NULL REFERENCES member(id),
        source_type TEXT NOT NULL
          CHECK (source_type IN ('recharge', 'activity', 'manual', 'legacy')),
        source_id TEXT,
        granted_tier TEXT NOT NULL CHECK (granted_tier = 'advanced'),
        reason TEXT NOT NULL,
        granted_by TEXT,
        granted_at TEXT NOT NULL,
        revoked_by TEXT,
        revoked_at TEXT,
        revoke_reason TEXT
      ) STRICT;

      CREATE TABLE legacy_id_mapping (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        legacy_source TEXT NOT NULL,
        legacy_table TEXT NOT NULL,
        legacy_id TEXT NOT NULL,
        import_batch_id TEXT NOT NULL,
        imported_at TEXT NOT NULL,
        checksum TEXT NOT NULL,
        UNIQUE (tenant_id, legacy_source, legacy_table, legacy_id)
      ) STRICT;

      CREATE INDEX idx_member_search_phone ON member (tenant_id, phone);
      CREATE INDEX idx_member_search_number ON member (tenant_id, member_number);
      CREATE INDEX idx_member_search_nickname ON member (tenant_id, nickname);
      CREATE INDEX idx_membership_grant_active
        ON membership_grant (tenant_id, member_id, revoked_at);
      CREATE INDEX idx_legacy_entity
        ON legacy_id_mapping (tenant_id, entity_type, entity_id);
    `
  },
  {
    version: 4,
    name: 'wallet-ledger',
    sql: `
      CREATE TABLE recharge_gift_tier (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        store_id TEXT NOT NULL REFERENCES store(id),
        principal_fen INTEGER NOT NULL CHECK (principal_fen > 0),
        gift_fen INTEGER NOT NULL CHECK (gift_fen >= 0),
        active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (tenant_id, store_id, principal_fen)
      ) STRICT;

      CREATE TABLE wallet_account (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        store_id TEXT NOT NULL REFERENCES store(id),
        member_id TEXT NOT NULL REFERENCES member(id),
        status TEXT NOT NULL DEFAULT 'active'
          CHECK (status IN ('active', 'frozen')),
        principal_balance_fen INTEGER NOT NULL DEFAULT 0
          CHECK (principal_balance_fen >= 0),
        gift_balance_fen INTEGER NOT NULL DEFAULT 0
          CHECK (gift_balance_fen >= 0),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (tenant_id, member_id)
      ) STRICT;

      CREATE TABLE wallet_recharge (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        store_id TEXT NOT NULL REFERENCES store(id),
        wallet_account_id TEXT NOT NULL REFERENCES wallet_account(id),
        member_id TEXT NOT NULL REFERENCES member(id),
        payment_method TEXT NOT NULL CHECK (payment_method IN ('cash', 'wechat', 'legacy')),
        principal_fen INTEGER NOT NULL CHECK (principal_fen > 0),
        gift_fen INTEGER NOT NULL CHECK (gift_fen >= 0),
        status TEXT NOT NULL DEFAULT 'completed'
          CHECK (status IN ('completed', 'partially_consumed', 'reversed')),
        gift_rule_snapshot_json TEXT NOT NULL,
        request_id TEXT NOT NULL,
        actor_id TEXT NOT NULL,
        device_id TEXT NOT NULL,
        reason TEXT NOT NULL,
        occurred_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (tenant_id, request_id)
      ) STRICT;

      CREATE TABLE wallet_lot (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        store_id TEXT NOT NULL REFERENCES store(id),
        wallet_account_id TEXT NOT NULL REFERENCES wallet_account(id),
        member_id TEXT NOT NULL REFERENCES member(id),
        source_type TEXT NOT NULL CHECK (source_type IN ('recharge', 'legacy', 'adjustment')),
        source_id TEXT NOT NULL,
        original_principal_fen INTEGER NOT NULL CHECK (original_principal_fen >= 0),
        original_gift_fen INTEGER NOT NULL CHECK (original_gift_fen >= 0),
        remaining_principal_fen INTEGER NOT NULL CHECK (remaining_principal_fen >= 0),
        remaining_gift_fen INTEGER NOT NULL CHECK (remaining_gift_fen >= 0),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (tenant_id, source_type, source_id)
      ) STRICT;

      CREATE TABLE wallet_ledger (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        store_id TEXT NOT NULL REFERENCES store(id),
        wallet_account_id TEXT NOT NULL REFERENCES wallet_account(id),
        member_id TEXT NOT NULL REFERENCES member(id),
        entry_type TEXT NOT NULL
          CHECK (entry_type IN (
            'cash_recharge', 'consumption_debit', 'cash_recharge_reversal',
            'manual_adjustment', 'legacy_opening'
          )),
        principal_delta_fen INTEGER NOT NULL,
        gift_delta_fen INTEGER NOT NULL,
        principal_balance_after_fen INTEGER NOT NULL CHECK (principal_balance_after_fen >= 0),
        gift_balance_after_fen INTEGER NOT NULL CHECK (gift_balance_after_fen >= 0),
        source_id TEXT NOT NULL,
        related_ledger_id TEXT,
        request_id TEXT NOT NULL,
        actor_id TEXT NOT NULL,
        device_id TEXT NOT NULL,
        reason TEXT NOT NULL,
        metadata_json TEXT NOT NULL,
        occurred_at TEXT NOT NULL,
        UNIQUE (tenant_id, request_id)
      ) STRICT;

      CREATE TABLE wallet_ledger_allocation (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        ledger_id TEXT NOT NULL REFERENCES wallet_ledger(id),
        lot_id TEXT NOT NULL REFERENCES wallet_lot(id),
        principal_fen INTEGER NOT NULL DEFAULT 0 CHECK (principal_fen >= 0),
        gift_fen INTEGER NOT NULL DEFAULT 0 CHECK (gift_fen >= 0),
        created_at TEXT NOT NULL,
        CHECK (principal_fen > 0 OR gift_fen > 0)
      ) STRICT;

      CREATE INDEX idx_wallet_member
        ON wallet_account (tenant_id, member_id);
      CREATE INDEX idx_wallet_ledger_account
        ON wallet_ledger (tenant_id, wallet_account_id, occurred_at);
      CREATE INDEX idx_wallet_lot_available
        ON wallet_lot (tenant_id, wallet_account_id, remaining_gift_fen, remaining_principal_fen);
      CREATE INDEX idx_wallet_recharge_member
        ON wallet_recharge (tenant_id, member_id, occurred_at);
      CREATE UNIQUE INDEX idx_membership_grant_source
        ON membership_grant (tenant_id, source_type, source_id)
        WHERE source_id IS NOT NULL;
    `
  },
  {
    version: 5,
    name: 'monthly-card',
    sql: `
      CREATE TABLE monthly_card_plan (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        store_id TEXT NOT NULL REFERENCES store(id),
        name TEXT NOT NULL,
        price_fen INTEGER NOT NULL CHECK (price_fen > 0),
        duration_days INTEGER NOT NULL CHECK (duration_days > 0),
        active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (tenant_id, store_id, name)
      ) STRICT;

      CREATE TABLE monthly_card (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        store_id TEXT NOT NULL REFERENCES store(id),
        member_id TEXT NOT NULL REFERENCES member(id),
        plan_id TEXT NOT NULL REFERENCES monthly_card_plan(id),
        plan_name_snapshot TEXT NOT NULL,
        price_fen INTEGER NOT NULL CHECK (price_fen > 0),
        duration_days INTEGER NOT NULL CHECK (duration_days > 0),
        payment_method TEXT NOT NULL CHECK (payment_method = 'cash'),
        status TEXT NOT NULL CHECK (status IN ('active', 'paused', 'expired', 'refunded')),
        request_id TEXT NOT NULL,
        purchased_by TEXT NOT NULL,
        purchased_at TEXT NOT NULL,
        starts_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        paused_at TEXT,
        total_paused_seconds INTEGER NOT NULL DEFAULT 0 CHECK (total_paused_seconds >= 0),
        refunded_at TEXT,
        refund_reason TEXT,
        updated_at TEXT NOT NULL,
        UNIQUE (tenant_id, request_id)
      ) STRICT;

      CREATE TABLE monthly_card_event (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        store_id TEXT NOT NULL REFERENCES store(id),
        card_id TEXT NOT NULL REFERENCES monthly_card(id),
        member_id TEXT NOT NULL REFERENCES member(id),
        event_type TEXT NOT NULL
          CHECK (event_type IN ('purchased', 'paused', 'resumed', 'used', 'refunded', 'expired')),
        request_id TEXT NOT NULL,
        actor_id TEXT NOT NULL,
        device_id TEXT NOT NULL,
        reason TEXT NOT NULL,
        metadata_json TEXT NOT NULL,
        occurred_at TEXT NOT NULL,
        UNIQUE (tenant_id, request_id)
      ) STRICT;

      CREATE UNIQUE INDEX idx_monthly_card_current
        ON monthly_card (tenant_id, member_id)
        WHERE status IN ('active', 'paused');
      CREATE INDEX idx_monthly_card_member_history
        ON monthly_card (tenant_id, member_id, purchased_at);
      CREATE INDEX idx_monthly_card_events
        ON monthly_card_event (tenant_id, card_id, occurred_at);
    `
  },
  {
    version: 6,
    name: 'catalog',
    sql: `
      CREATE TABLE catalog_item (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        store_id TEXT NOT NULL REFERENCES store(id),
        code TEXT NOT NULL,
        name TEXT NOT NULL,
        item_type TEXT NOT NULL
          CHECK (item_type IN ('admission', 'product', 'service', 'activity')),
        regular_price_fen INTEGER NOT NULL CHECK (regular_price_fen >= 0),
        advanced_price_fen INTEGER NOT NULL CHECK (advanced_price_fen >= 0),
        status TEXT NOT NULL DEFAULT 'active'
          CHECK (status IN ('active', 'disabled')),
        availability TEXT NOT NULL DEFAULT 'available'
          CHECK (availability IN ('available', 'sold_out')),
        note TEXT,
        source TEXT NOT NULL DEFAULT 'desktop'
          CHECK (source IN ('desktop', 'legacy')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (tenant_id, code)
      ) STRICT;

      CREATE INDEX idx_catalog_active
        ON catalog_item (tenant_id, store_id, status, item_type, name);
    `
  },
  {
    version: 7,
    name: 'visit-order',
    sql: `
      CREATE TABLE visit_batch (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        store_id TEXT NOT NULL REFERENCES store(id),
        status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'completed')),
        started_at TEXT NOT NULL,
        completed_at TEXT,
        created_by TEXT NOT NULL,
        device_id TEXT NOT NULL
      ) STRICT;

      CREATE TABLE sales_order (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        store_id TEXT NOT NULL REFERENCES store(id),
        visit_batch_id TEXT NOT NULL REFERENCES visit_batch(id),
        order_number TEXT NOT NULL,
        customer_member_id TEXT REFERENCES member(id),
        payment_method TEXT NOT NULL CHECK (payment_method IN ('cash', 'stored_value')),
        wallet_member_id TEXT REFERENCES member(id),
        status TEXT NOT NULL CHECK (status = 'completed'),
        total_fen INTEGER NOT NULL CHECK (total_fen >= 0),
        request_id TEXT NOT NULL,
        note TEXT,
        completed_by TEXT NOT NULL,
        device_id TEXT NOT NULL,
        completed_at TEXT NOT NULL,
        UNIQUE (tenant_id, order_number),
        UNIQUE (tenant_id, request_id),
        CHECK (
          (payment_method = 'cash' AND wallet_member_id IS NULL)
          OR
          (payment_method = 'stored_value' AND wallet_member_id IS NOT NULL)
        )
      ) STRICT;

      CREATE TABLE sales_order_item (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        store_id TEXT NOT NULL REFERENCES store(id),
        order_id TEXT NOT NULL REFERENCES sales_order(id),
        catalog_item_id TEXT NOT NULL REFERENCES catalog_item(id),
        item_name_snapshot TEXT NOT NULL,
        item_type_snapshot TEXT NOT NULL
          CHECK (item_type_snapshot IN ('admission', 'product', 'service', 'activity')),
        regular_price_fen_snapshot INTEGER NOT NULL CHECK (regular_price_fen_snapshot >= 0),
        advanced_price_fen_snapshot INTEGER NOT NULL CHECK (advanced_price_fen_snapshot >= 0),
        applied_unit_price_fen INTEGER NOT NULL CHECK (applied_unit_price_fen >= 0),
        pricing_tier TEXT NOT NULL CHECK (pricing_tier IN ('regular', 'advanced')),
        quantity INTEGER NOT NULL CHECK (quantity > 0),
        line_total_fen INTEGER NOT NULL CHECK (line_total_fen >= 0),
        benefit_type TEXT NOT NULL
          CHECK (benefit_type IN ('none', 'birthday', 'monthly_card', 'repeat_admission')),
        beneficiary_member_id TEXT REFERENCES member(id)
      ) STRICT;

      CREATE TABLE order_payment (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        store_id TEXT NOT NULL REFERENCES store(id),
        order_id TEXT NOT NULL REFERENCES sales_order(id),
        payment_method TEXT NOT NULL CHECK (payment_method IN ('cash', 'stored_value')),
        amount_fen INTEGER NOT NULL CHECK (amount_fen >= 0),
        wallet_member_id TEXT REFERENCES member(id),
        wallet_operation_id TEXT,
        status TEXT NOT NULL CHECK (status = 'completed'),
        occurred_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE member_admission_record (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        store_id TEXT NOT NULL REFERENCES store(id),
        member_id TEXT NOT NULL REFERENCES member(id),
        business_date TEXT NOT NULL,
        visit_batch_id TEXT NOT NULL REFERENCES visit_batch(id),
        order_id TEXT NOT NULL REFERENCES sales_order(id),
        benefit_type TEXT NOT NULL
          CHECK (benefit_type IN ('none', 'birthday', 'monthly_card', 'repeat_admission')),
        occurred_at TEXT NOT NULL,
        UNIQUE (tenant_id, member_id, business_date)
      ) STRICT;

      CREATE TABLE birthday_benefit_usage (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        store_id TEXT NOT NULL REFERENCES store(id),
        member_id TEXT NOT NULL REFERENCES member(id),
        business_date TEXT NOT NULL,
        order_id TEXT NOT NULL REFERENCES sales_order(id),
        occurred_at TEXT NOT NULL,
        UNIQUE (tenant_id, member_id, business_date)
      ) STRICT;

      CREATE INDEX idx_visit_batch_store
        ON visit_batch (tenant_id, store_id, started_at);
      CREATE INDEX idx_sales_order_recent
        ON sales_order (tenant_id, store_id, completed_at);
      CREATE INDEX idx_sales_order_batch
        ON sales_order (tenant_id, visit_batch_id, completed_at);
      CREATE INDEX idx_order_item_order
        ON sales_order_item (tenant_id, order_id);
      CREATE INDEX idx_admission_batch_member
        ON member_admission_record (tenant_id, member_id, visit_batch_id);
    `
  },
  {
    version: 8,
    name: 'order-refund',
    sql: `
      CREATE TABLE wallet_ledger_v8 (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        store_id TEXT NOT NULL REFERENCES store(id),
        wallet_account_id TEXT NOT NULL REFERENCES wallet_account(id),
        member_id TEXT NOT NULL REFERENCES member(id),
        entry_type TEXT NOT NULL
          CHECK (entry_type IN (
            'cash_recharge', 'consumption_debit', 'cash_recharge_reversal',
            'order_refund_credit', 'manual_adjustment', 'legacy_opening'
          )),
        principal_delta_fen INTEGER NOT NULL,
        gift_delta_fen INTEGER NOT NULL,
        principal_balance_after_fen INTEGER NOT NULL CHECK (principal_balance_after_fen >= 0),
        gift_balance_after_fen INTEGER NOT NULL CHECK (gift_balance_after_fen >= 0),
        source_id TEXT NOT NULL,
        related_ledger_id TEXT,
        request_id TEXT NOT NULL,
        actor_id TEXT NOT NULL,
        device_id TEXT NOT NULL,
        reason TEXT NOT NULL,
        metadata_json TEXT NOT NULL,
        occurred_at TEXT NOT NULL,
        UNIQUE (tenant_id, request_id)
      ) STRICT;

      INSERT INTO wallet_ledger_v8
      SELECT * FROM wallet_ledger;

      CREATE TABLE wallet_ledger_allocation_v8 (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        ledger_id TEXT NOT NULL REFERENCES wallet_ledger_v8(id),
        lot_id TEXT NOT NULL REFERENCES wallet_lot(id),
        principal_fen INTEGER NOT NULL DEFAULT 0 CHECK (principal_fen >= 0),
        gift_fen INTEGER NOT NULL DEFAULT 0 CHECK (gift_fen >= 0),
        created_at TEXT NOT NULL,
        CHECK (principal_fen > 0 OR gift_fen > 0)
      ) STRICT;

      INSERT INTO wallet_ledger_allocation_v8
      SELECT * FROM wallet_ledger_allocation;

      DROP TABLE wallet_ledger_allocation;
      DROP TABLE wallet_ledger;
      ALTER TABLE wallet_ledger_v8 RENAME TO wallet_ledger;
      ALTER TABLE wallet_ledger_allocation_v8 RENAME TO wallet_ledger_allocation;

      CREATE INDEX idx_wallet_ledger_account
        ON wallet_ledger (tenant_id, wallet_account_id, occurred_at);

      CREATE TABLE refund_request (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        store_id TEXT NOT NULL REFERENCES store(id),
        refund_number TEXT NOT NULL,
        order_id TEXT NOT NULL REFERENCES sales_order(id),
        original_payment_id TEXT NOT NULL REFERENCES order_payment(id),
        payment_method TEXT NOT NULL CHECK (payment_method IN ('cash', 'stored_value')),
        wallet_member_id TEXT REFERENCES member(id),
        status TEXT NOT NULL CHECK (status IN ('pending', 'completed', 'rejected')),
        total_fen INTEGER NOT NULL CHECK (total_fen > 0),
        request_id TEXT NOT NULL,
        requested_by TEXT NOT NULL,
        requested_at TEXT NOT NULL,
        request_reason TEXT,
        approved_by TEXT,
        approved_at TEXT,
        approval_request_id TEXT,
        special_product_override INTEGER NOT NULL DEFAULT 0
          CHECK (special_product_override IN (0, 1)),
        completion_reason TEXT,
        rejected_by TEXT,
        rejected_at TEXT,
        rejection_request_id TEXT,
        rejection_reason TEXT,
        completed_at TEXT,
        device_id TEXT NOT NULL,
        UNIQUE (tenant_id, refund_number),
        UNIQUE (tenant_id, request_id),
        UNIQUE (tenant_id, approval_request_id),
        UNIQUE (tenant_id, rejection_request_id),
        CHECK (
          (payment_method = 'cash' AND wallet_member_id IS NULL)
          OR
          (payment_method = 'stored_value' AND wallet_member_id IS NOT NULL)
        )
      ) STRICT;

      CREATE TABLE refund_item (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        store_id TEXT NOT NULL REFERENCES store(id),
        refund_id TEXT NOT NULL REFERENCES refund_request(id),
        order_item_id TEXT NOT NULL REFERENCES sales_order_item(id),
        item_name_snapshot TEXT NOT NULL,
        item_type_snapshot TEXT NOT NULL
          CHECK (item_type_snapshot IN ('admission', 'product', 'service', 'activity')),
        unit_refund_fen INTEGER NOT NULL CHECK (unit_refund_fen > 0),
        quantity INTEGER NOT NULL CHECK (quantity > 0),
        line_refund_fen INTEGER NOT NULL CHECK (line_refund_fen > 0),
        UNIQUE (tenant_id, refund_id, order_item_id)
      ) STRICT;

      CREATE TABLE refund_payment (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        store_id TEXT NOT NULL REFERENCES store(id),
        refund_id TEXT NOT NULL REFERENCES refund_request(id),
        original_payment_id TEXT NOT NULL REFERENCES order_payment(id),
        payment_method TEXT NOT NULL CHECK (payment_method IN ('cash', 'stored_value')),
        amount_fen INTEGER NOT NULL CHECK (amount_fen > 0),
        wallet_member_id TEXT REFERENCES member(id),
        wallet_ledger_id TEXT,
        status TEXT NOT NULL CHECK (status = 'completed'),
        occurred_at TEXT NOT NULL,
        UNIQUE (tenant_id, refund_id)
      ) STRICT;

      CREATE TABLE wallet_refund_allocation (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        refund_payment_id TEXT NOT NULL REFERENCES refund_payment(id),
        refund_ledger_id TEXT NOT NULL REFERENCES wallet_ledger(id),
        original_debit_ledger_id TEXT NOT NULL REFERENCES wallet_ledger(id),
        lot_id TEXT NOT NULL REFERENCES wallet_lot(id),
        principal_fen INTEGER NOT NULL DEFAULT 0 CHECK (principal_fen >= 0),
        gift_fen INTEGER NOT NULL DEFAULT 0 CHECK (gift_fen >= 0),
        created_at TEXT NOT NULL,
        CHECK (principal_fen > 0 OR gift_fen > 0)
      ) STRICT;

      CREATE TABLE refund_evidence (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        store_id TEXT NOT NULL REFERENCES store(id),
        refund_id TEXT NOT NULL REFERENCES refund_request(id),
        evidence_type TEXT NOT NULL CHECK (evidence_type IN ('pdf', 'excel')),
        file_name TEXT NOT NULL,
        file_sha256 TEXT NOT NULL,
        request_id TEXT NOT NULL,
        generated_by TEXT NOT NULL,
        generated_at TEXT NOT NULL,
        UNIQUE (tenant_id, request_id)
      ) STRICT;

      CREATE INDEX idx_refund_recent
        ON refund_request (tenant_id, store_id, requested_at);
      CREATE INDEX idx_refund_order
        ON refund_request (tenant_id, order_id, status);
      CREATE INDEX idx_refund_item_order_item
        ON refund_item (tenant_id, order_item_id);
      CREATE INDEX idx_wallet_refund_debit
        ON wallet_refund_allocation (tenant_id, original_debit_ledger_id);
    `
  },
  {
    version: 9,
    name: 'financial-refund-approval',
    sql: `
      CREATE TABLE financial_refund_request (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        store_id TEXT NOT NULL REFERENCES store(id),
        request_number TEXT NOT NULL,
        target_type TEXT NOT NULL
          CHECK (target_type IN ('monthly_card', 'cash_recharge')),
        target_id TEXT NOT NULL,
        member_id TEXT NOT NULL REFERENCES member(id),
        payment_method TEXT NOT NULL CHECK (payment_method = 'cash'),
        status TEXT NOT NULL CHECK (status IN ('pending', 'completed', 'rejected')),
        refund_principal_fen INTEGER NOT NULL CHECK (refund_principal_fen > 0),
        reclaim_gift_fen INTEGER NOT NULL DEFAULT 0 CHECK (reclaim_gift_fen >= 0),
        request_id TEXT NOT NULL,
        requested_by TEXT NOT NULL,
        requested_at TEXT NOT NULL,
        request_reason TEXT,
        approved_by TEXT,
        approved_at TEXT,
        approval_request_id TEXT,
        requires_special_override INTEGER NOT NULL DEFAULT 0
          CHECK (requires_special_override IN (0, 1)),
        special_override INTEGER NOT NULL DEFAULT 0 CHECK (special_override IN (0, 1)),
        completion_reason TEXT,
        execution_operation_id TEXT,
        rejected_by TEXT,
        rejected_at TEXT,
        rejection_request_id TEXT,
        rejection_reason TEXT,
        completed_at TEXT,
        device_id TEXT NOT NULL,
        UNIQUE (tenant_id, request_number),
        UNIQUE (tenant_id, request_id),
        UNIQUE (tenant_id, approval_request_id),
        UNIQUE (tenant_id, rejection_request_id)
      ) STRICT;

      CREATE UNIQUE INDEX idx_financial_refund_pending_target
        ON financial_refund_request (tenant_id, target_type, target_id)
        WHERE status = 'pending';
      CREATE INDEX idx_financial_refund_recent
        ON financial_refund_request (tenant_id, store_id, requested_at);
    `
  },
  {
    version: 10,
    name: 'legacy-import',
    sql: `
      ALTER TABLE monthly_card ADD COLUMN source TEXT NOT NULL DEFAULT 'desktop'
        CHECK (source IN ('desktop', 'legacy'));
      ALTER TABLE monthly_card ADD COLUMN legacy_import_batch_id TEXT;
      ALTER TABLE monthly_card ADD COLUMN legacy_member_id TEXT;

      CREATE TABLE legacy_import_batch (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        store_id TEXT NOT NULL REFERENCES store(id),
        source_name TEXT NOT NULL,
        source_sha256 TEXT NOT NULL,
        source_size_bytes INTEGER NOT NULL CHECK (source_size_bytes >= 0),
        imported_by TEXT NOT NULL,
        imported_at TEXT NOT NULL,
        summary_json TEXT NOT NULL,
        UNIQUE (tenant_id, source_sha256)
      ) STRICT;

      CREATE TABLE legacy_raw_row (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        import_batch_id TEXT NOT NULL REFERENCES legacy_import_batch(id),
        legacy_table TEXT NOT NULL,
        legacy_id TEXT NOT NULL,
        row_json TEXT NOT NULL,
        checksum TEXT NOT NULL,
        UNIQUE (import_batch_id, legacy_table, legacy_id)
      ) STRICT;

      CREATE TABLE legacy_financial_history (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        store_id TEXT NOT NULL REFERENCES store(id),
        import_batch_id TEXT NOT NULL REFERENCES legacy_import_batch(id),
        member_id TEXT REFERENCES member(id),
        legacy_table TEXT NOT NULL
          CHECK (legacy_table IN ('transactions', 'activity_logs')),
        legacy_id TEXT NOT NULL,
        legacy_member_id TEXT,
        event_type TEXT NOT NULL,
        amount_fen INTEGER,
        description TEXT,
        occurred_at_raw TEXT,
        occurred_at_normalized TEXT,
        UNIQUE (import_batch_id, legacy_table, legacy_id)
      ) STRICT;

      CREATE TABLE legacy_monthly_card_history (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        store_id TEXT NOT NULL REFERENCES store(id),
        import_batch_id TEXT NOT NULL REFERENCES legacy_import_batch(id),
        member_id TEXT NOT NULL REFERENCES member(id),
        legacy_member_id TEXT NOT NULL,
        plan_name TEXT NOT NULL,
        starts_at_raw TEXT NOT NULL,
        expires_at_raw TEXT NOT NULL,
        starts_at_normalized TEXT NOT NULL,
        expires_at_normalized TEXT NOT NULL,
        imported_status TEXT NOT NULL CHECK (imported_status IN ('active', 'expired')),
        operational_card_id TEXT REFERENCES monthly_card(id),
        UNIQUE (import_batch_id, legacy_member_id)
      ) STRICT;

      CREATE TABLE legacy_reconciliation_issue (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        store_id TEXT NOT NULL REFERENCES store(id),
        import_batch_id TEXT NOT NULL REFERENCES legacy_import_batch(id),
        member_id TEXT REFERENCES member(id),
        legacy_member_id TEXT,
        issue_type TEXT NOT NULL,
        expected_fen INTEGER,
        actual_fen INTEGER,
        detail TEXT NOT NULL
      ) STRICT;

      CREATE TABLE legacy_import_resolution (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        import_batch_id TEXT NOT NULL REFERENCES legacy_import_batch(id),
        conflict_type TEXT NOT NULL CHECK (conflict_type IN ('member', 'catalog')),
        legacy_id TEXT NOT NULL,
        resolution_json TEXT NOT NULL,
        UNIQUE (import_batch_id, conflict_type, legacy_id)
      ) STRICT;

      CREATE INDEX idx_legacy_raw_lookup
        ON legacy_raw_row (tenant_id, legacy_table, legacy_id);
      CREATE INDEX idx_legacy_history_member
        ON legacy_financial_history (tenant_id, member_id, occurred_at_normalized);
      CREATE INDEX idx_legacy_monthly_member
        ON legacy_monthly_card_history (tenant_id, member_id, expires_at_normalized);
      CREATE INDEX idx_legacy_reconciliation_batch
        ON legacy_reconciliation_issue (tenant_id, import_batch_id);
    `
  },
  {
    version: 11,
    name: 'sync-foundation',
    sql: `
      CREATE TABLE sync_state (
        device_id TEXT PRIMARY KEY REFERENCES device(id),
        tenant_id TEXT NOT NULL,
        store_id TEXT NOT NULL REFERENCES store(id),
        last_confirmed_device_seq INTEGER NOT NULL DEFAULT 0
          CHECK (last_confirmed_device_seq >= 0),
        pull_cursor TEXT,
        last_push_at TEXT,
        last_pull_at TEXT,
        updated_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE sync_conflict (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        store_id TEXT NOT NULL REFERENCES store(id),
        device_id TEXT NOT NULL REFERENCES device(id),
        operation_id TEXT NOT NULL REFERENCES outbox_operation(operation_id),
        conflict_type TEXT NOT NULL,
        local_payload_json TEXT NOT NULL,
        server_payload_json TEXT,
        status TEXT NOT NULL DEFAULT 'pending'
          CHECK (status IN ('pending', 'resolved')),
        created_at TEXT NOT NULL,
        resolved_by TEXT,
        resolved_at TEXT,
        resolution_json TEXT,
        UNIQUE (operation_id)
      ) STRICT;

      CREATE INDEX idx_sync_conflict_pending
        ON sync_conflict (tenant_id, store_id, status, created_at);
    `
  },
  {
    version: 12,
    name: 'activity-campaign',
    sql: `
      CREATE TABLE activity_campaign (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        store_id TEXT NOT NULL REFERENCES store(id),
        title TEXT NOT NULL,
        summary TEXT NOT NULL,
        content TEXT NOT NULL,
        activity_type TEXT NOT NULL
          CHECK (activity_type IN ('recharge', 'general')),
        status TEXT NOT NULL
          CHECK (status IN ('draft', 'published', 'disabled')),
        starts_at TEXT NOT NULL,
        ends_at TEXT NOT NULL,
        pinned INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0, 1)),
        regular_price_fen INTEGER CHECK (regular_price_fen >= 0),
        advanced_price_fen INTEGER CHECK (advanced_price_fen >= 0),
        allow_stored_value INTEGER NOT NULL DEFAULT 1
          CHECK (allow_stored_value IN (0, 1)),
        allow_wechat INTEGER NOT NULL DEFAULT 1
          CHECK (allow_wechat IN (0, 1)),
        created_by TEXT NOT NULL,
        published_by TEXT,
        published_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        CHECK (ends_at > starts_at)
      ) STRICT;

      CREATE TABLE activity_recharge_tier (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        store_id TEXT NOT NULL REFERENCES store(id),
        activity_id TEXT NOT NULL REFERENCES activity_campaign(id)
          ON DELETE CASCADE,
        principal_fen INTEGER NOT NULL CHECK (principal_fen > 0),
        gift_fen INTEGER NOT NULL CHECK (gift_fen >= 0),
        created_at TEXT NOT NULL,
        UNIQUE (tenant_id, activity_id, principal_fen)
      ) STRICT;

      CREATE INDEX idx_activity_schedule
        ON activity_campaign (tenant_id, store_id, status, starts_at, ends_at);
      CREATE INDEX idx_activity_tiers
        ON activity_recharge_tier (tenant_id, activity_id, principal_fen);
    `
  },
  {
    version: 13,
    name: 'store-content',
    sql: `
      CREATE TABLE announcement (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        store_id TEXT NOT NULL REFERENCES store(id),
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        status TEXT NOT NULL
          CHECK (status IN ('draft', 'published', 'disabled')),
        pinned INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0, 1)),
        visible_from TEXT NOT NULL,
        visible_until TEXT,
        created_by TEXT NOT NULL,
        published_by TEXT,
        published_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        CHECK (visible_until IS NULL OR visible_until > visible_from)
      ) STRICT;

      CREATE INDEX idx_announcement_visibility
        ON announcement
        (tenant_id, store_id, status, pinned, visible_from, visible_until);

      CREATE TABLE board_game (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        store_id TEXT NOT NULL REFERENCES store(id),
        name TEXT NOT NULL,
        introduction TEXT NOT NULL,
        categories_json TEXT NOT NULL,
        min_players INTEGER NOT NULL CHECK (min_players > 0),
        max_players INTEGER NOT NULL CHECK (max_players >= min_players),
        min_minutes INTEGER CHECK (min_minutes > 0),
        max_minutes INTEGER CHECK (
          max_minutes IS NULL OR
          (max_minutes > 0 AND (min_minutes IS NULL OR max_minutes >= min_minutes))
        ),
        difficulty TEXT NOT NULL
          CHECK (difficulty IN ('light', 'medium', 'heavy')),
        quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity >= 0),
        record_status TEXT NOT NULL DEFAULT 'active'
          CHECK (record_status IN ('active', 'disabled')),
        available INTEGER NOT NULL DEFAULT 1 CHECK (available IN (0, 1)),
        customer_consigned INTEGER NOT NULL DEFAULT 0
          CHECK (customer_consigned IN (0, 1)),
        missing_pieces INTEGER NOT NULL DEFAULT 0
          CHECK (missing_pieces IN (0, 1)),
        private INTEGER NOT NULL DEFAULT 0 CHECK (private IN (0, 1)),
        recommended INTEGER NOT NULL DEFAULT 0 CHECK (recommended IN (0, 1)),
        image_url TEXT,
        local_image_path TEXT,
        bgg_id INTEGER CHECK (bgg_id > 0),
        customer_note TEXT,
        internal_note TEXT,
        consignor_nickname TEXT,
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE board_game_missing_part (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        store_id TEXT NOT NULL REFERENCES store(id),
        board_game_id TEXT NOT NULL REFERENCES board_game(id)
          ON DELETE CASCADE,
        name TEXT NOT NULL,
        quantity INTEGER NOT NULL CHECK (quantity > 0),
        created_at TEXT NOT NULL
      ) STRICT;

      CREATE INDEX idx_board_game_public
        ON board_game
        (tenant_id, store_id, record_status, private, recommended, available);
      CREATE INDEX idx_board_game_missing_parts
        ON board_game_missing_part (tenant_id, board_game_id);
    `
  },
  {
    version: 14,
    name: 'sync-inbound-events',
    sql: `
      CREATE TABLE sync_inbound_event (
        sequence TEXT PRIMARY KEY,
        event_id TEXT NOT NULL UNIQUE,
        tenant_id TEXT NOT NULL,
        store_id TEXT NOT NULL REFERENCES store(id),
        origin_device_id TEXT,
        aggregate_type TEXT NOT NULL,
        aggregate_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        occurred_at TEXT NOT NULL,
        apply_status TEXT NOT NULL
          CHECK (apply_status IN (
            'pending', 'applied', 'skipped_origin', 'conflict'
          )),
        received_at TEXT NOT NULL,
        applied_at TEXT,
        error_message TEXT
      ) STRICT;

      CREATE INDEX idx_sync_inbound_pending
        ON sync_inbound_event
        (tenant_id, store_id, apply_status, sequence);
    `
  },
  {
    version: 15,
    name: 'store-public-profile',
    sql: `
      ALTER TABLE store ADD COLUMN address TEXT;
      ALTER TABLE store ADD COLUMN contact_phone TEXT;
      ALTER TABLE store ADD COLUMN business_open_minute INTEGER NOT NULL
        DEFAULT 780 CHECK (business_open_minute BETWEEN 0 AND 1439);
      ALTER TABLE store ADD COLUMN business_close_minute INTEGER NOT NULL
        DEFAULT 1380 CHECK (business_close_minute BETWEEN 0 AND 1439);
      ALTER TABLE store ADD COLUMN status_override TEXT NOT NULL
        DEFAULT 'automatic'
        CHECK (status_override IN ('automatic', 'open', 'closed'));
      ALTER TABLE store ADD COLUMN custom_status_text TEXT;
    `
  },
  {
    version: 16,
    name: 'member-age-gate',
    sql: `
      ALTER TABLE member ADD COLUMN age_gate_status TEXT NOT NULL
        DEFAULT 'confirmed_at_least_14'
        CHECK (age_gate_status IN (
          'confirmed_at_least_14',
          'under_14_verified',
          'recharge_disabled'
        ));

      UPDATE member
      SET age_gate_status = CASE
        WHEN confirmed_at_least_14 = 1 THEN 'confirmed_at_least_14'
        ELSE 'recharge_disabled'
      END;
    `
  },
  {
    version: 17,
    name: 'employee-mobile-credential',
    sql: `
      CREATE TABLE employee_mobile_credential (
        employee_id TEXT PRIMARY KEY REFERENCES employee(id) ON DELETE CASCADE,
        tenant_id TEXT NOT NULL,
        store_id TEXT NOT NULL REFERENCES store(id),
        enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
        password_hash TEXT,
        updated_at TEXT NOT NULL
      ) STRICT;

      CREATE INDEX idx_employee_mobile_credential_store
        ON employee_mobile_credential (tenant_id, store_id, enabled);
    `
  },
  {
    version: 18,
    name: 'cashier-command-execution',
    sql: `
      CREATE TABLE cashier_command_execution (
        command_id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        store_id TEXT NOT NULL REFERENCES store(id),
        device_id TEXT NOT NULL REFERENCES device(id),
        requested_by_employee_id TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('completed', 'failed')),
        local_order_id TEXT REFERENCES sales_order(id),
        result_json TEXT,
        error_message TEXT,
        reported_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        CHECK (
          (status = 'completed' AND local_order_id IS NOT NULL
            AND result_json IS NOT NULL AND error_message IS NULL)
          OR
          (status = 'failed' AND local_order_id IS NULL
            AND result_json IS NULL AND error_message IS NOT NULL)
        )
      ) STRICT;

      CREATE INDEX idx_cashier_command_execution_pending_report
        ON cashier_command_execution (tenant_id, store_id, created_at)
        WHERE reported_at IS NULL;
    `
  },
  {
    version: 19,
    name: 'employee-financial-command-execution',
    sql: `
      CREATE TABLE employee_financial_command_execution (
        command_id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        store_id TEXT NOT NULL REFERENCES store(id),
        device_id TEXT NOT NULL REFERENCES device(id),
        requested_by_employee_id TEXT NOT NULL,
        command_type TEXT NOT NULL CHECK (command_type IN (
          'cash_recharge',
          'monthly_card_purchase',
          'monthly_card_pause',
          'monthly_card_resume'
        )),
        status TEXT NOT NULL CHECK (status IN ('completed', 'failed')),
        result_json TEXT,
        error_message TEXT,
        reported_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        CHECK (
          (status = 'completed' AND result_json IS NOT NULL
            AND error_message IS NULL)
          OR
          (status = 'failed' AND result_json IS NULL
            AND error_message IS NOT NULL)
        )
      ) STRICT;

      CREATE INDEX idx_employee_financial_execution_pending_report
        ON employee_financial_command_execution
          (tenant_id, store_id, created_at)
        WHERE reported_at IS NULL;
    `
  },
  {
    version: 20,
    name: 'activity-recharge-tier-command',
    sql: `
      ALTER TABLE employee_financial_command_execution
        RENAME TO employee_financial_command_execution_v19;

      CREATE TABLE employee_financial_command_execution (
        command_id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        store_id TEXT NOT NULL REFERENCES store(id),
        device_id TEXT NOT NULL REFERENCES device(id),
        requested_by_employee_id TEXT NOT NULL,
        command_type TEXT NOT NULL CHECK (command_type IN (
          'cash_recharge',
          'monthly_card_purchase',
          'monthly_card_pause',
          'monthly_card_resume',
          'apply_activity_recharge_tiers'
        )),
        status TEXT NOT NULL CHECK (status IN ('completed', 'failed')),
        result_json TEXT,
        error_message TEXT,
        reported_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        CHECK (
          (status = 'completed' AND result_json IS NOT NULL
            AND error_message IS NULL)
          OR
          (status = 'failed' AND result_json IS NULL
            AND error_message IS NOT NULL)
        )
      ) STRICT;

      INSERT INTO employee_financial_command_execution (
        command_id, tenant_id, store_id, device_id,
        requested_by_employee_id, command_type, status, result_json,
        error_message, reported_at, created_at, updated_at
      )
      SELECT command_id, tenant_id, store_id, device_id,
             requested_by_employee_id, command_type, status, result_json,
             error_message, reported_at, created_at, updated_at
      FROM employee_financial_command_execution_v19;

      DROP TABLE employee_financial_command_execution_v19;

      CREATE INDEX idx_employee_financial_execution_pending_report
        ON employee_financial_command_execution
          (tenant_id, store_id, created_at)
        WHERE reported_at IS NULL;
    `
  },
  {
    version: 21,
    name: 'wechat-recharge-inbound-ledger',
    sql: `
      ALTER TABLE wallet_ledger_allocation
        RENAME TO wallet_ledger_allocation_v20;
      ALTER TABLE wallet_refund_allocation
        RENAME TO wallet_refund_allocation_v20;
      ALTER TABLE wallet_ledger RENAME TO wallet_ledger_v20;

      CREATE TABLE wallet_ledger (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        store_id TEXT NOT NULL REFERENCES store(id),
        wallet_account_id TEXT NOT NULL REFERENCES wallet_account(id),
        member_id TEXT NOT NULL REFERENCES member(id),
        entry_type TEXT NOT NULL
          CHECK (entry_type IN (
            'cash_recharge', 'wechat_recharge', 'consumption_debit',
            'cash_recharge_reversal', 'order_refund_credit',
            'manual_adjustment', 'legacy_opening'
          )),
        principal_delta_fen INTEGER NOT NULL,
        gift_delta_fen INTEGER NOT NULL,
        principal_balance_after_fen INTEGER NOT NULL
          CHECK (principal_balance_after_fen >= 0),
        gift_balance_after_fen INTEGER NOT NULL
          CHECK (gift_balance_after_fen >= 0),
        source_id TEXT NOT NULL,
        related_ledger_id TEXT,
        request_id TEXT NOT NULL,
        actor_id TEXT NOT NULL,
        device_id TEXT NOT NULL,
        reason TEXT NOT NULL,
        metadata_json TEXT NOT NULL,
        occurred_at TEXT NOT NULL,
        UNIQUE (tenant_id, request_id)
      ) STRICT;

      INSERT INTO wallet_ledger
      SELECT * FROM wallet_ledger_v20;

      CREATE TABLE wallet_ledger_allocation (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        ledger_id TEXT NOT NULL REFERENCES wallet_ledger(id),
        lot_id TEXT NOT NULL REFERENCES wallet_lot(id),
        principal_fen INTEGER NOT NULL DEFAULT 0 CHECK (principal_fen >= 0),
        gift_fen INTEGER NOT NULL DEFAULT 0 CHECK (gift_fen >= 0),
        created_at TEXT NOT NULL,
        CHECK (principal_fen > 0 OR gift_fen > 0)
      ) STRICT;

      INSERT INTO wallet_ledger_allocation
      SELECT * FROM wallet_ledger_allocation_v20;

      CREATE TABLE wallet_refund_allocation (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        refund_payment_id TEXT NOT NULL REFERENCES refund_payment(id),
        refund_ledger_id TEXT NOT NULL REFERENCES wallet_ledger(id),
        original_debit_ledger_id TEXT NOT NULL REFERENCES wallet_ledger(id),
        lot_id TEXT NOT NULL REFERENCES wallet_lot(id),
        principal_fen INTEGER NOT NULL DEFAULT 0 CHECK (principal_fen >= 0),
        gift_fen INTEGER NOT NULL DEFAULT 0 CHECK (gift_fen >= 0),
        created_at TEXT NOT NULL,
        CHECK (principal_fen > 0 OR gift_fen > 0)
      ) STRICT;

      INSERT INTO wallet_refund_allocation
      SELECT * FROM wallet_refund_allocation_v20;

      DROP TABLE wallet_refund_allocation_v20;
      DROP TABLE wallet_ledger_allocation_v20;
      DROP TABLE wallet_ledger_v20;

      CREATE INDEX idx_wallet_ledger_account
        ON wallet_ledger (tenant_id, wallet_account_id, occurred_at);
    `
  },
  {
    version: 22,
    name: 'recharge-gift-rule-state',
    sql: `
      CREATE TABLE recharge_gift_rule_state (
        tenant_id TEXT NOT NULL,
        store_id TEXT NOT NULL REFERENCES store(id),
        source_type TEXT NOT NULL CHECK (source_type IN ('default', 'activity')),
        source_activity_id TEXT REFERENCES activity_campaign(id),
        default_tiers_json TEXT NOT NULL,
        applied_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (tenant_id, store_id),
        CHECK (
          (source_type = 'default' AND source_activity_id IS NULL)
          OR
          (source_type = 'activity' AND source_activity_id IS NOT NULL)
        )
      ) STRICT;
    `
  },
  {
    version: 23,
    name: 'cloud-primary-runtime',
    sql: `
      CREATE TABLE cloud_runtime_state (
        device_id TEXT PRIMARY KEY REFERENCES device(id),
        tenant_id TEXT NOT NULL,
        store_id TEXT NOT NULL REFERENCES store(id),
        mirror_epoch TEXT NOT NULL,
        cloud_primary_activated INTEGER NOT NULL DEFAULT 0
          CHECK (cloud_primary_activated IN (0, 1)),
        runtime_mode TEXT NOT NULL DEFAULT 'not_configured'
          CHECK (runtime_mode IN (
            'not_configured', 'connecting', 'cloud_online', 'local_offline',
            'reconciling', 'mirror_error', 'result_pending',
            'configuration_error'
          )),
        last_cloud_reachable_at TEXT,
        offline_lease_owner_device_id TEXT,
        offline_lease_expires_at TEXT,
        offline_lease_version INTEGER NOT NULL DEFAULT 0,
        last_error TEXT,
        updated_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE cloud_operation_outcome (
        operation_id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        store_id TEXT NOT NULL,
        device_id TEXT NOT NULL,
        aggregate_type TEXT NOT NULL,
        aggregate_id TEXT NOT NULL,
        status TEXT NOT NULL
          CHECK (status IN ('pending', 'confirmed', 'conflict', 'mirror_error')),
        server_version INTEGER,
        result_json TEXT,
        error_message TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;

      CREATE INDEX idx_cloud_operation_outcome_status
        ON cloud_operation_outcome (tenant_id, store_id, status, updated_at);

      CREATE TABLE cloud_mirror_repair (
        operation_id TEXT PRIMARY KEY
          REFERENCES cloud_operation_outcome(operation_id),
        tenant_id TEXT NOT NULL,
        store_id TEXT NOT NULL,
        aggregate_type TEXT NOT NULL,
        aggregate_id TEXT NOT NULL,
        error_message TEXT NOT NULL,
        attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
        next_attempt_at TEXT NOT NULL,
        repaired_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;

      CREATE INDEX idx_cloud_mirror_repair_pending
        ON cloud_mirror_repair (repaired_at, next_attempt_at);

      CREATE TABLE cloud_read_model_cache (
        tenant_id TEXT NOT NULL,
        store_id TEXT NOT NULL,
        resource TEXT NOT NULL,
        row_id TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        event_cursor TEXT NOT NULL,
        cached_at TEXT NOT NULL,
        PRIMARY KEY (tenant_id, store_id, resource, row_id)
      ) STRICT;

      CREATE INDEX idx_cloud_read_model_cache_resource
        ON cloud_read_model_cache (tenant_id, store_id, resource, row_id);
    `
  },
  {
    version: 24,
    name: 'desktop-cloud-credential-cache',
    sql: `
      CREATE TABLE employee_pc_offline_credential (
        employee_id TEXT PRIMARY KEY REFERENCES employee(id) ON DELETE CASCADE,
        tenant_id TEXT NOT NULL,
        store_id TEXT NOT NULL REFERENCES store(id),
        device_id TEXT NOT NULL REFERENCES device(id),
        encrypted_verifier TEXT NOT NULL,
        credential_version INTEGER NOT NULL CHECK (credential_version >= 1),
        authorization_version INTEGER NOT NULL CHECK (authorization_version >= 1),
        verified_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        invalidated_at TEXT,
        updated_at TEXT NOT NULL,
        UNIQUE (employee_id, tenant_id, store_id, device_id)
      ) STRICT;

      CREATE INDEX idx_employee_pc_offline_credential_scope
        ON employee_pc_offline_credential
          (tenant_id, store_id, device_id, expires_at);

      CREATE TABLE employee_pc_credential_migration (
        employee_id TEXT PRIMARY KEY REFERENCES employee(id) ON DELETE CASCADE,
        tenant_id TEXT NOT NULL,
        store_id TEXT NOT NULL REFERENCES store(id),
        operation_id TEXT NOT NULL UNIQUE,
        queued_at TEXT NOT NULL,
        confirmed_at TEXT
      ) STRICT;
    `
  },
  {
    version: 25,
    name: 'tenant-wallet-monthly-card-scope-and-extension',
    sql: `
      ALTER TABLE monthly_card_plan ADD COLUMN scope_type TEXT NOT NULL DEFAULT 'store'
        CHECK (scope_type IN ('tenant', 'store'));
      ALTER TABLE monthly_card_plan ADD COLUMN source_template_id TEXT;

      ALTER TABLE monthly_card ADD COLUMN scope_type TEXT NOT NULL DEFAULT 'store'
        CHECK (scope_type IN ('tenant', 'store'));

      DROP INDEX idx_monthly_card_current;
      CREATE UNIQUE INDEX idx_monthly_card_current_store
        ON monthly_card (tenant_id, member_id, store_id)
        WHERE status IN ('active', 'paused') AND scope_type = 'store';
      CREATE UNIQUE INDEX idx_monthly_card_current_tenant
        ON monthly_card (tenant_id, member_id)
        WHERE status IN ('active', 'paused') AND scope_type = 'tenant';

      ALTER TABLE monthly_card_event RENAME TO monthly_card_event_v24;
      CREATE TABLE monthly_card_event (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        store_id TEXT NOT NULL REFERENCES store(id),
        card_id TEXT NOT NULL REFERENCES monthly_card(id),
        member_id TEXT NOT NULL REFERENCES member(id),
        event_type TEXT NOT NULL CHECK (event_type IN (
          'purchased', 'paused', 'resumed', 'used', 'refunded', 'expired',
          'manual_extended'
        )),
        request_id TEXT NOT NULL,
        actor_id TEXT NOT NULL,
        device_id TEXT NOT NULL,
        reason TEXT NOT NULL,
        metadata_json TEXT NOT NULL,
        occurred_at TEXT NOT NULL,
        UNIQUE (tenant_id, request_id)
      ) STRICT;
      INSERT INTO monthly_card_event
      SELECT * FROM monthly_card_event_v24;
      DROP TABLE monthly_card_event_v24;
      CREATE INDEX idx_monthly_card_events
        ON monthly_card_event (tenant_id, card_id, occurred_at);

      CREATE TABLE merchant_business_template (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        template_type TEXT NOT NULL CHECK (template_type IN (
          'recharge_gift_tier', 'monthly_card_plan', 'activity'
        )),
        name TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (tenant_id, template_type, name)
      ) STRICT;

      CREATE TABLE store_business_template_override (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        store_id TEXT NOT NULL REFERENCES store(id),
        template_id TEXT NOT NULL REFERENCES merchant_business_template(id),
        payload_json TEXT NOT NULL,
        active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (tenant_id, store_id, template_id)
      ) STRICT;

      ALTER TABLE recharge_gift_tier ADD COLUMN source_template_id TEXT;
      ALTER TABLE activity_campaign ADD COLUMN source_template_id TEXT;

      CREATE TABLE catalog_store_config (
        tenant_id TEXT NOT NULL,
        store_id TEXT NOT NULL REFERENCES store(id),
        catalog_item_id TEXT NOT NULL REFERENCES catalog_item(id),
        regular_price_fen INTEGER NOT NULL CHECK (regular_price_fen >= 0),
        advanced_price_fen INTEGER NOT NULL CHECK (advanced_price_fen >= 0),
        status TEXT NOT NULL CHECK (status IN ('active', 'disabled')),
        availability TEXT NOT NULL CHECK (availability IN ('available', 'sold_out')),
        note TEXT,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (tenant_id, store_id, catalog_item_id)
      ) STRICT;
      INSERT INTO catalog_store_config
      SELECT tenant_id, store_id, id, regular_price_fen, advanced_price_fen,
             status, availability, note, updated_at
      FROM catalog_item;

      CREATE TABLE board_game_store_config (
        tenant_id TEXT NOT NULL,
        store_id TEXT NOT NULL REFERENCES store(id),
        board_game_id TEXT NOT NULL REFERENCES board_game(id),
        quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity >= 0),
        record_status TEXT NOT NULL,
        available INTEGER NOT NULL CHECK (available IN (0, 1)),
        customer_consigned INTEGER NOT NULL CHECK (customer_consigned IN (0, 1)),
        missing_pieces INTEGER NOT NULL CHECK (missing_pieces IN (0, 1)),
        private INTEGER NOT NULL CHECK (private IN (0, 1)),
        recommended INTEGER NOT NULL CHECK (recommended IN (0, 1)),
        customer_note TEXT,
        internal_note TEXT,
        consignor_nickname TEXT,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (tenant_id, store_id, board_game_id)
      ) STRICT;
      INSERT INTO board_game_store_config
      SELECT tenant_id, store_id, id, quantity, record_status, available,
             customer_consigned, missing_pieces, private, recommended,
             customer_note, internal_note, consignor_nickname, updated_at
      FROM board_game;
    `
  },
  {
    version: 26,
    name: 'wechat-recharge-order-mirror',
    sql: `
      CREATE TABLE wechat_recharge_order_mirror (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        store_id TEXT NOT NULL REFERENCES store(id),
        member_id TEXT NOT NULL REFERENCES member(id),
        identity_id TEXT NOT NULL,
        request_id TEXT NOT NULL,
        out_trade_no TEXT NOT NULL,
        provider_mode TEXT NOT NULL CHECK (provider_mode IN ('mock', 'wechat')),
        provider_prepay_id TEXT,
        provider_transaction_id TEXT,
        principal_fen INTEGER NOT NULL CHECK (principal_fen > 0),
        gift_fen INTEGER NOT NULL CHECK (gift_fen >= 0),
        status TEXT NOT NULL CHECK (status IN (
          'creating', 'pending_payment', 'settled', 'failed', 'expired'
        )),
        error_message TEXT,
        expires_at TEXT NOT NULL,
        paid_at TEXT,
        settled_at TEXT,
        wallet_operation_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (tenant_id, out_trade_no)
      ) STRICT;

      CREATE INDEX idx_wechat_recharge_order_mirror_member
        ON wechat_recharge_order_mirror
          (tenant_id, member_id, created_at DESC);
      CREATE INDEX idx_wechat_recharge_order_mirror_status
        ON wechat_recharge_order_mirror
          (tenant_id, status, updated_at DESC);
    `
  },
  {
    version: 27,
    name: 'wechat-monthly-card-payment-method',
    sql: `
      DROP INDEX idx_monthly_card_current_store;
      DROP INDEX idx_monthly_card_current_tenant;
      DROP INDEX idx_monthly_card_member_history;
      DROP INDEX idx_monthly_card_events;
      DROP INDEX idx_legacy_monthly_member;

      ALTER TABLE legacy_monthly_card_history
        RENAME TO legacy_monthly_card_history_v25;
      ALTER TABLE monthly_card_event RENAME TO monthly_card_event_v25;
      ALTER TABLE monthly_card RENAME TO monthly_card_v25;

      CREATE TABLE monthly_card (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        store_id TEXT NOT NULL REFERENCES store(id),
        member_id TEXT NOT NULL REFERENCES member(id),
        plan_id TEXT NOT NULL REFERENCES monthly_card_plan(id),
        plan_name_snapshot TEXT NOT NULL,
        price_fen INTEGER NOT NULL CHECK (price_fen > 0),
        duration_days INTEGER NOT NULL CHECK (duration_days > 0),
        payment_method TEXT NOT NULL
          CHECK (payment_method IN ('cash', 'wechat')),
        status TEXT NOT NULL
          CHECK (status IN ('active', 'paused', 'expired', 'refunded', 'voided')),
        request_id TEXT NOT NULL,
        purchased_by TEXT NOT NULL,
        purchased_at TEXT NOT NULL,
        starts_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        paused_at TEXT,
        total_paused_seconds INTEGER NOT NULL DEFAULT 0
          CHECK (total_paused_seconds >= 0),
        refunded_at TEXT,
        refund_reason TEXT,
        updated_at TEXT NOT NULL,
        source TEXT NOT NULL DEFAULT 'desktop'
          CHECK (source IN ('desktop', 'legacy', 'cloud')),
        legacy_import_batch_id TEXT,
        legacy_member_id TEXT,
        scope_type TEXT NOT NULL DEFAULT 'store'
          CHECK (scope_type IN ('tenant', 'store')),
        UNIQUE (tenant_id, request_id)
      ) STRICT;

      INSERT INTO monthly_card
      (id, tenant_id, store_id, member_id, plan_id, plan_name_snapshot,
       price_fen, duration_days, payment_method, status, request_id,
       purchased_by, purchased_at, starts_at, expires_at, paused_at,
       total_paused_seconds, refunded_at, refund_reason, updated_at, source,
       legacy_import_batch_id, legacy_member_id, scope_type)
      SELECT id, tenant_id, store_id, member_id, plan_id, plan_name_snapshot,
             price_fen, duration_days, payment_method, status, request_id,
             purchased_by, purchased_at, starts_at, expires_at, paused_at,
             total_paused_seconds, refunded_at, refund_reason, updated_at,
             source, legacy_import_batch_id, legacy_member_id, scope_type
      FROM monthly_card_v25;

      CREATE TABLE monthly_card_event (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        store_id TEXT NOT NULL REFERENCES store(id),
        card_id TEXT NOT NULL REFERENCES monthly_card(id),
        member_id TEXT NOT NULL REFERENCES member(id),
        event_type TEXT NOT NULL CHECK (event_type IN (
          'purchased', 'paused', 'resumed', 'used', 'refunded', 'expired',
          'manual_extended'
        )),
        request_id TEXT NOT NULL,
        actor_id TEXT NOT NULL,
        device_id TEXT NOT NULL,
        reason TEXT NOT NULL,
        metadata_json TEXT NOT NULL,
        occurred_at TEXT NOT NULL,
        UNIQUE (tenant_id, request_id)
      ) STRICT;
      INSERT INTO monthly_card_event
      SELECT * FROM monthly_card_event_v25;

      CREATE TABLE legacy_monthly_card_history (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        store_id TEXT NOT NULL REFERENCES store(id),
        import_batch_id TEXT NOT NULL REFERENCES legacy_import_batch(id),
        member_id TEXT NOT NULL REFERENCES member(id),
        legacy_member_id TEXT NOT NULL,
        plan_name TEXT NOT NULL,
        starts_at_raw TEXT NOT NULL,
        expires_at_raw TEXT NOT NULL,
        starts_at_normalized TEXT NOT NULL,
        expires_at_normalized TEXT NOT NULL,
        imported_status TEXT NOT NULL
          CHECK (imported_status IN ('active', 'expired')),
        operational_card_id TEXT REFERENCES monthly_card(id),
        UNIQUE (import_batch_id, legacy_member_id)
      ) STRICT;
      INSERT INTO legacy_monthly_card_history
      SELECT * FROM legacy_monthly_card_history_v25;

      DROP TABLE legacy_monthly_card_history_v25;
      DROP TABLE monthly_card_event_v25;
      DROP TABLE monthly_card_v25;

      CREATE UNIQUE INDEX idx_monthly_card_current_store
        ON monthly_card (tenant_id, member_id, store_id)
        WHERE status IN ('active', 'paused') AND scope_type = 'store';
      CREATE UNIQUE INDEX idx_monthly_card_current_tenant
        ON monthly_card (tenant_id, member_id)
        WHERE status IN ('active', 'paused') AND scope_type = 'tenant';
      CREATE INDEX idx_monthly_card_member_history
        ON monthly_card (tenant_id, member_id, purchased_at);
      CREATE INDEX idx_monthly_card_events
        ON monthly_card_event (tenant_id, card_id, occurred_at);
      CREATE INDEX idx_legacy_monthly_member
        ON legacy_monthly_card_history
          (tenant_id, member_id, expires_at_normalized);
    `
  },
  {
    version: 28,
    name: 'wechat-monthly-card-order-mirror',
    sql: `
      CREATE TABLE wechat_monthly_card_order_mirror (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        store_id TEXT NOT NULL REFERENCES store(id),
        member_id TEXT NOT NULL REFERENCES member(id),
        identity_id TEXT NOT NULL,
        request_id TEXT NOT NULL,
        out_trade_no TEXT NOT NULL,
        provider_mode TEXT NOT NULL
          CHECK (provider_mode IN ('mock', 'wechat')),
        provider_prepay_id TEXT,
        provider_transaction_id TEXT,
        plan_name TEXT NOT NULL,
        price_fen INTEGER NOT NULL CHECK (price_fen > 0),
        duration_days INTEGER NOT NULL CHECK (duration_days > 0),
        scope_type TEXT NOT NULL CHECK (scope_type IN ('tenant', 'store')),
        status TEXT NOT NULL CHECK (status IN (
          'creating', 'pending_payment', 'settled', 'failed', 'expired'
        )),
        target_card_id TEXT,
        expires_before TEXT,
        expires_after TEXT,
        error_message TEXT,
        expires_at TEXT NOT NULL,
        paid_at TEXT,
        settled_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (tenant_id, out_trade_no)
      ) STRICT;

      CREATE INDEX idx_wechat_monthly_card_order_mirror_member
        ON wechat_monthly_card_order_mirror
          (tenant_id, member_id, created_at DESC);
      CREATE INDEX idx_wechat_monthly_card_order_mirror_status
        ON wechat_monthly_card_order_mirror
          (tenant_id, status, updated_at DESC);
    `
  },
  {
    version: 29,
    name: 'repair-tier-reconciliation-and-effective-wallet-ledger',
    sql: `
      UPDATE outbox_operation AS pending
      SET actor_id = (
        SELECT employee.id
        FROM employee
        WHERE employee.tenant_id = pending.tenant_id
          AND employee.store_id = pending.store_id
          AND employee.status = 'active'
        ORDER BY CASE employee.role WHEN 'manager' THEN 0 ELSE 1 END,
                 employee.updated_at DESC,
                 employee.id
        LIMIT 1
      )
      WHERE pending.sync_status = 'pending'
        AND pending.operation_type = 'member.tier.reconciled'
        AND pending.actor_id IS NULL
        AND EXISTS (
          SELECT 1 FROM employee
          WHERE employee.tenant_id = pending.tenant_id
            AND employee.store_id = pending.store_id
            AND employee.status = 'active'
        );

      CREATE VIEW effective_wallet_ledger AS
      SELECT cloud_row.*
      FROM wallet_ledger cloud_row
      WHERE NOT (
        cloud_row.actor_id = 'cloud-sync'
        AND EXISTS (
          SELECT 1
          FROM wallet_ledger local_row
          WHERE local_row.tenant_id = cloud_row.tenant_id
            AND local_row.member_id = cloud_row.member_id
            AND local_row.entry_type = cloud_row.entry_type
            AND local_row.source_id = cloud_row.source_id
            AND local_row.principal_delta_fen = cloud_row.principal_delta_fen
            AND local_row.gift_delta_fen = cloud_row.gift_delta_fen
            AND local_row.actor_id <> 'cloud-sync'
        )
      );
    `
  },
  {
    version: 30,
    name: 'board-game-metadata-import',
    sql: `
      CREATE TABLE board_game_bgg_migration_guard (
        duplicate_count INTEGER NOT NULL
          CONSTRAINT no_duplicate_board_game_bgg_ids
          CHECK (duplicate_count = 0)
      ) STRICT;
      INSERT INTO board_game_bgg_migration_guard
      SELECT COUNT(*) FROM (
        SELECT tenant_id, bgg_id
        FROM board_game
        WHERE bgg_id IS NOT NULL
        GROUP BY tenant_id, bgg_id
        HAVING COUNT(*) > 1
      );
      DROP TABLE board_game_bgg_migration_guard;

      ALTER TABLE board_game ADD COLUMN complexity_tenths INTEGER
        CHECK (complexity_tenths BETWEEN 0 AND 50);
      ALTER TABLE board_game ADD COLUMN metadata_source TEXT
        CHECK (metadata_source IN ('bgg'));
      ALTER TABLE board_game ADD COLUMN metadata_imported_at TEXT;

      CREATE UNIQUE INDEX uq_board_game_tenant_bgg_id
        ON board_game (tenant_id, bgg_id)
        WHERE bgg_id IS NOT NULL;
    `
  },
  {
    version: 31,
    name: 'board-game-expansion-parent',
    sql: `
      ALTER TABLE board_game ADD COLUMN base_game_id TEXT;

      CREATE INDEX idx_board_game_base_game
        ON board_game (tenant_id, base_game_id);
    `
  },
  {
    version: 32,
    name: 'cloud-financial-command-journal',
    sql: `CREATE TABLE cloud_financial_command (
      id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, store_id TEXT NOT NULL,
      device_id TEXT NOT NULL, actor_id TEXT NOT NULL, command_key TEXT NOT NULL,
      request_hash TEXT NOT NULL, channel TEXT NOT NULL, request_json TEXT NOT NULL,
      result_json TEXT NOT NULL, group_id TEXT NOT NULL, resolution_json TEXT, reported_at TEXT, created_at TEXT NOT NULL,
      UNIQUE(device_id, command_key)
    ) STRICT;
    CREATE INDEX idx_cloud_financial_group ON cloud_financial_command(group_id);
    CREATE TABLE monthly_card_event_reconciled (
      id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, store_id TEXT NOT NULL REFERENCES store(id),
      card_id TEXT NOT NULL REFERENCES monthly_card(id), member_id TEXT NOT NULL REFERENCES member(id),
      event_type TEXT NOT NULL CHECK (event_type IN ('purchased','paused','resumed','used','refunded','expired','manual_extended','reconciled')),
      request_id TEXT NOT NULL, actor_id TEXT NOT NULL, device_id TEXT NOT NULL,
      reason TEXT NOT NULL, metadata_json TEXT NOT NULL, occurred_at TEXT NOT NULL,
      UNIQUE(tenant_id, request_id)
    ) STRICT;
    INSERT INTO monthly_card_event_reconciled SELECT * FROM monthly_card_event;
    DROP TABLE monthly_card_event;
    ALTER TABLE monthly_card_event_reconciled RENAME TO monthly_card_event;
    CREATE INDEX idx_monthly_card_events ON monthly_card_event(tenant_id,card_id,occurred_at);`
  }
]

export const LATEST_SCHEMA_VERSION = migrations.at(-1)?.version ?? 0

export function migrateDatabase(
  database: DatabaseSync,
  targetVersion = Number.POSITIVE_INFINITY
): number {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    ) STRICT;
  `)

  const current = database
    .prepare('SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations')
    .get() as { version: number }

  for (const migration of migrations) {
    if (migration.version > targetVersion) {
      break
    }
    if (migration.version <= current.version) {
      continue
    }

    database.exec('BEGIN IMMEDIATE')
    try {
      database.exec(migration.sql)
      database
        .prepare(
          'INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)'
        )
        .run(migration.version, migration.name, new Date().toISOString())
      database.exec('COMMIT')
    } catch (error) {
      database.exec('ROLLBACK')
      throw error
    }
  }

  const result = database
    .prepare('SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations')
    .get() as { version: number }

  return result.version
}
