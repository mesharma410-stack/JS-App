import unittest
from unittest.mock import Mock
from openpyxl import load_workbook
from backend.reports import validate_filters, workbook, route_access, build, LABELS
class ReportTests(unittest.TestCase):
    def test_same_day(self):self.assertEqual(validate_filters({'from':'2026-11-25','to':'2026-11-25'})['to'],'2026-11-25')
    def test_invalid_date(self):
        with self.assertRaises(ValueError):validate_filters({'from':'2026-02-30'})
    def test_denial(self):
        with self.assertRaises(PermissionError):route_access({'Report':'View'},'serial-detail')
    def test_financial_denial(self):
        with self.assertRaises(PermissionError):route_access({'Report':'View','Report: Margin Analysis':'View'},'margin-analysis')
    def test_workbook_text(self):
        b=load_workbook(workbook([('Test',['Serial'],[['=1+1'],['00001']])]))
        self.assertEqual(b['Test']['A2'].data_type,'s');self.assertEqual(b['Test']['A3'].value,'00001')
    def test_inventory_reports_use_unit_allocation_after_schema_expansion(self):
        for key in ('serial-detail','aging-analysis','warehouse-stock','free-stock','workorder-inventory','product-movement'):
            with self.subTest(report=key):
                cur=Mock()
                cur.fetchall.return_value=[]
                grants={'Report':'View','Report: '+LABELS[key]:'View','Route: Bought Out':'View'}
                build(cur,key,{},grants)
                sql=cur.execute.call_args.args[0]
                self.assertIn('LEFT JOIN work_orders w ON w.work_order_id=u.work_order_id',sql)
                self.assertNotIn('LEFT JOIN work_orders w USING(work_order_id)',sql)
if __name__=='__main__':unittest.main()
