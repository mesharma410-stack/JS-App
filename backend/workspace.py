"""C2 workspace: explicit, permission-scoped operations and read pages."""
import re
from uuid import uuid4
from datetime import date
from decimal import Decimal, InvalidOperation
from .auth import can, digest, generate_password_hash
from .c2_read import allowed_routes

PERMISSIONS=["Dashboard","Product Master","Delete Products","Work Orders","Work Order Tracker","Stock In","Stock Out","Stock Book","Route: Bought Out","Route: Fabrication","Report","Report: Inventory Serial Detail","Report: Aging Analysis","Report: Warehouse Stock","Report: Free Stock","Report: Work Order Inventory","Report: Dispatch History","Report: Product Movement","Report: Purchase Analysis","Report: Margin Analysis","Pricing","Management Pricing Dashboard","Stock Purchase Cost"]
READ_PAGES=('Work Orders','Work Order Tracker','Stock In','Stock Out','Stock Book')

def admin_allowed(cur,username,grants):
    if grants.get('Superadmin')!='Edit':
        return False
    cur.execute("SELECT team FROM app_users WHERE username=%s",(username,))
    row=cur.fetchone()
    return bool(row and row['team']=='Admin')

def require_admin(cur,username,grants):
    if not admin_allowed(cur,username,grants):
        raise PermissionError('ACCESS_DENIED: Superadmin required')

def capabilities(cur,username,grants):
    routes=[r for r in ('Bought Out','Fabrication') if can(grants,'Route: '+r)]
    cur.execute("SELECT to_regprocedure('public.c2_save_new_wo(text,jsonb)') IS NOT NULL AS ready, to_regprocedure('public.c2_status_write(text,text,text,text,text,text)') IS NOT NULL AS status_ready")
    readiness=cur.fetchone()
    wo_ready=readiness['ready']
    return {'username':username,'grants':grants,'admin':admin_allowed(cur,username,grants),'woSave':wo_ready,'statusReady':readiness['status_ready'],
            'routes':routes,'permissions':PERMISSIONS}

def text(data,key,limit=100,required=False):
    v=data.get(key,'')
    if not isinstance(v,str) or len(v)>limit or '\x00' in v:
        raise ValueError('Invalid '+key)
    v=v.strip()
    if required and not v: raise ValueError(key+' is required')
    return v

def body(data):
    if not isinstance(data,dict): raise ValueError('Invalid request')
    return data

def result(cur):
    return {'ok':True,'id':cur.fetchone()['id']}

def product_write(cur,token,grants,data):
    data=body(data)
    action=text(data,'action',12,True)
    if grants.get('Product Master')!='Edit' or grants.get('Route: Bought Out')!='Edit':
        raise PermissionError('ACCESS_DENIED: Product Master and Bought Out Edit required')
    if action not in ('create','update','archive'): raise ValueError('Invalid product operation')
    if action=='archive' and grants.get('Delete Products')!='Edit':
        raise PermissionError('ACCESS_DENIED: Delete Products Edit required')
    ident=text(data,'id',100,action!='create')
    version=data.get('version',0)
    if type(version) is not int or version<0 or version>2**53-1:
        raise ValueError('Invalid row version')
    name=text(data,'name',200,action!='archive')
    kind=text(data,'type',20,action!='archive')
    brand=text(data,'brand',100,action!='archive')
    model=text(data,'model',100,action!='archive')
    size=text(data,'size',200)
    cur.execute("SELECT public.c2_product_write(%s,%s,%s,%s,%s,%s,%s,%s,%s) AS id",
                (digest(token),action,ident,version,name,kind,brand,model,size))
    return result(cur)

def receive_free(cur,token,grants,data):
    data=body(data)
    if grants.get('Stock In')!='Edit' or grants.get('Route: Bought Out')!='Edit':
        raise PermissionError('ACCESS_DENIED: Stock In and Bought Out Edit required')
    serials=data.get('serials')
    if not isinstance(serials,list) or not 1<=len(serials)<=100 or any(not isinstance(s,str) or not 1<=len(s.strip())<=100 or '\x00' in s for s in serials):
        raise ValueError('Enter 1 to 100 serial numbers')
    serials=[s.strip() for s in serials]
    if len({s.lower() for s in serials})!=len(serials): raise ValueError('Duplicate serials')
    qty=data.get('qty')
    if type(qty) is not int or qty!=len(serials): raise ValueError('Quantity must equal serial count')
    try:
        day=date.fromisoformat(text(data,'date',10,True))
        cost=Decimal(text(data,'cost',30,True))
        if not cost.is_finite() or not 0<=cost<=10000000000 or cost!=cost.quantize(Decimal('.01')):
            raise ValueError('Invalid unit cost')
    except (InvalidOperation,ValueError): raise ValueError('Enter a valid date and nonnegative cost (up to 2 decimals)')
    ident='SIN-'+uuid4().hex
    cur.execute("SELECT public.c2_receive_free(%s,%s,%s,%s,%s,%s,%s,%s,%s) AS id",
       (digest(token),ident,text(data,'product',100,True),text(data,'location',100,True),
        day,serials,cost,text(data,'vendor',140),text(data,'remarks',600)))
    return result(cur)

def admin_list(cur,username,grants,after=''):
    require_admin(cur,username,grants)
    if len(after)>80: raise ValueError('Invalid cursor')
    cur.execute("""SELECT username,active,team FROM app_users WHERE username>%s ORDER BY username LIMIT 51""",(after,))
    rows=cur.fetchall()
    names=[r['username'] for r in rows[:50]]
    cur.execute("SELECT username,permission,access_level FROM user_access_matrix WHERE username=ANY(%s)",(names,))
    matrix={}
    for row in cur.fetchall(): matrix.setdefault(row['username'],{})[row['permission']]=row['access_level']
    return {'users':[dict(r,grants=matrix.get(r['username'],{})) for r in rows[:50]],
            'next':rows[49]['username'] if len(rows)>50 else None}

def admin_write(cur,token,username,grants,data):
    require_admin(cur,username,grants)
    data=body(data)
    action=text(data,'action',12,True)
    target=text(data,'username',80,True).lower()
    if not re.fullmatch(r'[a-z0-9][a-z0-9._-]{1,79}',target): raise ValueError('Invalid username')
    password_hash=None
    if action in ('create','reset'):
        password=data.get('password')
        if not isinstance(password,str) or not 12<=len(password.encode('utf-8'))<=72 or '\x00' in password:
            raise ValueError('Password must contain 12 to 72 UTF-8 bytes')
        password_hash=generate_password_hash(password)
    permission=text(data,'permission',100)
    level=text(data,'level',10)
    active=data.get('active')
    if action=='grant' and (permission not in PERMISSIONS or level not in ('None','View','Edit')):
        raise ValueError('Invalid permission')
    if action=='active' and type(active) is not bool: raise ValueError('Invalid account status')
    if action not in ('create','reset','grant','active'): raise ValueError('Invalid account operation')
    cur.execute("SELECT public.c2_admin_write(%s,%s,%s,%s,%s,%s,%s) AS id",
                (digest(token),action,target,password_hash,permission,level,active))
    return result(cur)

QUERIES={
 'Work Orders':("""SELECT l.line_id AS id,w.work_order_number AS "Work Order",w.status AS "Status",
      w.creation_date AS "Created",w.promise_date AS "Promise",l.entry_type AS "Route",l.equipment_name AS "Equipment",l.planned_qty AS "Qty"
      FROM work_order_lines l JOIN work_orders w ON w.work_order_id=l.work_order_id
      WHERE l.active AND w.active AND l.entry_type=ANY(%s) AND l.line_id>%s""","l.line_id","concat_ws(' ',w.work_order_number,l.equipment_name,l.model)",'w.creation_date'),
 'Work Order Tracker':("""SELECT l.line_id AS id,w.work_order_number AS "Work Order",w.status AS "WO Status",
      l.entry_type AS "Route",l.equipment_name AS "Equipment",l.planned_qty AS "Qty",coalesce(t.stage,'Not recorded') AS "Stage",
      t.updated_at AS "Updated"
      FROM work_order_lines l JOIN work_orders w ON w.work_order_id=l.work_order_id
      LEFT JOIN LATERAL (SELECT stage,updated_at FROM work_order_tracker t WHERE t.work_order_line_id=l.line_id
      AND t.entry_type=l.entry_type AND t.active ORDER BY updated_at DESC,stage_id DESC LIMIT 1) t ON true
      WHERE l.active AND w.active AND l.entry_type=ANY(%s) AND l.line_id>%s""","l.line_id","concat_ws(' ',w.work_order_number,l.equipment_name,l.model,t.stage)",'w.creation_date'),
 'Stock In':("""SELECT r.stock_in_id AS id,r.purchase_date AS "Date",r.entry_type AS "Route",
      coalesce(r.equipment_name,p.equipment_name,'') AS "Equipment",coalesce(r.model,p.model,'') AS "Model",r.receipt_location AS "Location",
      w.work_order_number AS "Work Order",r.declared_qty AS "Received Qty"
      FROM stock_receipts r LEFT JOIN products p ON p.product_id=r.product_id
      LEFT JOIN work_orders w ON w.work_order_id=r.work_order_id
      WHERE r.active AND r.entry_type=ANY(%s) AND r.stock_in_id>%s""","r.stock_in_id","concat_ws(' ',r.stock_in_id,coalesce(r.equipment_name,p.equipment_name,''),coalesce(r.model,p.model,''),w.work_order_number,r.receipt_location)",'r.purchase_date'),
 'Stock Out':("""SELECT u.unit_id AS id,d.stock_out_id AS "Dispatch ID",d.dispatch_date AS "Date",d.location AS "Location",
      w.work_order_number AS "Work Order",coalesce(r.equipment_name,p.equipment_name,'') AS "Equipment",u.serial AS "Serial",r.entry_type AS "Route"
      FROM dispatch_units du JOIN dispatches d ON d.stock_out_id=du.stock_out_id
      JOIN stock_units u ON u.unit_id=du.unit_id JOIN stock_receipts r ON r.stock_in_id=u.stock_in_id
      LEFT JOIN products p ON p.product_id=r.product_id LEFT JOIN work_orders w ON w.work_order_id=d.work_order_id
      WHERE d.active AND du.active AND u.active AND r.active AND r.entry_type=ANY(%s) AND u.unit_id>%s""","u.unit_id","concat_ws(' ',d.stock_out_id,w.work_order_number,coalesce(r.equipment_name,p.equipment_name,''),u.serial,d.location)",'d.dispatch_date'),
 'Stock Book':("""SELECT u.unit_id AS id,u.serial AS "Serial",u.location AS "Location",coalesce(r.equipment_name,p.equipment_name,'') AS "Equipment",
      coalesce(r.model,p.model,'') AS "Model",r.entry_type AS "Route",w.work_order_number AS "Work Order",
      CASE WHEN u.work_order_id IS NULL THEN 'Free' ELSE 'Engaged' END AS "Allocation",r.purchase_date AS "Received"
      FROM stock_units u JOIN stock_receipts r ON r.stock_in_id=u.stock_in_id
      LEFT JOIN products p ON p.product_id=r.product_id LEFT JOIN work_orders w ON w.work_order_id=u.work_order_id
      WHERE u.active AND r.active AND r.entry_type=ANY(%s) AND u.unit_id>%s
      AND NOT EXISTS (SELECT 1 FROM dispatch_units du JOIN dispatches d ON d.stock_out_id=du.stock_out_id
      WHERE du.unit_id=u.unit_id AND du.active AND d.active)""","u.unit_id","concat_ws(' ',u.serial,coalesce(r.equipment_name,p.equipment_name,''),coalesce(r.model,p.model,''),w.work_order_number,u.location)",'r.purchase_date')
}

def read_page(cur,grants,page,query):
    if page not in QUERIES: raise ValueError('Unknown workspace page')
    routes=allowed_routes(grants,page)
    sql,order,search,day=QUERIES[page]
    q=query.get('q',''); after=query.get('after','')
    if len(q)>100 or len(after)>150: raise ValueError('Search or cursor too long')
    args=[routes,after,q.strip()]
    sql+=" AND strpos(lower("+search+"),lower(%s))>0"
    start=query.get('from',''); end=query.get('to','')
    if start and end and start>end: raise ValueError('From date cannot be after To date')
    for value,op in ((start,'>='),(end,'<=')):
        if value:
            args.append(date.fromisoformat(value))
            sql+=' AND '+day+' '+op+' %s'
    cur.execute(sql+' ORDER BY '+order+' LIMIT 51',args)
    rows=cur.fetchall()
    return {'rows':rows[:50],'next':rows[49]['id'] if len(rows)>50 else None}
