import io
import sys
import types

import pytest

import emails
import lambda_function
from importer import db


class FakeS3:
    def __init__(self, objects):
        self.objects = objects

    def get_object(self, Bucket, Key):
        return {"Body": io.BytesIO(self.objects[(Bucket, Key)])}


class FakeConn:
    def __init__(self):
        self.closed = False
        self.rolled_back = False

    def rollback(self):
        self.rolled_back = True

    def close(self):
        self.closed = True


@pytest.fixture
def env(monkeypatch):
    calls = {"inserted": [], "status": []}
    conn = FakeConn()
    monkeypatch.setenv("IMPORT_SOURCE", "santander")
    monkeypatch.setenv("PIGGY_USER_ID", "u1")
    monkeypatch.setenv("SUPABASE_DB_URL", "postgresql://x")
    monkeypatch.setenv("SANTANDER_SENDER", "santander.com.ar")
    monkeypatch.setenv("FORWARDING_GMAIL", emails.GMAIL)
    monkeypatch.setattr(db, "connect", lambda url: conn)
    monkeypatch.setattr(db, "load_settings", lambda c, u: db.Settings({"since": "2026-10-01"}))
    monkeypatch.setattr(db, "insert_entries", lambda c, u, entries: calls["inserted"].extend(entries) or len(list(entries)))
    monkeypatch.setattr(db, "update_status", lambda c, u, source, fields: calls["status"].append((source, fields)))
    return calls, conn


def s3_event(*keys):
    return {"Records": [{"s3": {"bucket": {"name": "mail"}, "object": {"key": k}}} for k in keys]}


def install_s3(monkeypatch, objects):
    fake = types.SimpleNamespace(client=lambda name: FakeS3(objects))
    monkeypatch.setitem(sys.modules, "boto3", fake)


def test_santander_event_imports_gated_alerts(env, monkeypatch):
    calls, conn = env
    install_s3(monkeypatch, {
        ("mail", "santander/1"): emails.CARD_PURCHASE,
        ("mail", "santander/2"): emails.build("Aviso", "<p>x</p>", forwarded=False),
        ("mail", "santander/3"): emails.TRANSFER_IN,  # disabled by default
    })
    result = lambda_function.handler(s3_event("santander/1", "santander/2", "santander/3"), None)
    assert result == {"imported": 1}
    assert [e.kind for e in calls["inserted"]] == ["card_purchase"]
    # Forwarding works now, so a stale confirmation code is cleared; then the run is recorded.
    assert calls["status"][0] == ("santander", {"forwarding_code": None})
    source, fields = calls["status"][-1]
    assert source == "santander" and fields["imported"] == 1 and fields["last_error"] is None
    assert conn.closed


def test_forwarding_confirmation_is_stored(env, monkeypatch):
    calls, _ = env
    install_s3(monkeypatch, {("mail", "k"): emails.FORWARDING_CONFIRMATION})
    lambda_function.handler(s3_event("k"), None)
    assert ("santander", {"forwarding_code": "123456789"}) in calls["status"]
    assert calls["inserted"] == []


def test_failures_are_recorded_and_raised(env, monkeypatch):
    calls, conn = env
    install_s3(monkeypatch, {})  # missing object -> KeyError
    with pytest.raises(KeyError):
        lambda_function.handler(s3_event("missing"), None)
    source, fields = calls["status"][-1]
    assert source == "santander" and fields["last_error"]
    assert conn.rolled_back and conn.closed


def test_settings_skip_disabled_kinds_and_old_dates():
    settings = db.Settings({"kinds": {"mp_outflow": False}, "since": "2026-10-10"})
    from importer.common import Entry
    assert not settings.wants(Entry("mercadopago", "a", "mp_outflow", date="2026-10-12"))
    assert not settings.wants(Entry("santander", "b", "card_purchase", date="2026-10-09"))
    assert settings.wants(Entry("santander", "c", "card_purchase", date="2026-10-10"))
    assert not settings.wants(Entry("santander", "d", "transfer_in", date="2026-10-12"))  # off by default
    assert not settings.wants(Entry("mercadopago", "f", "mp_interest", date="2026-10-12"))  # off by default
    assert db.Settings({"kinds": {"mp_interest": True}}).wants(Entry("mercadopago", "g", "mp_interest"))
    # Unparsed emails always reach the Inbox.
    assert settings.wants(Entry("santander", "e", "unknown"))
