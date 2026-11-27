# 009 — status workflow and performance increment (test only)

Based on C2 21_Final10C2Workflow.gs and the remaining-development checklist sections 4.4, 5, 6. Run only after 007/008 have been verified on the synthetic child branch. No direct runtime business-table write grants.

Coded: request with Work Orders View and at least one visible active route, reason length 5–1000, unique pending request, requester-private history, Admin approve/reject, explicit release reason, audit, row-version increment. Approval/release serialized on the Work Order row. Product update/archive also locks related active WOs, closing its race with approval. Status history keyset pages 50 rows. Read-only stock/Excel queries use LEFT JOIN and receipt descriptions when available; future fabrication receipt writes remain disabled. Product movement uses the WO line ID for fabrication grouping until full identity reconciliation. Excel uses write-only worksheets and releases the database connection before serialization. Existing report caps remain. Added five targeted indexes, not an assertion of measured speed.

Intentional deviations: explicit Superadmin + exact Admin team + both routes View/Edit for global decisions (stricter than source); requests require at least one accessible line; request IDs are UUID-based; UI uses simple prompts, not exact GS popup. Status panels refresh without discarding the unsaved WO draft; refresh history separately. Global guards for not-yet-implemented revision, allocated stock, tracker, dispatch, pricing, bulk import and mail are still required. The new helper is not automatically a guard on future services. No exact visual parity or production approval.

Acceptance (unchecked until live):
- [ ] Confirm 007/008 functions and V1 mixed-route save before running 009.
- [ ] Run 009 once; confirm c2_status_write and c2_status_read exist.
- [ ] Submit Hold for a synthetic open WO; status remains Open until approval.
- [ ] Operator sees own request, cannot see another operator's requests, approve/reject/release or bypass API.
- [ ] Duplicate pending rejected. Approve Hold, linked Product Master update rejected. Release with reason, verify audit and row version. Reject a Cancel request; status unchanged. Approve Cancel, reopen with reason.
- [ ] Simultaneous approval and product edit cannot commit a change after lock; check lock timeout handling and retry.
- [ ] Retest all analytical Excel categories, same-day filters, leading zeros and formula-safe text, fabricated receipt read paths when real fixture exists. Compare all totals to ledger.
- [ ] Measure 20 users' latency, connections, database CU-hours, storage and Vercel usage on permitted test workloads.

Free-tier engineering: no always-on polling or keepalive. Page sizes bounded. Pooled DATABASE_URL, short transactions, on-demand reads. Measure query plans and table/index sizes; do not add speculative indexes or silently prune operational history. Vercel Hobby is noncommercial only; production hosting approval is mandatory. Neon Free limits are subject to account and plan changes; check dashboard. The code and SQL have not been executed against a live PostgreSQL server by the author.
