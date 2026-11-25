"""Run locally from repository root: python -m database.create_user"""
import os
from getpass import getpass
from dotenv import load_dotenv
from backend.auth import generate_password_hash
from backend.db import db
load_dotenv()
# Never use the restricted application credential to administer accounts.
admin_url=os.environ.get('ADMIN_DATABASE_URL')
if not admin_url:
    raise SystemExit('Set ADMIN_DATABASE_URL locally to the authorized test database admin connection.')
os.environ['DATABASE_URL']=admin_url
name=input('Username: ').strip().lower();p=getpass('New password: ')
if not name or len(name)>80 or not 12<=len(p)<=256:raise SystemExit('Username required; password must have 12–256 characters')
with db() as c:
    c.execute('INSERT INTO app_users(username,password_hash) VALUES(%s,%s) ON CONFLICT(username) DO UPDATE SET password_hash=excluded.password_hash',(name,generate_password_hash(p)))
    c.execute('DELETE FROM app_sessions WHERE username=%s',(name,))
print('User saved. Assign exact permissions in user_access_matrix; no permissions are automatic.')
