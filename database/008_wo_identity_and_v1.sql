-- 008: separate C2 fabrication identity and new Work Order Version 1.
-- TEST CHILD BRANCH ONLY. Requires 007. No real-data import or direct table-write grants.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='120s';
DO $guard$
BEGIN
 IF to_regprocedure('public.c2_session_actor(text)') IS NULL
 OR NOT EXISTS (SELECT 1 FROM public.app_users WHERE username='da' AND active AND team='Admin')
 OR NOT EXISTS (SELECT 1 FROM public.work_orders WHERE work_order_id='DEMO-W01')
 THEN RAISE EXCEPTION 'Apply and verify 007 on the synthetic demo branch first'; END IF;
 IF EXISTS (SELECT 1 FROM public.work_order_lines WHERE entry_type='Fabrication' OR product_id IS NULL)
 OR EXISTS (SELECT 1 FROM public.stock_receipts WHERE entry_type='Fabrication')
 OR EXISTS (SELECT 1 FROM public.fabrication_products)
 THEN RAISE EXCEPTION 'Existing fabrication identity requires a reviewed data migration'; END IF;
END
$guard$;

-- The original C2 accepts zero planned quantity; actual receipts remain positive.
ALTER TABLE public.work_order_lines DROP CONSTRAINT work_order_lines_planned_qty_check;
ALTER TABLE public.work_order_lines ADD CONSTRAINT work_order_lines_planned_qty_check CHECK(planned_qty>=0);
ALTER TABLE public.work_order_lines ADD COLUMN fabrication_id text;
ALTER TABLE public.fabrication_products ADD CONSTRAINT fabrication_identity_line_key UNIQUE(fabrication_id,work_order_line_id);
CREATE UNIQUE INDEX fabrication_one_active_line_idx ON public.fabrication_products(work_order_line_id) WHERE active;
CREATE UNIQUE INDEX fabrication_catalog_active_key_unique ON public.fabrication_catalog(normalized_key) WHERE active;
ALTER TABLE public.work_order_lines ADD CONSTRAINT wo_line_fabrication_fk
 FOREIGN KEY(fabrication_id,line_id) REFERENCES public.fabrication_products(fabrication_id,work_order_line_id)
 DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE public.work_order_lines ADD CONSTRAINT wo_line_route_identity_ck CHECK(
 (entry_type='Bought Out' AND product_id IS NOT NULL AND fabrication_id IS NULL)
 OR (entry_type='Fabrication' AND product_id IS NULL AND fabrication_id IS NOT NULL));
-- Prepare receipt FKs. Fabrication receipt APIs are intentionally NOT enabled.
ALTER TABLE public.stock_receipts ALTER COLUMN product_id DROP NOT NULL;
ALTER TABLE public.stock_receipts ADD COLUMN fabrication_id text;
ALTER TABLE public.stock_receipts ADD CONSTRAINT receipt_fabrication_fk
 FOREIGN KEY(fabrication_id,work_order_line_id) REFERENCES public.fabrication_products(fabrication_id,work_order_line_id);
ALTER TABLE public.stock_receipts ADD CONSTRAINT receipt_route_identity_ck CHECK(
 (entry_type='Bought Out' AND product_id IS NOT NULL AND fabrication_id IS NULL)
 OR (entry_type='Fabrication' AND product_id IS NULL AND fabrication_id IS NOT NULL AND work_order_line_id IS NOT NULL AND work_order_id IS NOT NULL));
CREATE UNIQUE INDEX wo_number_normalized_unique ON public.work_orders(lower(trim(work_order_number)));

CREATE FUNCTION public.c2_catalog_key_part(v text) RETURNS text
LANGUAGE sql IMMUTABLE STRICT SET search_path=pg_catalog
AS $fn$ SELECT trim(regexp_replace(upper(normalize(trim(v),NFKC)),'[^A-Z0-9]+',' ','g')) $fn$;
REVOKE ALL ON FUNCTION public.c2_catalog_key_part(text) FROM PUBLIC,js_app_runtime;

CREATE FUNCTION public.c2_save_new_wo(p_hash text,p_data jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE
 actor text; meta jsonb; item jsonb; order_id text; new_line text; fab_id text; catalog_ref text;
 order_num text; kind text; start_day date; end_day date; route text; qty integer;
 item_name text; item_model text; item_brand text; size_spec text; prod text; item_category text; catalog_key text;
 master public.products%ROWTYPE; snapshot jsonb; lines jsonb:='[]'::jsonb; k text; lim integer; v text;
BEGIN
 actor:=public.c2_session_actor(p_hash);
 PERFORM public.c2_require_edit(actor,'Work Orders');
 IF coalesce(jsonb_typeof(p_data),'')<>'object' OR coalesce(jsonb_typeof(p_data->'meta'),'')<>'object'
 OR coalesce(jsonb_typeof(p_data->'items'),'')<>'array' THEN RAISE EXCEPTION 'C2: Invalid Work Order draft'; END IF;
 IF jsonb_array_length(p_data->'items') NOT BETWEEN 1 AND 130 OR octet_length(p_data::text)>1000000
 THEN RAISE EXCEPTION 'C2: Work Order must contain 1 to 130 items'; END IF;
 meta:=p_data->'meta'; order_num:=trim(coalesce(meta->>'workOrderNumber',''));
 kind:=coalesce(nullif(trim(meta->>'workOrderType'),''),'Project');
 IF length(order_num) NOT BETWEEN 1 AND 110 OR order_num ~ '^[=+@]'
 OR kind NOT IN ('Project','Retail','Other') OR length(trim(coalesce(meta->>'quoteReference',''))) NOT BETWEEN 1 AND 120
 OR coalesce(meta->>'workOrderDate','') !~ '^\d{4}-\d{2}-\d{2}$'
 THEN RAISE EXCEPTION 'C2: Enter valid Work Order number, type, date and Quote Reference'; END IF;
 start_day:=(meta->>'workOrderDate')::date;
 IF coalesce(meta->>'deliveryDate','')<>'' THEN
   IF meta->>'deliveryDate' !~ '^\d{4}-\d{2}-\d{2}$' THEN RAISE EXCEPTION 'C2: Invalid delivery date'; END IF;
   end_day:=(meta->>'deliveryDate')::date;
   IF end_day<start_day THEN RAISE EXCEPTION 'C2: Delivery date cannot precede Work Order date'; END IF;
 END IF;
 FOR k,lim IN SELECT * FROM (VALUES ('salesPerson',120),('specs',100),('structure',180),
   ('gasFitting',100),('quoteReference',120),('checkedBy',140)) AS limits(field,maximum)
 LOOP
   v:=coalesce(meta->>k,'');
   IF length(v)>lim OR v ~ '^[=+@]' THEN RAISE EXCEPTION 'C2: Invalid Work Order header field'; END IF;
 END LOOP;
 LOCK TABLE public.products,public.work_orders,public.work_order_lines,public.fabrication_catalog,public.fabrication_products
   IN SHARE ROW EXCLUSIVE MODE;
 IF EXISTS(SELECT 1 FROM public.work_orders WHERE lower(trim(work_order_number))=lower(order_num))
 THEN RAISE EXCEPTION 'C2: Work Order number already exists'; END IF;
 order_id:='WO-'||replace(gen_random_uuid()::text,'-','');
 INSERT INTO public.work_orders(work_order_id,work_order_number,order_type,sales_person,creation_date,promise_date,status,
   created_at,current_version,specs,structure,gas_fitting,quote_reference,prepared_by,checked_by,last_edited_by,last_edited_at,last_change)
 VALUES(order_id,order_num,kind,coalesce(meta->>'salesPerson',''),start_day,end_day,'Open',
   now(),1,coalesce(meta->>'specs',''),coalesce(meta->>'structure',''),coalesce(meta->>'gasFitting',''),
   trim(meta->>'quoteReference'),actor,coalesce(meta->>'checkedBy',''),actor,now(),'Work Order Studio: Created');
 FOR item IN SELECT value FROM jsonb_array_elements(p_data->'items') LOOP
   IF coalesce(jsonb_typeof(item),'')<>'object' THEN RAISE EXCEPTION 'C2: Invalid Work Order item'; END IF;
   route:=coalesce(item->>'entryType','');
   IF route NOT IN ('Bought Out','Fabrication') THEN RAISE EXCEPTION 'C2: Choose a material route'; END IF;
   PERFORM public.c2_require_edit(actor,'Route: '||route);
   IF coalesce(item->>'qty','') !~ '^\d{1,10}$' THEN RAISE EXCEPTION 'C2: Quantity must be a nonnegative whole number'; END IF;
   IF (item->>'qty')::numeric>2147483647 THEN RAISE EXCEPTION 'C2: Quantity is too large'; END IF;
   qty:=(item->>'qty')::integer;
   FOR k,lim IN SELECT * FROM (VALUES ('code',100),('description',1800),('size',200),('model',150),
       ('brand',150),('section',120),('itemRemarks',600),('itemDescription',1800),('productId',100)) AS limits(field,maximum)
   LOOP
     v:=coalesce(item->>k,'');
     IF length(v)>lim OR v ~ '^[=+@]' THEN RAISE EXCEPTION 'C2: Invalid Work Order item field'; END IF;
   END LOOP;
   item_name:=trim(coalesce(item->>'description',''));item_brand:=trim(coalesce(item->>'brand',''));
   item_model:=trim(coalesce(item->>'model',''));size_spec:=trim(coalesce(item->>'size',''));
   prod:=NULL;fab_id:=NULL;catalog_ref:=NULL;
   new_line:='WOL-'||replace(gen_random_uuid()::text,'-','');
   IF route='Bought Out' THEN
     prod:=trim(coalesce(item->>'productId',''));
     SELECT * INTO master FROM public.products WHERE product_id=prod AND active;
     IF NOT FOUND OR item_name<>master.equipment_name OR item_brand<>master.brand OR item_model<>master.model
     OR length(trim(item_model))=0 OR (SELECT count(*) FROM public.products p WHERE p.active
       AND upper(regexp_replace(normalize(trim(p.model),NFKC),'\s+','','g'))=
           upper(regexp_replace(normalize(trim(item_model),NFKC),'\s+','','g')))<>1
     THEN RAISE EXCEPTION 'C2: Master changed or is ambiguous; validate again before saving'; END IF;
     item_category:=master.product_type;
     size_spec:=coalesce(nullif(size_spec,''),master.size_capacity);
   ELSE
     IF item_name='' OR coalesce(item->>'productId','')<>'' THEN RAISE EXCEPTION 'C2: Enter custom fabrication description without a shared product ID'; END IF;
     item_category:='Other';fab_id:='FAB-'||replace(gen_random_uuid()::text,'-','');
     catalog_key:=public.c2_catalog_key_part(item_name)||'|'||public.c2_catalog_key_part(item_brand)||'|'||
       public.c2_catalog_key_part(item_model)||'|'||public.c2_catalog_key_part(size_spec);
     SELECT catalog_id INTO catalog_ref FROM public.fabrication_catalog WHERE normalized_key=catalog_key AND active;
     IF catalog_ref IS NULL THEN
       catalog_ref:='FCT-'||replace(gen_random_uuid()::text,'-','');
       INSERT INTO public.fabrication_catalog(catalog_id,normalized_key,equipment_name,brand,model,size_capacity,category,last_used_at)
       VALUES(catalog_ref,catalog_key,item_name,item_brand,item_model,size_spec,item_category,now());
     END IF;
   END IF;
   INSERT INTO public.work_order_lines(line_id,work_order_id,product_id,fabrication_id,equipment_name,model,brand,entry_type,planned_qty,
     created_at,size_capacity,product_type,code,section,category,fabrication_catalog_id,item_remarks,item_description,last_edited_by,last_edited_at,last_change)
   VALUES(new_line,order_id,prod,fab_id,item_name,item_model,item_brand,route,qty,now(),size_spec,item_category,coalesce(item->>'code',''),
     coalesce(item->>'section',''),item_category,catalog_ref,coalesce(item->>'itemRemarks',''),coalesce(item->>'itemDescription',''),actor,now(),'Work Order Studio: New item');
   IF route='Fabrication' THEN
     INSERT INTO public.fabrication_products(fabrication_id,work_order_id,work_order_line_id,equipment_name,brand,model,size_capacity,
       product_type,created_at,catalog_id,last_edited_by,last_edited_at)
     VALUES(fab_id,order_id,new_line,item_name,item_brand,item_model,size_spec,item_category,now(),catalog_ref,actor,now());
   END IF;
   lines:=lines||jsonb_build_array(jsonb_build_object('lineId',new_line,'productId',coalesce(prod,fab_id),'catalogId',coalesce(catalog_ref,''),
     'code',coalesce(item->>'code',''),'section',coalesce(item->>'section',''),'description',item_name,'brand',item_brand,'model',item_model,
     'size',size_spec,'qty',qty,'entryType',route,'category',item_category,'itemRemarks',coalesce(item->>'itemRemarks',''),
     'itemDescription',coalesce(item->>'itemDescription','')));
 END LOOP;
 snapshot:=jsonb_build_object('workOrderNumber',order_num,'workOrderType',kind,'workOrderDate',start_day,
   'deliveryDate',end_day,'salesPerson',coalesce(meta->>'salesPerson',''),'preparedBy',actor,'checkedBy',coalesce(meta->>'checkedBy',''),
   'specs',coalesce(meta->>'specs',''),'structure',coalesce(meta->>'structure',''),'gasFitting',coalesce(meta->>'gasFitting',''),
   'quoteReference',trim(meta->>'quoteReference'),'items',lines);
 INSERT INTO public.work_order_versions(version_id,work_order_id,version,snapshot_json,saved_at,saved_by,change_summary,accent_color)
 VALUES('WOV-'||replace(gen_random_uuid()::text,'-',''),order_id,1,snapshot,now(),actor,'Work Order Studio: Created','#8763bc');
 INSERT INTO public.audit_log(username,action,entity_type,entity_id,details)
 VALUES(actor,'CREATE','WorkOrder',order_id,jsonb_build_object('version',1,'products',jsonb_array_length(lines)));
 RETURN jsonb_build_object('ok',true,'id',order_id,'version',1,'message','Work Order saved as Version 1.');
END
$fn$;
REVOKE ALL ON FUNCTION public.c2_save_new_wo(text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.c2_save_new_wo(text,jsonb) TO js_app_runtime;

CREATE FUNCTION public.c2_read_wo_versions(p_hash text,p_number text,p_version integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE actor text; ident text; version_list jsonb; snap jsonb;
BEGIN
 actor:=public.c2_session_actor(p_hash);
 IF NOT EXISTS(SELECT 1 FROM public.user_access_matrix WHERE username=actor AND permission='Work Orders' AND access_level IN ('View','Edit'))
 THEN RAISE EXCEPTION 'C2: Work Orders access required'; END IF;
 SELECT work_order_id INTO ident FROM public.work_orders WHERE lower(trim(work_order_number))=lower(trim(p_number)) AND active;
 IF ident IS NULL THEN RAISE EXCEPTION 'C2: Work Order not found'; END IF;
 IF EXISTS (
   SELECT 1 FROM public.work_order_versions v CROSS JOIN LATERAL jsonb_array_elements(v.snapshot_json->'items') AS x(item)
   WHERE v.work_order_id=ident AND NOT EXISTS(SELECT 1 FROM public.user_access_matrix a
   WHERE a.username=actor AND a.permission='Route: '||(x.item->>'entryType') AND a.access_level IN ('View','Edit')))
 THEN RAISE EXCEPTION 'C2: All document material routes are required'; END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('version',version,'savedAt',saved_at,'savedBy',saved_by,
   'changeSummary',change_summary,'withdrawnAt',withdrawn_at) ORDER BY version DESC),'[]'::jsonb)
 INTO version_list FROM public.work_order_versions WHERE work_order_id=ident;
 IF p_version>0 THEN
   SELECT snapshot_json INTO snap FROM public.work_order_versions WHERE work_order_id=ident AND version=p_version;
   IF snap IS NULL THEN RAISE EXCEPTION 'C2: Saved version not found'; END IF;
   snap:=jsonb_build_object('workOrderNumber',snap->'workOrderNumber','workOrderType',snap->'workOrderType',
     'workOrderDate',snap->'workOrderDate','deliveryDate',snap->'deliveryDate','salesPerson',snap->'salesPerson',
     'preparedBy',snap->'preparedBy','checkedBy',snap->'checkedBy','specs',snap->'specs',
     'structure',snap->'structure','gasFitting',snap->'gasFitting','quoteReference',snap->'quoteReference',
     'items',(SELECT coalesce(jsonb_agg(jsonb_build_object('lineId',i->'lineId','productId',i->'productId',
       'code',i->'code','section',i->'section','description',i->'description','brand',i->'brand','model',i->'model',
       'size',i->'size','qty',i->'qty','entryType',i->'entryType','itemRemarks',i->'itemRemarks','itemDescription',i->'itemDescription')
       ORDER BY ord),'[]'::jsonb) FROM jsonb_array_elements(snap->'items') WITH ORDINALITY AS x(i,ord)));
 END IF;
 RETURN jsonb_build_object('versions',version_list,'snapshot',snap);
END
$fn$;
REVOKE ALL ON FUNCTION public.c2_read_wo_versions(text,text,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.c2_read_wo_versions(text,text,integer) TO js_app_runtime;
INSERT INTO public.user_access_matrix(username,permission,access_level)
VALUES('da','Work Orders','Edit'),('da','Route: Fabrication','Edit')
ON CONFLICT(username,permission) DO UPDATE SET access_level='Edit';
COMMIT;
