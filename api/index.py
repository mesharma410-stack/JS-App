import os
import secrets
from flask import Flask, request, jsonify, send_file, render_template_string, g
from dotenv import load_dotenv
from backend.db import db
from backend.auth import login, authorize, digest
from backend.reports import build, LABELS, route_access
from psycopg import Error as DatabaseError
load_dotenv()
app=Flask(__name__)
app.config['MAX_CONTENT_LENGTH']=100_000
@app.before_request
def preview_guard():
    # Public URL alone must not enable database access.
    g.csp_nonce=secrets.token_urlsafe(24)
    if request.path.startswith('/api/') and request.path != '/api/index':
        if os.environ.get('ENABLE_TEST_PREVIEW') != 'true':
            return jsonify(error='Test preview disabled.'),503
        if os.environ.get('DATABASE_URL','').strip()=='':
            return jsonify(error='Test database not configured.'),503

@app.after_request
def headers(response):
    response.headers['Cache-Control']='no-store'
    response.headers['X-Content-Type-Options']='nosniff'
    response.headers['Referrer-Policy']='no-referrer'
    response.headers['X-Frame-Options']='DENY'
    nonce=g.get('csp_nonce','')
    response.headers['Content-Security-Policy']=f"default-src 'none'; script-src 'nonce-{nonce}'; style-src 'nonce-{nonce}'; connect-src 'self'; img-src 'self' data:; form-action 'self'; base-uri 'none'; frame-ancestors 'none'"
    response.headers['Permissions-Policy']='camera=(), microphone=(), geolocation=()'
    if request.is_secure or os.environ.get('VERCEL')=='1':
        response.headers['Strict-Transport-Security']='max-age=31536000'
    return response
@app.errorhandler(PermissionError)
def forbidden(e):return jsonify(error=str(e)),403
@app.errorhandler(ValueError)
def invalid(e):return jsonify(error=str(e)),400
@app.errorhandler(DatabaseError)
@app.errorhandler(KeyError)
def unavailable(e):
    # Log only exception type and SQLSTATE; never exception text, DSN or query parameters.
    app.logger.warning("Database request failed: type=%s sqlstate=%s endpoint=%s",
                       type(e).__name__, getattr(e,'sqlstate',None) or 'none',
                       request.endpoint or 'unknown')
    return jsonify(error='Database unavailable or schema not initialized. No successful transaction confirmed.'),503

def token():
    value=request.headers.get('Authorization','')
    return value[7:] if value.startswith('Bearer ') and 37<=len(value)<=135 else ''
@app.get('/api/health')
def health():
    # No unauthenticated DB connectivity or schema disclosure.
    return jsonify(ok=True,mode='migration-preview')
@app.post('/api/login')
def signin():
    data=request.get_json();
    if not isinstance(data,dict):raise ValueError('Invalid request')
    with db() as c:r=login(c,data.get('username',''),data.get('password',''))
    return (jsonify(r),200) if r else (jsonify(error='Incorrect credentials or too many attempts'),401)
@app.post('/api/logout')
def logout():
    with db() as c:
        authorize(c,token())
        c.execute('DELETE FROM app_sessions WHERE token_hash=%s',(digest(token()),))
    return jsonify(ok=True)
@app.get('/api/reports')
def catalog():
    with db() as c:
        _,g=authorize(c,token());result={}
        for key,label in LABELS.items():
            try:route_access(g,key);result[key]=label
            except PermissionError:pass
    return jsonify(result)
@app.post('/api/reports/<key>')
def report(key):
    with db() as c:
        _,g=authorize(c,token());file,name=build(c,key,request.get_json(),g)
    if file.getbuffer().nbytes>4_000_000:raise ValueError('Report exceeds safe download size. Narrow the filters.')
    return send_file(file,download_name=name,as_attachment=True,mimetype='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
@app.get('/')
@app.get('/api/index')
def home():
    return render_template_string('''<!doctype html><html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Janshakti | Migration preview</title><style nonce="{{ g.csp_nonce }}">body{font:16px system-ui;max-width:650px;margin:50px auto;padding:20px;color:#193449}input,select,button{font:inherit;padding:10px;margin:5px 0;max-width:100%;box-sizing:border-box}label{display:block}button{cursor:pointer}#msg{white-space:pre-wrap}</style><h1>Janshakti — report migration preview</h1><p>Read-only proof of concept. Not the original production UI. Do not use for stock or work-order operations.</p><form id="login"><label>Username <input name="username" required autocomplete="username"></label><label>Password <input name="password" type="password" required autocomplete="current-password"></label><button>Sign in</button></form><form id="report" hidden><label>Report <select name="key" required></select></label><label>Work Order <input name="workOrder"></label><label>Product / Model / Serial <input name="product"></label><label>Location <input name="location"></label><label>From <input name="from" type="date"></label><label>To <input name="to" type="date"></label><button>Download Excel</button><button type="button" id="logout">Sign out</button></form><p id="msg" role="status"></p><script nonce="{{ g.csp_nonce }}">let token='';const login=document.getElementById('login'),report=document.getElementById('report'),msg=document.getElementById('msg');async function call(url,opt={}){let r=await fetch(url,{...opt,headers:{'Content-Type':'application/json','Authorization':'Bearer '+token}});if(!r.ok){let e=await r.json().catch(()=>({}));throw Error(e.error||'Request failed');}return r}login.onsubmit=async e=>{e.preventDefault();try{let r=await call('/api/login',{method:'POST',body:JSON.stringify(Object.fromEntries(new FormData(login)))});token=(await r.json()).token;login.reset();let c=await (await call('/api/reports')).json();report.elements.key.replaceChildren(...Object.entries(c).map(([k,v])=>new Option(v,k)));login.hidden=true;report.hidden=false;msg.textContent='Signed in. Only permitted reports are displayed.'}catch(e){msg.textContent=e.message}};report.onsubmit=async e=>{e.preventDefault();let btn=report.querySelector('button');btn.disabled=true;try{let f=Object.fromEntries(new FormData(report)),key=f.key;delete f.key;msg.textContent='Preparing report...';let r=await call('/api/reports/'+encodeURIComponent(key),{method:'POST',body:JSON.stringify(f)}),url=URL.createObjectURL(await r.blob()),a=document.createElement('a');a.href=url;a.download=(r.headers.get('Content-Disposition')||'').match(/filename="?([^";]+)/)?.[1]||'Janshakti.xlsx';a.textContent='Click here if automatic download did not start';msg.replaceChildren(a);a.click();setTimeout(()=>URL.revokeObjectURL(url),300000)}catch(e){msg.textContent=e.message}finally{btn.disabled=false}};document.getElementById('logout').onclick=async()=>{try{await call('/api/logout',{method:'POST'})}finally{token='';report.hidden=true;login.hidden=false;msg.textContent='Signed out'}};</script></html>''')
