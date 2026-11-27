"""C2 approval API boundary; the database owns the atomic state transition."""
from datetime import datetime
from .auth import can, digest

def _access(grants):
    if not can(grants,'Work Orders'):
        raise PermissionError('ACCESS_DENIED: Work Orders required')

def _text(data,key,maximum):
    v=data.get(key,'')
    if not isinstance(v,str) or len(v)>maximum or '\x00' in v:
        raise ValueError('Invalid '+key)
    return v.strip()

def status_write(cur,token,grants,data):
    _access(grants)
    if not isinstance(data,dict): raise ValueError('Invalid request')
    action=_text(data,'action',12)
    number=_text(data,'number',110)
    request_id=_text(data,'id',100)
    kind=_text(data,'type',10)
    reason=_text(data,'reason',1000)
    if action not in ('request','approve','reject','release'): raise ValueError('Invalid action')
    if action in ('request','release') and not number: raise ValueError('Enter Work Order number')
    if action in ('approve','reject') and not request_id: raise ValueError('Request ID required')
    if action=='request' and (kind not in ('Hold','Cancel') or len(reason)<5): raise ValueError('Choose Hold or Cancel and enter at least 5 characters')
    if action!='request':
        if grants.get('Superadmin')!='Edit': raise PermissionError('ACCESS_DENIED: Administrator required')
        if len(reason)>600 or (action=='release' and len(reason)<5): raise ValueError('Invalid review or release reason')
    cur.execute("SELECT public.c2_status_write(%s,%s,%s,%s,%s,%s) AS result",
                (digest(token),action,number,request_id,kind,reason))
    return cur.fetchone()['result']

def status_read(cur,token,grants,query):
    _access(grants)
    kind=_text(query,'kind',12) or 'requests'
    ident=_text(query,'id',100)
    before=_text(query,'before',48)
    if kind not in ('requests','locked'): raise ValueError('Invalid status view')
    if kind=='requests' and bool(before)!=bool(ident): raise ValueError('Invalid page cursor')
    if kind=='locked' and before: raise ValueError('Invalid page cursor')
    when=None
    if before:
        when=datetime.fromisoformat(before)
        if when.tzinfo is None: raise ValueError('Invalid page cursor timezone')
    cur.execute("SELECT public.c2_status_read(%s,%s,%s,%s) AS result",(digest(token),kind,when,ident))
    result=cur.fetchone()['result']
    rows=result['rows']
    next_page=None
    if len(rows)>50:
        last=rows[49]
        next_page={'id':last['id']}
        if kind=='requests': next_page['before']=last['Requested at']
    return {'admin':result['admin'],'rows':rows[:50],'next':next_page}
