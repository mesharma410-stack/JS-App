"""C2 original Work Order draft parser and model-first validation.
No writes: upload and review must never create a WO, product or receipt.
Derived from 17_WorkOrderDocument_New.gs, 18_ModelMatchingAndExperience_New.gs,
and f10c1ReadOriginalWorkbook in the supplied C2 Index.html.
"""
import io
import re
import unicodedata
import zipfile
from collections import defaultdict
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from openpyxl import load_workbook
from openpyxl.utils import get_column_letter
from openpyxl.utils.datetime import from_excel
from .auth import can

MAX_FILE=4_000_000
MAX_ROWS=130
BASE=['NO','PRODUCT NAME','SIZE','QTY','MODEL','BOUGHT OUT','VENDOR']
FIELDS=['code','description','size','qty','model','entryType','brand']
LIMITS={'code':100,'description':1800,'size':200,'model':150,'brand':150,
        'section':120,'itemRemarks':600,'itemDescription':1800,'productId':100}

def clean(v):
    return '' if v is None else str(v).strip()

def model_key(v):
    return re.sub(r'\s+','',unicodedata.normalize('NFKC',clean(v))).upper()

def words(v):
    s=unicodedata.normalize('NFKC',clean(v)).upper()
    return ' '.join(''.join(c if c.isalnum() else ' ' for c in s).split())

def similarity(a,b):
    if not a or not b: return 0
    if a==b: return 1
    if max(len(a),len(b))>180: return 0
    prev=list(range(len(b)+1))
    for i,c in enumerate(a,1):
        row=[i]
        for j,d in enumerate(b,1):
            row.append(min(row[-1]+1,prev[j]+1,prev[j-1]+(c!=d)))
        prev=row
    return 1-prev[-1]/max(len(a),len(b))

class Master:
    def __init__(self,rows):
        self.rows=rows
        self.ids={r['productId']:r for r in rows}
        self.models=defaultdict(list)
        self.names=defaultdict(list)
        for p in rows:
            m=model_key(p['model'])
            if m: self.models[m].append(p)
            self.names[(words(p['description']),words(p['brand']))].append(p)

    def resolve(self,x):
        ident=x.get('productId','')
        m=model_key(x['model']); n=words(x['description']); v=words(x['brand'])
        p=None; reason=''
        if ident:
            p=self.ids.get(ident)
            if not p: return None,'Selected master is no longer active. Choose an active model.',''
            reason='Selected master model / stable record'
        else:
            exact=self.models.get(m,[]) if m else []
            names=self.names.get((n,v),[]) if n and v else []
            if len(exact)>1: return None,'Model matches multiple active master rows. Resolve duplicates first.',''
            if len(exact)==1:
                p=exact[0]
                if names and all(t['productId']!=p['productId'] for t in names):
                    return None,'Model and product/vendor point to different master records. Choose manually.',''
                if (v and v!=words(p['brand'])) or (n and similarity(n,words(p['description']))<0.5):
                    return None,'Exact model found, but product name or vendor conflicts. Choose manually.',''
                reason='Unique normalized model'
            elif len(names)==1:
                p=names[0];reason='Unique exact product name + vendor'
            else:
                matches=[]
                if n and m and v:
                    vendor_rows=[t for t in self.rows if words(t['brand'])==v]
                    if len(vendor_rows)>500:
                        return None,'Too many possible master rows for automatic matching. Select the exact model.',''
                    for t in vendor_rows:
                        k=model_key(t['model'])
                        if similarity(n,words(t['description']))>=0.86 and (similarity(m,k)>=0.78 or (len(m)>=3 and k.startswith(m))):
                            matches.append(t)
                if len(matches)==1:
                    p=matches[0];reason='Unique close model + closely matching product name + exact vendor'
                elif len(matches)>1 or len(names)>1:
                    return None,'Several master models are possible. Choose from Product Master.',''
                else: return None,'No reliable active master match. Select a master model or correct the source.',''
        k=model_key(p['model'])
        if not k or len(self.models[k])!=1:
            return None,'Selected master model is blank or duplicated. Ask the master administrator.',''
        return p,'',reason

def read_original(raw):
    if not isinstance(raw,bytes) or not raw or len(raw)>MAX_FILE:
        raise ValueError('Select an original .xlsx under 4 MB (test deployment limit).')
    try:
        with zipfile.ZipFile(io.BytesIO(raw)) as z:
            entries=z.infolist()
            if len(entries)>1000 or sum(i.file_size for i in entries)>30_000_000 or any(i.file_size>12_000_000 or i.flag_bits&1 for i in entries):
                raise ValueError('Workbook exceeds safe expanded size.')
            if any('vbaproject' in i.filename.lower() or 'externallinks/' in i.filename.lower() for i in entries):
                raise ValueError('Macros and external workbook links are not accepted.')
        book=load_workbook(io.BytesIO(raw),read_only=True,data_only=False,keep_links=False)
    except ValueError: raise
    except Exception: raise ValueError('Invalid or unsupported Excel workbook.')
    try:
        if len(book.worksheets)>30: raise ValueError('Too many worksheets.')
        candidates=[]
        for sheet in book:
            rows=list(sheet.iter_rows(min_row=1,max_row=30,max_col=24,values_only=True))
            for i,row in enumerate(rows,1):
                if [re.sub(r'\s+',' ',clean(v).upper()).rstrip('.') for v in row[:7]]==BASE:
                    candidates.append((sheet,i,rows[:i-1],row));break
        if len(candidates)!=1: raise ValueError('Expected exactly one original Work Order sheet with NO | PRODUCT NAME | SIZE | QTY | MODEL | BOUGHT OUT | VENDOR.')
        sheet,h,pre,header=candidates[0]
        phase=clean(header[7]).upper()=='PHASE'
        tail=['PHASE','REMARKS','DESCRIPTION'] if phase else ['REMARKS','DESCRIPTION']
        if [clean(v).upper() for v in header[7:7+len(tail)]]!=tail:
            raise ValueError('Unexpected Phase / Remarks / Description column order.')
        fields=FIELDS+(['section'] if phase else [])+['itemRemarks','itemDescription']
        flat=[clean(v) for row in pre for v in row]
        patterns={'workOrderNumber':r'^\s*WORK\s*ORDER\s*(?:NUMBER|NO\.?)[\s:]*([^\r\n]+)$',
          'workOrderDate':r'^\s*ORDER\s*DATE\s*:\s*(.+)$','deliveryDate':r'^\s*DELIVERY\s*DATE\s*:\s*(.+)$',
          'specs':r'^\s*SPECS\s*:\s*(.+)$','structure':r'^\s*STRUCTURE\s*:\s*(.+)$',
          'gasFitting':r'^\s*GAS\s*FITTING\s*:\s*(.+)$','quoteReference':r'^\s*QUOTE\s*REF\.?\s*:\s*(.+)$',
          'checkedBy':r'^\s*CHECKED\s*BY\s*:\s*(.+)$'}
        meta={}
        for k,pattern in patterns.items():
            meta[k]=next((m.group(1).strip() for t in flat if (m:=re.match(pattern,t,re.I))),'')
        for k in ('workOrderDate','deliveryDate'):
            s=meta[k]
            try:
                if re.fullmatch(r'\d{5}(?:\.\d+)?',s): meta[k]=from_excel(float(s),book.epoch).date().isoformat()
                else:
                    for fmt in ('%Y-%m-%d','%d-%m-%Y','%d/%m/%Y','%d.%m.%Y'):
                        try: meta[k]=datetime.strptime(s,fmt).date().isoformat();break
                        except ValueError: continue
            except (ValueError,OverflowError): pass
        owner=[]; col=None
        for row in pre:
            if col is not None:
                if clean(row[col]): owner.append(clean(row[col]))
            else:
                for j,v in enumerate(row):
                    if re.match(r'^\s*ORDER\s*OF\s*:',clean(v),re.I):
                        col=j; t=re.sub(r'^\s*ORDER\s*OF\s*:\s*','',clean(v),flags=re.I)
                        if t: owner.append(t)
                        break
        meta['salesPerson']=' '.join(owner)
        if not meta['workOrderNumber']: raise ValueError('Missing Work Order Number in original workbook header.')
        items=[]
        # Read a bounded range; reject worksheets with an unexpectedly large used range.
        if sheet.max_row and sheet.max_row>10000: raise ValueError('Original Work Order worksheet is too large.')
        for i,row in enumerate(sheet.iter_rows(min_row=h+1,max_row=min(sheet.max_row or h+1000,10000),max_col=len(fields),values_only=True),h+1):
            if any(clean(v).upper()=='TOTAL' for v in row[:3]): break
            if not any(clean(v) for v in row): continue
            x=dict(zip(fields,map(clean,row)));x['entryType']=x['entryType'] or 'N'
            x.update(sourceRow=i,sourceSheet=sheet.title,phaseLayout=phase,productId='')
            items.append(x)
            if len(items)>MAX_ROWS: raise ValueError('Original Work Order supports at most 130 items.')
        if not items: raise ValueError('No Work Order items found.')
        return {'meta':meta,'items':items,'sheet':sheet.title}
    finally: book.close()

def validate(cur,grants,data):
    if not can(grants,'Work Orders'): raise PermissionError('ACCESS_DENIED: Work Orders required')
    if not isinstance(data,dict) or not isinstance(data.get('items'),list) or not 1<=len(data['items'])<=MAX_ROWS:
        raise ValueError('Enter 1 to 130 Work Order items.')
    meta=data.get('meta',{})
    if not isinstance(meta,dict): raise ValueError('Invalid Work Order header.')
    meta={k:clean(meta.get(k)) for k in ('workOrderNumber','workOrderDate','deliveryDate','salesPerson','specs','structure','gasFitting','quoteReference','checkedBy','workOrderType')}
    if any(len(v)>220 for v in meta.values()): raise ValueError('Work Order header is too long.')
    errors=[];corrections=[];items=[]
    master=Master([])
    if can(grants,'Route: Bought Out'):
        cur.execute("""SELECT product_id AS "productId",equipment_name AS description,brand,model,
            size_capacity AS size,product_type AS category FROM products WHERE active ORDER BY product_id LIMIT 10001""")
        rows=cur.fetchall()
        if len(rows)>10000: raise ValueError('Master exceeds preview limit; use a filtered master service.')
        master=Master(rows)
    if meta['workOrderNumber']:
        cur.execute("SELECT 1 FROM work_orders WHERE lower(trim(work_order_number))=lower(trim(%s)) LIMIT 1",(meta['workOrderNumber'],))
        if cur.fetchone(): errors.append({'index':-1,'cell':'Work Order Number','field':'workOrderNumber','message':'Work Order already exists. Open its saved version; original-file upload is for a new draft only.'})
    else: errors.append({'index':-1,'cell':'Work Order Number','field':'workOrderNumber','message':'Enter Work Order number.'})
    for i,raw in enumerate(data['items']):
        if not isinstance(raw,dict): raise ValueError('Invalid item row.')
        x={k:clean(raw.get(k)) for k in LIMITS}
        x['qty']=clean(raw.get('qty')); x['entryType']=clean(raw.get('entryType'))
        row=raw.get('sourceRow',i+2)
        if type(row) is not int or not 1<=row<=10000: row=i+2
        sheet=clean(raw.get('sourceSheet'))[:100] or 'Editor'
        phase=raw.get('phaseLayout') is True
        x.update(sourceRow=row,sourceSheet=sheet,phaseLayout=phase)
        cols={'code':'A','description':'B','size':'C','qty':'D','model':'E','entryType':'F','brand':'G',
              'section':'H','itemRemarks':'I' if phase else 'H','itemDescription':'J' if phase else 'I','productId':'E'}
        def issue(field,message):
            errors.append({'index':i,'row':row,'cell':sheet+'!'+cols[field]+str(row),'field':field,'message':message})
        route={'y':'Bought Out','yes':'Bought Out','bought out':'Bought Out','n':'Fabrication','no':'Fabrication','fabrication':'Fabrication'}.get(x['entryType'].lower(),'')
        if not route: issue('entryType','Enter Y (Bought Out) or N (Fabrication).')
        elif not can(grants,'Route: '+route): issue('entryType','Material route is not permitted.')
        x['entryType']=route or x['entryType']
        bad=False
        for k,limit in LIMITS.items():
            if len(x[k])>limit or '\x00' in x[k]: issue(k,'Invalid or overlong value.');bad=True
            elif x[k].startswith(('=','+','@')): issue(k,'Formula-like text is not accepted. Paste plain values.');bad=True
        try:
            q=Decimal(x['qty'])
            if not q.is_finite() or q<0 or q!=q.to_integral_value() or q>2147483647: raise ValueError()
            x['qty']=int(q)
        except (InvalidOperation,ValueError): issue('qty','Quantity must be a nonnegative whole number.')
        if route=='Bought Out' and can(grants,'Route: Bought Out') and not bad:
            p,error,reason=master.resolve(x)
            if error: issue('model',error);x['invalidMaster']=True;x['productId']=''
            else:
                for field in ('description','model','brand'):
                    before=x[field]; after=p[field]
                    norm=model_key if field=='model' else words
                    if norm(before)!=norm(after) and (before or field=='model'):
                        corrections.append({'index':i,'row':row,'cell':sheet+'!'+cols[field]+str(row),
                          'field':field,'before':before,'after':after,'reason':reason,'message':(before or '(blank)')+' → '+after+' · '+reason})
                    x[field]=after
                x['productId']=p['productId'];x['size']=x['size'] or p['size'];x['category']=p['category']
        elif route=='Fabrication':
            if not x['description']: issue('description','Enter custom fabrication product name.')
            if x['productId'] and not x['productId'].startswith('FAB-'): issue('productId','Fabrication cannot use a Bought Out product ID.')
            x['productId']='';x['category']='Other'
        items.append(x)
    return {'ok':not errors,'meta':meta,'items':items,'errors':errors,'corrections':corrections,
            'message':str(len(items))+' items reviewed; '+str(len(errors))+' blocking issues. Nothing saved.'}


def save_new(cur,token,grants,data):
    from .auth import digest
    import json
    if grants.get('Work Orders')!='Edit':
        raise PermissionError('ACCESS_DENIED: Work Orders Edit required')
    result=validate(cur,grants,data)
    if result['errors'] or result['corrections']:
        raise ValueError('Validate items and review all corrections before saving.')
    meta=result['meta']
    meta['workOrderType']=meta['workOrderType'] or 'Project'
    if meta['workOrderType'] not in ('Project','Retail','Other'):
        raise ValueError('Invalid Work Order type.')
    if not meta['quoteReference']:
        raise ValueError('Quote Reference is required by the C2 save workflow.')
    try:
        start=date.fromisoformat(meta['workOrderDate'])
        if meta['deliveryDate'] and date.fromisoformat(meta['deliveryDate'])<start:
            raise ValueError()
    except ValueError:
        raise ValueError('Enter a valid Work Order date and delivery date on or after it.')
    for item in result['items']:
        if grants.get('Route: '+item['entryType'])!='Edit':
            raise PermissionError('ACCESS_DENIED: Edit access required for every material route.')
    cur.execute("SELECT public.c2_save_new_wo(%s,%s::jsonb) AS result",
        (digest(token),json.dumps({'meta':meta,'items':result['items']},ensure_ascii=False)))
    return cur.fetchone()['result']

def versions(cur,token,grants,number,version):
    from .auth import digest
    if not can(grants,'Work Orders'): raise PermissionError('ACCESS_DENIED: Work Orders required')
    if not 1<=len(number)<=110 or not isinstance(version,int) or not 0<=version<=2147483647:
        raise ValueError('Enter a valid Work Order number and version.')
    cur.execute("SELECT public.c2_read_wo_versions(%s,%s,%s) AS result",(digest(token),number,version))
    return cur.fetchone()['result']
