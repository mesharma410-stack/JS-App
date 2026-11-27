# Final 10C2 parity baseline — GS Gallery reference

Source-of-truth: supplied complete FINAL_10_C2_HOLD_REPORTS_FIXED archive (23 GS modules, Index.html, workbook with 22 tabs), later report-fix overlay where compatible, and GS Gallery screenshots. The earlier master documentation explicitly had incomplete evidence; the supplied actual C2 code supersedes historical guesses. Screenshots, workbook, embedded private catalog and credentials are NOT copied into the public repo.

## This milestone
- Original C2 palette (#213967 ink, #e98b31 orange, #f4f6fa background), branded login and navy navigation adapted to the existing CSP-safe workspace, not full pixel parity.
- Work Orders: direct original XLSX parser (header A:G, optional Phase, Remarks, Description, header metadata, blank Bought Out defaults N, stop at TOTAL, 130 rows). New draft only; duplicate WO number blocked; parser is bounded to 4 MB to fit serverless request limits.
- Model-first Bought Out matching port: stable ID, NFKC normalized unique model, exact name+vendor, conservative fuzzy thresholds (name .86, model .78 or prefix; exact-name conflict .5). Ambiguity blocks. Custom Fabrication is NOT a shared Bought Out SKU.
- Original source cell/index and red blocking/yellow correction display, editable draft, revalidation. No automatic save. No changes to the database schema in this commit.

## Database alignment and remaining gates
| Source | PostgreSQL | Current gap |
|---|---|---|
| Products | products | shared Bought Out identity; complete catalog import & safe Excel update pending |
| FabricationCatalog | fabrication_catalog | normalized reusable design; catalog writes pending |
| FabricationProducts | fabrication_products | separate per-WO-line fabrication identity; operational FK migration pending |
| WorkOrders / WorkOrderLines | work_orders / work_order_lines | saved line read only; schema currently has purchased product FK and positive-only planned qty, C2 permits zero planned qty; must resolve before write |
| WorkOrderVersions | work_order_versions | immutable snapshots, base-version conflict, 24h V2+ withdrawal; not yet ported |
| WorkOrderStageDefinitions / Tracker | work_order_stage_definitions / work_order_tracker | tracker reads, transition and packing gate pending |
| StockIn / FabricationStockIn | stock_receipts + stock_units | free Bought Out receipt only; fabrication FK, allocation, edit/archive/reversal pending |
| StockOut | dispatches + dispatch_units | read only; partial/complete dispatch and audited reversal pending |
| WOStatusRequests | wo_status_requests | no Active column; Admin approve/release with reason, held/cancelled locks every route; pending |
| WorkOrderPricing | work_order_pricing | basic reports only; missing prices and route-safe management calculations pending |
| SalesExecutiveTargets | sales_executive_targets | month/quarter and complete-order profitability pending |
| WOEmailHistory | wo_email_history | immutable mail outcomes, PDF from saved revision pending |
| Credential / UserAccessMatrix / UserProfiles | app_users / user_access_matrix / user_profiles | account admin code in 007, actual live test pending |
| Settings / SalesPersons / AuditLog / 00_System_Map | app_settings / sales_persons / audit_log / database metadata | config, roster, audit parity and data reconciliation pending |

Do not force fabrication IDs into Products merely to satisfy the receipt FK. Add a route-specific relational FK and check before enabling fabrication receipt writes. Preserve stable line IDs, explicit allocation, quantity/serial invariants and revision locks. Full source validation (including locked existing rows, saved IDs, required quote reference, exact source workbook conventions, versioning and all operational imports) still needs the write-phase port. The draft validator is not the final save validator. No real company data or screenshots in repository. Use synthetic test branch only. No production handover until full workflow, authorization, transaction, import, export and load tests pass.


## Follow-on V1 foundation
008 adds distinct fabrication identity, a transactional new-order V1 save and route-scoped snapshot view. This is not full revision or inventory workflow parity; see WORK_ORDER_V1_TEST_GUIDE.md. Live execution is pending.
