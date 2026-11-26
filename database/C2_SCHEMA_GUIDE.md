# Final 10C2 schema expansion (foundation only)

Source: full C2 workbook header reference and APP.sheets in 00_Setup.gs, with the latest five-file overlay, and the documented Hold/Cancel, revision, stock, report and executive-target rules. No private workbook, row data, credentials or embedded product catalog is included.

## Run on the existing test branch
1. Confirm Neon project, exact child branch, owner role and database; check branch expiry and make a recovery branch/backup if appropriate. Never run on production or a branch with real data. Confirm the existing preview still logs in and downloads reports.
2. Run database/004_c2_schema_expansion.sql as owner, **once**, after 001 and 002. One transaction; no existing tables dropped, no existing rows updated, no operational write grants. Unexpected schema conflicts abort the transaction. If an error occurs, inspect the first error and rollback before retrying; do not blindly rerun.
3. Run database/005_verify_c2_schema.sql separately. Expect 24/24 expected tables, no missing tables, the four effective privilege checks false, 11 new tables unreadable/unwritable by runtime, and existing report dependencies readable.
4. Test the existing website login and Aging Analysis download again. GitHub/Vercel deployments do not automatically execute SQL migrations. No environment changes for this step.

## Workbook mapping
| Source tab | PostgreSQL |
|---|---|
| 00_System_Map | This documentation and database metadata; derived, not transactional |
| Products | products |
| SalesPersons | sales_persons |
| WorkOrders | work_orders |
| WorkOrderLines | work_order_lines |
| WorkOrderVersions | work_order_versions |
| WorkOrderStageDefinitions | work_order_stage_definitions |
| WorkOrderTracker | work_order_tracker |
| StockIn, FabricationStockIn | stock_receipts + stock_units (serials normalized) |
| StockOut | dispatches + dispatch_units |
| FabricationCatalog | fabrication_catalog |
| FabricationProducts | fabrication_products |
| WorkOrderPricing | work_order_pricing |
| Credential | app_users (hashes only; never import plaintext passwords) |
| UserAccessMatrix | user_access_matrix; Team/Office on app_users |
| UserProfiles | user_profiles |
| Settings | app_settings |
| AuditLog | audit_log |
| WOStatusRequests | wo_status_requests |
| WOEmailHistory | wo_email_history |
| SalesExecutiveTargets | sales_executive_targets |

## Deliberate design decisions / remaining work
- Existing table names, primary keys, route values and read-only report queries remain compatible. Source WorkOrderNumber is resolved through stable work_order_id; source SerialNumbers and quantities must be reconciled during import. Fabrication receipt product mapping must be validated against the existing required products FK. Current version defaults NULL for existing preview data; source zero/blank maps to NULL only after validation.
- One current pricing record per line matches the preview. Archived/revised pricing rows and legacy ID collision rules need a separate history/import design; price flags and active status must be reflected in report queries before importing records. Unknown amounts are not defaulted to zero.
- New tables are denied to runtime; existing table-level SELECT grants also cover newly added columns on those tables. Revisit column-level grants, service roles and financial redaction before any real data import or operational enablement. No automatic Team=Admin or page grants are assigned.
- Stage definitions, roster, configuration and other records are intentionally not seeded. Source stages and exact allowed transitions, active catalog deduplication, stable IDs, period date boundaries, receipt cost/quantity equality, row-version increments, revision snapshot immutability, approval transitions, Packing/Dispatch gating and audited release/reversal must be implemented and tested in transactional services. Constraints here are a subset, not a complete business-rule implementation.
- No original UI integration, new APIs, email delivery, report parity, full data import or concurrent testing is delivered by this migration. No live PostgreSQL execution has been performed by the author. Use a synthetic-data child branch until end-to-end acceptance and security review.
