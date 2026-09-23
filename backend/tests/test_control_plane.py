from __future__ import annotations

from uuid import uuid4

import pytest

from app.admin_auth import ADMIN_COOKIE
from app.auth import create_auth_session, sign_value
from app.auth_models import Account, AdminUser, AuthIdentity, CreditLedgerEntry
from app.services.google_auth import GoogleClaims, validate_google_claims

ADMIN_HEADERS = {"X-Admin-Token": "test-admin-token"}


def _new_email():
    return f"control-{uuid4().hex[:10]}@example.com"


def test_google_claim_validation_rejects_wrong_issuer_and_audience():
    claims = {"iss": "https://accounts.google.com", "aud": "client-123", "sub": "google-sub", "email": "user@example.com", "email_verified": True}
    assert validate_google_claims(claims, client_id="client-123").subject == "google-sub"
    with pytest.raises(ValueError):
        validate_google_claims({**claims, "iss": "evil.example"}, client_id="client-123")
    with pytest.raises(ValueError):
        validate_google_claims({**claims, "aud": "wrong"}, client_id="client-123")


def test_google_signin_creates_idempotent_signup_grant(client, db_session, monkeypatch):
    import app.routers.account as account_router

    monkeypatch.setattr(account_router, "verify_google_id_token", lambda _token: GoogleClaims("google-sub-1", _new_email(), "Google User", "https://example/avatar"))
    first = client.post("/api/account/google", json={"id_token": "x" * 24})
    assert first.status_code == 200, first.text
    email = first.json()["email"]
    account = db_session.query(Account).filter(Account.email == email).one()
    assert db_session.query(AuthIdentity).filter(AuthIdentity.account_id == account.id).count() == 1
    assert db_session.query(CreditLedgerEntry).filter(CreditLedgerEntry.user_id == account.id, CreditLedgerEntry.type == "signup_bonus").count() == 1

    second = client.post("/api/account/google", json={"id_token": "x" * 24})
    assert second.status_code == 200
    db_session.expire_all()
    assert db_session.query(CreditLedgerEntry).filter(CreditLedgerEntry.user_id == account.id, CreditLedgerEntry.type == "signup_bonus").count() == 1
    assert client.get("/api/account/usage").json()["ai_total"] == 5


def test_operational_admin_endpoints_and_credit_idempotency(client, db_session):
    email = _new_email()
    created = client.post("/api/account/signup", json={"email": email, "password": "correct horse battery"})
    assert created.status_code == 201
    account = db_session.query(Account).filter(Account.email == email).one()

    assert client.get("/api/admin/overview", headers=ADMIN_HEADERS).status_code == 200
    users = client.get("/api/admin/users", headers=ADMIN_HEADERS).json()
    assert any(row["id"] == account.id for row in users["users"])
    assert client.get("/api/admin/settings", headers=ADMIN_HEADERS).status_code == 200

    action = {"amount": 3, "reason": "Support compensation", "confirm": True, "idempotency_key": "test-credit-" + account.id}
    first = client.post(f"/api/admin/users/{account.id}/credits", headers=ADMIN_HEADERS, json=action)
    second = client.post(f"/api/admin/users/{account.id}/credits", headers=ADMIN_HEADERS, json=action)
    assert first.status_code == second.status_code == 200
    assert first.json()["changed"] is True and second.json()["changed"] is False
    db_session.expire_all()
    account = db_session.get(Account, account.id)
    assert account.ai_quota_total == 8
    assert db_session.query(CreditLedgerEntry).filter(CreditLedgerEntry.idempotency_key == action["idempotency_key"]).count() == 1

    plan_id = "test-plan-" + uuid4().hex[:8]
    plan = client.post("/api/admin/plans", headers=ADMIN_HEADERS, json={"id": plan_id, "code": plan_id, "name": "Test Plan", "monthly_ai_credits": 4})
    assert plan.status_code == 201
    assigned = client.post(f"/api/admin/users/{account.id}/subscription", headers=ADMIN_HEADERS, json={"action": "assign", "plan_id": plan_id, "reason": "Test assignment", "confirm": True})
    assert assigned.status_code == 200
    repeated = client.post(f"/api/admin/users/{account.id}/subscription", headers=ADMIN_HEADERS, json={"action": "assign", "plan_id": plan_id, "reason": "Test assignment", "confirm": True})
    assert repeated.status_code == 200
    db_session.expire_all()
    assert db_session.get(Account, account.id).ai_quota_total == 12
    audit = client.get("/api/admin/audit", headers=ADMIN_HEADERS).json()
    assert any(row["action"] == "credit_granted" for row in audit)
    assert any(row["action"] == "subscription_assign" for row in audit)


def test_admin_role_permissions_are_server_side(client, db_session):
    actor = AdminUser(id="operator-test", name="Operator", role="operator", is_active=True)
    db_session.add(actor)
    db_session.commit()
    raw = create_auth_session(db_session, is_admin=True, admin_user_id=actor.id, admin_role="operator")
    client.cookies.set(ADMIN_COOKIE, sign_value(raw))
    assert client.get("/api/admin/overview").status_code == 200
    assert client.get("/api/admin/experiences").status_code == 403
    assert client.post("/api/admin/plans", json={"id": "blocked-plan", "code": "blocked-plan", "name": "Blocked"}).status_code == 403


def test_admin_csrf_accepts_same_public_origin_behind_tls_proxy(client):
    headers = {
        **ADMIN_HEADERS,
        "Origin": "https://admin.example.com",
        "Host": "admin.example.com",
        "X-Forwarded-Proto": "https",
    }
    plan_id = "csrf-proxy-plan-" + uuid4().hex[:8]
    response = client.post(
        "/api/admin/plans",
        headers=headers,
        json={"id": plan_id, "code": plan_id, "name": "Proxy origin test", "monthly_ai_credits": 1},
    )
    assert response.status_code == 201, response.text
