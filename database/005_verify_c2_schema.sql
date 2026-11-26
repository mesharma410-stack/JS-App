-- Read-only verification. Run as owner on the SAME test branch after 004.
WITH expected(name) AS (VALUES
 ('app_users'),('user_access_matrix'),('app_sessions'),('login_attempts'),
 ('products'),('work_orders'),('work_order_lines'),('stock_receipts'),('stock_units'),
 ('dispatches'),('dispatch_units'),('work_order_pricing'),('audit_log'),
 ('user_profiles'),('sales_persons'),('app_settings'),('fabrication_catalog'),
 ('fabrication_products'),('work_order_versions'),('work_order_stage_definitions'),
 ('work_order_tracker'),('wo_status_requests'),('wo_email_history'),('sales_executive_targets')
)
SELECT count(*) AS expected_tables,
       count(to_regclass('public.' || name)) AS present_tables,
       coalesce(string_agg(name, ', ' ORDER BY name) FILTER (WHERE to_regclass('public.' || name) IS NULL),'None') AS missing_tables
FROM expected;

-- All four columns should be false. These check effective inherited permissions.
SELECT has_table_privilege('js_app_runtime','public.app_users','UPDATE') AS can_edit_users,
       has_table_privilege('js_app_runtime','public.user_access_matrix','INSERT') AS can_grant_access,
       has_table_privilege('js_app_runtime','public.stock_units','DELETE') AS can_delete_stock,
       has_schema_privilege('js_app_runtime','public','CREATE') AS can_create_objects;

-- All rows should have false for read/write on the new tables.
SELECT c.relname AS table_name,
       has_table_privilege('js_app_runtime',c.oid,'SELECT') AS runtime_can_read,
       (has_table_privilege('js_app_runtime',c.oid,'INSERT') OR
        has_table_privilege('js_app_runtime',c.oid,'UPDATE') OR
        has_table_privilege('js_app_runtime',c.oid,'DELETE')) AS runtime_can_write
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND c.relkind='r' AND c.relname IN
 ('user_profiles','sales_persons','app_settings','fabrication_catalog','fabrication_products',
  'work_order_versions','work_order_stage_definitions','work_order_tracker','wo_status_requests',
  'wo_email_history','sales_executive_targets')
ORDER BY c.relname;

-- Existing report query dependencies should still be readable: all true.
SELECT c.relname AS table_name,has_table_privilege('js_app_runtime',c.oid,'SELECT') AS runtime_can_read
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND c.relkind='r' AND c.relname IN
 ('products','work_orders','work_order_lines','stock_receipts','stock_units','dispatches',
  'dispatch_units','work_order_pricing','app_users','user_access_matrix')
ORDER BY c.relname;
