"""First C2 read-only APIs. No financial fields or operational writes."""
from datetime import datetime
from zoneinfo import ZoneInfo
from .auth import can

ROUTES=('Bought Out','Fabrication')
LOCATIONS=('Bapu Nagar warehouse','Bakrol warehouse','Bapu Nagar showroom')
BUCKETS=('0–60 days','61–90 days','91–150 days','151–210 days','211+ days')
CRITICAL_DAYS=90 # source default; dynamic settings are not yet ported

def allowed_routes(grants,page):
    if not can(grants,page):
        raise PermissionError('ACCESS_DENIED: '+page+' not granted')
    routes=[r for r in ROUTES if can(grants,'Route: '+r)]
    if not routes:
        raise PermissionError('ACCESS_DENIED: Material route not granted')
    return routes

def products(cur,grants,search='',after=''):
    if 'Bought Out' not in allowed_routes(grants,'Product Master'):
        raise PermissionError('ACCESS_DENIED: Bought Out route required')
    if any(not isinstance(v,str) or len(v)>100 for v in (search,after)):
        raise ValueError('Search or page cursor too long')
    cur.execute("""SELECT product_id AS "productId",equipment_name AS "equipmentName",
        product_type AS "productType",brand,model,size_capacity AS "sizeCapacity"
        FROM products WHERE active AND product_id>%s
        AND strpos(lower(concat_ws(' ',product_id,equipment_name,brand,model,size_capacity)),lower(%s))>0
        ORDER BY product_id LIMIT 51""",(after,search.strip()))
    rows=cur.fetchall()
    return {'products':rows[:50],'next':rows[49]['productId'] if len(rows)>50 else None}

def dashboard(cur,grants):
    routes=allowed_routes(grants,'Dashboard')
    today=datetime.now(ZoneInfo('Asia/Kolkata')).date()
    cur.execute("""WITH available AS (
        SELECT u.location, u.work_order_id IS NOT NULL AS engaged,
               %s::date-r.purchase_date AS age
        FROM stock_units u JOIN stock_receipts r ON r.stock_in_id=u.stock_in_id
        WHERE u.active AND r.active AND r.entry_type=ANY(%s)
          AND NOT EXISTS (SELECT 1 FROM dispatch_units du JOIN dispatches d
            ON d.stock_out_id=du.stock_out_id
            WHERE du.unit_id=u.unit_id AND du.active AND d.active)
    )
    SELECT location,engaged,CASE WHEN age<0 THEN -1 WHEN age<=60 THEN 0
      WHEN age<=90 THEN 1 WHEN age<=150 THEN 2 WHEN age<=210 THEN 3 ELSE 4 END AS bucket,
      count(*) AS qty,count(*) FILTER (WHERE age>%s) AS aged
    FROM available GROUP BY 1,2,3""",(today,routes,CRITICAL_DAYS))
    locations={loc:{'location':loc,'freeQty':0,'engagedQty':0,'agedFreeQty':0} for loc in LOCATIONS}
    aging=[{'label':label,'free':0,'engaged':0} for label in BUCKETS]
    free=engaged=critical=future=0
    for row in cur.fetchall():
        loc=locations.setdefault(row['location'],{'location':row['location'],'freeQty':0,'engagedQty':0,'agedFreeQty':0})
        qty=row['qty']
        if row['engaged']:
            engaged+=qty
            loc['engagedQty']+=qty
        else:
            free+=qty
            critical+=row['aged']
            loc['freeQty']+=qty
            loc['agedFreeQty']+=row['aged']
        if row['bucket']<0:
            future+=qty
        else:
            aging[row['bucket']]['engaged' if row['engaged'] else 'free']+=qty
    return {'physical':{'qty':free+engaged},'free':{'qty':free},'engaged':{'qty':engaged},
            'critical':{'qty':critical},'byLocation':list(locations.values()),'aging':aging,
            'futureDatedUnits':future,'criticalAgeDays':CRITICAL_DAYS}
