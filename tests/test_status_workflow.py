import unittest
from unittest.mock import Mock
from backend.status_workflow import status_write,status_read
from backend.reports import collect,workbook,LABELS
from backend.workspace import read_page
from openpyxl import load_workbook

class StatusTests(unittest.TestCase):
    def test_request_view_allowed_and_no_direct_write(self):
        cur=Mock();cur.fetchone.return_value={'result':{'ok':True}}
        status_write(cur,'dummy',{'Work Orders':'View'},{'action':'request','number':'DEMO-WO-001','type':'Hold','reason':'Testing only'})
        self.assertIn('c2_status_write',cur.execute.call_args.args[0])
        self.assertNotIn('UPDATE',cur.execute.call_args.args[0])
    def test_operator_cannot_approve(self):
        cur=Mock()
        with self.assertRaises(PermissionError):
            status_write(cur,'dummy',{'Work Orders':'Edit'},{'action':'approve','id':'REQ-test'})
        cur.execute.assert_not_called()
    def test_reason_required(self):
        cur=Mock()
        with self.assertRaises(ValueError):
            status_write(cur,'dummy',{'Work Orders':'View'},{'action':'request','number':'DEMO-WO-001','type':'Cancel','reason':'no'})
        cur.execute.assert_not_called()
    def test_bounded_cursor(self):
        cur=Mock();cur.fetchone.return_value={'result':{'admin':False,'rows':[{'id':str(i),'Requested at':'2026-11-27T10:00:00+00:00'} for i in range(51)]}}
        result=status_read(cur,'dummy',{'Work Orders':'View'},{})
        self.assertEqual(len(result['rows']),50);self.assertEqual(result['next']['id'],'49')
    def test_stock_book_left_join(self):
        cur=Mock();cur.fetchall.return_value=[]
        read_page(cur,{'Stock Book':'View','Route: Fabrication':'View'},'Stock Book',{})
        self.assertIn('LEFT JOIN products',cur.execute.call_args.args[0])
    def test_report_collect_before_workbook(self):
        cur=Mock();cur.fetchall.return_value=[]
        tabs,name=collect(cur,'aging-analysis',{}, {'Report':'View','Report: '+LABELS['aging-analysis']:'View','Route: Fabrication':'View'})
        self.assertIn('LEFT JOIN products',cur.execute.call_args.args[0])
        book=load_workbook(workbook(tabs))
        self.assertIn('Aging Analysis',book.sheetnames)
        book.close()
    def test_streamed_workbook_preserves_text(self):
        book=load_workbook(workbook([('Test',['Serial'],[['=1+1'],['00001']])]))
        sheet=book['Test']
        self.assertEqual(sheet['A2'].data_type,'s')
        self.assertEqual(sheet['A3'].value,'00001')
        self.assertEqual(sheet.auto_filter.ref,'A1:A3')
        book.close()
