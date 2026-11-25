import unittest
from openpyxl import load_workbook
from backend.reports import validate_filters, workbook, route_access
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
if __name__=='__main__':unittest.main()
