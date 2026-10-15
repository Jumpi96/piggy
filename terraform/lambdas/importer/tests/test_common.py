import pytest

from importer.common import parse_amount_cents, parse_ar_date


@pytest.mark.parametrize("text,cents", [
    ("$ 12.345,67", 1234567),
    ("12.345,6", 1234560),
    ("1.234", 123400),          # AR thousands
    ("1.234.567", 123456700),
    ("1,234", 123400),          # US thousands
    ("1,234.56", 123456),
    ("1234.56", 123456),        # MP report style
    ("12,5", 1250),
    ("U$S 45,99", 4599),
    ("-350.00", 35000),
    ("100", 10000),
])
def test_parse_amount_cents(text, cents):
    assert parse_amount_cents(text) == cents


@pytest.mark.parametrize("text", ["", "no number", None])
def test_parse_amount_cents_without_number(text):
    assert parse_amount_cents(text) is None


def test_parse_ar_date():
    assert parse_ar_date("Fecha: 05/10/2026 14:32") == "2026-10-05"
    assert parse_ar_date("el 5-10-26") == "2026-10-05"
    assert parse_ar_date("31/02/2026") is None
    assert parse_ar_date("sin fecha") is None
