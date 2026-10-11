import unittest
from pathlib import Path
from scripts.deploy_frontend_v2 import ensure_nginx, patch_nginx


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

    def test_refresh_keeps_live_v2_routing_and_rejects_partial(self):
        patched = patch_nginx(Path('frontend/nginx.conf').read_text())
        self.assertEqual(ensure_nginx(patched), patched)
        self.assertEqual(ensure_nginx(Path('frontend/nginx.conf').read_text()), patched)
        with self.assertRaises(RuntimeError):
            ensure_nginx(patched.replace('location ^~ /v2/kiosk/assets/', 'location ^~ /x/'))


if __name__ == '__main__':
    unittest.main()
