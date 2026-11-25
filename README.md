# JS-App — Python / Neon migration preview

**Not production-ready.** The supplied FINAL_10_C2_REPORT_DOWNLOAD_FIX archive contains five replacement files only. The original full Apps Script backend is required to port operational behavior without changing it. Exact supplied source is retained in `legacy/` for comparison; not served as the live UI. The preview implements nine read-only analytical Excel categories on a proposed normalized schema. It does not implement the operational write flows, original UI integration, full template import/export, Google Sheet migration, pricing/approval workflow, or load testing. Do not replace the existing app with it.

## Setup on a test branch
1. Rotate the previously shared Neon database password. Do not put connection strings in GitHub. Create a Neon development branch and execute `database/001_schema.sql` in SQL Editor on that branch. SQL creates tables only; no sample business rows.
2. Copy `.env.example` to `.env` locally, set `DATABASE_URL` to the test branch pooled connection string. `python -m venv .venv`, activate it, then `pip install -r requirements.txt`.
3. `python -m database.create_user`; use a unique password. In Neon SQL Editor assign the minimum user permissions using `database/grant_example.sql` as a template. Passwords are hashed; account disabling and access updates apply on the next request. Route permission names here are provisional until original access logic is ported.
4. `python -m unittest discover -s tests -v`; `flask --app api.index run`. Open http://127.0.0.1:5000. No business data is automatically imported; a report can legitimately have zero rows.
5. Vercel: import private GitHub repository, choose Flask framework (or Other if auto-detected), root directory repository root, add DATABASE_URL in Environment Variables for Preview only, deploy. Keep compute close to Neon Ohio (`cle1` if available). Use an authorized plan for business usage (Hobby is personal/non-commercial). Do not promote to production. Test `/api/health`, login, report permissions and Excel downloads.

## Architecture and caveats
Same-origin Flask API, short Psycopg connections to Neon pooled endpoint, PostgreSQL permission and session tables, direct binary XLSX response (no Google Drive, base64, or temp file). Larger than 4 MB is rejected with a filter prompt; large-report object storage is not implemented. No persistent background worker. Database row locks, transaction-level idempotency and revision checks must be implemented for operational writes before release. `legacy/Index.html` is unchanged, not a functional standalone UI; `api/index.py` serves an explicitly separate preview page. The proposed schema is not an authoritative mapping of the missing source.

## Required migration inputs
Full deployed C2 source (all `.gs`, HTML and manifest files, including setup, inventory ledger, stock, work order, pricing, revision, packing/approval, audit and permission modules), sanitized backend workbook header/sample data, and report acceptance cases. Do not share passwords or live customer records unnecessarily. No existing production DB schema has been altered by this package.
