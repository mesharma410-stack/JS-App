import unittest
from unittest.mock import Mock, patch
from backend.workspace import product_write, receive_free, admin_write, read_page

class WorkspaceTests(unittest.TestCase):
    def test_product_requires_both_edit_grants(self):
        cur=Mock()
        with self.assertRaises(PermissionError):
            product_write(cur,'token',{'Product Master':'Edit','Route: Bought Out':'View'},{'action':'create'})
        cur.execute.assert_not_called()

    def test_free_receipt_serial_count_and_duplicate(self):
        cur=Mock(); grants={'Stock In':'Edit','Route: Bought Out':'Edit'}
        for serials,qty in [(['a','A'],2),(['a'],2)]:
            with self.assertRaises(ValueError): receive_free(cur,'token',grants,{'serials':serials,'qty':qty})
        cur.execute.assert_not_called()

    def test_admin_cannot_grant_superadmin(self):
        cur=Mock();cur.fetchone.return_value={'team':'Admin'}
        with self.assertRaises(ValueError):
            admin_write(cur,'token','da',{'Superadmin':'Edit'},{'action':'grant','username':'operator','permission':'Superadmin','level':'Edit'})

    def test_stock_book_route_and_date_filters(self):
        cur=Mock();cur.fetchall.return_value=[]
        read_page(cur,{'Stock Book':'View','Route: Fabrication':'View'},'Stock Book',{'q':'serial','from':'2026-01-01','to':'2026-01-01'})
        sql,args=cur.execute.call_args.args
        self.assertEqual(args[0],['Fabrication'])
        self.assertIn('NOT EXISTS',sql)
        self.assertIn('r.purchase_date >= %s',sql)
