"""Run locally from repository root: python -m database.create_user"""
from getpass import getpass
from dotenv import load_dotenv
from backend.auth import generate_password_hash
from backend.db import db
load_dotenv()
name=input('Username: ').strip().lower();p=getpass('New password: ')
if not name or len(name)>80 or len(p)<12:raise SystemExit('Username required; password must have at least 12 characters')
with db() as c:
    c.execute('INSERT INTO app_users(username,password_hash) VALUES(%s,%s) ON CONFLICT(username) DO UPDATE SET password_hash=excluded.password_hash',(name,generate_password_hash(p)))
    c.execute('DELETE FROM app_sessions WHERE username=%s',(name,))
print('User saved. Assign exact permissions in user_access_matrix; no permissions are automatic.')
