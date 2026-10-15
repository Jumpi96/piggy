"""Real (anonymized) Santander alerts: see tests/fixtures/README.md."""
from pathlib import Path

import pytest

import emails
from importer.inbound_email import GateConfig, handle_message, parse_message
from importer.santander import parse_email

FIXTURES = Path(__file__).parent / "fixtures"
CONFIG = GateConfig(santander_senders=["santander.com.ar"], forwarding_gmail=emails.GMAIL)

# fixture -> (kind, date, amount_cents, currency, description, account_ref, installments)
EXPECTED = {
    "santander_card_purchase_1.eml": (
        "card_purchase", "2026-10-06", 5910050, "ARS", "FARMACIA EJEMPLO SAN JUAN",
        "Tarjeta Santander Visa Crédito terminada en 1111", 3,
    ),
    "santander_card_purchase_2.eml": (
        "card_purchase", "2026-10-08", 7850000, "ARS", "MERPAGO*TIENDANUBE",
        "Tarjeta Santander Visa Crédito terminada en 2222", 1,
    ),
    "santander_debit_purchase_1.eml": (
        "debit_purchase", "2026-10-10", 3245000, "ARS", "PEDIDOSYA*RESTAURANTE",
        "Tarjeta Santander Visa Débito terminada en 4821", None,
    ),
    "santander_debit_purchase_2.eml": (
        "debit_purchase", "2026-09-16", 1234, "USD", "AEROPUERTO DUTY FREE S",
        "Tarjeta Santander Visa Débito terminada en 4822", None,
    ),
    # No date in the body: it comes from the Date header (Argentina local time).
    "santander_transfer_out_1.eml": (
        "transfer_out", "2026-10-02", 15000000, "ARS", "GOMEZ MARIA LAURA", None, None,
    ),
}


def load(name: str) -> bytes:
    return (FIXTURES / name).read_bytes()


def as_stored_in_s3(raw: bytes) -> bytes:
    """The alert as SES writes it to S3 after Gmail auto-forwards it: the original message with
    Gmail's forwarding headers and SES's verdicts prepended."""
    headers = (
        f"X-SES-Spam-Verdict: PASS\r\nX-SES-Virus-Verdict: PASS\r\n"
        f"X-Forwarded-To: {emails.INBOUND}\r\nX-Forwarded-For: {emails.GMAIL} {emails.INBOUND}\r\n"
    )
    return headers.encode() + raw


@pytest.mark.parametrize("name", sorted(EXPECTED))
def test_real_alert_is_parsed(name):
    e = parse_email(parse_message(load(name)), "id")
    kind, date, cents, currency, description, account_ref, installments = EXPECTED[name]
    assert (e.kind, e.date, e.amount_cents, e.currency_code) == (kind, date, cents, currency)
    assert e.direction == "expense"
    assert e.description == description
    assert e.account_ref == account_ref
    assert e.installments == installments
    assert e.parse_error is None
    assert "Online Banking" in e.raw["body"]


@pytest.mark.parametrize("name", sorted(EXPECTED))
def test_forwarded_real_alert_passes_the_gate(name):
    result = handle_message(as_stored_in_s3(load(name)), "santander/obj", CONFIG)
    assert result.ignored_reason is None
    assert result.entry.kind == EXPECTED[name][0]
    assert result.entry.external_id == parse_message(load(name))["Message-ID"]


def test_real_alert_not_forwarded_by_the_user_is_ignored():
    result = handle_message(load("santander_card_purchase_1.eml"), "santander/obj", CONFIG)
    assert "not forwarded" in result.ignored_reason
