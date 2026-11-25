/**
 * Janshakti Final 10(B) — 02_AuthenticationAndAPI.
 * Keep the file in the SAME bound Apps Script project as the other modules.
 * Calls and constants are shared across .gs files by the Apps Script runtime.
 * Do not rename externally called functions unless Index.html is updated too.
 */

/* ---- Login / RPC protection ---- */
/**
 * Final 3: username / password login for Apps Script Web App.
 * Deploy as "Execute as me"; users MUST NOT receive access to the Google Sheet.
 * Every inventory RPC below checks the server-side session before running.
 * Only a SHA-256 digest of the session token is cached. Session TTL: 6 hours.
 */
const AUTH_TTL_SECONDS = 21600;
const AUTH_HASH_ROUNDS = 2500;

function credentialRows_() {
  const sh = ss_().getSheetByName('Credential');
  if (!sh) throw new Error('Credential tab is missing. The owner must run initializeFinal3Credentials() in Apps Script and add users.');
  return readRowsFromSheet_(sh);
}
function credentialEnabled_(r) {
  const flag=String(r.Active==null?'':r.Active).trim().toLowerCase();
  return !['false','no','0','inactive','disabled'].includes(flag);
}
function authHash_(s) {
  const bytes=Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(s), Utilities.Charset.UTF_8);
  return bytes.map(b=>('0'+(b&255).toString(16)).slice(-2)).join('');
}
function passwordHash_(password,salt) {
  const seed=Utilities.newBlob(salt).getBytes();
  let bytes=Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt+':'+password, Utilities.Charset.UTF_8);
  for(let i=1;i<AUTH_HASH_ROUNDS;i++) bytes=Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,bytes.concat(seed));
  return bytes.map(b=>('0'+(b&255).toString(16)).slice(-2)).join('');
}
function checkPassword_(input,stored) {
  const parts=String(stored||'').split('$');
  if(parts[0]==='v3sha256' && parts.length===3) {
    return passwordHash_(input,parts[1])===parts[2];
  }
  // Owner can write a new plain password in the Credential sheet.
  // On successful login it is immediately replaced by a salted slow hash.
  return !!stored && String(input)===String(stored);
}
function migratePassword_(username,password) {
  const sh=ss_().getSheetByName('Credential');
  const values=sh.getDataRange().getValues();
  const head=values[0].map(String),nameCol=head.indexOf('Username'),passCol=head.indexOf('Password');
  if(nameCol<0||passCol<0)throw new Error('Credential requires Username and Password columns.');
  for(let i=1;i<values.length;i++)if(clean_(values[i][nameCol]).toLowerCase()===username.toLowerCase()){
    const old=String(values[i][passCol]||'');
    if(old.startsWith('v3sha256$'))return old;
    if(old!==password) throw new Error('Your password changed during sign-in. Try again.');
    const salt=Utilities.getUuid().replace(/-/g,'');
    const hashed='v3sha256$'+salt+'$'+passwordHash_(password,salt);
    sh.getRange(i+1,passCol+1).setValue(hashed);
    return hashed;
  }
  throw new Error('User not found.');
}
function loginInventory(username,password) {
  const name=clean_(username).toLowerCase();
  if(!name || !String(password||'').trim() || name.length>80 || String(password).length>256)
    throw new Error('Enter a valid username and password.');
  const cache=CacheService.getScriptCache(),failKey='loginfail:'+authHash_(name);
  const failed=Number(cache.get(failKey)||0);
  if(failed>=7)throw new Error('Too many attempts. Please try again in 15 minutes.');
  const matches=credentialRows_().filter(r=>clean_(r.Username).toLowerCase()===name);
  if(matches.length!==1 || !credentialEnabled_(matches[0]) || !checkPassword_(String(password),matches[0].Password)){
    cache.put(failKey,String(failed+1),900);
    throw new Error('Incorrect username or password, or account disabled.');
  }
  // Migration writes only after a valid password check.
  const secret=String(matches[0].Password).startsWith('v3sha256$')
    ?String(matches[0].Password):migratePassword_(name,String(password));
  cache.remove(failKey);
  const token=Utilities.getUuid()+Utilities.getUuid();
  cache.put('session:'+authHash_(token),JSON.stringify({username:name,credentialVersion:authHash_(secret)}),AUTH_TTL_SECONDS);
  F6_ACTIVE_ACTOR_=name;audit_('LOGIN','Credential',name,'User signed in');
  return {ok:true,token,username:clean_(matches[0].Username),expiresInSeconds:AUTH_TTL_SECONDS};
}
function requireAuth_(token) {
  // Pick up administrator permission changes on the next authenticated request.
  // Cache is reused within this one server action, not across access-policy edits.
  f7InvalidateRows_('UserAccessMatrix');
  if(typeof token!=='string'||!/^[-a-f0-9]{72}$/i.test(token))throw new Error('AUTH_REQUIRED: Please log in.');
  const json=CacheService.getScriptCache().get('session:'+authHash_(token));
  if(!json)throw new Error('AUTH_REQUIRED: Session expired. Please log in again.');
  let session;
  try{session=JSON.parse(json);}catch(e){throw new Error('AUTH_REQUIRED: Please log in again.');}
  const matches=credentialRows_().filter(r=>clean_(r.Username).toLowerCase()===session.username && credentialEnabled_(r));
  if(matches.length!==1 || authHash_(String(matches[0].Password))!==session.credentialVersion)
    throw new Error('AUTH_REQUIRED: Account changed or disabled. Please log in again.');
  F6_ACTIVE_ACTOR_=session.username;
  return session.username;
}
function verifyInventorySession(token) {
  return {ok:true,username:requireAuth_(token)};
}
function logoutInventory(token) {
  if(typeof token==='string'&&token.length===72) CacheService.getScriptCache().remove('session:'+authHash_(token));
  return {ok:true};
}
/** Run this once from Apps Script editor to create Credential tab. No business data is deleted. */
function initializeFinal3Credentials() {
  // Web visitors running under the owner's identity cannot call this as anonymous users.
  const active=Session.getActiveUser().getEmail();
  const owner=Session.getEffectiveUser().getEmail();
  if(!active || !owner || active.toLowerCase()!==owner.toLowerCase())
    throw new Error('Only the script owner can run initial setup from the Apps Script editor.');
  return setupInventorySystem_();
}

/** Record the credential username alongside changes; Google execute-as-me email may be the owner. */
function authenticatedChange_(token,method,callback,page){
 const username=f6Authorized_(token,page,'Edit');
 const result=callback();
 audit_('USER_ACTION','Credential',username,{method,resultId:result&&result.id||''});
 return result;
}
function setupFinal6(){
 const active=Session.getActiveUser().getEmail(),owner=Session.getEffectiveUser().getEmail();
 if(!active||!owner||active.toLowerCase()!==owner.toLowerCase())throw new Error('Run setupFinal6 as the spreadsheet owner in the bound Apps Script editor.');
 return setupInventorySystem_();
}
function getInitData(token){
 const username=requireAuth_(token);F6_ACTIVE_ACTOR_=username;const p=f6Permissions_(),allowed=F6_PAGES.filter(page=>!['None',''].includes(p[page]));
 if(!allowed.length)throw new Error('ACCESS_DENIED: No pages assigned in AccessMatrix.');
 const data=f10aFilterInit_(getInitData_(),username);
 if(!['View','Edit'].includes(p['Work Order Tracker'])){data.trackerSummary=[];}
 if(p['Stock In']==='None'&&p['Report']==='None')data.stockInHistory=[];
 if(p['Stock Out']==='None'&&p['Report']==='None')data.stockOutHistory=[];
 if(p['Work Orders']==='None'&&p['Report']==='None'){data.workOrderDocs=[];data.workOrderHistory=[];data.workOrderLines=[];}
 if(p['Product Master']==='None'&&p['Stock In']==='None'&&p['Work Orders']==='None')data.products=[];
 const woReceiptCount=new Map(),allTyped=f7TypedLines_(),receipts=allStockInRows_().filter(r=>truthy_(r.Active));
 receipts.forEach(r=>{let id=String(r.WorkOrderLineID||'');if(!id&&r.WorkOrderNumber){const matched=allTyped.filter(l=>String(l.WorkOrderNumber)===String(r.WorkOrderNumber)&&String(l.ProductID)===String(r.ProductID));if(matched.length===1)id=String(matched[0].LineID);}if(id)woReceiptCount.set(id,(woReceiptCount.get(id)||0)+Number(r.Qty||0));});
 data.stockInEligibleNumbers=[...new Set(allTyped.filter(l=>f10aRouteAllowed_(username,l._f7Type,'View')&&Number(l.PlannedQty||0)>(woReceiptCount.get(String(l.LineID))||0)&&!['hold','cancel'].includes(norm_(c2Status_(l.WorkOrderNumber)))).map(l=>String(l.WorkOrderNumber)))];
 data.stockOutEligibleNumbers=p['Stock Out']==='None'?[]:[...new Set(f10aFilterStock_(inventoryUnits_().filter(u=>u.available&&u.workOrderNumber),username).map(u=>u.workOrderNumber).filter(number=>!['hold','held','cancel','cancelled','canceled'].includes(norm_(c2Status_(number)))))] ;
 data.c2Permissions={withdrawVersions:c2Permission_(username,'Withdraw Versions'),deleteProducts:c2Permission_(username,'Delete Products'),deleteWorkOrders:c2Permission_(username,'Delete Work Orders')};
 data.actor=username;data.reportPermissions=Object.fromEntries(Object.keys(F10_REPORT_KEYS_).map(k=>[k,f10aPagePermission_(username,'Report: '+F10_REPORT_KEYS_[k])]));
 return f9Redact_(f10c1DecorateInit_(data));
}
function getHealthCheck(token){f6Authorized_(token,'Report','Edit');return getHealthCheck_();}
function setupInventorySystem(token){throw new Error('Run setupFinal6 from the Apps Script editor as spreadsheet owner.');}
function seedDemoData(token){throw new Error('Demo data cannot be seeded from the web app.');}
function saveProduct(token,f){const user=f6Authorized_(token,'Product Master','Edit');f10aRouteAccess_(user,'Bought Out','Edit');return authenticatedChange_(token,'saveProduct',()=>saveProduct_(f),'Product Master');}
function updateProduct(token,f){const user=f6Authorized_(token,'Product Master','Edit');f10aRouteAccess_(user,'Bought Out','Edit');c2CheckProductWO_(f.productId);return authenticatedChange_(token,'updateProduct',()=>updateProduct_(f),'Product Master');}
function deleteProduct(token,id){const user=f6Authorized_(token,'Product Master','Edit');f10aRouteAccess_(user,'Bought Out','Edit');if(!c2Permission_(user,'Delete Products'))throw new Error('ACCESS_DENIED: Delete Products = Edit is required.');c2CheckProductWO_(id);return authenticatedChange_(token,'deleteProduct',()=>deleteProduct_(id),'Product Master');}
function saveWorkOrder(token,f){throw new Error('Create and revise Work Orders in the versioned Work Order Studio.');}
function updateWorkOrder(token,f){throw new Error('Edit Work Orders in the versioned Work Order Studio.');}
function deleteWorkOrder(token,id){const user=f6Authorized_(token,'Work Orders','Edit');if(!c2Permission_(user,'Delete Work Orders'))throw new Error('ACCESS_DENIED: Delete Work Orders = Edit is required.');const matched=rows_('WorkOrders').find(w=>String(w.WorkOrderID)===String(id)||norm_(w.WorkOrderNumber)===norm_(id));if(matched)c2CheckWO_(matched.WorkOrderNumber);return authenticatedChange_(token,'deleteWorkOrder',()=>deleteWorkOrder_(id),'Work Orders');}
function saveStockIn(token,f){const user=f6Authorized_(token,'Stock In','Edit');f10aRouteAccess_(user,f.entryType,'Edit');return authenticatedChange_(token,'saveStockIn',()=>saveStockIn_(f),'Stock In');}
function getStockReceiptCost(token,id){const user=f6Authorized_(token,'Stock Purchase Cost','Edit');f6Access_(user,'Stock In','Edit');f10aRouteAccess_(user,'Bought Out','Edit');const row=findBy_('StockIn','StockInID',id);if(!row||norm_(row.EntryType)!=='bought out')throw new Error('Bought Out receipt not found.');return {unitCost:Number(row.UnitCost||0)};}
function saveStockInBatch(token,f){const user=f6Authorized_(token,'Stock In','Edit');const entries=Array.isArray(f)?f:(f.lines||f.items||[]);if(!entries.length)throw new Error('Select at least one stock receipt line.');entries.forEach(x=>f10aRouteAccess_(user,x.entryType||f.entryType,'Edit'));return authenticatedChange_(token,'saveStockInBatch',()=>saveStockInBatch_(f),'Stock In');}
function updateStockIn(token,f){const user=f6Authorized_(token,'Stock In','Edit');const old=findBy_('StockIn','StockInID',f.stockInId)||findBy_('FabricationStockIn','StockInID',f.stockInId);if(old)f10aRouteAccess_(user,old.EntryType,'Edit');if(old?.WorkOrderNumber)c2CheckWO_(old.WorkOrderNumber);if(f.workOrderNumber)c2CheckWO_(f.workOrderNumber);return authenticatedChange_(token,'updateStockIn',()=>updateStockIn_(f),'Stock In');}
function archiveStockIn(token,id){const user=f6Authorized_(token,'Stock In','Edit');const old=findBy_('StockIn','StockInID',id)||findBy_('FabricationStockIn','StockInID',id);if(old)f10aRouteAccess_(user,old.EntryType,'Edit');if(old?.WorkOrderNumber)c2CheckWO_(old.WorkOrderNumber);return authenticatedChange_(token,'archiveStockIn',()=>archiveStockIn_(id),'Stock In');}
function saveStockOut(token,f){const user=f6Authorized_(token,'Stock Out','Edit');f10aCheckDispatchRoutes_(user,f);return authenticatedChange_(token,'saveStockOut',()=>saveStockOut_(f),'Stock Out');}
function updateStockOut(token,f){const user=f6Authorized_(token,'Stock Out','Edit');f10aCheckDispatchRoutes_(user,f);const existing=findBy_('StockOut','StockOutID',f.stockOutId);if(existing?.WorkOrderNumber)c2CheckWO_(existing.WorkOrderNumber);if(f.workOrderNumber)c2CheckWO_(f.workOrderNumber);return authenticatedChange_(token,'updateStockOut',()=>updateStockOut_(f),'Stock Out');}
function archiveStockOut(token,id){const user=f6Authorized_(token,'Stock Out','Edit'),old=findBy_('StockOut','StockOutID',id);if(old){f10aCheckDispatchRoutes_(user,old);if(old.WorkOrderNumber)c2CheckWO_(old.WorkOrderNumber);}return authenticatedChange_(token,'archiveStockOut',()=>archiveStockOut_(id),'Stock Out');}
function getWorkOrderStock(token,wo,loc){const user=f6Authorized_(token,'Stock Out','View');const r=getWorkOrderStock_(wo,loc);r.products=f10aFilterStock_(r.products,user);r.serials=r.products.map(x=>x.serial);r.qty=r.serials.length;r.totalAvailable=r.qty;r.locations={};r.products.forEach(u=>r.locations[u.location]=(r.locations[u.location]||0)+1);return f9Redact_(r);}
function getStockInWorkOrderItems(token,wo,type){const user=f6Authorized_(token,'Stock In','View');f10aRouteAccess_(user,type,'View');return f9Redact_(f8StockInCandidates_(wo,type));}
function getStockBook(token){const user=requireAuth_(token);F6_ACTIVE_ACTOR_=user;if(!['Dashboard','Stock Book'].some(p=>{try{f6Access_(user,p,'View');return true;}catch(e){return false;}}))throw new Error('Stock data access denied.');return f9Redact_(f10c1DecorateStock_(f10aFilterStock_(getStockBook_(),user)));}
function getDashboardData(token){const user=f6Authorized_(token,'Dashboard','View');return f9Redact_(f10aDashboardFor_(user));}
function getKpiDetails(token,key){const user=f6Authorized_(token,'Dashboard','View');return f9Redact_(f10aKpiFor_(user,key));}
function getInvoiceHtml(token,wo){f6Authorized_(token,'Invoice PDF','View');throw new Error('Price-bearing invoice is disabled. Use the price-free Work Order print.');}
function generateInvoicePdf(token,wo){f6Authorized_(token,'Invoice PDF','Edit');throw new Error('Invoice creation is disabled in inventory-only mode.');}
function getProductInsights(token){const user=f6Authorized_(token,'Product Master','View');f10aRouteAccess_(user,'Bought Out','View');return f9Redact_(getProductInsights_());}
function exportDashboardSummary(token,filters){const user=f6Authorized_(token,'Dashboard','View');F10C_REPORT_BROWSER_=false;return f10aExportDashboardFor_(user,filters);}
function exportDataTemplate(token,type,transport){
 const user=f6Authorized_(token,'Report','View');f10ReportAccess_(user,type,'View');
 if(type==='products')f10aRouteAccess_(user,'Bought Out','View');
 else if(type!=='stockin'&&type!=='stockout'){f10aRouteAccess_(user,'Bought Out','View');f10aRouteAccess_(user,'Fabrication','View');}
 // Editable formats always include all active rows, stable IDs and RowVersion tokens.
 F10C_REPORT_BROWSER_=(transport!=='native');
 return exportDataTemplate_(type);
}
function importDataTemplate(token,type,filename,base64,apply){
 const user=f6Authorized_(token,'Report',apply?'Edit':'View');
 f10ReportAccess_(user,type,apply?'Edit':'View');
 f10aRouteAccess_(user,'Bought Out',apply?'Edit':'View');if(type!=='products')f10aRouteAccess_(user,'Fabrication',apply?'Edit':'View');
 if(type==='stockin')throw new Error('Final 9: Stock In Excel is download-only to prevent cross-sheet receipts being written into the wrong ledger. Receive Bought Out stock in Stock In, and Fabrication serials in Tracker → Assembly.');
 if(apply){const pages={products:'Product Master',stockin:'Stock In',stockout:'Stock Out'};if(!pages[type])throw new Error('Use Work Order Flow for version-controlled work order uploads.');f6Access_(user,pages[type],'Edit');}
 const r=importDataTemplate_(type,filename,base64,apply);if(apply&&r.ok)audit_('BULK_REPORT','Credential',user,{type,added:r.added,updated:r.updated});return r;
}
function initializeFinal5(token){throw new Error('Run setupFinal6 as spreadsheet owner in the Apps Script editor.');}
function listQuotations(token){throw new Error('Quotation page has been retired in Final 6.');}
function getQuotationVersion(token,id,version){throw new Error('Quotation page has been retired in Final 6.');}
function saveQuotation(token,f){throw new Error('Quotation page has been retired in Final 6.');}
function linkQuotationToWorkOrder(token,id,wo,version){throw new Error('Quotation linking retired; Work Orders are independent.');}
function printQuotationHtml(token,id,version){throw new Error('Use Work Order print.');}
function storeSerialPhotos(token,photos){throw new Error('Camera and gallery upload disabled in Final 6.');}
function listWorkOrderDocuments(token){f6Authorized_(token,'Work Orders','View');return wo6List_();}
function readWorkOrderDocument(token,id,version){const user=f6Authorized_(token,'Work Orders','View');f10aRouteAccess_(user,'Bought Out','View');f10aRouteAccess_(user,'Fabrication','View');const result=wo6Read_(id,version);return f9Redact_(f10c1DocumentMeta_(result,user));}
function saveWorkOrderDocument(token,form){const user=f6Authorized_(token,'Work Orders','Edit');f10aRouteAccess_(user,'Bought Out','Edit');f10aRouteAccess_(user,'Fabrication','Edit');return wo6Save_(form,user);}
function printWorkOrderDocument(token,id,version){const user=f6Authorized_(token,'Work Orders','View');f10cAuthorizeDocument_(user,wo6Read_(id,version).data);return wo6PrintHtml_(id,version);}
function getTrackerData(token){const user=f6Authorized_(token,'Work Order Tracker','View');return f9Redact_(f10aFilterTracker_(tracker6Data_(),user));}
function updateTrackerStage(token,form){const user=f6Authorized_(token,'Work Order Tracker','Edit');f10aRouteAccess_(user,form.entryType,'Edit');return tracker6Apply_(form,user);}
function exportWorkOrderFlow(token,transport){
 const user=f6Authorized_(token,'Report','View');f10ReportAccess_(user,'flow','View');
 f10aRouteAccess_(user,'Bought Out','View');f10aRouteAccess_(user,'Fabrication','View');
 // The retired Flow Excel editor contained prices. This VIEW-ONLY export is always price-free;
 // Work Order Studio remains the only way to create a versioned revision.
 F10C_REPORT_BROWSER_=(transport!=='native');
 const hiddenPrices=new Set(['Rate','Discount','SpecialDiscount','GST']);
 const cols=FLOW6_FIELDS.filter(c=>!hiddenPrices.has(c));
 const rows=flow6Rows_();const book=r4NewWorkbook_('Work Order Flow');
 const statuses=new Map(rows_('WorkOrders').filter(r=>truthy_(r.Active)).map(r=>[String(r.WorkOrderNumber),String(r.Status||'Open')]));
 r4WriteTab_(book,'Work Order Flow',cols.concat('WO Status'),
  rows.map(r=>cols.map(f=>r[f]??'').concat(statuses.get(String(r.WorkOrderNumber))||'Open')));
 r4WriteTab_(book,'Instructions',['Topic','Explanation'],[
  ['Source','Live Work Orders, WorkOrderLines, Tracker and stock ledgers'],
  ['Purpose','Inspect every accessible work order item, stage and stock movement.'],
  ['Upload','READ ONLY. Create or revise orders with Work Order Studio; receipt or dispatch with their own pages.'],
  ['Security','Purchase and selling prices are excluded from this operational report.'],
  ['Status','Approved Hold or Cancel locks the work order until Admin releases/reopens it.']
 ]);
 return r4ExportXlsx_(book,'Janshakti_Work_Order_Flow_'+today_(),rows.length);
}
function importWorkOrderFlow(token,filename,base64,apply){f6Authorized_(token,'Report',apply?'Edit':'View');throw new Error('Final 9: older Work Order Flow uploads can contain confidential pricing. Download the current price-free Work Order Items Excel and update through Work Order Studio.');}

function downloadWOItemsTemplate(token,id){f6Authorized_(token,'Work Orders','View');throw new Error('Use the price-free Excel download in Work Order Studio.');}
function validateWOItemsBrowser(token,id,items){const user=f6Authorized_(token,'Work Orders','Edit');f10aRouteAccess_(user,'Bought Out','Edit');f10aRouteAccess_(user,'Fabrication','Edit');return f8ValidateBrowserItems_(id,items);}
function parseWOItemsTemplate(token,filename,base64){f6Authorized_(token,'Work Orders','Edit');throw new Error('Use the browser Work Order Excel uploader.');}

/** Final 7: owner-only setup; Sales Review is independently permission protected. */
function setupFinal7(){
 const active=Session.getActiveUser().getEmail(),owner=Session.getEffectiveUser().getEmail();
 if(!active||!owner||active.toLowerCase()!==owner.toLowerCase())throw new Error('Run setupFinal7 as the spreadsheet owner in the bound Apps Script editor.');
 return setupInventorySystem_();
}
function getSalesReviewData(token){f6Authorized_(token,'Sales Review','View');throw new Error('Historical financial sales review is retired from operational views. Use the restricted Management Pricing Dashboard.');}
function getFabricationDuplicateReview(token){const user=f6Authorized_(token,'Work Orders','View');f10aRouteAccess_(user,'Fabrication','View');return f7ReviewDuplicates_();}


