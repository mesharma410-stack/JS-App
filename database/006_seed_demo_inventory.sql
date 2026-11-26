-- SYNTHETIC TEST DATA ONLY. Run once as owner on JS-App-Test-Branch, never main.
-- Aborts if any inventory/work-order data already exists; does not delete or overwrite records.
BEGIN;
SET LOCAL lock_timeout = '5s';
LOCK TABLE products, work_orders, work_order_lines, stock_receipts, stock_units,
  dispatches, dispatch_units, work_order_pricing IN SHARE ROW EXCLUSIVE MODE;
DO $demo$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM app_users WHERE username='da' AND active) THEN
    RAISE EXCEPTION 'Expected active test account da';
  END IF;
  IF EXISTS (SELECT 1 FROM products UNION ALL SELECT 1 FROM work_orders
    UNION ALL SELECT 1 FROM work_order_lines UNION ALL SELECT 1 FROM stock_receipts
    UNION ALL SELECT 1 FROM stock_units UNION ALL SELECT 1 FROM dispatches
    UNION ALL SELECT 1 FROM dispatch_units UNION ALL SELECT 1 FROM work_order_pricing) THEN
    RAISE EXCEPTION 'Inventory tables are not empty. Stop and review; do not delete existing data.';
  END IF;
END;
$demo$;
INSERT INTO products(product_id,equipment_name,product_type,brand,model,size_capacity)
VALUES ('DEMO-P01','Demo work table','STD','Demo Brand','DEMO-T1','1200 mm'),
       ('DEMO-P02','Demo sink','STD','Demo Brand','DEMO-S1','900 mm'),
       ('DEMO-P03','Demo mixer','STD','Demo Brand','DEMO-M1','10 L');
INSERT INTO work_orders(work_order_id,work_order_number,order_type,sales_person,creation_date,promise_date,status,customer_name)
VALUES ('DEMO-W01','DEMO-WO-001','Project','Demo Executive',current_date-50,current_date+15,'Open','Demo Customer A'),
       ('DEMO-W02','DEMO-WO-002','Retail','Demo Executive',current_date-35,current_date+5,'Open','Demo Customer B');
INSERT INTO work_order_lines(line_id,work_order_id,product_id,equipment_name,model,brand,entry_type,planned_qty)
VALUES ('DEMO-L01','DEMO-W01','DEMO-P02','Demo sink','DEMO-S1','Demo Brand','Bought Out',3),
       ('DEMO-L02','DEMO-W02','DEMO-P03','Demo mixer','DEMO-M1','Demo Brand','Bought Out',1);
INSERT INTO stock_receipts(stock_in_id,entry_type,product_id,work_order_line_id,purchase_date,receipt_location,work_order_id,declared_qty,unit_cost,cost_provided)
VALUES ('DEMO-R01','Bought Out','DEMO-P01',NULL,current_date-100,'Bapu Nagar warehouse',NULL,2,10000,true),
       ('DEMO-R02','Bought Out','DEMO-P02','DEMO-L01',current_date-20,'Bakrol warehouse','DEMO-W01',3,8000,true),
       ('DEMO-R03','Bought Out','DEMO-P03','DEMO-L02',current_date-10,'Bapu Nagar showroom','DEMO-W02',1,15000,true);
INSERT INTO stock_units(unit_id,serial,stock_in_id,location,work_order_id)
VALUES ('DEMO-U01','DEMO-SN-001','DEMO-R01','Bapu Nagar warehouse',NULL),
       ('DEMO-U02','DEMO-SN-002','DEMO-R01','Bapu Nagar warehouse',NULL),
       ('DEMO-U03','DEMO-SN-003','DEMO-R02','Bakrol warehouse','DEMO-W01'),
       ('DEMO-U04','DEMO-SN-004','DEMO-R02','Bakrol warehouse','DEMO-W01'),
       ('DEMO-U05','DEMO-SN-005','DEMO-R02','Bakrol warehouse','DEMO-W01'),
       ('DEMO-U06','DEMO-SN-006','DEMO-R03','Bapu Nagar showroom','DEMO-W02');
INSERT INTO dispatches(stock_out_id,work_order_id,location,dispatch_date,dispatch_mode)
VALUES ('DEMO-D01','DEMO-W02','Bapu Nagar showroom',current_date-2,'Complete');
INSERT INTO dispatch_units(stock_out_id,unit_id) VALUES ('DEMO-D01','DEMO-U06');
INSERT INTO work_order_pricing(line_id,purchase_unit_price,selling_unit_price,purchase_set,selling_set)
VALUES ('DEMO-L01',8000,12000,true,true),('DEMO-L02',15000,22000,true,true);
-- Enable only read access to the new test pages for existing da. Preserve Edit.
INSERT INTO user_access_matrix(username,permission,access_level)
VALUES ('da','Dashboard','View'),('da','Product Master','View')
ON CONFLICT(username,permission) DO UPDATE SET access_level=
  CASE WHEN user_access_matrix.access_level='Edit' THEN 'Edit' ELSE 'View' END;
COMMIT;
-- Expected physical 5, free 2, engaged 3, critical free 2 (90-day default).
-- This is a report fixture, NOT a complete valid operational WO/version/stage history.
