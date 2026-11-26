-- 007: first functional workspace, synthetic child branch ONLY, run once as owner.
-- No direct runtime table write grants. SECURITY DEFINER entry points authenticate
-- a valid app session and recheck permissions in the database before mutations.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='120s';
DO $guard$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM public.app_users WHERE username='da' AND active) THEN
   RAISE EXCEPTION 'Active test account da required';
 END IF;
 IF EXISTS (SELECT 1 FROM public.products WHERE product_id NOT LIKE 'DEMO-%')
 OR EXISTS (SELECT 1 FROM public.work_orders WHERE work_order_id NOT LIKE 'DEMO-%')
 OR EXISTS (SELECT 1 FROM public.stock_receipts WHERE stock_in_id NOT LIKE 'DEMO-%') THEN
   RAISE EXCEPTION 'Non-demo inventory detected. Do not run on operational data.';
 END IF;
END
$guard$;

CREATE FUNCTION public.c2_session_actor(p_hash text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE actor text;
BEGIN
 SELECT u.username INTO actor FROM public.app_sessions s JOIN public.app_users u USING(username)
 WHERE s.token_hash=p_hash AND s.expires_at>now() AND u.active
 AND s.password_version=encode(sha256(convert_to(u.password_hash,'UTF8')),'hex')
 FOR SHARE OF u,s;
 IF actor IS NULL THEN RAISE EXCEPTION 'C2: Sign in again'; END IF;
 RETURN actor;
END
$fn$;
REVOKE ALL ON FUNCTION public.c2_session_actor(text) FROM PUBLIC,js_app_runtime;

CREATE FUNCTION public.c2_require_edit(p_actor text,p_permission text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
BEGIN
 PERFORM 1 FROM public.user_access_matrix
 WHERE username=p_actor AND permission=p_permission AND access_level='Edit' FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'C2: Edit permission required'; END IF;
END
$fn$;
REVOKE ALL ON FUNCTION public.c2_require_edit(text,text) FROM PUBLIC,js_app_runtime;

CREATE FUNCTION public.c2_product_write(p_hash text,p_action text,p_id text,p_version bigint,
 p_name text,p_type text,p_brand text,p_model text,p_size text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE actor text; ident text; base text; expanded text; n integer:=1;
BEGIN
 actor:=public.c2_session_actor(p_hash);
 PERFORM public.c2_require_edit(actor,'Product Master');
 PERFORM public.c2_require_edit(actor,'Route: Bought Out');
 IF p_action NOT IN ('create','update','archive') THEN RAISE EXCEPTION 'C2: Invalid product operation'; END IF;
 LOCK TABLE public.products IN SHARE ROW EXCLUSIVE MODE;
 IF p_action<>'create' THEN
   PERFORM 1 FROM public.products WHERE product_id=p_id AND active AND row_version=p_version FOR UPDATE;
   IF NOT FOUND THEN RAISE EXCEPTION 'C2: Product changed or missing. Refresh and retry'; END IF;
   IF EXISTS (SELECT 1 FROM public.work_order_lines l JOIN public.work_orders w ON w.work_order_id=l.work_order_id
      WHERE l.product_id=p_id AND l.active AND (NOT w.active OR lower(trim(w.status)) IN ('hold','held','cancel','cancelled','canceled'))) THEN
     RAISE EXCEPTION 'C2: Product belongs to a locked work order';
   END IF;
 END IF;
 IF p_action='archive' THEN
   PERFORM public.c2_require_edit(actor,'Delete Products');
   IF EXISTS (SELECT 1 FROM public.stock_receipts WHERE product_id=p_id)
      OR EXISTS (SELECT 1 FROM public.work_order_lines WHERE product_id=p_id) THEN
     RAISE EXCEPTION 'C2: Product has inventory or work order history and cannot be archived';
   END IF;
   UPDATE public.products SET active=false,row_version=row_version+1,last_edited_by=actor,
      last_edited_at=now(),last_change='Archived' WHERE product_id=p_id;
   ident:=p_id;
 ELSE
   p_name:=trim(p_name); p_brand:=trim(p_brand);
   p_model:=regexp_replace(normalize(trim(p_model),NFKC),'\s+','','g');
   IF p_name IS NULL OR length(p_name) NOT BETWEEN 1 AND 200 OR p_brand IS NULL OR length(p_brand) NOT BETWEEN 1 AND 100
      OR p_model IS NULL OR length(p_model) NOT BETWEEN 1 AND 100 OR p_size IS NULL OR length(p_size)>200
      OR p_type NOT IN ('STD','Spare','Other') THEN RAISE EXCEPTION 'C2: Enter valid equipment, brand, model and product type'; END IF;
   IF EXISTS (SELECT 1 FROM public.products WHERE active AND (p_action='create' OR product_id<>p_id)
      AND upper(regexp_replace(normalize(trim(model),NFKC),'\s+','','g'))=upper(p_model)) THEN
      RAISE EXCEPTION 'C2: Model already exists';
   END IF;
   IF p_action='create' THEN
     base:=left(trim(both '-' from regexp_replace(upper(p_brand),'[^A-Z0-9]+','-','g')),20)||'-'||
           left(trim(both '-' from regexp_replace(upper(p_model),'[^A-Z0-9]+','-','g')),30);
     IF length(base)<3 THEN RAISE EXCEPTION 'C2: Brand and model require a usable identifier'; END IF;
     expanded:=base||'-'||left(trim(both '-' from regexp_replace(upper(p_name),'[^A-Z0-9]+','-','g')),25);
     ident:=base;
     WHILE EXISTS (SELECT 1 FROM public.products WHERE lower(product_id)=lower(ident)) LOOP
       n:=n+1; ident:=CASE WHEN n=2 THEN expanded ELSE expanded||'-'||n END;
       IF n>9999 THEN RAISE EXCEPTION 'C2: Product identifier unavailable'; END IF;
     END LOOP;
     INSERT INTO public.products(product_id,equipment_name,product_type,brand,model,size_capacity,
       created_at,last_edited_by,last_edited_at,last_change)
     VALUES(ident,p_name,p_type,p_brand,p_model,p_size,now(),actor,now(),'Created');
   ELSE
     ident:=p_id;
     UPDATE public.products SET equipment_name=p_name,product_type=p_type,brand=p_brand,model=p_model,
       size_capacity=p_size,row_version=row_version+1,last_edited_by=actor,last_edited_at=now(),
       last_change='Equipment, type or specifications' WHERE product_id=p_id;
   END IF;
 END IF;
 INSERT INTO public.audit_log(username,action,entity_type,entity_id)
 VALUES(actor,upper(p_action),'Product',ident);
 RETURN ident;
END
$fn$;
REVOKE ALL ON FUNCTION public.c2_product_write(text,text,text,bigint,text,text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.c2_product_write(text,text,text,bigint,text,text,text,text,text) TO js_app_runtime;

CREATE FUNCTION public.c2_receive_free(p_hash text,p_id text,p_product text,p_location text,p_date date,
 p_serials text[],p_cost numeric,p_vendor text,p_remarks text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE actor text; pr public.products%ROWTYPE; qty integer; s text;
BEGIN
 actor:=public.c2_session_actor(p_hash);
 PERFORM public.c2_require_edit(actor,'Stock In');
 PERFORM public.c2_require_edit(actor,'Route: Bought Out');
 IF p_id !~ '^SIN-[0-9a-f]{32}$' OR p_location NOT IN ('Bapu Nagar warehouse','Bakrol warehouse','Bapu Nagar showroom')
   OR p_date IS NULL OR p_date>(now() AT TIME ZONE 'Asia/Kolkata')::date
   OR p_cost IS NULL OR p_cost<0 OR p_cost>10000000000 OR p_cost<>round(p_cost,2)
   OR p_vendor IS NULL OR length(p_vendor)>140 OR p_remarks IS NULL OR length(p_remarks)>600
   THEN RAISE EXCEPTION 'C2: Invalid receipt details'; END IF;
 qty:=coalesce(cardinality(p_serials),0);
 IF qty NOT BETWEEN 1 AND 100 OR EXISTS (SELECT 1 FROM unnest(p_serials) AS x(v)
     WHERE v IS NULL OR length(trim(v)) NOT BETWEEN 1 AND 100 OR trim(v)<>v)
   OR (SELECT count(DISTINCT lower(trim(v))) FROM unnest(p_serials) AS x(v))<>qty
   THEN RAISE EXCEPTION 'C2: Enter 1 to 100 distinct serials, one for each unit'; END IF;
 SELECT * INTO pr FROM public.products WHERE product_id=p_product AND active FOR SHARE;
 IF NOT FOUND OR pr.product_id LIKE 'FAB-%' THEN RAISE EXCEPTION 'C2: Select an active purchased product'; END IF;
 LOCK TABLE public.stock_receipts,public.stock_units IN SHARE ROW EXCLUSIVE MODE;
 IF EXISTS (SELECT 1 FROM public.stock_units u JOIN unnest(p_serials) AS x(v) ON lower(trim(u.serial))=lower(v))
   THEN RAISE EXCEPTION 'C2: A serial already exists in inventory history'; END IF;
 INSERT INTO public.stock_receipts(stock_in_id,entry_type,product_id,purchase_date,receipt_location,
   product_type,equipment_name,brand,model,size_capacity,declared_qty,unit_cost,cost_provided,created_at,last_edited_by,last_edited_at,last_change,vendor_name,remarks)
 VALUES(p_id,'Bought Out',p_product,p_date,p_location,pr.product_type,pr.equipment_name,pr.brand,pr.model,
   pr.size_capacity,qty,p_cost,true,now(),actor,now(),'Free stock receipt',p_vendor,p_remarks);
 INSERT INTO public.stock_units(unit_id,serial,stock_in_id,location)
 SELECT p_id||'-'||ord,v,p_id,p_location FROM unnest(p_serials) WITH ORDINALITY AS x(v,ord);
 INSERT INTO public.audit_log(username,action,entity_type,entity_id,details)
 VALUES(actor,'CREATE','StockIn',p_id,jsonb_build_object('qty',qty,'location',p_location));
 RETURN p_id;
END
$fn$;
REVOKE ALL ON FUNCTION public.c2_receive_free(text,text,text,text,date,text[],numeric,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.c2_receive_free(text,text,text,text,date,text[],numeric,text,text) TO js_app_runtime;

CREATE FUNCTION public.c2_admin_write(p_hash text,p_action text,p_user text,p_password_hash text,
 p_permission text,p_level text,p_active boolean) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE actor text;
BEGIN
 actor:=public.c2_session_actor(p_hash);
 PERFORM public.c2_require_edit(actor,'Superadmin');
 IF NOT EXISTS (SELECT 1 FROM public.app_users WHERE username=actor AND team='Admin') THEN
   RAISE EXCEPTION 'C2: Admin team required';
 END IF;
 IF p_user IS NULL OR p_user !~ '^[a-z0-9][a-z0-9._-]{1,79}$' OR p_user=actor THEN
   RAISE EXCEPTION 'C2: Invalid or protected username';
 END IF;
 IF p_action NOT IN ('create','reset','active','grant') THEN RAISE EXCEPTION 'C2: Invalid account operation'; END IF;
 IF p_action IN ('create','reset') AND (p_password_hash IS NULL OR p_password_hash !~ '^scrypt\$[A-Za-z0-9_-]{22}==\$[A-Za-z0-9_-]{86}==$') THEN
   RAISE EXCEPTION 'C2: Invalid generated password hash';
 END IF;
 IF p_action='create' THEN
   IF EXISTS (SELECT 1 FROM public.app_users WHERE username=p_user) THEN RAISE EXCEPTION 'C2: Username already exists'; END IF;
   INSERT INTO public.app_users(username,password_hash,active,team) VALUES(p_user,p_password_hash,true,'Operator');
 ELSE
   PERFORM 1 FROM public.app_users WHERE username=p_user AND coalesce(team,'')<>'Admin' FOR UPDATE;
   IF NOT FOUND OR EXISTS (SELECT 1 FROM public.user_access_matrix WHERE username=p_user AND permission='Superadmin' AND access_level<>'None') THEN
     RAISE EXCEPTION 'C2: Account missing or protected';
   END IF;
   IF p_action='reset' THEN
     UPDATE public.app_users SET password_hash=p_password_hash WHERE username=p_user;
   ELSIF p_action='active' THEN
     IF p_active IS NULL THEN RAISE EXCEPTION 'C2: Select account status'; END IF;
     UPDATE public.app_users SET active=p_active WHERE username=p_user;
   ELSE
     IF p_permission IS NULL OR p_permission NOT IN ('Dashboard','Product Master','Delete Products','Work Orders','Work Order Tracker','Stock In','Stock Out','Stock Book','Route: Bought Out','Route: Fabrication','Report','Report: Inventory Serial Detail','Report: Aging Analysis','Report: Warehouse Stock','Report: Free Stock','Report: Work Order Inventory','Report: Dispatch History','Report: Product Movement','Report: Purchase Analysis','Report: Margin Analysis','Pricing','Management Pricing Dashboard','Stock Purchase Cost')
        OR p_level IS NULL OR p_level NOT IN ('None','View','Edit') THEN RAISE EXCEPTION 'C2: Invalid permission'; END IF;
     INSERT INTO public.user_access_matrix(username,permission,access_level) VALUES(p_user,p_permission,p_level)
     ON CONFLICT(username,permission) DO UPDATE SET access_level=excluded.access_level;
   END IF;
   IF p_action IN ('reset','active') THEN
     DELETE FROM public.app_sessions WHERE username=p_user;
     DELETE FROM public.login_attempts WHERE username=p_user;
   END IF;
 END IF;
 INSERT INTO public.audit_log(username,action,entity_type,entity_id,details)
 VALUES(actor,'USER_'||upper(p_action),'Account',p_user,
 CASE WHEN p_action='grant' THEN jsonb_build_object('permission',p_permission,'level',p_level) ELSE '{}'::jsonb END);
 RETURN p_user;
END
$fn$;
REVOKE ALL ON FUNCTION public.c2_admin_write(text,text,text,text,text,text,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.c2_admin_write(text,text,text,text,text,text,boolean) TO js_app_runtime;

-- Narrow tracker read: no new whole-table SELECT privileges.
GRANT SELECT(stage_id,work_order_line_id,entry_type,stage,updated_at,active) ON public.work_order_tracker TO js_app_runtime;
-- Bootstrap only the existing DA test administrator. Other users remain unchanged.
UPDATE public.app_users SET team='Admin' WHERE username='da';
INSERT INTO public.user_access_matrix(username,permission,access_level)
VALUES ('da','Superadmin','Edit'),('da','Dashboard','View'),('da','Product Master','Edit'),
 ('da','Delete Products','Edit'),('da','Work Orders','View'),('da','Work Order Tracker','View'),
 ('da','Stock In','Edit'),('da','Stock Out','View'),('da','Stock Book','View'),
 ('da','Route: Bought Out','Edit'),('da','Route: Fabrication','View')
ON CONFLICT(username,permission) DO UPDATE SET access_level=CASE
 WHEN public.user_access_matrix.access_level='Edit' THEN 'Edit' ELSE excluded.access_level END;
COMMIT;
