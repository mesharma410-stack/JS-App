-- Final 10C2 additive schema foundation. TEST BRANCH ONLY. Run once as owner,
-- after 001_schema.sql and 002_runtime_permissions.sql. No business data or credentials.
-- All DDL is transactional. An unexpected existing object aborts rather than masking drift.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';
SET LOCAL search_path = public, pg_catalog;

-- Credential remains app_users with hashed passwords; UserAccessMatrix stays normalized.
ALTER TABLE app_users
  ADD COLUMN team text,
  ADD COLUMN office text;

CREATE TABLE user_profiles (
  username text PRIMARY KEY REFERENCES app_users(username),
  display_name text NOT NULL DEFAULT '',
  designation text NOT NULL DEFAULT '',
  updated_by text,
  updated_at timestamptz
);
CREATE TABLE sales_persons (
  sales_person_id text PRIMARY KEY,
  sales_person_name text NOT NULL CHECK (length(trim(sales_person_name)) > 0),
  active boolean NOT NULL DEFAULT true,
  display_id text
);
CREATE TABLE app_settings (
  key text PRIMARY KEY,
  value text NOT NULL
);
CREATE TABLE fabrication_catalog (
  catalog_id text PRIMARY KEY,
  normalized_key text NOT NULL,
  equipment_name text NOT NULL,
  brand text NOT NULL DEFAULT '',
  model text NOT NULL DEFAULT '',
  size_capacity text NOT NULL DEFAULT '',
  category text NOT NULL DEFAULT '',
  subcategory text NOT NULL DEFAULT '',
  suggested_rate numeric(16,2) CHECK (suggested_rate >= 0),
  use_count integer NOT NULL DEFAULT 0 CHECK (use_count >= 0),
  last_used_at timestamptz,
  active boolean NOT NULL DEFAULT true,
  display_id text
);
CREATE INDEX fabrication_catalog_key_idx ON fabrication_catalog(normalized_key) WHERE active;

ALTER TABLE products
  ADD COLUMN default_unit_cost numeric(16,2) CHECK (default_unit_cost >= 0),
  ADD COLUMN created_at timestamptz,
  ADD COLUMN last_edited_by text,
  ADD COLUMN last_edited_at timestamptz,
  ADD COLUMN display_id text,
  ADD COLUMN last_change text,
  ADD COLUMN row_version bigint NOT NULL DEFAULT 1 CHECK (row_version > 0);

ALTER TABLE work_orders
  ADD COLUMN sales_person_id text REFERENCES sales_persons(sales_person_id),
  ADD COLUMN created_at timestamptz,
  ADD COLUMN quotation_id text,
  ADD COLUMN quotation_version integer,
  ADD COLUMN current_version integer CHECK (current_version >= 1),
  ADD COLUMN customer_name text,
  ADD COLUMN last_edited_by text,
  ADD COLUMN last_edited_at timestamptz,
  ADD COLUMN display_id text,
  ADD COLUMN last_change text,
  ADD COLUMN specs text,
  ADD COLUMN structure text,
  ADD COLUMN gas_fitting text,
  ADD COLUMN quote_reference text,
  ADD COLUMN prepared_by text,
  ADD COLUMN checked_by text;

ALTER TABLE work_order_lines
  ADD COLUMN unit_price numeric(16,2) CHECK (unit_price >= 0),
  ADD COLUMN created_at timestamptz,
  ADD COLUMN size_capacity text,
  ADD COLUMN product_type text,
  ADD COLUMN code text,
  ADD COLUMN section text,
  ADD COLUMN category text,
  ADD COLUMN subcategory text,
  ADD COLUMN discount numeric(16,4),
  ADD COLUMN special_discount numeric(16,4),
  ADD COLUMN gst numeric(16,4),
  ADD COLUMN last_edited_by text,
  ADD COLUMN last_edited_at timestamptz,
  ADD COLUMN fabrication_catalog_id text REFERENCES fabrication_catalog(catalog_id),
  ADD COLUMN display_id text,
  ADD COLUMN last_change text,
  ADD COLUMN item_remarks text,
  ADD COLUMN item_description text,
  ADD CONSTRAINT work_order_lines_order_line_route_key UNIQUE (work_order_id,line_id,entry_type);

CREATE TABLE fabrication_products (
  fabrication_id text PRIMARY KEY,
  work_order_id text NOT NULL REFERENCES work_orders(work_order_id),
  work_order_line_id text NOT NULL,
  entry_type text NOT NULL DEFAULT 'Fabrication' CHECK (entry_type = 'Fabrication'),
  equipment_name text NOT NULL,
  brand text NOT NULL DEFAULT '',
  model text NOT NULL DEFAULT '',
  size_capacity text NOT NULL DEFAULT '',
  product_type text,
  unit_price numeric(16,2) CHECK (unit_price >= 0),
  created_at timestamptz,
  active boolean NOT NULL DEFAULT true,
  last_edited_by text,
  last_edited_at timestamptz,
  catalog_id text REFERENCES fabrication_catalog(catalog_id),
  display_id text,
  row_version bigint NOT NULL DEFAULT 1 CHECK (row_version > 0),
  FOREIGN KEY (work_order_id,work_order_line_id,entry_type)
    REFERENCES work_order_lines(work_order_id,line_id,entry_type)
);
CREATE INDEX fabrication_products_line_idx ON fabrication_products(work_order_line_id);

CREATE TABLE work_order_versions (
  version_id text PRIMARY KEY,
  work_order_id text NOT NULL REFERENCES work_orders(work_order_id),
  version integer NOT NULL CHECK (version >= 1),
  snapshot_json jsonb NOT NULL CHECK (jsonb_typeof(snapshot_json) = 'object'),
  saved_at timestamptz NOT NULL,
  saved_by text NOT NULL,
  change_summary text,
  accent_color text,
  display_id text,
  withdrawn_at timestamptz,
  withdrawn_by text,
  withdrawn_reason text,
  UNIQUE (work_order_id,version),
  CHECK (version <> 1 OR (withdrawn_at IS NULL AND withdrawn_by IS NULL AND withdrawn_reason IS NULL)),
  CHECK ((withdrawn_at IS NULL AND withdrawn_by IS NULL AND withdrawn_reason IS NULL)
    OR (withdrawn_at IS NOT NULL AND withdrawn_by IS NOT NULL AND withdrawn_reason IS NOT NULL))
);
-- Current pointer may be NULL for existing preview records; set with imported revision.
ALTER TABLE work_orders ADD CONSTRAINT work_orders_current_version_fk
  FOREIGN KEY (work_order_id,current_version) REFERENCES work_order_versions(work_order_id,version)
  DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE work_order_stage_definitions (
  track_type text NOT NULL CHECK (track_type IN ('Bought Out','Fabrication')),
  stage text NOT NULL CHECK (length(trim(stage)) > 0),
  sort_order integer NOT NULL CHECK (sort_order >= 0),
  is_final boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  PRIMARY KEY (track_type,stage)
);
CREATE TABLE work_order_tracker (
  stage_id text PRIMARY KEY,
  work_order_id text NOT NULL REFERENCES work_orders(work_order_id),
  work_order_line_id text NOT NULL,
  entry_type text NOT NULL CHECK (entry_type IN ('Bought Out','Fabrication')),
  stage text NOT NULL,
  updated_at timestamptz NOT NULL,
  updated_by text NOT NULL,
  note text,
  active boolean NOT NULL DEFAULT true,
  display_id text,
  FOREIGN KEY (work_order_id,work_order_line_id,entry_type)
    REFERENCES work_order_lines(work_order_id,line_id,entry_type),
  FOREIGN KEY (entry_type,stage) REFERENCES work_order_stage_definitions(track_type,stage)
);
CREATE INDEX work_order_tracker_latest_idx ON work_order_tracker(work_order_line_id,updated_at DESC,stage_id) WHERE active;

-- StockIn and FabricationStockIn share stock_receipts; serials remain normalized
-- in stock_units, not comma-separated text. Preserve existing unique serial index.
ALTER TABLE stock_receipts
  ADD COLUMN receipt_location text,
  ADD COLUMN work_order_id text REFERENCES work_orders(work_order_id),
  ADD COLUMN product_type text,
  ADD COLUMN equipment_name text,
  ADD COLUMN brand text,
  ADD COLUMN model text,
  ADD COLUMN size_capacity text,
  ADD COLUMN declared_qty integer CHECK (declared_qty > 0),
  ADD COLUMN unit_cost numeric(16,2) CHECK (unit_cost >= 0),
  ADD COLUMN cost_provided boolean,
  ADD COLUMN created_at timestamptz,
  ADD COLUMN last_edited_by text,
  ADD COLUMN last_edited_at timestamptz,
  ADD COLUMN display_id text,
  ADD COLUMN last_change text,
  ADD COLUMN remarks text,
  ADD COLUMN vendor_name text,
  ADD CONSTRAINT stock_receipts_cost_present_ck CHECK (cost_provided IS NOT TRUE OR unit_cost IS NOT NULL);
CREATE INDEX stock_receipts_work_order_line_idx ON stock_receipts(work_order_line_id) WHERE active;
ALTER TABLE stock_units ADD COLUMN row_version bigint NOT NULL DEFAULT 1 CHECK (row_version > 0);

ALTER TABLE dispatches
  ADD COLUMN created_at timestamptz,
  ADD COLUMN last_edited_by text,
  ADD COLUMN last_edited_at timestamptz,
  ADD COLUMN display_id text,
  ADD COLUMN last_change text,
  ADD COLUMN row_version bigint NOT NULL DEFAULT 1 CHECK (row_version > 0);

-- Preserve current per-line pricing key and report queries.
ALTER TABLE work_order_pricing
  ADD COLUMN pricing_id text UNIQUE,
  ADD COLUMN updated_at timestamptz,
  ADD COLUMN updated_by text,
  ADD COLUMN revision integer CHECK (revision >= 1),
  ADD COLUMN active boolean NOT NULL DEFAULT true,
  ADD COLUMN display_id text,
  ADD COLUMN last_change text,
  ADD COLUMN purchase_set boolean,
  ADD COLUMN selling_set boolean,
  ADD COLUMN row_version bigint NOT NULL DEFAULT 1 CHECK (row_version > 0),
  ADD CONSTRAINT work_order_pricing_purchase_present_ck CHECK (purchase_set IS NOT TRUE OR purchase_unit_price IS NOT NULL),
  ADD CONSTRAINT work_order_pricing_selling_present_ck CHECK (selling_set IS NOT TRUE OR selling_unit_price IS NOT NULL);

CREATE TABLE wo_status_requests (
  request_id text PRIMARY KEY,
  work_order_id text NOT NULL REFERENCES work_orders(work_order_id),
  request_type text NOT NULL CHECK (request_type IN ('Hold','Cancel')),
  reason text NOT NULL CHECK (length(trim(reason)) BETWEEN 5 AND 1000),
  requested_by text NOT NULL,
  requested_at timestamptz NOT NULL,
  decision text NOT NULL DEFAULT 'Pending' CHECK (decision IN ('Pending','Approved','Rejected')),
  reviewed_by text,
  reviewed_at timestamptz,
  review_comment text,
  CHECK ((decision = 'Pending' AND reviewed_by IS NULL AND reviewed_at IS NULL)
      OR (decision IN ('Approved','Rejected') AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL))
);
CREATE UNIQUE INDEX wo_status_one_pending_idx ON wo_status_requests(work_order_id) WHERE decision = 'Pending';

CREATE TABLE wo_email_history (
  mail_id text PRIMARY KEY,
  work_order_id text NOT NULL,
  version integer NOT NULL CHECK (version >= 1),
  mail_type text NOT NULL CHECK (mail_type IN ('New','Revised')),
  sent_at timestamptz NOT NULL,
  sender text NOT NULL,
  recipients_to text NOT NULL,
  recipients_cc text,
  subject text NOT NULL,
  message text NOT NULL,
  status text NOT NULL CHECK (status IN ('Sent','Failed')),
  error text,
  FOREIGN KEY (work_order_id,version) REFERENCES work_order_versions(work_order_id,version)
);
CREATE INDEX wo_email_history_order_idx ON wo_email_history(work_order_id,sent_at DESC);

CREATE TABLE sales_executive_targets (
  target_id text PRIMARY KEY,
  sales_person_id text REFERENCES sales_persons(sales_person_id),
  sales_person text NOT NULL CHECK (length(trim(sales_person)) > 0),
  period_type text NOT NULL CHECK (period_type IN ('Month','Quarter')),
  period_key text NOT NULL,
  start_date date NOT NULL,
  end_date date NOT NULL CHECK (end_date >= start_date),
  target_amount numeric(16,2) NOT NULL CHECK (target_amount BETWEEN 0 AND 10000000000000),
  updated_at timestamptz,
  updated_by text,
  active boolean NOT NULL DEFAULT true,
  row_version bigint NOT NULL DEFAULT 1 CHECK (row_version > 0),
  CHECK ((period_type = 'Month' AND period_key ~ '^20[0-9]{2}-(0[1-9]|1[0-2])$')
      OR (period_type = 'Quarter' AND period_key ~ '^20[0-9]{2}-Q[1-4]$'))
);
CREATE UNIQUE INDEX sales_executive_targets_active_idx ON sales_executive_targets(lower(trim(sales_person)),period_type,period_key) WHERE active;

ALTER TABLE audit_log
  ADD COLUMN legacy_audit_id text UNIQUE,
  ADD COLUMN display_id text;
CREATE INDEX audit_log_entity_time_idx ON audit_log(entity_type,entity_id,occurred_at DESC);
CREATE INDEX work_orders_date_status_idx ON work_orders(creation_date,status) WHERE active;

-- Keep newly created tables inaccessible to the preview runtime.
-- Do not enable operational endpoints until reviewed, tested grants exist.
REVOKE ALL ON user_profiles,sales_persons,app_settings,fabrication_catalog,
  fabrication_products,work_order_versions,work_order_stage_definitions,
  work_order_tracker,wo_status_requests,wo_email_history,sales_executive_targets
  FROM PUBLIC,js_app_runtime;
COMMIT;
