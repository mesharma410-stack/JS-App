import os
import unittest
from unittest.mock import patch
from api.index import app

class PreviewSecurityTests(unittest.TestCase):
    def setUp(self):
        self.client = app.test_client()

    def test_disabled_preview_never_connects(self):
        with patch.dict(os.environ, {'ENABLE_TEST_PREVIEW':'false'}), patch('api.index.db') as db:
            for method, path in [('GET','/api/health'),('POST','/api/login'),('GET','/api/reports'),('POST','/api/reports/serial-detail'),('POST','/api/logout')]:
                self.assertEqual(self.client.open(path, method=method, json={}).status_code,503)
            db.assert_not_called()

    def test_headers_and_nonce(self):
        response=self.client.get('/')
        self.assertEqual(response.headers['Cache-Control'],'no-store')
        self.assertEqual(response.headers['X-Frame-Options'],'DENY')
        self.assertIn('script-src',response.headers['Content-Security-Policy'])
        self.assertIn(b'<script nonce="',response.data)

    def test_missing_db_url_never_connects(self):
        with patch.dict(os.environ, {'ENABLE_TEST_PREVIEW':'true','DATABASE_URL':''}), patch('api.index.db') as db:
            self.assertEqual(self.client.post('/api/login',json={}).status_code,503)
            db.assert_not_called()

if __name__=='__main__':
    unittest.main()
