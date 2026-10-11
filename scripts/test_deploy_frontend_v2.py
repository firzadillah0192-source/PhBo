import unittest
from pathlib import Path
from scripts.deploy_frontend_v2 import patch_nginx


class RoutingTest(unittest.TestCase):
    def test_additive_routes_and_token_redaction(self):
        original = Path('frontend/nginx.conf').read_text()
        patched = patch_nginx(original)
        for prefix in ['/v2', '/v2/admin', '/v2/kiosk']:
            self.assertIn(f'location ^~ {prefix}/assets/', patched)
            self.assertIn(f'try_files $uri $uri/ {prefix}/index.html;', patched)
        self.assertIn('location /api/', patched)
        self.assertIn('location ^~ /r/', patched)
        self.assertIn('try_files $uri $uri/ /index.html;', patched)
        self.assertIn('~^/v2/(r|claim)/', patched)
        self.assertIn('~*/v2/(r|claim)/', patched)
        self.assertIn('Referrer-Policy "no-referrer" always', patched)
        self.assertIn('"$photobooth_v2_safe_referrer"', patched)

    def test_refuses_ambiguous_or_existing_v2_routing(self):
        with self.assertRaises(RuntimeError):
            patch_nginx('server {}')
        with self.assertRaises(RuntimeError):
            patch_nginx('location /v2/ { }')


if __name__ == '__main__':
    unittest.main()
