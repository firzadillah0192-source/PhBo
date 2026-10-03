"""Origin checking with explicit ports forwarded by the web proxy."""
import pytest
from fastapi import HTTPException
from starlette.requests import Request
from app.admin_auth import require_admin_csrf


def request(origin, host):
    return Request({'type': 'http', 'scheme': 'http', 'method': 'POST', 'path': '/api/admin/login',
                    'headers': [(b'origin', origin.encode()), (b'host', host.encode()),
                                (b'x-forwarded-host', host.encode())]})


@pytest.mark.parametrize('origin,host', [
    ('http://192.168.18.12:3000', '192.168.18.12:3000'),
    ('https://nxbooth.gennexbyte.com', 'nxbooth.gennexbyte.com'),
])
def test_admin_accepts_same_browser_authority(origin, host):
    require_admin_csrf(request(origin, host))


@pytest.mark.parametrize('origin', ['https://untrusted.example', 'http://192.168.18.12:3001'])
def test_admin_rejects_another_site_or_port(origin):
    with pytest.raises(HTTPException) as error:
        require_admin_csrf(request(origin, '192.168.18.12:3000'))
    assert error.value.status_code == 403
    assert error.value.detail['error_code'] == 'CSRF_BLOCKED'
