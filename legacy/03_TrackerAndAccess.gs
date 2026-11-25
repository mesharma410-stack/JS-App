/**
 * Janshakti Final 10(B) — 03_TrackerAndAccess.
 * Keep the file in the SAME bound Apps Script project as the other modules.
 * Calls and constants are shared across .gs files by the Apps Script runtime.
 * Do not rename externally called functions unless Index.html is updated too.
 */

/* ---- Stage and access matrix ---- */
/** Final 6 — owner-managed username x page access matrix and tracker. */
const F6_PAGES=['Dashboard','Work Orders','Work Order Tracker','Stock In','Stock Out','Stock Book','Product Master','Report','Invoice PDF','Sales Review','Pricing','Management Pricing Dashboard','Stock Purchase Cost'];
var F6_ACTIVE_ACTOR_='';
function f6Actor_(){return F6_ACTIVE_ACTOR_||'System / editor';}
/**
 * Seed stages on a NEW workbook. Existing stage names and order are never overwritten.
 * No legacy permission/quotation/report guide sheets are created or changed here.
 * All user rights belong to UserAccessMatrix (see 16_UnifiedAccessControl.gs).
 */
function f6SeedConfiguration_(ss){
 const stage=ss.getSheetByName('WorkOrderStageDefinitions');
 if(!stage)throw new Error('Missing WorkOrderStageDefinitions; run setupFinal10B().');
 if(stage.getLastRow()>1)return;
 const stages={
  Fabrication:['In Gate','Cutting','Bending','Assembly','Welding','Butting','Testing','Finishing','Packing','Dispatch'],
  'Bought Out':['Not Started','Purchase Requested','Purchase Order Placed','Supplier Confirmed','In Transit','Received','Quality Check','Ready to Dispatch','Completed']
 };
 const values=[];
 Object.keys(stages).forEach(type=>stages[type].forEach((name,i)=>values.push([type,name,i+1,i===stages[type].length-1,true])));
 stage.getRange(2,1,values.length,5).setValues(values);
}
/** Unified matrix is the sole active permissions table in Final 10(A). */
function f6Access_(username,page,mode){
 if(!F6_PAGES.includes(page))throw new Error('Unknown application permission: '+page);
 if(page==='Dashboard'&&mode==='Edit')throw new Error('Dashboard is read only.');
 if(!credentialRows_().some(x=>norm_(x.Username)===norm_(username)&&credentialEnabled_(x)))
  throw new Error('ACCESS_DENIED: Account is not active.');
 const grant=f10aPagePermission_(username,page);
 if(grant!=='Edit'&&(mode==='Edit'||grant!=='View'))
  throw new Error('ACCESS_DENIED: '+page+' requires '+mode+' access. Edit UserAccessMatrix.');
 return true;
}
function f6Authorized_(token,page,mode){const username=requireAuth_(token);F6_ACTIVE_ACTOR_=username;f6Access_(username,page,mode||'View');return username;}
function f6Permissions_(){const u=f6Actor_(),o={};F6_PAGES.forEach(p=>o[p]=f10aPagePermission_(u,p));o.routes=f10aRoutesFor_(u);return o;}
function tracker6Stages_(type){return rows_('WorkOrderStageDefinitions').filter(x=>truthy_(x.Active)&&norm_(x.TrackType)===norm_(type)).sort((a,b)=>Number(a.SortOrder)-Number(b.SortOrder)).map(r=>String(r.Stage));}
/** Resolve incomplete Final 6 / legacy line types without mutating historical data. */
function f7LineType_(line,byLine,byProduct,stockTypes){
 const id=clean_(line.LineID),prod=clean_(line.ProductID),raw=norm_(line.EntryType).replace(/\s+/g,'');
 // Fabrication identity takes priority over misleading default values on legacy lines.
 if(byLine.has(id)||byProduct.has(prod)||/^FAB[-_]/i.test(prod))return 'Fabrication';
 if(raw==='fabrication'||raw==='fab'||raw==='custom')return 'Fabrication';
 if(raw==='boughtout'||raw==='bought'||raw==='purchased'||raw==='purchase')return 'Bought Out';
 const linked=stockTypes.get(id)||stockTypes.get('P:'+prod);if(linked==='Fabrication')return 'Fabrication';
 return 'Bought Out';
}
function f7TypedLines_(){
 const fab=rows_('FabricationProducts').filter(r=>truthy_(r.Active));
 const byLine=new Set(fab.map(r=>clean_(r.WorkOrderLineID)).filter(Boolean)),byProduct=new Set(fab.map(r=>clean_(r.FabricationID)));
 const stockTypes=new Map();allStockInRows_().filter(r=>truthy_(r.Active)).forEach(r=>{if(norm_(r.EntryType)==='fabrication'){
  if(r.WorkOrderLineID)stockTypes.set(clean_(r.WorkOrderLineID),'Fabrication');if(r.ProductID)stockTypes.set('P:'+clean_(r.ProductID),'Fabrication');
 }});
 return rows_('WorkOrderLines').filter(r=>truthy_(r.Active)).map(r=>({...r,_f7Type:f7LineType_(r,byLine,byProduct,stockTypes)}));
}
function tracker6Rows_(){return rows_('WorkOrderTracker').filter(r=>truthy_(r.Active));}
function tracker6Summary_(){
 const all=wo6Records_(),lines=f7TypedLines_(),tracked=tracker6Rows_();
 const latest=new Map(tracked.map(r=>[String(r.WorkOrderLineID),r]));
 const byOrder=new Map();lines.forEach(l=>{const k=String(l.WorkOrderNumber);if(!byOrder.has(k))byOrder.set(k,[]);byOrder.get(k).push(l);});
 return all.map(w=>{
   const related=byOrder.get(String(w.WorkOrderNumber))||[];
   const types=['Bought Out','Fabrication'].map(t=>{const ll=related.filter(l=>l._f7Type===t);let amount=0;const counts={};ll.forEach(l=>{const stage=String(latest.get(String(l.LineID))?.Stage||(t==='Fabrication'?'In Gate':'Not Started'));counts[stage]=(counts[stage]||0)+1;});return {type:t,items:ll.length,amount,stages:counts,completed:counts.Completed||0};});
   return {workOrder:w.WorkOrderNumber,customer:w.CustomerName||'',version:Number(w.CurrentVersion||0),types,workOrderDate:dateStr_(w.CreationDate),deliveryDate:dateStr_(w.PromiseDate)};
 });
}
function tracker6Data_(){
 const lines=f7TypedLines_(),recs=tracker6Rows_(),map=new Map(recs.map(r=>[String(r.WorkOrderLineID),r])),activity=f10c1Activity_();
 return {stages:{'Bought Out':tracker6Stages_('Bought Out'),Fabrication:tracker6Stages_('Fabrication')},orphanFabrications:f7ReviewDuplicates_().filter(x=>x.Status.indexOf('ORPHAN')===0),summary:tracker6Summary_(),rows:lines.map(l=>({lineId:String(l.LineID),workOrder:String(l.WorkOrderNumber),entryType:l._f7Type,product:String(l.EquipmentName||''),model:String(l.Model||''),qty:Number(l.PlannedQty||0),stage:String(map.get(String(l.LineID))?.Stage||(l._f7Type==='Fabrication'?'In Gate':'Not Started')),lastBy:String(map.get(String(l.LineID))?.UpdatedBy||l.LastEditedBy||''),lastAt:dateTimeStr_(map.get(String(l.LineID))?.UpdatedAt||l.LastEditedAt),note:String(map.get(String(l.LineID))?.Note||''),phase:clean_(l.Section),...f10c1TrackerMeta_(l,map.get(String(l.LineID)),activity)}))};
}
function tracker6Apply_(form,actor){return withLock_(()=>{
 const wo=clean_(form.workOrder),type=clean_(form.entryType),stage=clean_(form.stage);
 if(type==='Fabrication'&&stage==='Packing')throw new Error('Use Packing (Serial Add) to submit serials and fabrication costs.');
 if(!['Bought Out','Fabrication'].includes(type)||!tracker6Stages_(type).includes(stage))throw new Error('Select a valid tracker type and active stage from WorkOrderStageDefinitions.');
 const w=findBy_('WorkOrders','WorkOrderNumber',wo);if(!w)throw new Error('Work Order does not exist.');c2CheckWO_(wo);
 const lines=f7TypedLines_().filter(l=>String(l.WorkOrderNumber)===wo && l._f7Type===type),ids=Array.isArray(form.lineIds)?form.lineIds.map(String):[];
 const selected=form.all?lines:lines.filter(l=>ids.includes(String(l.LineID)));
 if(!selected.length)throw new Error('No matching '+type+' product lines for this work order.');
 if(form.expectedEdits&&selected.some(l=>form.expectedEdits[String(l.LineID)]!==f10c1LineStamp_(l)))throw new Error('Work Order products changed after the tracker was loaded. Refresh and review the highlighted items before updating the stage.');
 if(ids.some(id=>!lines.some(l=>String(l.LineID)===id)))throw new Error('A product is no longer part of this Work Order. Refresh.');
 if(type==='Fabrication'&&tracker6Stages_(type).indexOf(stage)>tracker6Stages_(type).indexOf('Packing')){
  const receipts=allStockInRows_().filter(r=>truthy_(r.Active));
  const tracker=tracker6Rows_();selected.forEach(l=>{
    const current=tracker.find(x=>String(x.WorkOrderLineID)===String(l.LineID));
    if(!current||!['Packing','Dispatch'].includes(String(current.Stage)))throw new Error('Complete Packing (Serial Add) before Dispatch for '+l.EquipmentName+'.');
    const linked=receipts.filter(r=>String(r.WorkOrderLineID)===String(l.LineID));
    if(linked.some(r=>f10c1ReceiptIssue_(r))||linked.reduce((n,r)=>n+Number(r.Qty||0),0)<Number(l.PlannedQty||0))throw new Error('Complete the required serials for '+l.EquipmentName+' before Dispatch.');
  });
 }
 const note=wo6Text_(form.note,300),now=new Date();
 const existing=tracker6Rows_();selected.forEach(l=>{
  const old=existing.find(r=>String(r.WorkOrderLineID)===String(l.LineID));
  if(old)updateRowById_('WorkOrderTracker','StageID',old.StageID,{EntryType:type,Stage:stage,UpdatedAt:now,UpdatedBy:actor,Note:note});
  else append_('WorkOrderTracker',{StageID:id_('STG'),WorkOrderID:w.WorkOrderID,WorkOrderNumber:wo,WorkOrderLineID:l.LineID,EntryType:type,Stage:stage,UpdatedAt:now,UpdatedBy:actor,Note:note,Active:true});
 });
 audit_('TRACKER_STAGE','WorkOrder',w.WorkOrderID,{type,stage,lines:selected.map(x=>x.LineID),actor});
 return {ok:true,message:selected.length+' '+type+' product(s) moved to '+stage+'.'};
});}


/* Final 9 operational-only response sanitizer. Confidential values never leave the server through inventory RPCs. */
function f9Redact_(input){
 const confidential=/^(rate|unitprice|defaultunitcost|unitcost|cost|price|amount|value|gross|discount|specialdiscount|gst|taxable|grandtotal|netamount|freevalue|engagedvalue|sellingprice|purchaseprice|suggestedrate|buyingprice|profit|margin|bankdetails|customergstin)$/i;
 function walk(x){
  if(Array.isArray(x))return x.map(walk);
  if(x&&typeof x==='object'&&!(x instanceof Date)){
   const z={};Object.keys(x).forEach(k=>{if(!confidential.test(k)&&!/(value|cost|price|amount|profit|margin|discount|gst|tax)$/i.test(k))z[k]=walk(x[k]);});return z;
  }return x;
 }
 return walk(input);
}
function f9SeedStages_(){
 const sh=ss_().getSheetByName('WorkOrderStageDefinitions');if(!sh)return;
 const desired=['In Gate','Cutting','Bending','Assembly','Welding','Butting','Testing','Finishing','Packing','Dispatch'];
 const rows=readRowsFromSheet_(sh),seen=new Set(rows.filter(r=>norm_(r.TrackType)==='fabrication').map(r=>norm_(r.Stage)));
 const vals=sh.getDataRange().getValues(),header=vals[0].map(String),ic={};header.forEach((h,i)=>ic[h]=i);
 rows.forEach((r,i)=>{if(norm_(r.TrackType)==='fabrication'&&!desired.some(s=>norm_(s)===norm_(r.Stage))&&truthy_(r.Active))sh.getRange(i+2,ic.Active+1).setValue(false);});
 desired.forEach((stage,i)=>{
  const prev=rows.find(r=>norm_(r.TrackType)==='fabrication'&&norm_(r.Stage)===norm_(stage));
  if(prev){const row=rows.indexOf(prev)+2;sh.getRange(row,ic.SortOrder+1).setValue(i+1);sh.getRange(row,ic.Active+1).setValue(true);}
  else append_('WorkOrderStageDefinitions',{TrackType:'Fabrication',Stage,SortOrder:i+1,IsFinal:stage==='Dispatch',Active:true});
 });
 f7InvalidateRows_('WorkOrderStageDefinitions');
}
function f9ExportDashboardUnits_(filters){
 const data=r4DashboardFilter_(getStockBook_(),filters||{});const wb=r4NewWorkbook_('Inventory Units');
 const keys=['location','equipmentName','productType','brand','model','size','purchaseDate','serial','workOrderNumber','allocation','ageDays'];
 r4WriteTab_(wb,'Serial Detail',keys,data.map(x=>keys.map(k=>x[k]??'')));
 r4WriteTab_(wb,'Instructions',['Note'],[['Only inventory quantities and serial references are included; pricing is confidential and excluded.']]);
 return r4ExportXlsx_(wb,'Janshakti_Dashboard_Units_'+today_(),data.length);
}

/** Final 10: secure download-only management reports, with report-level permissions. */
function downloadInventoryReport(token,key,filters,transport){
  // Report-specific and route-based permissions are evaluated before reading any source rows.
  const user=f6Authorized_(token,'Report','View');
  f10ReportAccess_(user,key,'View');
  // Final 8-style browser transport avoids transferring a large base64 ZIP through google.script.run.
  // A second authorized call with transport="native" is available if browser ZIP creation fails.
  F10C_REPORT_BROWSER_=(transport!=='native');
  return f10BuildInventoryReport_(key,filters||{});
}
