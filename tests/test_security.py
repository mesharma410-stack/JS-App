import os
import unittest
import bcrypt
from backend.auth import check_password_hash, generate_password_hash
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

class PasswordFormatTests(unittest.TestCase):
    def test_existing_scrypt(self):
        p='synthetic test password'
        h=generate_password_hash(p)
        self.assertTrue(check_password_hash(h,p))
        self.assertFalse(check_password_hash(h,p+'x'))

    def test_pgcrypto_bcrypt_prefix_and_wrong_password(self):
        p='synthetic test password'
        for prefix in (b'2a',b'2b'):
            h=bcrypt.hashpw(p.encode(),bcrypt.gensalt(rounds=12,prefix=prefix)).decode()
            self.assertTrue(check_password_hash(h,p))
            self.assertFalse(check_password_hash(h,p+'x'))
            if prefix==b'2b':
                self.assertTrue(check_password_hash('$2y$'+h[4:],p))

    def test_reject_invalid_bcrypt_and_long_inputs(self):
        p='synthetic test password'
        h=bcrypt.hashpw(p.encode(),bcrypt.gensalt(rounds=12)).decode()
        for candidate in ('a'*73,'é'*37,'a\x00b'):
            self.assertFalse(check_password_hash(h,candidate))
        self.assertFalse(check_password_hash(h[:4]+'31'+h[6:],p))
        self.assertFalse(check_password_hash('PASTE_YOUR_GENERATED_HASH_HERE',p))
        self.assertFalse(check_password_hash(None,p))

if __name__=='__main__':
    unittest.main()
