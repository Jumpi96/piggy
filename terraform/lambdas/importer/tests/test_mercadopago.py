import json
from collections import Counter
from datetime import datetime, timezone

import pytest

from conftest import FIXTURES
from importer.mercadopago import Client, MercadoPagoError, parse_release_csv, recent_report_files, run_daily


def report_text():
    return (FIXTURES / "synthetic_mp_release.csv").read_text()


def test_keeps_outflows_and_interest_only():
    entries = parse_release_csv(report_text())
    assert [(e.kind, e.direction, e.amount_cents) for e in entries] == [
        ("mp_outflow", "expense", 1234567),
        ("mp_outflow", "expense", 250000),
        ("mp_interest", "income", 8812),
        ("mp_outflow", "expense", 2000000),  # withdrawal: imported, the user dismisses it
    ]
    # Balance/total rows, the incoming transfer and the zero row are gone.
    assert all(e.source == "mercadopago" and e.currency_code == "ARS" and e.account_ref == "mp" for e in entries)


def test_dates_are_argentina_local():
    entries = parse_release_csv(report_text())
    # 23:40 GMT-3 on the 12th stays on the 12th.
    assert entries[1].date == "2026-10-12"
    assert entries[2].date == "2026-10-13"


def test_external_ids_use_source_id_or_a_row_hash():
    entries = parse_release_csv(report_text())
    assert entries[0].external_id == "90000000001:mp_outflow"
    assert entries[2].external_id == "90000000003:mp_interest"
    withdrawal = entries[3]
    assert withdrawal.external_id.startswith("sha256:")
    # Same row parsed again -> same id (idempotent re-runs).
    assert parse_release_csv(report_text())[3].external_id == withdrawal.external_id


def test_description_and_raw_row():
    entry = parse_release_csv(report_text())[1]
    assert entry.description == "payment · account_money · ORDER-77"
    assert entry.raw["SOURCE_ID"] == "90000000002"


def test_collects_stats_for_verification():
    stats: dict[str, Counter] = {}
    parse_release_csv(report_text(), stats=stats)
    assert stats["payment_methods"]["account_money"] == 3
    assert stats["inflow_descriptions"] == Counter({"asset_management": 1, "money_transfer": 1})


def test_comma_separated_reports_parse_too():
    text = report_text().replace(";", ",")
    assert len(parse_release_csv(text)) == 4


def test_interest_markers_are_configurable():
    entries = parse_release_csv(report_text(), interest_markers=("money_transfer",))
    assert [e.kind for e in entries].count("mp_interest") == 1
    assert any(e.amount_cents == 5000000 and e.kind == "mp_interest" for e in entries)


def test_recent_report_files_filters_by_age_and_status():
    now = datetime(2026, 10, 14, 12, tzinfo=timezone.utc)
    reports = [
        {"file_name": "old.csv", "date_created": "2026-10-01T09:00:00Z", "status": "processed"},
        {"file_name": "b.csv", "date_created": "2026-10-13T09:00:00Z", "status": "processed"},
        {"file_name": "a.csv", "date_created": "2026-10-12T09:00:00Z"},
        {"file_name": "pending.csv", "date_created": "2026-10-14T09:00:00Z", "status": "pending"},
        {"file_name": "not-a-report.xlsx", "date_created": "2026-10-14T09:00:00Z"},
    ]
    assert recent_report_files(reports, now) == ["a.csv", "b.csv"]


class FakeHttp:
    def __init__(self, responses):
        self.responses = responses  # list of (status, body) consumed in order
        self.calls = []

    def __call__(self, method, url, body=None):
        self.calls.append((method, url, body))
        return self.responses.pop(0)


def test_run_daily_downloads_and_dedupes_across_reports():
    listing = json.dumps([
        {"file_name": "r1.csv", "date_created": "2026-10-13T09:00:00Z", "status": "processed"},
        {"file_name": "r2.csv", "date_created": "2026-10-14T09:00:00Z", "status": "processed"},
    ]).encode()
    http = FakeHttp([(200, listing), (200, report_text().encode()), (200, report_text().encode())])
    entries, info = run_daily(Client("t", http=http), now=datetime(2026, 10, 14, 12, tzinfo=timezone.utc))
    assert len(entries) == 4  # the overlapping second report adds nothing new
    assert info["reports"] == ["r1.csv", "r2.csv"]
    assert [c[1].rsplit("/", 1)[1] for c in http.calls] == ["list", "r1.csv", "r2.csv"]


def test_bad_token_raises_a_clear_error():
    client = Client("t", http=FakeHttp([(401, b"unauthorized")]))
    with pytest.raises(MercadoPagoError, match="access token"):
        client.list_reports()


def test_203_and_5xx_are_retried_then_fail():
    sleeps = []
    client = Client("t", http=FakeHttp([(203, b""), (500, b""), (200, b"[]")]), sleep=sleeps.append)
    assert client.list_reports() == []
    assert len(sleeps) == 2

    client = Client("t", http=FakeHttp([(203, b"")] * 4), sleep=lambda s: None)
    with pytest.raises(MercadoPagoError, match="kept failing"):
        client.list_reports()


def test_ensure_config_creates_and_schedules():
    http = FakeHttp([(404, b""), (201, json.dumps({"scheduled": False}).encode()), (200, b"{}")])
    Client("t", http=http).ensure_config()
    assert [(m, u.rsplit("/", 1)[1]) for m, u, _ in http.calls] == [
        ("GET", "config"), ("POST", "config"), ("POST", "schedule"),
    ]
    sent = http.calls[1][2]
    assert sent["display_timezone"] == "GMT-03"
    assert sent["frequency"] == {"type": "daily", "value": 1, "hour": 6}
    assert {"key": "SOURCE_ID"} in sent["columns"]


def test_ensure_config_updates_existing_and_skips_schedule_when_already_on():
    http = FakeHttp([(200, b"{}"), (200, json.dumps({"scheduled": True}).encode())])
    Client("t", http=http).ensure_config()
    assert [m for m, _, _ in http.calls] == ["GET", "PUT"]
