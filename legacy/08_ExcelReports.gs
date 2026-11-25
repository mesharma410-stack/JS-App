/**
 * Janshakti Final 10(B) — 08_ExcelReports.
 * Keep the file in the SAME bound Apps Script project as the other modules.
 * Calls and constants are shared across .gs files by the Apps Script runtime.
 * Do not rename externally called functions unless Index.html is updated too.
 */

/** Janshakti Final 7 — consolidated source. All public RPC names remain unchanged. */


/* ---- Excel report import/export ---- */
/**
 * FINAL 4 — secure Excel dashboard export and bulk data management.
 * Uses native Utilities.zip/unzip + XmlService for Excel; no Drive conversion API.
 * Public actions use login sessions and AccessMatrix permissions.
 */
const R4_FORMATS = {
 products: {sheet:'Product Master',table:'Products',key:'ProductID',fields:['ProductID','EquipmentName','ProductType','MakeBrand','Model','SizeCapacity','CreatedAt']},
 workorders: {sheet:'Work Orders',table:'WorkOrders',key:'WorkOrderID',fields:['WorkOrderID','WorkOrderNumber','WorkOrderType','SalesPerson','CreationDate','PromiseDate','Status']},
 stockin: {sheet:'Stock In',table:'StockIn',key:'StockInID',fields:['StockInID','EntryType','Location','WorkOrderNumber','ProductType','ProductID','EquipmentName','MakeBrand','Model','SizeCapacity','Qty','SerialNumbers','PurchaseDate','WorkOrderLineID']},
 stockout: {sheet:'Stock Out',table:'StockOut',key:'StockOutID',fields:['StockOutID','Location','WorkOrderNumber','SerialNumbers','DispatchDate','DispatchMode']},
 linkage: {sheet:'Work Order Linkage',table:'WorkOrderLines',key:'LineID',fields:['LineID','WorkOrderNumber','ProductID','PlannedQty']}
};
const R4_MAX_ROWS=5000;
function r4Format_(key){if(!Object.prototype.hasOwnProperty.call(R4_FORMATS,key))throw new Error('Unknown report type.');return R4_FORMATS[key];}
function r4ExcelCol_(n){let out='';while(n>0){out=String.fromCharCode(65+(n-1)%26)+out;n=Math.floor((n-1)/26);}return out;}
function r4ExcelCell_(fmt,field,row){const index=fmt.fields.indexOf(field);return fmt.sheet+'!'+r4ExcelCol_(index<0?1:index+1)+row;}
function r4Safe_(value){
 if(value instanceof Date)return dateStr_(value);
 if(typeof value==='string' && /^[\s]*[=+@]/.test(value))return "'"+value; // Excel formula injection defense.
 if(value==null)return '';return value;
}
function r4Text_(v){return clean_(v instanceof Date?dateStr_(v):v);}
function r4Version_(row,fields){return authHash_(JSON.stringify(fields.map(f=>r4Text_(row[f]))));}
/** Native in-memory Office Open XML export: no temporary Google Sheet, Drive export, or OAuth HTTP 403. */
function r4NewWorkbook_(name){return {__tabs:[],name:name};}
function r4WriteTab_(book,name,headers,rows){
 if(!book.__tabs)throw new Error('Invalid internal Excel workbook.');
 if(book.__tabs.some(s=>s.name===name))throw new Error('Duplicate Excel worksheet: '+name);
 if(rows.length>25000)throw new Error('Maximum 25,000 rows in one Excel tab. Filter first.');
 book.__tabs.push({name,headers:headers.slice(),rows:rows.map(x=>x.slice())});
}
function f8XlsxEscape_(text){return String(text==null?'':text).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g,'');}
/** Live report worksheet: frozen/filterable header, readable widths, zebra rows,
 * and the same Hold (blue) / Cancel (red) semantics as Work Order Studio.
 * Only style information is derived here; no operational data is changed.
 */
function f8XlsxSheet_(tab){
 const hdr=tab.headers||[],rs=tab.rows||[],n=hdr.length;
 const statusColumn=hdr.findIndex(x=>['status','wo status','work order status','approved status'].includes(String(x).toLowerCase()));
 const cols=hdr.map((h,j)=>{let max=String(h||'').length;for(let i=0;i<Math.min(60,rs.length);i++){
  const t=String(rs[i][j]==null?'':rs[i][j]);max=Math.max(max,Math.min(54,t.length));
 }return '<col min="'+(j+1)+'" max="'+(j+1)+'" width="'+Math.max(11,Math.min(56,max+3))+'" customWidth="1"/>';}).join('');
 const result=['<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="18"/><cols>'+cols+'</cols><sheetData>'];
 [hdr].concat(rs).forEach((arr,i)=>{
  const row=i+1;const status=statusColumn<0?'':String(i>0?arr[statusColumn]||'':'').trim().toLowerCase();
  const style=i===0?1:/^(hold|held)$/.test(status)?3:/^cancel/.test(status)?4:(i%2===0?2:0);
  result.push('<row r="'+row+'"'+(i===0?' ht="25" customHeight="1"':'')+'>');
  arr.forEach((v,j)=>{if(v==null||v==='')return;
   const address=r4ExcelCol_(j+1)+row,styleAttr=style?' s="'+style+'"':'';
   if(i>0&&typeof v==='number'&&isFinite(v))result.push('<c r="'+address+'"'+styleAttr+'><v>'+v+'</v></c>');
   else{const val=v instanceof Date?dateStr_(v):v;result.push('<c r="'+address+'" t="inlineStr"'+styleAttr+'><is><t xml:space="preserve">'+f8XlsxEscape_(val)+'</t></is></c>');}
  });result.push('</row>');
 });
 result.push('</sheetData><autoFilter ref="A1:'+r4ExcelCol_(n)+Math.max(1,rs.length+1)+'"/></worksheet>');
 return result.join('');
}
function r4ExportXlsx_(book,name,rowCount){
 if(!book.__tabs?.length)throw new Error('No Excel worksheets to export.');
 // For small/medium reports, return live tab data and construct Excel in the browser
 // (Final 8-compatible). Large reports use compressed native Utilities.zip instead;
 // this avoids oversized google.script.run JSON payloads and slow browser CRC32 loops.
 const browserRows=book.__tabs.reduce((n,t)=>n+t.rows.length,0);
 const browserCells=book.__tabs.reduce((n,t)=>n+t.rows.length*t.headers.length,0);
 if(F10C_REPORT_BROWSER_&&browserRows<=1800&&browserCells<=24000)
  return f10cReportTransport_(book,name,rowCount);
 const ns='http://schemas.openxmlformats.org/officeDocument/2006/relationships',pack='http://schemas.openxmlformats.org/package/2006/relationships',tabs=book.__tabs;
 const sheets=tabs.map((x,i)=>'<sheet name="'+f8XlsxEscape_(x.name)+'" sheetId="'+(i+1)+'" r:id="rId'+(i+1)+'"/>').join('');
 const rels=tabs.map((x,i)=>'<Relationship Id="rId'+(i+1)+'" Type="'+ns+'/worksheet" Target="worksheets/sheet'+(i+1)+'.xml"/>').join('');
 const overrides=tabs.map((x,i)=>'<Override PartName="/xl/worksheets/sheet'+(i+1)+'.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>').join('');
 const types='<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'+overrides+'</Types>';
 const style='<?xml version="1.0"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Arial"/></font><font><b/><sz val="11"/><color rgb="FF17324D"/><name val="Arial"/></font></fonts><fills count="5"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFEAF0F7"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF6F9FE"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFDCEEFF"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFEE2E2"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="5"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="1" borderId="0" xfId="0" applyFill="1" applyFont="1"/><xf numFmtId="0" fontId="0" fillId="2" borderId="0" xfId="0" applyFill="1"/><xf numFmtId="0" fontId="0" fillId="3" borderId="0" xfId="0" applyFill="1"/><xf numFmtId="0" fontId="0" fillId="4" borderId="0" xfId="0" applyFill="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';
 const blob=(path,content)=>Utilities.newBlob(content,'text/xml',path);
 const files=[blob('[Content_Types].xml',types),blob('_rels/.rels','<?xml version="1.0"?><Relationships xmlns="'+pack+'"><Relationship Id="rId1" Type="'+ns+'/officeDocument" Target="xl/workbook.xml"/></Relationships>'),blob('xl/workbook.xml','<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="'+ns+'"><sheets>'+sheets+'</sheets></workbook>'),blob('xl/_rels/workbook.xml.rels','<?xml version="1.0"?><Relationships xmlns="'+pack+'">'+rels+'<Relationship Id="rId'+(tabs.length+1)+'" Type="'+ns+'/styles" Target="styles.xml"/></Relationships>'),blob('xl/styles.xml',style)];
 tabs.forEach((t,i)=>files.push(blob('xl/worksheets/sheet'+(i+1)+'.xml',f8XlsxSheet_(t))));
 let bytes;try{bytes=Utilities.zip(files,name+'.xlsx').getBytes();}catch(error){throw new Error('Excel generation failed. Narrow the date/product filters or ask an administrator to inspect the data: '+String(error.message||error));}if(bytes.length>9*1024*1024)throw new Error('Excel report exceeds 9 MB. Apply filters and export again.');
 return {ok:true,filename:name+'.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',base64:Utilities.base64Encode(bytes),rowCount};
}
function r4ReportInstructions_(fmt){return [
 ['FINAL 10C · Excel formats',''],
 ['Format',fmt.sheet],
 ['How to update','Edit the existing row. Keep its ID and RowVersion exactly as downloaded.'],
 ['How to add','Add a new row below the data. Hidden ID and RowVersion cells must remain blank for a new row. Do not copy an existing row including hidden keys.'],
 ['Model number','For Product Master, use a unique model. Spaces are ignored for identity and removed when saved. Do not type ProductID.'],
 ['Header colors','Black text; blue-gray denotes preserved system fields, green denotes editable data. Stock In and Flow are download only.'],
 ['Data is live','This template contains all ACTIVE database records, not just the last 250 shown in history.'],
 ['Validation','Use Validate only first; no rows save when any validation error is found.'],
 ['Headers','Do not rename, reorder, delete or add columns. Keep this worksheet name.'],
 ['Deletion','Removing a row from this file does NOT delete it in the inventory.'],
 ['Stock history','Dispatched serial numbers cannot be reassigned or removed until the dispatch is reversed safely.'],
 ['Date format','Use YYYY-MM-DD. Serial numbers separated by commas; keep serials as text.'],
 ['Security','Credential, AuditLog, inactive rows, and access control are excluded.'],
 ['Conflicting edits','If another user updated a row, download a fresh copy before importing.'],
 ['Before import','Back up your Google Sheet before any large update.'],
 ['Work Orders','Create and edit versioned Work Orders in Work Order Studio. This report is not a Work Order creation form.']
 ];}
function exportDataTemplate_(key){
 if(key==='workorders'||key==='linkage')throw new Error('Use Work Order Studio / Flow Editor for version-controlled work order changes.');
 const fmt=r4Format_(key);
 const actor=f6Actor_();
 let data=rows_(fmt.table).filter(r=>truthy_(r.Active));
 if(key==='stockin')data=f10aFilterStock_(allStockInRows_().filter(r=>truthy_(r.Active)),actor);
 if(key==='stockout')data=f10aFilterDispatchHistory_(data,actor);
 if(data.length>25000)throw new Error('This dataset has more than 25,000 rows. Contact your administrator to split the report.');
 const book=r4NewWorkbook_('Format-'+key);
 try{
  const hdr=fmt.fields.concat('RowVersion');
  r4WriteTab_(book,fmt.sheet,hdr,data.map(r=>fmt.fields.map(f=>r[f]).concat(r4Version_(r,fmt.fields))));
  book.__tabs[0].hidden=[fmt.key,'RowVersion'];
  book.__tabs[0].editable=key==='stockin'?[]:fmt.fields.filter(f=>f!==fmt.key);
  r4WriteTab_(book,'Instructions',['Instruction','What to do'],r4ReportInstructions_(fmt).concat(
   key==='stockout'?[['Stock Out correction','Only DispatchDate of existing rows is editable. Work Order, Location, SerialNumbers, Mode and ID are protected. Create/reverse dispatches in the Stock Out page.']]:
   key==='products'?[['Product identity','Brand + Model establishes product identity. Existing products used in Work Orders/receipts cannot have their identity fields changed. New rows need blank ProductID and RowVersion.'],['Model matching','A model shared with another active product is rejected. Check the Product Reference worksheet before importing.']]:[]
  ));
  if(key==='products'){
   const linkCount=new Map();rows_('WorkOrderLines').filter(r=>truthy_(r.Active)).forEach(r=>{const id=String(r.ProductID||'');linkCount.set(id,(linkCount.get(id)||0)+1);});
   allStockInRows_().filter(r=>truthy_(r.Active)).forEach(r=>{const id=String(r.ProductID||'');linkCount.set(id,(linkCount.get(id)||0)+1);});
   r4WriteTab_(book,'Product Reference',['ProductID','Equipment','Brand','Model','Product Type','Linked records','Identity editable?'],data.map(r=>[r.ProductID,r.EquipmentName,r.MakeBrand,r.Model,r.ProductType,linkCount.get(String(r.ProductID))||0,linkCount.has(String(r.ProductID))?'NO — linked':'YES — validate first']));
  }
  return r4ExportXlsx_(book,'Janshakti_'+fmt.sheet.replace(/\s+/g,'_')+'_'+today_(),data.length);
 }catch(e){throw e;}
}
/** Always compute from current server inventory and only permitted filter keys. */
/** Dashboard filters also drive the XLSX export; date range uses Stock In dates. */
function r4DashboardFilter_(rows,filters){
 const dims=['location','equipmentName','model','workOrderNumber','productType','allocation'];
 const dates=['purchaseDate_from','purchaseDate_to'];
 if(!filters||typeof filters!=='object'||Array.isArray(filters))filters={};
 for(const name of Object.keys(filters)){
  if(!dims.includes(name)&&!dates.includes(name))throw new Error('Dashboard filter is not recognized: '+name);
  if(dates.includes(name)&&filters[name]&&(!/^\d{4}-\d{2}-\d{2}$/.test(String(filters[name]))))
    throw new Error('Dashboard date filter must use YYYY-MM-DD.');
 }
 return rows.filter(row=>{
  const date=dateStr_(row.purchaseDate);
  if(filters.purchaseDate_from&&(!date||date<filters.purchaseDate_from))return false;
  if(filters.purchaseDate_to&&(!date||date>filters.purchaseDate_to))return false;
  return dims.every(key=>{
   const val=filters[key];
   if(val==null||!Array.isArray(val)||!val.length)return true;
   if(val.length>10000||val.some(v=>typeof v!=='string'))throw new Error('Invalid '+key+' filter.');
   return val.includes(String(row[key]??''));
  });
 });
}
function r4Group_(units,keyFn){const m=new Map();units.forEach(u=>{const key=keyFn(u),o=m.get(key)||{key,qty:0,free:0,engaged:0,amount:0,freeValue:0,engagedValue:0,oldest:0};o.qty++;o.amount+=Number(u.unitCost||0);o.oldest=Math.max(o.oldest,Number(u.ageDays)||0);if(u.allocation==='Free'){o.free++;o.freeValue+=Number(u.unitCost||0);}else{o.engaged++;o.engagedValue+=Number(u.unitCost||0);}m.set(key,o);});return [...m.values()].sort((a,b)=>b.qty-a.qty||String(a.key).localeCompare(String(b.key)));}
function exportDashboardSummary_(filters){
 const units=r4DashboardFilter_(getStockBook_(),filters);
 if(units.length>25000)throw new Error('More than 25,000 serial units match. Apply Dashboard filters and export in parts.');
 const book=r4NewWorkbook_('Dashboard');
 try{
  const header=['Location','Allocation','Serial Number / Internal ID','Work Order','Stock In Date','Equipment Name','Product Type','Make / Brand','Model','Size / Capacity','Age (Days)','Unit Cost (INR)','Stock In ID'];
  r4WriteTab_(book,'Serial Detail',header,units.map(u=>[u.location,u.allocation,u.serial,u.workOrderNumber,u.purchaseDate,u.equipmentName,u.productType,u.brand,u.model,u.size,u.ageDays,u.unitCost,u.stockInId]));
  const grouped=r4Group_(units,u=>u.location);
  r4WriteTab_(book,'Free vs Engaged',['Location','Free Qty','Engaged Qty','Total Qty','Free Amount INR','Engaged Amount INR','Total Amount INR'],grouped.map(x=>[x.key,x.free,x.engaged,x.qty,x.freeValue,x.engagedValue,x.amount]));
  const buck=(age)=>age<=60?'0-60 days':age<=90?'61-90 days':age<=150?'91-150 days':age<=210?'151-210 days':'211+ days';
  r4WriteTab_(book,'Aging Analysis',['Aging Bucket','Free Qty','Engaged Qty','Total Qty','Free Amount INR','Engaged Amount INR','Total INR'],r4Group_(units,u=>buck(Number(u.ageDays||0))).map(x=>[x.key,x.free,x.engaged,x.qty,x.freeValue,x.engagedValue,x.amount]));
  r4WriteTab_(book,'Equipment Analysis',['Product / Model','Free Qty','Engaged Qty','Total Qty','Total INR','Oldest Age Days'],r4Group_(units,u=>[u.equipmentName,u.model].filter(Boolean).join(' · ')).map(x=>[x.key,x.free,x.engaged,x.qty,x.amount,x.oldest]));
  r4WriteTab_(book,'Work Order Analysis',['Work Order','Location','Engaged Serial Qty','Engaged Value INR'],r4Group_(units.filter(u=>u.allocation==='Engaged'),u=>u.workOrderNumber+' | '+u.location).map(x=>[x.key.split(' | ')[0],x.key.split(' | ').slice(1).join(' | '),x.qty,x.amount]));
  const selected=Object.entries(filters||{}).filter(([k,v])=>Array.isArray(v)&&v.length).map(([k,v])=>[k,v.join(', ')]);
  r4WriteTab_(book,'Export Notes',['Item','Value'],[
   ['Exported at (India time)',dateTimeStr_(new Date())],['Exported matching units',units.length],
   ['Physical stock only','Active, available serial units: already dispatched units are excluded.'],
   ['Scope','Every report sheet uses the same matching serial units and active Dashboard filters.'],
   ['Allocation','Free = unassigned; Engaged = linked to a work order.'],
   ['Cost','Unit Cost is purchase/fabrication cost, not confirmed selling price.'],
   ...selected
  ]);
  return r4ExportXlsx_(book,'Janshakti_Dashboard_Summary_'+today_(),units.length);
 }catch(e){throw e;}
}
/** XLSX import using Apps Script native ZIP/XML services, no Google Drive conversion or HTTP scopes. */
function r4ConvertXlsx_(filename,base64){
 if(!/\.xlsx$/i.test(String(filename||'')))throw new Error('Use an Excel .xlsx workbook, downloaded from this application.');
 if(typeof base64!=='string'||base64.length>7.5*1024*1024)throw new Error('Maximum Excel upload is 5 MB.');
 const raw=Utilities.base64Decode(base64);if(raw.length<40||raw.length>5*1024*1024||(raw[0]&255)!==80||(raw[1]&255)!==75)throw new Error('Invalid XLSX ZIP file or larger than 5 MB.');
 const parts=Utilities.unzip(Utilities.newBlob(raw,'application/zip','workbook.zip'));
 let total=0;const xml={};
 parts.forEach(file=>{const name=file.getName().replace(/^\//,'');total+=file.getBytes().length;if(total>22*1024*1024)throw new Error('The Excel file expands to more than 22 MB. Please split the report.');
  if(/^xl\/(workbook\.xml|_rels\/workbook\.xml\.rels|sharedStrings\.xml|worksheets\/sheet\d+\.xml)$/.test(name))xml[name]=file.getDataAsString('UTF-8');
 });
 if(!xml['xl/workbook.xml']||!xml['xl/_rels/workbook.xml.rels'])throw new Error('This is not a standard Excel .xlsx workbook.');
 const main=XmlService.getNamespace('http://schemas.openxmlformats.org/spreadsheetml/2006/main');
 const relationships=XmlService.getNamespace('http://schemas.openxmlformats.org/officeDocument/2006/relationships');
 const pkg=XmlService.getNamespace('http://schemas.openxmlformats.org/package/2006/relationships');
 const parse=text=>{if(/<!DOCTYPE|<!ENTITY/i.test(text))throw new Error('Excel XML document type is not allowed.');return XmlService.parse(text).getRootElement();};
 function allText(e){if(!e)return '';return (e.getName()==='t'?e.getText():'')+e.getChildren().map(allText).join('');}
 const shared=[];
 if(xml['xl/sharedStrings.xml'])parse(xml['xl/sharedStrings.xml']).getChildren('si',main).forEach(si=>shared.push(allText(si)));
 const rela=new Map(parse(xml['xl/_rels/workbook.xml.rels']).getChildren('Relationship',pkg).map(r=>[r.getAttribute('Id').getValue(),r.getAttribute('Target').getValue()]));
 const wb=parse(xml['xl/workbook.xml']),sheets=wb.getChild('sheets',main).getChildren('sheet',main);const result={};
 sheets.forEach(sheet=>{
  const name=sheet.getAttribute('name').getValue(),rid=sheet.getAttribute('id',relationships)?.getValue();
  const target=rela.get(rid)||'',path=target.replace(/^\//,'').startsWith('xl/')?target.replace(/^\//,''):'xl/'+target.replace(/^\//,'');if(!xml[path])return;
  const root=parse(xml[path]),sd=root.getChild('sheetData',main);if(!sd)return;
  const data=[],forms=[];let maxCol=0;
  sd.getChildren('row',main).forEach(rr=>{
   const ri=Number(rr.getAttribute('r')?.getValue()||'1')-1;if(ri<0||ri>26000)throw new Error(name+': Excel has too many rows (max 25,000).');
   if(!data[ri])data[ri]=[];if(!forms[ri])forms[ri]=[];
   rr.getChildren('c',main).forEach(cell=>{
    const addr=cell.getAttribute('r')?.getValue()||'A1';const col=String(addr.match(/^[A-Z]+/)?.[0]||'A').split('').reduce((n,l)=>n*26+l.charCodeAt(0)-64,0)-1;
    if(col<0||col>250)throw new Error(name+': Excel has more than 251 columns.');maxCol=Math.max(maxCol,col+1);
    const type=cell.getAttribute('t')?.getValue()||'',formula=cell.getChild('f',main);
    if(formula)forms[ri][col]='='+formula.getText();
    const value=cell.getChild('v',main)?.getText()||'';
    if(type==='inlineStr')data[ri][col]=allText(cell.getChild('is',main));
    else if(type==='s')data[ri][col]=shared[Number(value)]??'';
    else data[ri][col]=value;
   });
  });
  const maxRow=data.length;if(maxRow*maxCol>700000)throw new Error(name+': Excel has too many cells.');
  const headers=data[0]||[];
  data.forEach((row,i)=>{if(!row)data[i]=[];if(i>0)row?.forEach((v,c)=>{
   const h=String(headers[c]||'');if(/(?:Date|CreatedAt|PromiseDate|UpdatedAt)$/i.test(h)&&/^\d{5}(?:\.\d+)?$/.test(String(v||''))){
    const d=new Date(Date.UTC(1899,11,30)+Math.floor(Number(v))*86400000);data[i][c]=Utilities.formatDate(d,'UTC','yyyy-MM-dd');
   }
  });});
  function range(r,c,h,w){const get=(arr)=>Array.from({length:h},(_,i)=>Array.from({length:w},(_,j)=>String(arr[r+i-1]?.[c+j-1]??'')));
    return {getValues:()=>get(data),getDisplayValues:()=>get(data),getFormulas:()=>get(forms)};}
  result[name]={getLastRow:()=>maxRow,getLastColumn:()=>maxCol,getDataRange:()=>range(1,1,maxRow,maxCol),getRange:range};
 });
 return {getSheetByName:name=>result[name]||null};
}
function r4ImportRead_(ss,fmt){
 const sh=ss.getSheetByName(fmt.sheet);
 if(!sh)return {errors:[{cell:'File',message:'Expected worksheet "'+fmt.sheet+'". Download the matching format and do not rename its tab.'}],rows:[]};
 const expected=fmt.fields.concat('RowVersion');const width=sh.getLastColumn();
 const head=sh.getRange(1,1,1,Math.max(1,width)).getDisplayValues()[0].map(v=>v.trim());
 const errors=[];
 expected.forEach((name,i)=>{if(head[i]!==name)errors.push({cell:fmt.sheet+'!'+r4ExcelCol_(i+1)+'1',message:'Expected heading "'+name+'"; found "'+(head[i]||'(blank)')+'".'});});
 if(head.length>expected.length&&head.slice(expected.length).some(Boolean))errors.push({cell:fmt.sheet+'!'+r4ExcelCol_(expected.length+1)+'1',message:'Unexpected extra columns. Use the downloaded format.'});
 if(errors.length)return {errors,rows:[]};
 if(sh.getLastRow()-1>R4_MAX_ROWS)return {errors:[{cell:'File',message:'Maximum '+R4_MAX_ROWS+' data rows per import. Split the workbook.'}],rows:[]};
 if(sh.getLastRow()<2)return {errors:[],rows:[]};
 const dataRange=sh.getRange(2,1,sh.getLastRow()-1,expected.length);
 const formulas=dataRange.getFormulas();
 formulas.forEach((r,i)=>r.forEach((formula,j)=>{if(formula&&errors.length<60)errors.push({cell:fmt.sheet+'!'+r4ExcelCol_(j+1)+(i+2),message:'Formula cells are not accepted. Paste values only.'});}));
 if(errors.length)return {errors,rows:[]};
 const raw=dataRange.getValues();
 return {errors:[],rows:raw.map((r,index)=>({line:index+2,value:Object.fromEntries(expected.map((k,i)=>[k,r4Text_(r[i])]))})).filter(r=>expected.some(k=>r.value[k]!==''))};
}
function r4CheckDay_(value){return /^\d{4}-\d{2}-\d{2}$/.test(value)&&!!parseDate_(value)&&dateStr_(parseDate_(value))===value;}
function r4Errors_(fmt,parsed){
 const errs=[];const push=(line,field,message)=>{if(errs.length<250)errs.push({cell:r4ExcelCell_(fmt,field,line),message});};
 const raw=rows_(fmt.table), allIds=new Set(raw.map(r=>r4Text_(r[fmt.key])));
 const existing=new Map(raw.filter(r=>truthy_(r.Active)).map(r=>[r4Text_(r[fmt.key]),r]));
 const usedIds=new Set(),changes=[],fresh=[];
 for(const item of parsed){
  const {line,value:v}=item;const id=v[fmt.key],orig=id?existing.get(id):null;
  if(id&&!orig){push(line,fmt.key,allIds.has(id)?'This ID refers to an archived row. It cannot be imported.':'Unknown ID '+id+'. Keep the original ID to update, or leave it blank to add.');continue;}
  if(id&&usedIds.has(id)){push(line,fmt.key,'Same record ID repeated in the uploaded file.');continue;}
  if(id)usedIds.add(id);
  if(orig && v.RowVersion!==r4Version_(orig,fmt.fields)){push(line,fmt.key,'This record has changed since download, or RowVersion was edited. Download a fresh format.');continue;}
  if(!orig && v.RowVersion){push(line,fmt.key,'New rows must have a blank RowVersion.');continue;}
  const data={};fmt.fields.forEach(k=>data[k]=v[k]);
  // Guard spreadsheet formula injection and invalid control values before database writes.
  for(const field of fmt.fields){
   const cellValue=data[field];if(/^[\s]*=/.test(cellValue))push(line,field,'Excel formulas are not allowed in import data. Enter a literal value.');
   if(cellValue.length>12000)push(line,field,'Cell text is too long (maximum 12,000 characters).');
  }
  const required={products:['EquipmentName','ProductType','Model'],workorders:['WorkOrderNumber','WorkOrderType'],stockin:['EntryType','Location','ProductID','Qty','PurchaseDate'],stockout:['Location','WorkOrderNumber','SerialNumbers','DispatchDate','DispatchMode'],linkage:['WorkOrderNumber','ProductID','PlannedQty']};
  required[Object.keys(R4_FORMATS).find(k=>R4_FORMATS[k]===fmt)].forEach(k=>{if(!data[k])push(line,k,k+' is required.');});
  const dates=fmt.table==='Products'?['CreatedAt']:fmt.table==='WorkOrders'?['CreationDate','PromiseDate']:fmt.table==='StockIn'?['PurchaseDate']:fmt.table==='StockOut'?['DispatchDate']:[];
  dates.forEach(k=>{if(data[k]&&!r4CheckDay_(data[k]))push(line,k,'Use a valid YYYY-MM-DD date.');});
  const quantities={Products:['DefaultUnitCost'],WorkOrders:[],StockIn:['Qty','UnitCost'],StockOut:[],WorkOrderLines:['PlannedQty','UnitPrice']};
  (quantities[fmt.table]||[]).forEach(k=>{const n=Number(data[k]||0);if(data[k] && (!Number.isFinite(n)||n<0||(k==='Qty'||k==='PlannedQty')&&(!Number.isInteger(n)||n<1)))push(line,k,'Enter a valid '+((k==='Qty'||k==='PlannedQty')?'positive whole number':'non-negative number')+'.');});
  if(fmt.table==='Products')data.Model=clean_(data.Model).replace(/\s+/g,'');
  if(fmt.table==='Products'&&!APP.productTypes.includes(data.ProductType))push(line,'ProductType','Category must be STD, Spare or Other.');
  if(fmt.table==='WorkOrders'&&!APP.workOrderTypes.includes(data.WorkOrderType))push(line,'WorkOrderType','Type must be Project, Retail or Other.');
  if(fmt.table==='StockIn'){
   if(!APP.entryTypes.includes(data.EntryType))push(line,'EntryType','Entry type must be Bought Out or Fabrication.');
   if(!APP.locations.includes(canonicalLocation_(data.Location)))push(line,'Location','Choose one of the three configured warehouses/showroom.');
   data.Location=canonicalLocation_(data.Location);
  }
  if(fmt.table==='StockOut'){
   if(!APP.locations.includes(canonicalLocation_(data.Location)))push(line,'Location','Choose one of the three configured warehouses/showroom.');
   data.Location=canonicalLocation_(data.Location);
   if(!['Partial','Complete'].includes(data.DispatchMode))push(line,'DispatchMode','Dispatch mode must be Partial or Complete.');
  }
  if(['StockIn','StockOut'].includes(fmt.table)){
   const serials=splitSerials_(data.SerialNumbers),unique=new Set(serials.map(norm_));
   if(unique.size!==serials.length)push(line,'SerialNumbers','Duplicate serials within the same row.');
   if(fmt.table==='StockIn'&&serials.length>Number(data.Qty||0))push(line,'SerialNumbers',serials.length+' serials exceed quantity '+data.Qty+'.');
   data.SerialNumbers=serials.join(', ');
  }
  // Imports may update only safe master attributes. Foreign keys and stock history remain immutable.
  if(fmt.table==='Products'){
   if(orig&&fmt.fields.some(k=>r4Text_(orig[k])!==r4Text_(data[k]))){try{c2CheckProductWO_(id);}catch(error){push(line,'ProductID',String(error.message||error));}} // Unchanged historical records stay valid in a full live export.
   if(!data.MakeBrand)push(line,'MakeBrand','Brand is required to identify a Product Master model.');
   const linked=!!orig&&(rows_('WorkOrderLines').some(x=>truthy_(x.Active)&&String(x.ProductID)===id)||
       allStockInRows_().some(x=>truthy_(x.Active)&&String(x.ProductID)===id));
   if(linked)for(const field of ['EquipmentName','ProductType','MakeBrand','Model','CreatedAt']){
    if(r4Text_(orig[field])!==r4Text_(data[field]))push(line,field,'This product is already linked to a Work Order or Stock In receipt. Changing its identity/history would break existing references; leave this cell unchanged.');
   }
  }
  if(fmt.table==='StockOut'){
   if(orig&&r4Text_(orig.DispatchDate)!==r4Text_(data.DispatchDate)){try{c2CheckWO_(orig.WorkOrderNumber);}catch(error){push(line,'DispatchDate',String(error.message||error));}}
   if(!orig)push(line,fmt.key,'New dispatches must be created through Stock Out after inventory/serial validation. Excel only supports safe corrections to existing Dispatch Date.');
   else for(const field of fmt.fields.filter(k=>!['DispatchDate'].includes(k))){
    if(r4Text_(orig[field])!==r4Text_(data[field]))push(line,field,'This is a protected dispatch field. Only Dispatch Date can be corrected by report; use Stock Out reversal/edit flow for serial, location, mode or Work Order changes.');
   }
  }
  if(orig){changes.push({line,data,id,orig});}else {
   if(fmt.table==='Products'){
    // Primary stable ID is Brand + Model, with Product Name fallback. Reserve across this import batch.
    const slug=x=>String(x||'').trim().toUpperCase().replace(/[^A-Z0-9]+/g,'-').replace(/^-|-$/g,'');
    const base=slug(data.MakeBrand)+'-'+slug(data.Model),fallback=base+'-'+slug(data.EquipmentName);
    const allTaken=new Set(raw.map(r=>norm_(r.ProductID)).concat(fresh.map(x=>norm_(x.id))));
    const next=!allTaken.has(norm_(base))?base:!allTaken.has(norm_(fallback))?fallback:null;
    if(!next||!base||base==='-')push(line,'ProductID','Brand + Model (+ Product Name) is not unique. Correct the model/name or use the Product Master form.');
    data[fmt.key]=next||id_('PRD');
   } else data[fmt.key]=id_(({WorkOrders:'WO',StockIn:'SIN',StockOut:'SOUT',WorkOrderLines:'WOL'})[fmt.table]);
   fresh.push({line,data,id:data[fmt.key]});
  }
 }
 return {errs,changes,fresh,raw};
}
function r4CrossValidate_(fmt,prep){
 const errors=prep.errs,push=(line,field,message)=>{if(errors.length<250)errors.push({cell:r4ExcelCell_(fmt,field,line),message});};
 const newRows=prep.changes.concat(prep.fresh);
 const actual=rows_(fmt.table).filter(r=>truthy_(r.Active));
 const byId=new Map(actual.map(r=>[String(r[fmt.key]),r]));
 newRows.forEach(x=>{byId.set(x.id,Object.assign({},byId.get(x.id)||{},x.data,{Active:true}));});
 const all=[...byId.values()];
 const productRows=fmt.table==='Products'?all:rows_('Products').filter(r=>truthy_(r.Active));
 const woRows=fmt.table==='WorkOrders'?all:rows_('WorkOrders').filter(r=>truthy_(r.Active));
 const inRows=fmt.table==='StockIn'?all.concat(rows_('FabricationStockIn').filter(r=>truthy_(r.Active))):allStockInRows_().filter(r=>truthy_(r.Active));
 const outRows=fmt.table==='StockOut'?all:rows_('StockOut').filter(r=>truthy_(r.Active));
 const pMap=new Map(productRows.map(r=>[String(r.ProductID),r]));rows_('FabricationProducts').filter(r=>truthy_(r.Active)).forEach(r=>pMap.set(String(r.FabricationID),{...r,ProductID:r.FabricationID,ProductType:r.ProductType||'Other'}));const woLines=f7TypedLines_();const woSet=new Set(woRows.map(r=>r4Text_(r.WorkOrderNumber)));
 function duplicates(rowset,keyFn,field){const seen=new Map();for(const x of rowset){const k=keyFn(x);if(!k)continue;if(seen.has(k)){const target=newRows.find(r=>r.id===r4Text_(x[fmt.key])||r.id===r4Text_(seen.get(k)[fmt.key]));if(target)push(target.line,field,'Duplicate value "'+k+'" (also exists in another active record).');}else seen.set(k,x);}}
 if(fmt.table==='Products')duplicates(all,r=>f10cModelKey_(r.Model),'Model');
 if(fmt.table==='WorkOrders')duplicates(all,r=>norm_(r.WorkOrderNumber),'WorkOrderNumber');
 if(fmt.table==='WorkOrders')prep.fresh.forEach(x=>push(x.line,'WorkOrderNumber','Create Work Orders in Work Order Studio so version history and item validations are preserved.'));
 if(fmt.table==='WorkOrderLines'){
  newRows.forEach(x=>{const r=x.data;if(!woSet.has(r.WorkOrderNumber))push(x.line,'WorkOrderNumber','Work order "'+r.WorkOrderNumber+'" does not exist or is inactive.');if(!pMap.has(r.ProductID))push(x.line,'ProductID','Product "'+r.ProductID+'" is not available in Product Master.');});
 }
 if(fmt.table==='StockIn'){
  const quantities=new Map();inRows.forEach(r=>{const id=clean_(r.WorkOrderLineID);if(id)quantities.set(id,(quantities.get(id)||0)+Number(r.Qty||0));});
  newRows.forEach(x=>{const id=clean_(x.data.WorkOrderLineID),line=woLines.find(l=>String(l.LineID)===id);
    if(line&&(quantities.get(id)||0)>Number(line.PlannedQty||0))push(x.line,'Qty','Received '+quantities.get(id)+' exceeds Work Order planned '+line.PlannedQty+' for this LineID.');
  });
 }
 const inIdMap=new Map(inRows.map(r=>[String(r.StockInID),r]));
 // Every resulting receipt and dispatch reference must remain valid after proposed edits.
 for(const x of newRows){
  const r=x.data;
  if(fmt.table==='StockIn'){
   if(!pMap.has(r.ProductID))push(x.line,'ProductID','Product '+r.ProductID+' does not exist in active Product Master.');
   else if(norm_(r.ProductType)!==norm_(pMap.get(r.ProductID).ProductType))push(x.line,'ProductType','Product category differs from Product Master.');
   if(r.WorkOrderNumber&&!woSet.has(r.WorkOrderNumber))push(x.line,'WorkOrderNumber','Work order '+r.WorkOrderNumber+' does not exist or is inactive.');
   const line=woLines.find(l=>String(l.LineID)===String(r.WorkOrderLineID||''));
   const isOldUnlinked=!!x.orig&&!clean_(x.orig.WorkOrderLineID);
   if(!r.WorkOrderNumber&&!x.orig)push(x.line,'WorkOrderNumber','New receipts require a Work Order.');
   if(!line&&!isOldUnlinked)push(x.line,'WorkOrderLineID','Work Order LineID is missing/invalid. Copy it from Work Order Flow report.');
   if(line&&(String(line.WorkOrderNumber)!==String(r.WorkOrderNumber)||String(line.ProductID)!==String(r.ProductID)||String(line._f7Type)!==String(r.EntryType)))push(x.line,'WorkOrderLineID','This LineID must match the Work Order, ProductID and material type.');
   if(isOldUnlinked&&(String(x.orig.WorkOrderNumber)!==String(r.WorkOrderNumber)||String(x.orig.ProductID)!==String(r.ProductID)))push(x.line,'WorkOrderLineID','Legacy receipt has no LineID. Do not reassign its Work Order/product by Excel.');
   const serials=splitSerials_(r.SerialNumbers);if(serials.length&&serials.length!==Number(r.Qty||0))push(x.line,'SerialNumbers','Serial count '+serials.length+' must equal Qty '+r.Qty+', or be blank for bulk items.');
   if(pMap.has(r.ProductID)&&norm_(r.EquipmentName)!==norm_(pMap.get(r.ProductID).EquipmentName))push(x.line,'EquipmentName','Equipment name must match Product Master for this ProductID.');
  }
  if(fmt.table==='StockOut'&&!woSet.has(r.WorkOrderNumber))push(x.line,'WorkOrderNumber','Work order '+r.WorkOrderNumber+' does not exist or is inactive.');
  if(fmt.table==='StockOut'&&inRows.some(receipt=>clean_(receipt.WorkOrderNumber)===clean_(r.WorkOrderNumber)&&canonicalLocation_(receipt.Location)===canonicalLocation_(r.Location)&&f10c1ReceiptIssue_(receipt)))push(x.line,'SerialNumbers','Correct inconsistent receipt quantity / serial count before dispatching this Work Order at this location.');
 }
 if(['Products','WorkOrders','StockIn','StockOut'].includes(fmt.table)){
  const serials=new Map();
  const oldReceipts=allStockInRows_().filter(r=>truthy_(r.Active));
  const oldSerialOwners=new Map();
  oldReceipts.forEach(r=>{const list=splitSerials_(r.SerialNumbers),qty=Number(r.Qty||0);list.concat(Array.from({length:Math.max(0,qty-list.length)},(_,i)=>'NS-'+r.StockInID+'-'+(i+1))).forEach(serial=>oldSerialOwners.set(norm_(serial),String(r.StockInID)));});
  inRows.forEach(r=>{
   const id=String(r.StockInID);const list=splitSerials_(r.SerialNumbers),qty=Number(r.Qty||0);
   const available=list.length||f10c1ReceiptIssue_(r)?list:list.concat(Array.from({length:qty},(_,i)=>'NS-'+id+'-'+(i+1)));
   available.forEach(serial=>{
    const key=norm_(serial);if(serials.has(key)){
     const target=newRows.find(x=>x.id===id||x.id===serials.get(key).id);
     if(target)push(target.line,'SerialNumbers','Duplicate serial "'+serial+'" exists in Stock In '+serials.get(key).id+'.');
    }else serials.set(key,{id,location:canonicalLocation_(r.Location),workOrderNumber:r4Text_(r.WorkOrderNumber),serial});
   });
  });
  const dispatched=new Map();
  outRows.forEach(r=>splitSerials_(r.SerialNumbers).forEach(serial=>{
   const key=norm_(serial),unit=serials.get(key);
   const target=newRows.find(x=>x.id===String(r.StockOutID)||x.id===(unit&&unit.id)||x.id===oldSerialOwners.get(key));
   if(dispatched.has(key)){
    if(target)push(target.line,fmt.table==='StockOut'?'SerialNumbers':'SerialNumbers','Serial '+serial+' is dispatched by multiple Stock Out entries.');
   }else dispatched.set(key,String(r.StockOutID));
   if(!unit){if(target)push(target.line,'SerialNumbers','Serial '+serial+' is missing from available/recorded Stock In.');}
   else if(unit.location!==canonicalLocation_(r.Location)||unit.workOrderNumber!==r4Text_(r.WorkOrderNumber)){
    if(target)push(target.line,fmt.table==='StockOut'?'SerialNumbers':'Location','Dispatched serial '+serial+' must keep its original location and linked work order. Reverse that dispatch first.');
   }
  }));
  // Validate every new/update receipt reference when changing products or work order numbering.
  if(fmt.table==='WorkOrders'){
   newRows.forEach(x=>{const old=x.orig;if(old&&r4Text_(old.WorkOrderNumber)!==x.data.WorkOrderNumber){
    const linked=inRows.some(r=>r4Text_(r.WorkOrderNumber)===r4Text_(old.WorkOrderNumber))||outRows.some(r=>r4Text_(r.WorkOrderNumber)===r4Text_(old.WorkOrderNumber))||rows_('WorkOrderLines').some(r=>truthy_(r.Active)&&r4Text_(r.WorkOrderNumber)===r4Text_(old.WorkOrderNumber));
    if(linked)push(x.line,'WorkOrderNumber','Cannot rename a work order with stock history. Keep its number or correct linked records safely first.');
   }});
  }
 }
 return errors;
}
function r4StoreChanges_(fmt,prep){
  if(!['Products','StockOut'].includes(fmt.table))throw new Error('Bulk updates of this operational ledger are disabled. Use its dedicated secured app workflow.');
 const linkedProducts=fmt.table==='WorkOrderLines'?new Map(rows_('Products').filter(r=>truthy_(r.Active)).map(r=>[String(r.ProductID),r])):new Map();
 const sh=ss_().getSheetByName(fmt.table),matrix=sh.getDataRange().getValues(),header=matrix[0].map(String);
 for(const col of APP.sheets[fmt.table])if(!header.includes(col))throw new Error('Sheet '+fmt.table+' is missing column '+col+'. Run setup.');
 const keyCol=header.indexOf(fmt.key);
 const indices=new Map();matrix.slice(1).forEach((row,i)=>indices.set(String(row[keyCol]),i+1));
 let changed=0;const additions=[],rollbackRows=[],initialRows=sh.getLastRow();
 try{
 prep.changes.forEach(x=>{
  const index=indices.get(x.id);
  if(index==null)throw new Error('Record disappeared during import: '+x.id);
  const original=matrix[index];const prior=original.slice();
  let modified=false;const changedFields=[];
  fmt.fields.forEach(f=>{const col=header.indexOf(f);const input=x.data[f];let value=input;
   if(['Qty','UnitCost','DefaultUnitCost','PlannedQty','UnitPrice'].includes(f))value=Number(input||0);
   if(r4Text_(original[col])!==r4Text_(value)){modified=true;changedFields.push(f);original[col]=value;}
  });
  if(fmt.table==='WorkOrderLines' && linkedProducts.has(x.data.ProductID)){
   const pr=linkedProducts.get(x.data.ProductID);
   [['EquipmentName',pr.EquipmentName],['Model',pr.Model]].forEach(([field,value])=>{
    const col=header.indexOf(field);
    if(col>=0&&r4Text_(original[col])!==r4Text_(value)){original[col]=value;modified=true;}
   });
  }
  if(modified){rollbackRows.push({index:index+1,before:prior});if(fmt.table==='Products'){const view=Object.fromEntries(header.map((h,i)=>[h,original[i]]));if(header.includes('DisplayID'))original[header.indexOf('DisplayID')]=f10ReadableId_('Products',view);}if(header.includes('LastChange'))original[header.indexOf('LastChange')]='Report Excel import: '+changedFields.join(', ').slice(0,150);if(header.includes('LastEditedBy')){original[header.indexOf('LastEditedBy')]=f6Actor_();original[header.indexOf('LastEditedAt')]=new Date();}sh.getRange(index+1,1,1,header.length).setValues([original]);changed++;}
 });
 prep.fresh.forEach(x=>{
  const row=Object.assign({},x.data,{Active:true});
  if(fmt.table==='Products')row.CreatedAt=row.CreatedAt||today_();
  else if(fmt.table==='WorkOrders')row.CreatedAt=new Date();
  else if(fmt.table==='StockIn'||fmt.table==='StockOut'||fmt.table==='WorkOrderLines')row.CreatedAt=new Date();
  if(fmt.table==='WorkOrders')row.Status=row.Status||'Open';
  if(fmt.table==='WorkOrderLines' && linkedProducts.has(row.ProductID)){
   const pr=linkedProducts.get(row.ProductID);row.EquipmentName=pr.EquipmentName;row.Model=pr.Model;
  }
  ['Qty','UnitCost','DefaultUnitCost','PlannedQty','UnitPrice'].forEach(f=>{if(f in row)row[f]=Number(row[f]||0);});
  if(header.includes('LastEditedBy')){row.LastEditedBy=f6Actor_();row.LastEditedAt=new Date();}if(header.includes('DisplayID'))row.DisplayID=f10ReadableId_(fmt.table,row);if(header.includes('LastChange'))row.LastChange='Excel import';
  additions.push(header.map(h=>row[h]===undefined?'':row[h]));
 });
 if(additions.length){const start=sh.getLastRow()+1,needed=start+additions.length-1;if(needed>sh.getMaxRows())sh.insertRowsAfter(sh.getMaxRows(),needed-sh.getMaxRows());sh.getRange(start,1,additions.length,header.length).setValues(additions);}
 SpreadsheetApp.flush();return {added:prep.fresh.length,updated:changed,unchanged:prep.changes.length-changed};
 }catch(error){
  // Best-effort compensating rollback. Sheets has no multi-range ACID transactions.
  let rollbackError='';try{
   for(let j=rollbackRows.length-1;j>=0;j--){const r=rollbackRows[j];sh.getRange(r.index,1,1,header.length).setValues([r.before]);}
   const extra=sh.getLastRow()-initialRows;
   if(extra>0)sh.deleteRows(initialRows+1,extra);
   SpreadsheetApp.flush();f7InvalidateRows_(fmt.table);
  }catch(restore){rollbackError=restore.message||String(restore);}
  throw new Error('Import was interrupted. '+(rollbackError?'AUTOMATIC RESTORE FAILED: '+rollbackError+'. Restore from your backup immediately.':'Previous rows were restored where possible.')+' Cause: '+(error.message||error));
 }
}
function importDataTemplate_(key,filename,base64,apply){
 if(!['products','stockout'].includes(key))throw new Error('This report is download-only. Edit Product Master or the safe Dispatch Date correction template, not generated analytical reports.');
 const fmt=r4Format_(key),ss=r4ConvertXlsx_(filename,base64);
 try{
  const parsed=r4ImportRead_(ss,fmt);
  if(parsed.errors.length)return {ok:false,errors:parsed.errors};
  if(!parsed.rows.length)return {ok:false,errors:[{cell:fmt.sheet+'!A2',message:'No data rows found. Add or edit a row before uploading.'}]};
  return withLock_(()=>{
   // Re-uploading an already-applied workbook must not duplicate newly added
   // receipts without supplier serial numbers. Keep recent per-format digests.
   const digest=authHash_(JSON.stringify(parsed.rows.map(row=>row.value)));
   const keyName='R4_IMPORT_HISTORY_'+key;
   const props=PropertiesService.getScriptProperties();
   let prior=[];try{prior=JSON.parse(props.getProperty(keyName)||'[]');}catch(e){}
   if(prior.includes(digest))return {ok:false,errors:[{cell:'File',message:'This exact workbook data was imported already. Download a fresh format before submitting further changes.'}],checked:parsed.rows.length};
   const prep=r4Errors_(fmt,parsed.rows);
   r4CrossValidate_(fmt,prep);
   if(prep.errs.length)return {ok:false,errors:prep.errs,checked:parsed.rows.length};
   if(!apply)return {ok:true,dryRun:true,checked:parsed.rows.length,updated:prep.changes.length,added:prep.fresh.length,unchanged:0};
   const done=r4StoreChanges_(fmt,prep);
   try{props.setProperty(keyName,JSON.stringify([digest,...prior].slice(0,20)));}
   catch(e){console.error('Could not store import deduplication history: '+e.message);}
   audit_('BULK_IMPORT',fmt.table,fmt.sheet,{rows:parsed.rows.length,added:done.added,updated:done.updated,uploadedFile:filename});
   return Object.assign({ok:true,dryRun:false,checked:parsed.rows.length,message:'Bulk import saved. '+done.updated+' updated, '+done.added+' added.'},done);
  });
 }finally{ /* Browser data is parsed in memory; no temporary Drive document exists. */ }
}


