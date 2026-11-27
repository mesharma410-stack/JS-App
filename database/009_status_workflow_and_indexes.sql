-- 009: C2 Hold/Cancel and bounded read paths. Synthetic test branch ONLY.
-- Run after 007/008, once, as owner. Do not grant runtime direct writes.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='120s';
DO $guard$
BEGIN
 IF to_regprocedure('public.c2_save_new_wo(text,jsonb)') IS NULL
 OR to_regprocedure('public.c2_product_write(text,text,text,bigint,text,text,text,text,text)') IS NULL
 OR NOT EXISTS(SELECT 1 FROM public.work_orders WHERE work_order_id='DEMO-W01')
 THEN RAISE EXCEPTION 'Verify 007 and 008 on the synthetic branch before 009'; END IF;
END
$guard$;

CREATE INDEX IF NOT EXISTS c2_requests_history_idx ON public.wo_status_requests(requested_at DESC,request_id DESC);
CREATE INDEX IF NOT EXISTS c2_requests_actor_idx ON public.wo_status_requests(requested_by,requested_at DESC,request_id DESC);
CREATE INDEX IF NOT EXISTS c2_lines_product_active_idx ON public.work_order_lines(product_id,work_order_id) WHERE active;
CREATE INDEX IF NOT EXISTS c2_receipts_route_date_idx ON public.stock_receipts(entry_type,purchase_date,stock_in_id) WHERE active;
CREATE INDEX IF NOT EXISTS c2_dispatch_units_history_idx ON public.dispatch_units(unit_id) WHERE NOT active;

-- Shared status check: future operational services MUST call it on all old/new
-- WO references, holding the row lock until the transaction commits.
CREATE FUNCTION public.c2_lock_open_order(p_order text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE w public.work_orders%ROWTYPE;
BEGIN
 IF p_order IS NULL THEN RETURN; END IF;
 SELECT * INTO w FROM public.work_orders WHERE work_order_id=p_order FOR SHARE;
 IF NOT FOUND OR NOT w.active THEN RAISE EXCEPTION 'C2: Work Order missing or archived'; END IF;
 IF lower(trim(w.status)) IN ('hold','held','cancel','cancelled','canceled') THEN
   RAISE EXCEPTION 'C2: Work Order is locked. An administrator must reopen it first';
 END IF;
END
$fn$;
REVOKE ALL ON FUNCTION public.c2_lock_open_order(text) FROM PUBLIC,js_app_runtime;

-- Close the race between existing Product Master writes and a status approval.
-- No new WO-linked receiving/dispatch/revision writes are enabled by 009.
CREATE FUNCTION public.c2_product_lock_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE ident text;
BEGIN
 FOR ident IN SELECT DISTINCT l.work_order_id FROM public.work_order_lines l
   WHERE l.active AND l.product_id=OLD.product_id ORDER BY l.work_order_id
 LOOP
   PERFORM public.c2_lock_open_order(ident);
 END LOOP;
 RETURN NEW;
END
$fn$;
REVOKE ALL ON FUNCTION public.c2_product_lock_guard() FROM PUBLIC,js_app_runtime;
CREATE TRIGGER c2_product_order_guard BEFORE UPDATE ON public.products
FOR EACH ROW EXECUTE FUNCTION public.c2_product_lock_guard();

CREATE FUNCTION public.c2_status_admin(p_actor text) RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
 SELECT EXISTS(SELECT 1 FROM public.app_users u WHERE u.username=p_actor AND u.active AND u.team='Admin')
 AND EXISTS(SELECT 1 FROM public.user_access_matrix a WHERE a.username=p_actor AND a.permission='Superadmin' AND a.access_level='Edit')
 AND (SELECT count(*) FROM public.user_access_matrix a WHERE a.username=p_actor
   AND a.permission IN ('Route: Bought Out','Route: Fabrication') AND a.access_level IN ('View','Edit'))=2
$fn$;
REVOKE ALL ON FUNCTION public.c2_status_admin(text) FROM PUBLIC,js_app_runtime;

CREATE FUNCTION public.c2_status_write(p_hash text,p_action text,p_number text,p_request text,p_type text,p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE actor text; w public.work_orders%ROWTYPE; req public.wo_status_requests%ROWTYPE; ident text; note text; prior text;
BEGIN
 actor:=public.c2_session_actor(p_hash);
 PERFORM 1 FROM public.user_access_matrix WHERE username=actor AND permission='Work Orders'
 AND access_level IN ('View','Edit') FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'C2: Work Orders access required'; END IF;
 IF p_action IS NULL OR p_action NOT IN ('request','approve','reject','release') THEN RAISE EXCEPTION 'C2: Invalid action'; END IF;
 note:=trim(coalesce(p_reason,''));
 IF p_action='request' THEN
   IF p_type IS NULL OR p_type NOT IN ('Hold','Cancel') OR length(note) NOT BETWEEN 5 AND 1000
   THEN RAISE EXCEPTION 'C2: Select Hold or Cancel and enter a reason of 5 to 1000 characters'; END IF;
 ELSE
   -- Serialize permission revocation with approval/release. This explicit Admin
   -- rule is intentionally stricter than GAS Team contains Admin.
   PERFORM 1 FROM public.user_access_matrix WHERE username=actor
   AND permission IN ('Superadmin','Route: Bought Out','Route: Fabrication') FOR SHARE;
   IF NOT public.c2_status_admin(actor) THEN RAISE EXCEPTION 'C2: Authorized administrator required'; END IF;
   IF length(note)>600 OR (p_action='release' AND length(note)<5)
   THEN RAISE EXCEPTION 'C2: Enter a valid review or release reason'; END IF;
 END IF;
 IF p_action IN ('approve','reject') THEN
   SELECT work_order_id INTO ident FROM public.wo_status_requests WHERE request_id=p_request;
   IF NOT FOUND THEN RAISE EXCEPTION 'C2: Request no longer pending. Refresh'; END IF;
   SELECT * INTO w FROM public.work_orders WHERE work_order_id=ident AND active FOR UPDATE;
 ELSE
   SELECT * INTO w FROM public.work_orders WHERE lower(trim(work_order_number))=lower(trim(p_number)) AND active FOR UPDATE;
 END IF;
 IF NOT FOUND THEN RAISE EXCEPTION 'C2: Work Order not found or not accessible'; END IF;
 prior:=w.status;
 IF p_action='request' THEN
   -- Require at least one authorized active line; no order enumeration through requests.
   IF NOT EXISTS(SELECT 1 FROM public.work_order_lines l JOIN public.user_access_matrix a
       ON a.username=actor AND a.permission='Route: '||l.entry_type AND a.access_level IN ('View','Edit')
       WHERE l.work_order_id=w.work_order_id AND l.active)
   THEN RAISE EXCEPTION 'C2: Work Order not found or not accessible'; END IF;
   PERFORM public.c2_lock_open_order(w.work_order_id);
   IF EXISTS(SELECT 1 FROM public.wo_status_requests WHERE work_order_id=w.work_order_id AND decision='Pending')
   THEN RAISE EXCEPTION 'C2: A request is already awaiting approval'; END IF;
   ident:='REQ-'||replace(gen_random_uuid()::text,'-','');
   INSERT INTO public.wo_status_requests(request_id,work_order_id,request_type,reason,requested_by,requested_at)
   VALUES(ident,w.work_order_id,p_type,note,actor,now());
   INSERT INTO public.audit_log(username,action,entity_type,entity_id,details)
   VALUES(actor,'WO_STATUS_REQUEST','WorkOrder',w.work_order_id,jsonb_build_object('requestId',ident,'type',p_type));
   RETURN jsonb_build_object('ok',true,'message',p_type||' request submitted; global status unchanged.');
 ELSIF p_action='release' THEN
   IF lower(trim(prior)) NOT IN ('hold','held','cancel','cancelled','canceled')
   THEN RAISE EXCEPTION 'C2: Work Order is not locked. Refresh'; END IF;
   UPDATE public.work_orders SET status='Open',last_edited_by=actor,last_edited_at=now(),
   last_change='Admin reopened '||prior,row_version=row_version+1 WHERE work_order_id=w.work_order_id;
   INSERT INTO public.audit_log(username,action,entity_type,entity_id,details)
   VALUES(actor,'WO_STATUS_RELEASED','WorkOrder',w.work_order_id,jsonb_build_object('from',prior,'to','Open','reason',note));
   RETURN jsonb_build_object('ok',true,'message','Work Order reopened; reason recorded.');
 ELSE
   SELECT * INTO req FROM public.wo_status_requests WHERE request_id=p_request AND work_order_id=w.work_order_id FOR UPDATE;
   IF NOT FOUND OR req.decision<>'Pending' THEN RAISE EXCEPTION 'C2: Request no longer pending. Refresh'; END IF;
   IF p_action='approve' THEN
     PERFORM public.c2_lock_open_order(w.work_order_id);
     UPDATE public.work_orders SET status=req.request_type,last_edited_by=actor,last_edited_at=now(),
       last_change='Admin approved '||req.request_type,row_version=row_version+1 WHERE work_order_id=w.work_order_id;
   END IF;
   UPDATE public.wo_status_requests SET decision=CASE WHEN p_action='approve' THEN 'Approved' ELSE 'Rejected' END,
     reviewed_by=actor,reviewed_at=now(),review_comment=note WHERE request_id=p_request;
   INSERT INTO public.audit_log(username,action,entity_type,entity_id,details)
   VALUES(actor,CASE WHEN p_action='approve' THEN 'WO_STATUS_APPROVED' ELSE 'WO_STATUS_REJECTED' END,
     'WorkOrder',w.work_order_id,jsonb_build_object('requestId',p_request,'type',req.request_type,'reason',req.reason));
   RETURN jsonb_build_object('ok',true,'message',req.request_type||CASE WHEN p_action='approve' THEN ' request approved.' ELSE ' request rejected.' END);
 END IF;
END
$fn$;
REVOKE ALL ON FUNCTION public.c2_status_write(text,text,text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.c2_status_write(text,text,text,text,text,text) TO js_app_runtime;

CREATE FUNCTION public.c2_status_read(p_hash text,p_kind text,p_before timestamptz,p_id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE actor text; admin boolean; records jsonb;
BEGIN
 actor:=public.c2_session_actor(p_hash);
 IF NOT EXISTS(SELECT 1 FROM public.user_access_matrix WHERE username=actor AND permission='Work Orders' AND access_level IN ('View','Edit'))
 THEN RAISE EXCEPTION 'C2: Work Orders access required'; END IF;
 admin:=public.c2_status_admin(actor);
 IF p_kind='requests' THEN
   SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q."Requested at" DESC,q.id DESC),'[]'::jsonb) INTO records
   FROM (SELECT r.request_id AS id,w.work_order_number AS "Work Order",r.request_type AS "Request",
      r.reason AS "Reason",r.requested_by AS "Requested by",r.requested_at AS "Requested at",
      r.decision AS "Decision",r.reviewed_by AS "Reviewed by",r.reviewed_at AS "Reviewed at",r.review_comment AS "Comment"
      FROM public.wo_status_requests r JOIN public.work_orders w ON w.work_order_id=r.work_order_id
      WHERE (admin OR r.requested_by=actor)
      AND (p_before IS NULL OR (r.requested_at,r.request_id)<(p_before,p_id))
      ORDER BY r.requested_at DESC,r.request_id DESC LIMIT 51) q;
 ELSIF p_kind='locked' AND admin THEN
   SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.id),'[]'::jsonb) INTO records
   FROM (SELECT w.work_order_id AS id,w.work_order_number AS "Work Order",w.status AS "Status",
         w.last_edited_by AS "Last edited by",w.last_edited_at AS "Updated"
      FROM public.work_orders w WHERE w.active AND lower(trim(w.status)) IN ('hold','held','cancel','cancelled','canceled')
      AND w.work_order_id>coalesce(p_id,'') ORDER BY w.work_order_id LIMIT 51) q;
 ELSE RAISE EXCEPTION 'C2: Invalid or unauthorized status view';
 END IF;
 RETURN jsonb_build_object('admin',admin,'rows',records);
END
$fn$;
REVOKE ALL ON FUNCTION public.c2_status_read(text,text,timestamptz,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.c2_status_read(text,text,timestamptz,text) TO js_app_runtime;
COMMIT;
