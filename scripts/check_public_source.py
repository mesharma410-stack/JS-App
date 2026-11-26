"""Fail closed for unapproved paths and common secrets in Git's index.
Run after staging. This intentionally does not inspect untracked private files.
No matching secret values are printed.
"""
import re
import subprocess
import sys

ALLOWED = {
    '.env.example', '.gitignore', '.vercelignore', 'README.md', 'SECURITY.md',
    'app.py', 'requirements.txt', 'vercel.json', 'api/index.py',
    'backend/__init__.py', 'backend/auth.py', 'backend/db.py', 'backend/reports.py',
    'database/001_schema.sql', 'database/002_runtime_permissions.sql',
    'database/create_user.py', 'database/grant_example.sql',
    'database/003_reset_app_password.sql',
    'database/004_c2_schema_expansion.sql', 'database/005_verify_c2_schema.sql',
    'database/C2_SCHEMA_GUIDE.md', 'database/006_seed_demo_inventory.sql',
    'backend/c2_read.py', 'tests/test_c2_read.py',
    'backend/workspace.py', 'backend/workspace_ui.py', 'tests/test_workspace.py',
    'database/007_workspace_permissions_and_writes.sql', 'database/WORKSPACE_TEST_GUIDE.md',
    'legacy/Index.html', 'legacy/02_AuthenticationAndAPI.gs',
    'legacy/03_TrackerAndAccess.gs', 'legacy/08_ExcelReports.gs', 'legacy/13_ReportCatalog.gs',
    'tests/test_reports.py', 'tests/test_security.py',
    'scripts/check_public_source.py', '.githooks/pre-commit',
}
# Split literal prefixes so the guard itself is not mistaken for a credential.
PATTERNS = [
    re.compile(b'n' + b'pg_[A-Za-z0-9]{8,}'),
    re.compile(b'gh' + b'p_[A-Za-z0-9]{20,}'),
    re.compile(b'github_' + b'pat_[A-Za-z0-9_]{20,}'),
    re.compile(b'AK' + b'IA[A-Z0-9]{16}'),
    re.compile(b'AI' + b'za[0-9A-Za-z_-]{35}'),
    re.compile(b'-----BEGIN [A-Z ]*' + b'PRIVATE KEY-----'),
    re.compile(rb'postgres(?:ql)?://[^:\s/]+:(?!REPLACE_ME@)[^@\s/]+@', re.I),
    re.compile(rb'https?://[^\s/]*\.neon\.tech', re.I),
]

def git(*args):
    return subprocess.check_output(['git', *args])

def main():
    paths = git('ls-files', '-z').decode('utf-8').split('\0')
    failures = []
    for path in filter(None, paths):
        if path not in ALLOWED:
            failures.append(f'{path}: unapproved tracked path')
            continue
        content = git('show', ':' + path)
        if any(p.search(content) for p in PATTERNS):
            failures.append(f'{path}: possible secret')
    if failures:
        print('\n'.join(failures), file=sys.stderr)
        return 1
    print('Tracked-path and common-secret checks passed. Manual data review is still required.')
    return 0

if __name__ == '__main__':
    raise SystemExit(main())
