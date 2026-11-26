# Public-source / private-data policy
This is a read-only migration preview, not an approved production application.
Public source code is acceptable only with company authorization. Real records are not.

## Before changing GitHub visibility
- Rotate any previously shared Neon database password in Neon Roles.
- Review all branches, tags, prior commits, releases, Actions logs/artifacts, issues and attachments. Deleting a file in a later commit does not erase its history.
- Run the tracked-file guard: `python scripts/check_public_source.py`. Enable the local hook with `git config core.hooksPath .githooks` (Git Bash or Linux/macOS).
- Never commit credentials, customer/vendor lists, invoices, employee information, reports, database dumps, real product/stock/price records, or screenshots of real data. Use synthetic fixtures only.
- Enable GitHub and Neon MFA; enable GitHub secret scanning and push protection where available. Review collaborators.

## Neon
Use a separate test project or isolated branch from an EMPTY database. Do not clone a branch with real records into public testing.
Execute 001_schema.sql as the owner. Create a new role js_app_runtime with a generated password; execute 002_runtime_permissions.sql as the owner and verify effective permissions, including inherited privileges and public grants.
Use the pooled runtime URL with SSL required. Keep owner/admin URL only on a trusted local machine as ADMIN_DATABASE_URL. Use database/create_user.py locally and manage permissions via the SQL editor.
An authorized test database owner can reset an existing application account using database/003_reset_app_password.sql after the bcrypt-compatible release is deployed. Use a unique private password of 12–72 UTF-8 bytes and never save filled-in SQL in Git. SQL Editor can retain query history; restrict access. Password resets clear failures and sessions without changing grants. Do not give the runtime role user administration permissions.
Never give the runtime role ownership, schema creation, or access to unrelated schemas or databases. Do not grant new permissions without reviewing the API.

## Vercel
A private personal GitHub repo can deploy; public is not mandatory. Hobby is personal/non-commercial only.
Create DATABASE_URL as a server-side Secret, never NEXT_PUBLIC_ or VITE_ variables.
Set ENABLE_TEST_PREVIEW=true only for an isolated dummy-data database. API requests are disabled by default. Never connect this preview to live business data.
Never put credentials in build commands, screenshots, logs or vercel.json. Redeploy after rotation.
The runtime has no user-management or business-write endpoints; reports check permissions server-side and are served without caching.
The guard and ignore rules are defense-in-depth, not a guarantee against intentional commits, unknown credential formats or sensitive data embedded in source.

## Production blockers
Full original source migration, correct operational permissions and row-level data scope, rate limiting against public abuse, live database least-privilege verification, independent security review, backup/restore and concurrent testing are still required. Public login can attract automated traffic and exhaust free quotas; do not use real data until approved.
