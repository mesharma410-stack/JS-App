import unittest
from unittest.mock import Mock
from backend.c2_read import products,dashboard

class C2ReadTests(unittest.TestCase):
    def test_page_and_route_required(self):
        cur=Mock()
        for grants in ({'Dashboard':'View'}, {'Route: Bought Out':'View'}):
            with self.assertRaises(PermissionError): dashboard(cur,grants)
        with self.assertRaises(PermissionError):
            products(cur,{'Product Master':'View','Route: Fabrication':'Edit'})
        cur.execute.assert_not_called()

    def test_product_pagination_and_parameters(self):
        cur=Mock()
        cur.fetchall.return_value=[{'productId':str(i)} for i in range(51)]
        result=products(cur,{'Product Master':'View','Route: Bought Out':'View'},"O'Reilly",'cursor')
        self.assertEqual(len(result['products']),50)
        self.assertEqual(result['next'],'49')
        sql,args=cur.execute.call_args.args
        self.assertEqual(args,('cursor',"O'Reilly"))
        self.assertNotIn('default_unit_cost',sql)

    def test_dashboard_counts_and_route_filter(self):
        cur=Mock()
        cur.fetchall.return_value=[
            {'location':'Bapu Nagar warehouse','engaged':False,'bucket':2,'qty':2,'aged':2},
            {'location':'Bakrol warehouse','engaged':True,'bucket':0,'qty':3,'aged':0}]
        result=dashboard(cur,{'Dashboard':'View','Route: Bought Out':'View'})
        self.assertEqual([result[k]['qty'] for k in ('physical','free','engaged','critical')],[5,2,3,2])
        self.assertEqual(cur.execute.call_args.args[1][1],['Bought Out'])
        self.assertEqual(result['aging'][2]['free'],2)
        self.assertIn('NOT EXISTS',cur.execute.call_args.args[0])
