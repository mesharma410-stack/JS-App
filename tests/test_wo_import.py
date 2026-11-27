import io
import unittest
from unittest.mock import Mock
from openpyxl import Workbook
from backend.wo_import import Master, read_original, validate

def master_row(id='P1',model='M-100',description='Demo mixer',brand='Demo'):
    return dict(productId=id,model=model,description=description,brand=brand,size='10 L',category='STD')

class WorkOrderImportTests(unittest.TestCase):
    def test_match_and_conflict(self):
        m=Master([master_row()])
        self.assertEqual(m.resolve(dict(model=' m-100 ',description='',brand=''))[0]['productId'],'P1')
        self.assertIsNone(m.resolve(dict(model='M-100',description='Demo mixer',brand='Other'))[0])
        self.assertIsNone(Master([master_row(),master_row('P2')]).resolve(dict(model='M-100',description='',brand=''))[0])

    def test_original_workbook(self):
        b=Workbook();s=b.active;s.title='Sheet1'
        s.append(['WORK ORDER NO: DEMO-WO-NEW','ORDER DATE: 27-11-2026'])
        s.append(['NO','PRODUCT NAME','SIZE','QTY','MODEL','BOUGHT OUT','VENDOR','PHASE','REMARKS','DESCRIPTION'])
        s.append(['1','Demo mixer','',2,'M-100','Y','Demo','PH-01','',''])
        s.append(['2','Custom demo table','800 mm',1,'','','','PH-01','',''])
        s.append(['TOTAL'])
        out=io.BytesIO();b.save(out);b.close()
        d=read_original(out.getvalue())
        self.assertEqual(d['meta']['workOrderNumber'],'DEMO-WO-NEW')
        self.assertEqual(d['meta']['workOrderDate'],'2026-11-27')
        self.assertEqual(d['items'][1]['entryType'],'N')
        self.assertEqual(d['items'][0]['sourceRow'],3)

    def test_preview_separate_routes_and_errors(self):
        cur=Mock();cur.fetchall.return_value=[master_row()];cur.fetchone.return_value=None
        grants={'Work Orders':'View','Route: Bought Out':'View','Route: Fabrication':'View'}
        d=validate(cur,grants,{'meta':{'workOrderNumber':'DEMO-NEW'},'items':[
            {'entryType':'Y','model':'M-100','qty':'2'},
            {'entryType':'N','description':'Custom demo table','qty':'1'},
            {'entryType':'Y','model':'MISSING','qty':'1','sourceRow':9,'sourceSheet':'Sheet1'}]})
        self.assertFalse(d['ok']);self.assertEqual(d['items'][0]['productId'],'P1')
        self.assertEqual(d['items'][1]['productId'],'');self.assertEqual(d['errors'][0]['cell'],'Sheet1!E9')
        self.assertTrue(all('INSERT' not in c.args[0] for c in cur.execute.call_args_list))

    def test_reject_formula_and_unauthorized_route(self):
        cur=Mock();cur.fetchone.return_value=None
        d=validate(cur,{'Work Orders':'View','Route: Fabrication':'View'},
          {'meta':{'workOrderNumber':'DEMO-NEW'},'items':[{'entryType':'Y','description':'=1+1','qty':'1'}]})
        self.assertFalse(d['ok']);self.assertEqual(len(d['errors']),2)
