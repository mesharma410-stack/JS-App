import hashlib, secrets
import bcrypt
from base64 import urlsafe_b64encode, urlsafe_b64decode

def generate_password_hash(password):
    salt=secrets.token_bytes(16)
    key=hashlib.scrypt(password.encode(),salt=salt,n=2**15,r=8,p=1,maxmem=64*1024*1024)
    return 'scrypt$'+urlsafe_b64encode(salt).decode()+'$'+urlsafe_b64encode(key).decode()

def check_password_hash(stored,password):
    if not isinstance(stored,str) or not isinstance(password,str):
        return False
    try:
        if stored.startswith(('$2a$', '$2b$', '$2y$')):
            raw=password.encode('utf-8')
            if len(stored)!=60 or len(raw)>72 or b'\x00' in raw:
                return False
            cost=int(stored[4:6])
            if not 4<=cost<=14:
                return False
            return bcrypt.checkpw(raw,stored.encode('ascii'))
        scheme,salt,key=stored.split('$')
        if scheme!='scrypt': return False
        expected=urlsafe_b64decode(key)
        actual=hashlib.scrypt(password.encode(),salt=urlsafe_b64decode(salt),n=2**15,r=8,p=1,maxmem=64*1024*1024)
        return secrets.compare_digest(actual,expected)
    except (ValueError,TypeError):return False

DUMMY = generate_password_hash(secrets.token_hex(32))

def digest(s): return hashlib.sha256(s.encode()).hexdigest()

def login(cur, username, password):
    name = str(username).strip().lower()
    if not name or len(name)>80 or not isinstance(password,str) or not password or len(password)>256:
        return None
    cur.execute("""INSERT INTO login_attempts(username,failures,window_until) VALUES(%s,0,now()+interval '15 minutes')
    ON CONFLICT(username) DO UPDATE SET failures=CASE WHEN login_attempts.window_until<=now() THEN 0 ELSE login_attempts.failures END,
    window_until=CASE WHEN login_attempts.window_until<=now() THEN now()+interval '15 minutes' ELSE login_attempts.window_until END RETURNING failures""",(name,))
    if cur.fetchone()['failures']>=7: return None
    cur.execute('SELECT * FROM app_users WHERE username=%s',(name,)); u=cur.fetchone()
    valid=check_password_hash(u['password_hash'] if u else DUMMY,password)
    if not u or not u['active'] or not valid:
        cur.execute('UPDATE login_attempts SET failures=failures+1 WHERE username=%s',(name,)); return None
    cur.execute('DELETE FROM login_attempts WHERE username=%s',(name,))
    cur.execute('DELETE FROM app_sessions WHERE expires_at<=now()')
    token=secrets.token_urlsafe(36)
    cur.execute("INSERT INTO app_sessions VALUES(%s,%s,%s,now()+interval '6 hours')",(digest(token),name,digest(u['password_hash'])))
    return {'ok':True,'token':token,'username':name,'expiresInSeconds':21600}

def authorize(cur,token):
    if not isinstance(token,str) or not 30<=len(token)<=128: raise PermissionError('AUTH_REQUIRED: Please log in.')
    cur.execute('''SELECT u.username,u.password_hash,s.password_version FROM app_sessions s JOIN app_users u USING(username)
    WHERE s.token_hash=%s AND s.expires_at>now() AND u.active''',(digest(token),)); u=cur.fetchone()
    if not u or not secrets.compare_digest(digest(u['password_hash']),u['password_version']): raise PermissionError('AUTH_REQUIRED: Please log in.')
    cur.execute('SELECT permission,access_level FROM user_access_matrix WHERE username=%s',(u['username'],))
    return u['username'], {r['permission']:r['access_level'] for r in cur.fetchall()}

def can(grants,key): return grants.get(key) in ('View','Edit')
