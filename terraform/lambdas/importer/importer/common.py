"""Shared model and parsing helpers for the importers."""
from __future__ import annotations

import hashlib
import json
import re
import unicodedata
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from typing import Any, Optional

# Argentina has had no DST since 2009, so a fixed offset is exact and needs no tz database.
AR_TZ = timezone(timedelta(hours=-3))

KNOWN_CURRENCIES = {"ARS", "USD", "EUR"}


@dataclass
class Entry:
    """One movement, normalized. Mirrors the import_entries table."""

    source: str  # 'mercadopago' | 'santander'
    external_id: str
    kind: str  # card_purchase | debit_purchase | transfer_out | transfer_in | mp_outflow | mp_interest | unknown
    date: Optional[str] = None  # YYYY-MM-DD, Argentina local
    direction: Optional[str] = None  # 'income' | 'expense'
    amount_cents: Optional[int] = None  # always positive
    currency_code: Optional[str] = None
    description: Optional[str] = None
    account_ref: Optional[str] = None
    installments: Optional[int] = None
    raw: dict[str, Any] = field(default_factory=dict)
    parse_error: Optional[str] = None

    def raw_json(self) -> str:
        return json.dumps(self.raw, ensure_ascii=False, default=str)


def normalize(text: str) -> str:
    """Lowercase, strip accents and collapse whitespace (for keyword matching)."""
    decomposed = unicodedata.normalize("NFD", text or "")
    no_accents = "".join(c for c in decomposed if unicodedata.category(c) != "Mn")
    return re.sub(r"\s+", " ", no_accents).strip().lower()


def collapse_ws(text: str) -> str:
    return re.sub(r"\s+", " ", text or "").strip()


def parse_amount_cents(text: str) -> Optional[int]:
    """
    Parses an amount written either the Argentine way (1.234,56) or the US way (1,234.56 /
    1234.56) into positive cents. Returns None when there is no number.
    """
    if text is None:
        return None
    s = re.sub(r"[^\d.,-]", "", str(text)).lstrip("-")
    if not s or not re.search(r"\d", s):
        return None

    last_dot, last_comma = s.rfind("."), s.rfind(",")
    if last_dot >= 0 and last_comma >= 0:
        decimal_sep = "." if last_dot > last_comma else ","
    elif last_comma >= 0:
        # "1234,5" / "12,34" -> decimal comma; "1,234" / "1,234,567" -> thousands
        decimal_sep = "," if len(s) - last_comma - 1 in (1, 2) else None
    elif last_dot >= 0:
        # "12.5" / "1234.56" -> decimal point; "1.234" / "1.234.567" -> thousands (AR)
        decimal_sep = "." if s.count(".") == 1 and len(s) - last_dot - 1 != 3 else None
    else:
        decimal_sep = None

    if decimal_sep:
        integer, _, fraction = s.rpartition(decimal_sep)
    else:
        integer, fraction = s, ""
    integer = re.sub(r"[.,]", "", integer) or "0"
    fraction = (fraction + "00")[:2]
    return int(integer) * 100 + int(fraction)


def parse_ar_date(text: str) -> Optional[str]:
    """dd/mm/yyyy or dd/mm/yy (also with '-' or '.') -> YYYY-MM-DD."""
    m = re.search(r"\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})\b", text or "")
    if not m:
        return None
    day, month, year = int(m.group(1)), int(m.group(2)), int(m.group(3))
    if year < 100:
        year += 2000
    try:
        return date(year, month, day).isoformat()
    except ValueError:
        return None


def to_ar_date(value: datetime) -> str:
    """A timezone-aware datetime -> its Argentina-local calendar date."""
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(AR_TZ).date().isoformat()


def row_hash(row: dict[str, Any]) -> str:
    payload = json.dumps(row, sort_keys=True, ensure_ascii=False, default=str)
    return "sha256:" + hashlib.sha256(payload.encode("utf-8")).hexdigest()
