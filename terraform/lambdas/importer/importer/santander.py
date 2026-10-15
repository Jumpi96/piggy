"""
Santander Argentina alert-email parser.

Tolerant by design: it looks for labelled fields and amount/date patterns anywhere in the
text instead of depending on one template's layout. Anything it can't make sense of still
becomes an entry, with `parse_error` set, so it shows up in the Inbox as "needs review".

The keywords and labels are tuned against real alerts (tests/fixtures/santander_*.eml). In
those, every label stands on its own line with no colon ("Comercio" / "PEDIDOSYA*..."), and
the card is named as "Tarjeta Santander Visa Crédito terminada en NNNN" (`account_ref`).
"""
from __future__ import annotations

import re
from email.message import Message
from email.utils import parsedate_to_datetime
from html.parser import HTMLParser
from typing import Optional

from .common import KNOWN_CURRENCIES, Entry, collapse_ws, normalize, parse_amount_cents, parse_ar_date, to_ar_date

RAW_BODY_LIMIT = 8000

# (kind, keyword groups): every group needs at least one keyword present. Checked in order.
KIND_RULES: list[tuple[str, list[tuple[str, ...]]]] = [
    ("transfer_in", [("transferencia",), ("recibiste", "recibida", "te transfirieron", "te enviaron", "acreditamos")]),
    ("transfer_out", [("transferencia",), ("realizaste", "se realizo", "enviaste", "enviada", "realizada", "debitamos")]),
    ("debit_purchase", [("compra", "consumo", "pago"), ("debito",)]),
    ("card_purchase", [("compra", "consumo"), ("credito", "visa", "american express", "amex", "mastercard", "tarjeta")]),
]

MERCHANT_LABELS = ("comercio", "establecimiento", "lugar", "detalle")
RECIPIENT_LABELS = ("destinatario", "beneficiario", "titular de la cuenta destino", "para", "cuenta destino")
SENDER_LABELS = ("originante", "remitente", "de")

AMOUNT_RE = re.compile(
    r"(?P<cur>U\$S|U\$D|US\$|USD|ARS|\$)\s*(?P<num>\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?)",
    re.IGNORECASE,
)
CARD_REF_RE = re.compile(
    r"(?P<ref>(?:tarjeta\s+)?(?:de\s+(?:credito|crédito|debito|débito)\s+)?"
    r"(?:visa|american express|amex|mastercard|master)?[\w\s]{0,30}?"
    r"(?:terminada|finalizada|termina)\s+en\s*:?\s*\**\s*\d{4})",
    re.IGNORECASE,
)
# "en 3 cuotas" on one line; not the tail of an amount ("12.345,67" followed by "Cuotas:").
INSTALLMENTS_RE = re.compile(r"(?<![\d.,])(\d{1,2})[ \t]+cuotas?\b", re.IGNORECASE)


class _TextExtractor(HTMLParser):
    BLOCK_TAGS = {"br", "p", "div", "tr", "li", "h1", "h2", "h3", "h4", "table", "td"}

    def __init__(self) -> None:
        super().__init__()
        self.parts: list[str] = []
        self._skip = 0

    def handle_starttag(self, tag, attrs):  # noqa: D401
        if tag in ("style", "script", "head"):
            self._skip += 1
        if tag in self.BLOCK_TAGS:
            self.parts.append("\n")

    def handle_endtag(self, tag):
        if tag in ("style", "script", "head") and self._skip:
            self._skip -= 1
        if tag in self.BLOCK_TAGS:
            self.parts.append("\n")

    def handle_data(self, data):
        if not self._skip:
            self.parts.append(data)


def html_to_text(html: str) -> str:
    parser = _TextExtractor()
    parser.feed(html)
    lines = (collapse_ws(line) for line in "".join(parser.parts).splitlines())
    return "\n".join(line for line in lines if line)


def message_text(msg: Message) -> str:
    """Plain text of a message: the text/plain part if any, else the HTML part converted."""
    plain: Optional[str] = None
    html: Optional[str] = None
    for part in msg.walk() if msg.is_multipart() else [msg]:
        if part.get_content_maintype() == "multipart" or part.get_filename():
            continue
        payload = part.get_payload(decode=True)
        if payload is None:
            continue
        text = payload.decode(part.get_content_charset() or "utf-8", errors="replace")
        ctype = part.get_content_type()
        if ctype == "text/plain" and plain is None:
            plain = text
        elif ctype == "text/html" and html is None:
            html = text
    if html is not None:
        return html_to_text(html)
    return "\n".join(collapse_ws(l) for l in (plain or "").splitlines() if l.strip())


def classify(text: str) -> str:
    norm = normalize(text)
    for kind, groups in KIND_RULES:
        if all(any(k in norm for k in group) for group in groups):
            return kind
    return "unknown"


def _labelled_value(lines: list[str], labels: tuple[str, ...]) -> Optional[str]:
    """Value after 'Label:' on the same line, or on the next line when the label stands alone
    (with or without a colon)."""
    for i, line in enumerate(lines):
        norm = normalize(line)
        for label in labels:
            if norm == label:
                following = lines[i + 1].strip() if i + 1 < len(lines) else ""
                return following or None
            m = re.match(rf"^{re.escape(label)}\s*:\s*(.*)$", norm)
            if not m:
                continue
            # Take the original-case text after the colon.
            value = line.split(":", 1)[1].strip()
            if value:
                return value
            if i + 1 < len(lines):
                return lines[i + 1].strip() or None
    return None


def _amount(text: str) -> tuple[Optional[int], Optional[str]]:
    for m in AMOUNT_RE.finditer(text):
        cents = parse_amount_cents(m.group("num"))
        if cents:
            cur = m.group("cur").upper()
            currency = "ARS" if cur in ("$", "ARS") else "USD"
            return cents, currency
    return None, None


def _installments(lines: list[str], text: str) -> Optional[int]:
    labelled = _labelled_value(lines, ("cuotas", "cantidad de cuotas", "plan de cuotas"))
    if labelled:
        m = re.match(r"\s*(\d{1,2})\b", labelled)
        if m:
            return int(m.group(1))
    m = INSTALLMENTS_RE.search(text)
    return int(m.group(1)) if m else None


def parse_email(msg: Message, external_id: str) -> Entry:
    subject = collapse_ws(str(msg.get("Subject", "")))
    body = message_text(msg)
    text = f"{subject}\n{body}"
    lines = [l for l in body.splitlines() if l.strip()]

    kind = classify(text)
    amount_cents, currency = _amount(text)

    date = parse_ar_date(_labelled_value(lines, ("fecha", "fecha de la operacion", "fecha y hora")) or "") or parse_ar_date(text)
    if date is None and msg.get("Date"):
        try:
            date = to_ar_date(parsedate_to_datetime(str(msg["Date"])))
        except (TypeError, ValueError):
            date = None

    if kind in ("transfer_out",):
        description = _labelled_value(lines, RECIPIENT_LABELS)
    elif kind == "transfer_in":
        description = _labelled_value(lines, SENDER_LABELS)
    else:
        description = _labelled_value(lines, MERCHANT_LABELS)

    card = CARD_REF_RE.search(text)
    account_ref = collapse_ws(card.group("ref")) if card else None
    installments = _installments(lines, text)

    problems = []
    if kind == "unknown":
        problems.append("unrecognized alert type")
    if amount_cents is None:
        problems.append("amount not found")
    elif currency not in KNOWN_CURRENCIES:
        problems.append(f"unknown currency {currency}")
    if date is None:
        problems.append("date not found")

    direction = None
    if kind == "transfer_in":
        direction = "income"
    elif kind != "unknown":
        direction = "expense"

    return Entry(
        source="santander",
        external_id=external_id,
        kind=kind,
        date=date,
        direction=direction,
        amount_cents=amount_cents,
        currency_code=currency if currency in KNOWN_CURRENCIES else None,
        description=description,
        account_ref=account_ref,
        installments=installments,
        raw={"subject": subject, "body": body[:RAW_BODY_LIMIT]},
        parse_error="; ".join(problems) or None,
    )
