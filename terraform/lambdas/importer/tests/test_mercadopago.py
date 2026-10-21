import json
from collections import Counter
from datetime import datetime, timezone

import pytest

from conftest import FIXTURES
from importer.mercadopago import (
    PENDING_CAPTURE_FLAG, Client, MercadoPagoError, describe_payment, parse_release_csv, recent_report_files,
    run_daily,
)


def real_report():
    """A real release report, anonymized: one example of every row pattern seen in a month."""
    return (FIXTURES / "mp_release_1.csv").read_text()


def day_report():
    """Real patterns of one day (anonymized): two prepaid-card purchases still pending capture."""
    return (FIXTURES / "mp_release_2_day.csv").read_text()


def later_report():
    """The same day in a report made after the merchants captured those purchases."""
    return (FIXTURES / "mp_release_2_manual.csv").read_text()


def synthetic_report():
    """Hand-written: `;` separator and a movement without SOURCE_ID, which the real one lacks."""
    return (FIXTURES / "synthetic_mp_release.csv").read_text()


def summary(entries):
    return [(e.external_id, e.kind, e.date, e.amount_cents, e.description) for e in entries]


def test_real_report_keeps_one_entry_per_movement():
    assert summary(parse_release_csv(real_report())) == [
        # Card purchase abroad: the net debit (with taxes) left the account, not the gross.
        ("91000000001:mp_outflow", "mp_outflow", "2026-09-13", 3215745, "Pago"),
        # Interest ("rendimientos"); imported only if that kind is switched on in Settings.
        ("91000000004:mp_interest", "mp_interest", "2026-09-14", 16440, "Rendimientos"),
        # Purchase later partly refunded: the purchase stays, the refund is not imported.
        ("91000000007:mp_outflow", "mp_outflow", "2026-09-25", 2330900, "Pago"),
        # Hold still open: a card purchase pending capture (see the pending-capture tests).
        ("91000000008:mp_outflow", "mp_outflow", "2026-10-13", 50000, "Pago"),
        ("91000000009:mp_outflow", "mp_outflow", "2026-10-13", 633000, "Propina"),
        ("91000000002:mp_outflow", "mp_outflow", "2026-10-14", 3300000, "Pago"),
        ("91000000003:mp_outflow", "mp_outflow", "2026-10-14", 480000, "Transferencia enviada"),
    ]


def test_released_hold_without_movement_is_a_cancelled_payment():
    ids = {e.external_id.split(":")[0] for e in parse_release_csv(real_report())}
    assert "91000000006" not in ids


# --- Card purchases pending capture ---------------------------------------------------------
# A prepaid-card purchase is only authorized on the day: the report has just the hold debit.
# The capture comes a day or two later, back-dated to the purchase, so no later daily report
# carries it. The open hold is imported, keyed like the payment row it turns into.

def test_open_holds_are_imported_as_the_purchase():
    entries = parse_release_csv(day_report())
    assert summary(entries) == [
        ("92000000001:mp_interest", "mp_interest", "2026-10-15", 6077, "Rendimientos"),
        ("92000000002:mp_outflow", "mp_outflow", "2026-10-15", 1131900, "Pago"),  # open hold
        ("92000000003:mp_outflow", "mp_outflow", "2026-10-15", 30000, "Pago"),  # open hold
        ("92000000004:mp_outflow", "mp_outflow", "2026-10-15", 100000, "Pago"),  # same-day payment
        ("92000000005:mp_outflow", "mp_outflow", "2026-10-15", 1500000, "Transferencia enviada"),
        ("92000000006:mp_outflow", "mp_outflow", "2026-10-15", 250000, "Transferencia enviada"),  # open payout hold
        # 92000000007: hold released the same day with no payment, a cancelled authorization.
    ]
    flagged = {e.external_id for e in entries if e.raw.get(PENDING_CAPTURE_FLAG) == "true"}
    assert flagged == {"92000000002:mp_outflow", "92000000003:mp_outflow", "92000000006:mp_outflow"}


def test_captured_purchase_keeps_the_key_of_its_hold():
    before = {e.external_id: e for e in parse_release_csv(day_report())}
    after = {e.external_id: e for e in parse_release_csv(later_report())}
    assert set(after) == set(before)
    for key in ("92000000002:mp_outflow", "92000000003:mp_outflow", "92000000006:mp_outflow"):
        assert PENDING_CAPTURE_FLAG not in after[key].raw
        assert (after[key].date, after[key].amount_cents) == (before[key].date, before[key].amount_cents)


def test_all_entries_are_ars_from_the_mp_account():
    entries = parse_release_csv(real_report())
    assert all(e.source == "mercadopago" and e.currency_code == "ARS" and e.account_ref == "mp" for e in entries)
    assert {(e.kind, e.direction) for e in entries} == {("mp_outflow", "expense"), ("mp_interest", "income")}
    assert entries[0].raw["EXTERNAL_REFERENCE"] == "REF-1"


def test_collects_stats_for_verification():
    stats: dict[str, Counter] = {}
    parse_release_csv(real_report(), stats=stats)
    assert stats["payment_methods"] == Counter({"available_money": 7, "debin_transfer": 1})
    assert stats["inflow_descriptions"] == Counter({"asset_management": 1, "payment": 1, "refund": 1})


def test_semicolon_reports_and_rows_without_source_id():
    entries = parse_release_csv(synthetic_report())
    assert [(e.kind, e.amount_cents) for e in entries] == [
        ("mp_outflow", 1234567), ("mp_outflow", 250000), ("mp_interest", 8812), ("mp_outflow", 2000000),
    ]
    withdrawal = entries[3]
    assert withdrawal.external_id.startswith("sha256:")
    assert parse_release_csv(synthetic_report())[3].external_id == withdrawal.external_id
    # 23:40 GMT-3 on the 12th stays on the 12th.
    assert entries[1].date == "2026-10-12"


# Shapes of real GET /v1/payments/{id} responses, trimmed to the fields that matter.
CARD_PAYMENT = {
    "operation_type": "regular_payment", "description": "Uber * pending",
    "point_of_interaction": {"type": "MP_DEBIT_CARD", "transaction_data": {"commerce": {"name": "UBER * PENDING"}}},
}
QR_PAYMENT = {"operation_type": "regular_payment", "description": "Producto de Kiosco Ejemplo",
              "point_of_interaction": {"type": "INSTORE", "transaction_data": {}}}
# A transfer to another Mercado Pago user: no name, only the recipient's user id.
TRANSFER = {"operation_type": "money_transfer", "description": "Varios", "collector": {"id": 555000111},
            "point_of_interaction": {"type": "PSP_TRANSFER", "sub_type": "INTRA_PSP", "transaction_data": {}}}
# GET /users/{id}: the public profile, whose nickname is often the name run together.
RECIPIENT = {"id": 555000111, "nickname": "ANAEJEMPLO", "site_id": "MLA", "country_id": "AR"}
TIP = {"operation_type": "regular_payment", "description": "Dlo*pedidosya propina",
       "point_of_interaction": {"transaction_data": {"commerce": {"name": "DLO*PedidosYa Propina"}}}}
# A prepaid-card authorization not yet captured: the payments API already knows the merchant.
AUTHORIZATION = {"operation_type": "regular_payment", "status": "authorized", "status_detail": "pending_capture",
                 "description": "Dlo*delivery compra",
                 "point_of_interaction": {"transaction_data": {"commerce": {"name": "DLO*Delivery Compra"}}}}


def test_describe_payment():
    assert describe_payment(CARD_PAYMENT) == "UBER * PENDING"
    assert describe_payment(QR_PAYMENT) == "Producto de Kiosco Ejemplo"
    assert describe_payment(TRANSFER) == "Transferencia enviada"
    assert describe_payment({**TRANSFER, "description": "Alquiler"}) == "Transferencia enviada · Alquiler"
    assert describe_payment(TRANSFER, "ANAEJEMPLO") == "Transferencia a ANAEJEMPLO"
    assert describe_payment({**TRANSFER, "description": "Alquiler"}, "ANAEJEMPLO") == "Transferencia a ANAEJEMPLO · Alquiler"
    assert describe_payment({"operation_type": "regular_payment"}) is None


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


class RoutedHttp:
    """Answers by URL suffix; unknown URLs are 404."""

    def __init__(self, routes):
        self.routes = routes
        self.calls = []

    def __call__(self, method, url, body=None):
        self.calls.append(url)
        for suffix, response in self.routes.items():
            if url.endswith(suffix):
                return response
        return 404, b'{"message":"Payment not found"}'


def test_run_daily_dedupes_across_reports_and_describes_payments():
    listing = json.dumps([
        {"file_name": "r1.csv", "date_created": "2026-10-14T02:07:14.000-04:00", "status": "enabled"},
        {"file_name": "r2.csv", "date_created": "2026-10-14T09:00:00Z", "status": "enabled"},
    ]).encode()
    report = real_report().encode()
    http = RoutedHttp({
        "/list": (200, listing), "/r1.csv": (200, report), "/r2.csv": (200, report),
        "/v1/payments/91000000001": (200, json.dumps(CARD_PAYMENT).encode()),
        "/v1/payments/91000000002": (200, json.dumps(TRANSFER).encode()),
        "/users/555000111": (200, json.dumps(RECIPIENT).encode()),
        "/v1/payments/91000000009": (200, json.dumps(TIP).encode()),
        # 91000000007 is unknown to the payments API: it keeps the report's label.
    })
    entries, info = run_daily(Client("t", http=http), now=datetime(2026, 10, 14, 12, tzinfo=timezone.utc))
    assert [(e.external_id.split(":")[0], e.description) for e in entries] == [
        ("91000000001", "UBER * PENDING"),
        ("91000000004", "Rendimientos"),
        ("91000000007", "Pago"),
        ("91000000008", "Pago"),  # open hold, unknown to the payments API
        ("91000000009", "DLO*PedidosYa Propina"),
        ("91000000002", "Transferencia a ANAEJEMPLO"),
        ("91000000003", "Transferencia enviada"),  # payout: never looked up
    ]
    assert info["reports"] == ["r1.csv", "r2.csv"]
    payment_calls = [u for u in http.calls if "/v1/payments/" in u]
    assert len(payment_calls) == 5  # once per payment (incl. the open hold), not per report
    assert [u for u in http.calls if "/users/" in u] == ["https://api.mercadopago.com/users/555000111"]


@pytest.mark.parametrize("failure", ["timeout", "not json", "not an object"])
def test_nickname_lookup_failures_never_abort_the_import(failure):
    import urllib.error
    routes = RoutedHttp({"/v1/payments/91000000002": (200, json.dumps(TRANSFER).encode())})

    def http(method, url, body=None):
        if "/users/" in url:
            if failure == "timeout":
                raise urllib.error.URLError(TimeoutError("timed out"))
            return 200, b"<html>oops</html>" if failure == "not json" else b'["x"]'
        return routes(method, url, body)

    assert Client("t", http=http).user_nickname(555000111) is None


def test_transfer_without_a_readable_recipient_keeps_the_generic_label():
    listing = json.dumps([{"file_name": "r1.csv", "date_created": "2026-10-14T09:00:00Z", "status": "enabled"}]).encode()
    http = RoutedHttp({
        "/list": (200, listing), "/r1.csv": (200, real_report().encode()),
        "/v1/payments/91000000002": (200, json.dumps(TRANSFER).encode()),
        "/users/555000111": (403, b'{"message":"forbidden"}'),  # a private profile
    })
    entries, _ = run_daily(Client("t", http=http), now=datetime(2026, 10, 14, 12, tzinfo=timezone.utc))
    assert {e.external_id: e.description for e in entries}["91000000002:mp_outflow"] == "Transferencia enviada"


def test_run_daily_describes_open_holds_and_dedupes_their_capture():
    listing = json.dumps([
        {"file_name": "day.csv", "date_created": "2026-10-16T07:45:40.000-04:00", "status": "enabled"},
        {"file_name": "later.csv", "date_created": "2026-10-17T14:24:34.000-04:00", "status": "enabled"},
    ]).encode()
    http = RoutedHttp({
        "/list": (200, listing),
        "/day.csv": (200, day_report().encode()),
        "/later.csv": (200, later_report().encode()),
        "/v1/payments/92000000002": (200, json.dumps(AUTHORIZATION).encode()),
    })
    entries, _ = run_daily(Client("t", http=http), now=datetime(2026, 10, 17, 18, tzinfo=timezone.utc))
    by_id = {e.external_id: e for e in entries}
    assert len(entries) == 6  # the capture in the later report adds nothing
    assert by_id["92000000002:mp_outflow"].description == "DLO*Delivery Compra"
    assert by_id["92000000003:mp_outflow"].description == "Pago"  # unknown to the payments API
    # Payouts aren't in the payments API: an open payout hold is never looked up.
    assert by_id["92000000006:mp_outflow"].description == "Transferencia enviada"
    assert not any(u.endswith("/v1/payments/92000000006") for u in http.calls)


def test_payment_lookup_still_fails_loudly_on_a_bad_token():
    client = Client("t", http=FakeHttp([(401, b"")]))
    with pytest.raises(MercadoPagoError, match="access token"):
        client.payment("1")


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
    assert sent["frequency"] == {"type": "daily", "hour": 0}
    assert {"key": "SOURCE_ID"} in sent["columns"]


def test_ensure_config_updates_existing_and_skips_schedule_when_already_on():
    http = FakeHttp([(200, b"{}"), (200, json.dumps({"scheduled": True}).encode())])
    Client("t", http=http).ensure_config()
    assert [m for m, _, _ in http.calls] == ["GET", "PUT"]
