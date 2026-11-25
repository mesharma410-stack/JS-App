-- Execute as table owner on the TEST branch, AFTER 001_schema.sql.
-- First create a separate role named js_app_runtime in Neon Roles;
-- keep its generated password out of SQL and Git. Do not grant owner membership.
-- Review any inherited roles/default privileges before enabling the app.
BEGIN;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM js_app_runtime;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM js_app_runtime;
GRANT USAGE ON SCHEMA public TO js_app_runtime;
GRANT SELECT ON app_users, user_access_matrix TO js_app_runtime;
GRANT SELECT, INSERT, DELETE ON app_sessions TO js_app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON login_attempts TO js_app_runtime;
GRANT SELECT ON products, work_orders, work_order_lines, stock_receipts,
    stock_units, dispatches, dispatch_units, work_order_pricing TO js_app_runtime;
-- No app_users writes, permission edits, operational writes or audit_log access.
-- Neon roles may inherit privileges; verify these results are false before deployment:
SELECT has_table_privilege('js_app_runtime','public.app_users','UPDATE') AS can_edit_users,
       has_table_privilege('js_app_runtime','public.user_access_matrix','INSERT') AS can_grant_access,
       has_table_privilege('js_app_runtime','public.stock_units','DELETE') AS can_delete_stock,
       has_schema_privilege('js_app_runtime','public','CREATE') AS can_create_objects;
COMMIT;
