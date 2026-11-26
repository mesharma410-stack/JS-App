from datetime import date, datetime
from zoneinfo import ZoneInfo
from collections import defaultdict
from io import BytesIO
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill
from openpyxl.utils import get_column_letter
from .auth import can

LABELS={'serial-detail':'Inventory Serial Detail','aging-analysis':'Aging Analysis','warehouse-stock':'Warehouse Stock','free-stock':'Free Stock','workorder-inventory':'Work Order Inventory','dispatch-history':'Dispatch History','product-movement':'Product Movement','purchase-analysis':'Purchase Analysis','margin-analysis':'Margin Analysis'}
FIN={'purchase-analysis','margin-analysis'}
ROUTES=('Bought Out','Fabrication')
MAX_ROWS=25000
SERIAL=['Serial / Internal ID','Location','Work Order','WO Status','Allocation','Equipment','Product Type','Brand','Model','Size','Stock In Date','Age Days','Stock In ID']

def validate_filters(raw):
    keys=('workOrder','product','location','from','to')
    if not isinstance(raw,dict) or set(raw)-set(keys): raise ValueError('Invalid report filters')
    f={k:raw.get(k,'') for k in keys}
    if any(not isinstance(v,str) or len(v)>100 for v in f.values()): raise ValueError('Invalid filter length or type')
    f={k:v.strip() for k,v in f.items()}
    for k in ('from','to'):
        if f[k] and date.fromisoformat(f[k]).isoformat()!=f[k]: raise ValueError('Dates must use YYYY-MM-DD')
    if f['from'] and f['to'] and f['from']>f['to']: raise ValueError('From date cannot be after To date')
    return f

def route_access(grants,key):
    if key not in LABELS: raise ValueError('Unknown report')
    if not can(grants,'Report') or not can(grants,'Report: '+LABELS[key]): raise PermissionError('ACCESS_DENIED: Report not granted')
    routes=[r for r in ROUTES if can(grants,'Route: '+r)]
    if not routes: raise PermissionError('ACCESS_DENIED: Material route not granted')
    if key in FIN and (len(routes)!=2 or not all(can(grants,p) for p in ('Management Pricing Dashboard','Pricing'))): raise PermissionError('ACCESS_DENIED: Financial report not granted')
    return routes

def query(cur,sql,params):
    cur.execute(sql+' LIMIT %s',(*params,MAX_ROWS+1)); rows=cur.fetchall()
    if len(rows)>MAX_ROWS: raise ValueError('More than 25,000 source rows. Narrow filters.')
    return rows

def condition(f,wo,product,location,day):
    clauses=[]; values=[]
    for k,expr in [('workOrder',wo),('product',product),('location',location)]:
        if f[k]:
            if not expr: raise ValueError('Location filter is not available for financial reports')
            clauses.append(f"strpos(lower(coalesce({expr},'')),lower(%s))>0"); values.append(f[k])
    for k,op in [('from','>='),('to','<=')]:
        if f[k]: clauses.append(f'{day} {op} %s::date'); values.append(f[k])
    return (' AND '+' AND '.join(clauses) if clauses else ''),values

def workbook(tabs):
    book=Workbook();book.remove(book.active)
    for name,headers,rows in tabs:
        ws=book.create_sheet(name);ws.append(headers);ws.freeze_panes='A2'
        for c in ws[1]: c.font=Font(bold=True,color='FFFFFF');c.fill=PatternFill('solid',fgColor='17364D')
        for row in rows:
            ws.append(list(row))
            for c in ws[ws.max_row]:
                if isinstance(c.value,str): c.data_type='s' # never execute formula text
        ws.auto_filter.ref=ws.dimensions
        for i,h in enumerate(headers,1):ws.column_dimensions[get_column_letter(i)].width=min(40,max(16,len(h)+2))
    out=BytesIO();book.save(out);out.seek(0);return out

def build(cur,key,raw,grants):
    routes=route_access(grants,key); f=validate_filters(raw); tabs=[]; units=[]; count=0
    today=datetime.now(ZoneInfo('Asia/Kolkata')).date()
    def tab(n,h,r):tabs.append((n,h,list(r)))
    if key in FIN:
        extra,args=condition(f,'w.work_order_number',"concat_ws(' ',l.equipment_name,l.model,l.brand)",None,'w.creation_date')
        rows=query(cur,'''SELECT w.work_order_number,w.creation_date,w.status,w.order_type,w.sales_person,l.line_id,l.equipment_name,l.entry_type,l.planned_qty,p.purchase_unit_price,p.selling_unit_price FROM work_order_lines l JOIN work_orders w USING(work_order_id) LEFT JOIN work_order_pricing p USING(line_id) WHERE l.active AND w.active AND l.entry_type=ANY(%s)'''+extra+' ORDER BY w.work_order_number,l.line_id',[routes,*args]); count=len(rows)
        def line(r):
            q=r['planned_qty']; b=r['purchase_unit_price']; s=r['selling_unit_price']; complete=b is not None and s is not None
            return [r[k] for k in ('work_order_number','creation_date','status','order_type','sales_person','line_id','equipment_name','entry_type','planned_qty','purchase_unit_price','selling_unit_price')]+[q*b if b is not None else None,q*s if s is not None else None,q*(s-b) if complete else None,'Complete' if complete else 'Missing purchase or selling price']
        tab('Estimated Margins' if key=='margin-analysis' else 'Purchase Analysis',['Work Order','Created','Status','Order Type','Sales Executive','Line ID','Equipment','Material Type','Qty','Purchase Unit Cost','Selling Unit Price','Total Purchase','Total Selling','Calculated Gross Profit','Costing Status'],map(line,rows))
    elif key=='dispatch-history':
        extra,args=condition(f,'w.work_order_number',"concat_ws(' ',p.equipment_name,p.model,u.serial)",'d.location','d.dispatch_date')
        rows=query(cur,'''SELECT d.stock_out_id,d.dispatch_date,w.work_order_number,coalesce(w.status,'Free') status,d.location,d.dispatch_mode,u.serial FROM dispatches d JOIN dispatch_units du USING(stock_out_id) JOIN stock_units u USING(unit_id) JOIN stock_receipts r USING(stock_in_id) JOIN products p USING(product_id) LEFT JOIN work_orders w ON w.work_order_id=d.work_order_id WHERE d.active AND du.active AND u.active AND r.active AND r.entry_type=ANY(%s)'''+extra+' ORDER BY d.stock_out_id,u.serial',[routes,*args]); groups={}
        for r in rows:
            k=r['stock_out_id']; g=groups.setdefault(k,([r[x] for x in ('stock_out_id','dispatch_date','work_order_number','status','location','dispatch_mode')],[]));g[1].append(r['serial'])
        count=len(groups);tab('Dispatch History',['Dispatch ID','Dispatch Date','Work Order','WO Status','Location','Mode','Serial Numbers','Serial Count'],(a+[', '.join(b),len(b)] for a,b in groups.values()))
    else:
        extra,args=condition(f,'w.work_order_number',"concat_ws(' ',p.equipment_name,p.model,u.serial)",'u.location','r.purchase_date')
        available='NOT EXISTS (SELECT 1 FROM dispatch_units du JOIN dispatches d USING(stock_out_id) WHERE du.unit_id=u.unit_id AND du.active AND d.active)'
        sql=f'''SELECT u.serial,u.location,w.work_order_number,coalesce(w.status,'Free') status,p.product_id,p.equipment_name,p.product_type,p.brand,p.model,p.size_capacity,r.purchase_date,r.stock_in_id,({available}) available FROM stock_units u JOIN stock_receipts r USING(stock_in_id) JOIN products p USING(product_id) LEFT JOIN work_orders w ON w.work_order_id=u.work_order_id WHERE u.active AND r.active AND r.entry_type=ANY(%s)'''
        if key!='product-movement':sql+=' AND '+available
        units=query(cur,sql+extra+' ORDER BY u.serial',[routes,*args]);count=len(units)
        def age(r):return (today-r['purchase_date']).days
        def serial(r):return [r['serial'],r['location'],r['work_order_number'],r['status'],'Engaged' if r['work_order_number'] else 'Free',*[r[x] for x in ('equipment_name','product_type','brand','model','size_capacity','purchase_date')],age(r),r['stock_in_id']]
        if key=='serial-detail':tab('Serial Detail',SERIAL,map(serial,units))
        if key=='free-stock':
            units=[r for r in units if not r['work_order_number']];count=len(units);tab('Free Stock',SERIAL,map(serial,units))
        if key=='aging-analysis':
            buckets=[('0-30 days',0,30),('31-60 days',31,60),('61-90 days',61,90),('91-180 days',91,180),('181+ days',181,10**9)]
            result=[]
            for name,a,b in buckets:
                x=[r for r in units if a<=age(r)<=b]; free=sum(not r['work_order_number'] for r in x);result.append([name,free,len(x)-free,len(x)])
            tab('Aging Analysis',['Age Bucket','Free Units','Engaged Units','Total Units'],result);tab('Aging Serial Detail',SERIAL,map(serial,units))
        if key=='warehouse-stock':
            groups=defaultdict(list)
            for r in units:groups[r['location']].append(r)
            tab('Warehouse Summary',['Location','Free','Engaged','Total On Hand','Oldest Days'],([k,sum(not r['work_order_number'] for r in v),sum(bool(r['work_order_number']) for r in v),len(v),max(map(age,v))] for k,v in groups.items()));tab('Warehouse Serial Detail',SERIAL,map(serial,units))
        if key=='workorder-inventory':
            groups=defaultdict(list)
            for r in units:groups[r['work_order_number'] or 'Without Work Order'].append(r)
            tab('Work Order Inventory',['Work Order','Status','On Hand Units','Locations','Oldest Days'],([k,v[0]['status'],len(v),', '.join(sorted({r['location'] for r in v})),max(map(age,v))] for k,v in groups.items()));tab('Work Order Serials',SERIAL,map(serial,units))
        if key=='product-movement':
            groups=defaultdict(list)
            for r in units:groups[(r['product_id'],r['location'])].append(r)
            count=len(groups);tab('Product Movement',['Product ID','Equipment','Brand','Model','Location','Received Units','Dispatched Units','On Hand Units'],([k[0],v[0]['equipment_name'],v[0]['brand'],v[0]['model'],k[1],len(v),sum(not r['available'] for r in v),sum(r['available'] for r in v)] for k,v in groups.items()))
    tab('Report Summary',['Metric','Value'],[['Report',LABELS[key]],['Generated',today.isoformat()],['Main report rows',count],['Financial data','Management only' if key in FIN else 'Excluded'],['Mode','Migration preview; read-only']]);tab('Applied Filters',['Filter','Value'],[(k,v or 'All') for k,v in f.items()]);tab('Read Me',['Topic','Explanation'],[['Source','Neon PostgreSQL migration preview'],['Editing','No operational changes supported in preview'],['Blank result','No matching imported data']])
    return workbook(tabs),f'Janshakti_{key}_{today.isoformat()}.xlsx'
