/**
 * FINAL 10 C2 — Live Excel Report Catalog (Final 8-compatible transport).
 *
 * Source of truth: the bound Google Sheet. This module never writes stock,
 * products, pricing or work-order rows. The caller must authenticate and check
 * Report + report-specific access BEFORE invoking f10BuildInventoryReport_.
 *
 * A report-specific financial grant is NOT enough for cost information:
 * Pricing and Management Pricing access are required as well. Every operational
 * export is further restricted by Bought Out / Fabrication route permissions.
 */
const F10_REPORT_KEYS_={
 'serial-detail':'Inventory Serial Detail','aging-analysis':'Aging Analysis',
 'warehouse-stock':'Warehouse Stock','free-stock':'Free Stock',
 'workorder-inventory':'Work Order Inventory','dispatch-history':'Dispatch History',
 'product-movement':'Product Movement','purchase-analysis':'Purchase Analysis',
 'margin-analysis':'Margin Analysis',products:'Product Master',stockin:'Stock In',
 stockout:'Stock Out',flow:'Work Order Flow'
};
const F10_FINANCIAL_REPORTS_=new Set(['purchase-analysis','margin-analysis']);
function f10ReportAccess_(user,key,mode){
 const label=F10_REPORT_KEYS_[key];if(!label)throw new Error('Unknown report category: '+key);
 if(F10_FINANCIAL_REPORTS_.has(key)){
  f6Access_(user,'Management Pricing Dashboard','View');f6Access_(user,'Pricing','View');
  f10aRouteAccess_(user,'Bought Out','View');f10aRouteAccess_(user,'Fabrication','View');
 }
 const grant=f10aPagePermission_(user,'Report: '+label);
 if(grant!=='Edit'&&(mode==='Edit'||grant!=='View'))
  throw new Error('ACCESS_DENIED: '+label+' report access not granted in UserAccessMatrix.');
 return true;
}
function f10SeedReportPermissions_(){return {retired:true,permissionsSheet:'UserAccessMatrix'};}

/** Whitelisted, bounded filters. Text is a CASE-INSENSITIVE substring search. */
function f10ReportFilters_(input){
 if(!input||typeof input!=='object'||Array.isArray(input))return {workOrder:'',product:'',location:'',from:'',to:''};
 const names=['workOrder','product','location','from','to'];
 for(const key of Object.keys(input))if(!names.includes(key))throw new Error('Unrecognized report filter: '+key);
 const f={};names.forEach(k=>{if(input[k]&&typeof input[k]!=='string')throw new Error('Invalid report '+k+' filter.');f[k]=String(input[k]||'').trim();if(f[k].length>100)throw new Error('Report filters can be at most 100 characters.');});
 ['from','to'].forEach(k=>{
  if(!f[k])return;
  if(!/^\d{4}-\d{2}-\d{2}$/.test(f[k]))throw new Error('Report dates must use YYYY-MM-DD.');
  const [y,m,d]=f[k].split('-').map(Number),actual=new Date(Date.UTC(y,m-1,d));
  if(actual.getUTCFullYear()!==y||actual.getUTCMonth()+1!==m||actual.getUTCDate()!==d)
   throw new Error('Invalid '+k+' date. Choose a valid calendar date.');
 });
 if(f.from&&f.to&&f.from>f.to)throw new Error('From date cannot be after To date.');
 return f;
}
function f10ReportMatch_(r,f,date,productText){
 const contains=(text,q)=>!q||String(text==null?'':text).toLowerCase().includes(q.toLowerCase());
 return contains(r.workOrderNumber||r.WorkOrderNumber||'',f.workOrder)&&
  contains(productText===undefined?[r.equipmentName||r.EquipmentName,r.model||r.Model,r.serial||r.SerialNumbers].join(' '):productText,f.product)&&
  contains(r.location||r.Location||'',f.location)&&
  (!f.from||(date&&date>=f.from))&&(!f.to||(date&&date<=f.to));
}
/** Source-specific builders below never return privileged financial fields by accident. */
function f10BuildInventoryReport_(key,rawFilters){
 if(!F10_REPORT_KEYS_[key]||key==='products'||key==='stockin'||key==='stockout'||key==='flow')throw new Error('This report must be downloaded from its own secure source template endpoint.');
 const user=f6Actor_(),financial=F10_FINANCIAL_REPORTS_.has(key),f=f10ReportFilters_(rawFilters);
 if(financial&&f.location)throw new Error('Location filtering is not available for financial line reports. Clear Location and download again.');
 const book=r4NewWorkbook_('Janshakti Report');
 const stamp=v=>v?dateStr_(v):'';
 const safe=v=>String(v==null?'':v);
 const status=new Map(rows_('WorkOrders').filter(r=>truthy_(r.Active)).map(r=>[safe(r.WorkOrderNumber).toLowerCase(),safe(r.Status||'Open')]));
 const getStatus=wo=>!wo?'Free':status.get(safe(wo).toLowerCase())||'Open';
 let lineCount=0,units=[],reportBasis='Live on-hand inventory';
 const serialHeaders=['Serial / Internal ID','Location','Work Order','WO Status','Allocation','Equipment','Product Type','Brand','Model','Size','Stock In Date','Age Days','Stock In ID'];
 const serialRows=items=>items.map(r=>[r.serial,r.location,r.workOrderNumber||'',getStatus(r.workOrderNumber),r.allocation,r.equipmentName,r.productType,r.brand,r.model,r.size,r.purchaseDate,r.ageDays,r.stockInId]);
 if(!financial&&key!=='dispatch-history'&&key!=='product-movement'){
  // Only ONE inventory snapshot is read; stock book does not include dispatched units.
  units=f10aFilterStock_(getStockBook_(),user).filter(u=>f10ReportMatch_(u,f,stamp(u.purchaseDate)));
  lineCount=units.length;
 }
 if(key==='serial-detail')r4WriteTab_(book,'Serial Detail',serialHeaders,serialRows(units));
 if(key==='free-stock'){
  const free=units.filter(u=>!u.workOrderNumber);
  r4WriteTab_(book,'Free Stock',serialHeaders,serialRows(free));lineCount=free.length;
 }
 if(key==='aging-analysis'){
  const buckets=[['0-30 days',0,30],['31-60 days',31,60],['61-90 days',61,90],['91-180 days',91,180],['181+ days',181,Infinity]];
  r4WriteTab_(book,'Aging Analysis',['Age Bucket','Free Units','Engaged Units','Total Units'],buckets.map(([name,min,max])=>{const x=units.filter(u=>Number(u.ageDays)>=min&&Number(u.ageDays)<=max);return [name,x.filter(u=>!u.workOrderNumber).length,x.filter(u=>u.workOrderNumber).length,x.length];}));
  r4WriteTab_(book,'Aging Serial Detail',serialHeaders,serialRows(units));
 }
 if(key==='warehouse-stock'){
  const by=new Map();units.forEach(u=>{const name=safe(u.location)||'Unknown',x=by.get(name)||{free:0,engaged:0,oldest:0};x[u.workOrderNumber?'engaged':'free']++;x.oldest=Math.max(x.oldest,Number(u.ageDays)||0);by.set(name,x);});
  r4WriteTab_(book,'Warehouse Summary',['Location','Free','Engaged','Total On Hand','Oldest Days'],[...by].map(([name,v])=>[name,v.free,v.engaged,v.free+v.engaged,v.oldest]));
  r4WriteTab_(book,'Warehouse Serial Detail',serialHeaders,serialRows(units));
 }
 if(key==='workorder-inventory'){
  const by=new Map();units.forEach(u=>{const name=safe(u.workOrderNumber)||'Without Work Order',x=by.get(name)||{qty:0,locations:new Set(),oldest:0};x.qty++;x.locations.add(safe(u.location));x.oldest=Math.max(x.oldest,Number(u.ageDays)||0);by.set(name,x);});
  r4WriteTab_(book,'Work Order Inventory',['Work Order','Status','On Hand Units','Locations','Oldest Days'],[...by].map(([name,v])=>[name,getStatus(name),v.qty,[...v.locations].join(', '),v.oldest]));
  r4WriteTab_(book,'Work Order Serials',serialHeaders,serialRows(units));
 }
 if(key==='dispatch-history'){
  // This report reads recorded dispatches, not current stock book; dispatched units must appear.
  const all=f10aFilterDispatchHistory_(rows_('StockOut').filter(r=>truthy_(r.Active)),user);
  // Product/model searches in Dispatch History resolve the serial against its original
  // receipt; this remains read-only and does not expose receipt purchase costs.
  const serialMeta=f.product?new Map(inventoryUnits_().map(u=>[norm_(u.serial),[u.equipmentName,u.model,u.serial].join(' ')])):null;
  const sent=all.filter(r=>f10ReportMatch_(r,f,stamp(r.DispatchDate),
   serialMeta?splitSerials_(r.SerialNumbers).map(sn=>serialMeta.get(norm_(sn))||sn).join(' '):r.SerialNumbers));
  r4WriteTab_(book,'Dispatch History',['Dispatch ID','Dispatch Date','Work Order','WO Status','Location','Mode','Serial Numbers','Serial Count'],sent.map(r=>[r.StockOutID,stamp(r.DispatchDate),r.WorkOrderNumber,getStatus(r.WorkOrderNumber),r.Location,r.DispatchMode,r.SerialNumbers,splitSerials_(r.SerialNumbers).length]));
  lineCount=sent.length;reportBasis='All active recorded dispatches';
 }
 if(key==='product-movement'){
  // One ledger expansion covers both available and dispatched units; receipt date is the filter date.
  const routeByReceipt=f10aReceiptTypeMap_();const visible=inventoryUnits_().filter(u=>f10aRouteAllowed_(user,routeByReceipt.get(safe(u.stockInId))||'Bought Out','View'));
  const by=new Map();visible.filter(u=>f10ReportMatch_(u,f,stamp(u.purchaseDate))).forEach(u=>{
   const id=safe(u.productId),name=id+'|'+safe(u.location),v=by.get(name)||{id,location:u.location,equipment:u.equipmentName,model:u.model,brand:u.brand,received:0,dispatched:0};
   v.received++;if(!u.available)v.dispatched++;by.set(name,v);
  });
  r4WriteTab_(book,'Product Movement',['Product ID','Equipment','Brand','Model','Location','Received Units','Dispatched Units','On Hand Units'],[...by.values()].map(v=>[v.id,v.equipment,v.brand,v.model,v.location,v.received,v.dispatched,v.received-v.dispatched]));
  lineCount=by.size;reportBasis='Receipt cohort by purchase/fabrication date, including dispatched units';
 }
 if(financial){
  // Explicit financial report: separate pricing ledger, only accessible to authorized management.
  const workOrders=new Map(rows_('WorkOrders').filter(w=>truthy_(w.Active)).map(w=>[safe(w.WorkOrderNumber),w]));
  const pricing=new Map(rows_('WorkOrderPricing').filter(x=>truthy_(x.Active)).map(x=>[safe(x.WorkOrderLineID),x]));
  const lines=rows_('WorkOrderLines').filter(x=>truthy_(x.Active)).filter(l=>{
   const w=workOrders.get(safe(l.WorkOrderNumber));return !!w&&f10ReportMatch_({workOrderNumber:l.WorkOrderNumber,equipmentName:l.EquipmentName,model:l.Model},f,stamp(w.CreationDate),[l.EquipmentName,l.Model,l.MakeBrand].join(' '));
  });
  const headers=['Work Order','Created','Status','Order Type','Sales Executive','Line ID','Equipment','Material Type','Qty','Purchase Unit Cost','Selling Unit Price','Total Purchase','Total Selling','Calculated Gross Profit','Costing Status'];
  r4WriteTab_(book,key==='margin-analysis'?'Estimated Margins':'Purchase Analysis',headers,lines.map(l=>{
   const w=workOrders.get(safe(l.WorkOrderNumber))||{},p=pricing.get(safe(l.LineID))||{},q=Number(l.PlannedQty||0);
   const costSet=String(p.PurchaseSet).toLowerCase()==='true',sellSet=String(p.SellingSet).toLowerCase()==='true';
   const buy=costSet?Number(p.PurchaseUnitPrice||0):'',sell=sellSet?Number(p.SellingUnitPrice||0):'';
   return [l.WorkOrderNumber,stamp(w.CreationDate),getStatus(l.WorkOrderNumber),w.WorkOrderType||'',w.SalesPerson||'',l.LineID,l.EquipmentName,l.EntryType,q,buy,sell,costSet?q*buy:'',sellSet?q*sell:'',costSet&&sellSet?q*(sell-buy):'',costSet&&sellSet?'Complete':'Missing purchase or selling price'];
  }));
  lineCount=lines.length;reportBasis='Authorized Work Order lines with recorded pricing';
 }
 const free=units.filter(u=>!u.workOrderNumber).length;
 r4WriteTab_(book,'Report Summary',['Metric','Value','Meaning'],[
  ['Report',F10_REPORT_KEYS_[key],'Live authorized Google Sheets report'],
  ['Generated',dateTimeStr_(new Date()),'Snapshot of data when the report was requested'],
  ['Source',reportBasis,'Only authorized material routes are included'],
  ['Main report rows',lineCount,'See first worksheet(s)'],
  ['Filtered units on hand',financial?'—':units.length,'Current available stock, not historical sales'],
  ['Free units on hand',financial?'—':free,'Stock not assigned to a work order'],
  ['Engaged units on hand',financial?'—':units.length-free,'Allocated to Work Orders, not yet dispatched'],
  ['Import rules','Download only','Operational changes require the relevant app workflow'],
  ['Financial data',financial?'Management-only data':'Excluded','Costs/profit never included in factory report exports']
 ]);
 r4WriteTab_(book,'Applied Filters',['Filter','Value'],[
  ['Work Order',f.workOrder||'All'],['Equipment / Model / Serial',f.product||'All'],
  ['Location',f.location||'All'],['From date',f.from||'All'],['To date',f.to||'All'],
  ['Date field',financial?'Work Order creation':key==='dispatch-history'?'Dispatch date':'Stock In / receipt date']
 ]);
 r4WriteTab_(book,'Read Me',['Topic','Explanation'],[
  ['Source','Live operational sheets from Janshakti Google Apps Script; no example rows invented.'],
  ['Editing','Reports are read-only. Use Product Master / Work Order Studio / Stock In / Stock Out to change transactions.'],
  ['Status colours','Approved Hold = light blue; approved Cancel = light red. Both lock linked records.'],
  ['Quantity','Current stock counts exclude dispatched units except the dispatch/movement reports.'],
  ['Profit',financial?'Gross profit = selling less actual recorded costs; incomplete rows display blank.':'Financial figures are excluded.'],
  ['Security','Export includes only rows and fields authorized for the current signed-in user.'],
  ['Blank result','No rows matched your filters or permission scope; try Clear filters.']
 ]);
 return r4ExportXlsx_(book,'Janshakti_'+key.replace(/[^a-z0-9-]/gi,'_')+'_'+today_(),lineCount);
}
