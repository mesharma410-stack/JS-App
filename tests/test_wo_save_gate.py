import unittest
from unittest.mock import Mock
from backend.wo_import import save_new

class WorkOrderSaveGateTests(unittest.TestCase):
    def test_view_user_cannot_create(self):
        cur=Mock()
        with self.assertRaises(PermissionError):
            save_new(cur,'test-token',{'Work Orders':'View'},{})
        cur.execute.assert_not_called()

    def test_missing_route_edit_cannot_save(self):
        cur=Mock();cur.fetchone.return_value=None;cur.fetchall.return_value=[]
        draft={'meta':{'workOrderNumber':'DEMO-NEW','workOrderDate':'2026-11-27','quoteReference':'DEMO-Q'},'items':[
            {'entryType':'Fabrication','description':'Demo table','qty':1}]}
        with self.assertRaises(PermissionError):
            save_new(cur,'test-token',{'Work Orders':'Edit','Route: Fabrication':'View'},draft)
        self.assertTrue(all('c2_save_new_wo' not in c.args[0] for c in cur.execute.call_args_list))
