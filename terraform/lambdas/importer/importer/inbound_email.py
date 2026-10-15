"""
Inbound email handling: SES stores each received message in S3, which triggers the Santander
Lambda. Before parsing, a message must pass a gate, because anyone can send mail to the
inbound address:

- it was auto-forwarded by the user's own Gmail (Gmail adds X-Forwarded-For / X-Forwarded-To),
- its original From is one of the configured Santander senders,
- SES did not flag it as spam or a virus.

Gmail's one-time "forwarding confirmation" email is recognised separately, and its confirmation
link (and code, in the older format) is surfaced in the app so the forwarding address can be
verified without reading S3. Because that link becomes a button in the app, the email must pass
DMARC for google.com as checked by SES, and only a https://mail.google.com/mail/vf-... link is
accepted.
"""
from __future__ import annotations

import email
import email.errors
import email.header
import email.policy
import logging
import re
import urllib.parse
from dataclasses import dataclass
from email.message import Message
from email.utils import getaddresses
from typing import Any, Optional

from .common import Entry
from .santander import message_text, parse_email

logger = logging.getLogger(__name__)

GMAIL_FORWARDING_SENDER = "forwarding-noreply@google.com"
# The "confirm" link; the "uf-" one in the same email cancels the request instead.
GMAIL_CONFIRM_URL_RE = re.compile(r"https://mail\.google\.com/mail/vf-[^\s<>\"']+")


@dataclass
class GateConfig:
    santander_senders: list[str]  # full addresses or bare domains, e.g. "santander.com.ar"
    forwarding_gmail: str


@dataclass
class ForwardingConfirmation:
    code: Optional[str] = None  # older emails carry a code
    url: Optional[str] = None  # current ones (at least in Spanish) only a link


@dataclass
class InboundResult:
    entry: Optional[Entry] = None
    forwarding: Optional[ForwardingConfirmation] = None
    ignored_reason: Optional[str] = None


def parse_message(raw: bytes) -> Message:
    return email.message_from_bytes(raw, policy=email.policy.compat32)


def s3_objects(event: dict[str, Any]) -> list[tuple[str, str]]:
    """(bucket, key) pairs from an S3 ObjectCreated event."""
    out = []
    for record in event.get("Records", []):
        s3 = record.get("s3") or {}
        bucket = (s3.get("bucket") or {}).get("name")
        key = (s3.get("object") or {}).get("key")
        if bucket and key:
            out.append((bucket, urllib.parse.unquote_plus(key)))
    return out


def _addresses(msg: Message, header: str) -> list[str]:
    return [addr.lower() for _, addr in getaddresses(msg.get_all(header, [])) if addr]


def _sender_matches(address: str, allowed: list[str]) -> bool:
    address = address.lower()
    domain = address.rsplit("@", 1)[-1]
    for entry in allowed:
        entry = entry.strip().lower()
        if not entry:
            continue
        if "@" in entry:
            if address == entry:
                return True
        elif domain == entry or domain.endswith("." + entry):
            return True
    return False


def _ses_flagged(msg: Message) -> Optional[str]:
    for header in ("X-SES-Spam-Verdict", "X-SES-Virus-Verdict"):
        if str(msg.get(header, "")).strip().upper() == "FAIL":
            return f"{header} is FAIL"
    return None


def _forwarded_by(msg: Message, gmail: str) -> bool:
    gmail = gmail.strip().lower()
    forwarded = " ".join(str(v) for v in msg.get_all("X-Forwarded-For", []) + msg.get_all("X-Forwarded-To", []))
    return bool(gmail) and gmail in forwarded.lower()


def _header_text(msg: Message, name: str) -> str:
    """A header with RFC 2047 encoded words (=?UTF-8?Q?...?=) decoded."""
    value = msg.get(name)
    if value is None:
        return ""
    try:
        return str(email.header.make_header(email.header.decode_header(str(value))))
    except (UnicodeDecodeError, LookupError, email.errors.HeaderParseError):
        return str(value)


def _dmarc_pass_for(msg: Message, domain: str) -> bool:
    """SES's own verdict: it prepends Authentication-Results, so only the first one counts
    (a sender can add more below it)."""
    results = str(msg.get("Authentication-Results", ""))
    if not results.strip().lower().startswith("amazonses.com"):
        return False
    return re.search(rf"\bdmarc=pass\b[^;]*header\.from={re.escape(domain)}\b", results, re.IGNORECASE) is not None


def forwarding_confirmation(msg: Message, gmail: str) -> Optional[ForwardingConfirmation]:
    """Gmail's 'Forwarding Confirmation' email for this Gmail address, if it is one."""
    if GMAIL_FORWARDING_SENDER not in _addresses(msg, "From"):
        return None
    subject = _header_text(msg, "Subject")
    text = f"{subject}\n{message_text(msg)}"
    if gmail.strip().lower() not in text.lower():
        return None
    if not _dmarc_pass_for(msg, "google.com"):
        logger.warning("Ignored a Gmail forwarding confirmation that did not pass DMARC for google.com")
        return None
    m = re.search(r"\(#(\d{6,})\)", subject) or re.search(
        r"(?:confirmation code|c[oó]digo de confirmaci[oó]n)\D{0,20}(\d{6,})", text, re.IGNORECASE)
    url = GMAIL_CONFIRM_URL_RE.search(text)
    confirmation = ForwardingConfirmation(
        code=m.group(1) if m else None,
        url=url.group(0).rstrip(".,;)") if url else None,
    )
    return confirmation if confirmation.code or confirmation.url else None


def message_id(msg: Message, fallback: str) -> str:
    """The original Message-ID (kept by Gmail when forwarding), else the S3 key."""
    value = str(msg.get("Message-ID", "")).strip()
    return value or f"s3:{fallback}"


def handle_message(raw: bytes, key: str, config: GateConfig) -> InboundResult:
    msg = parse_message(raw)

    forwarding = forwarding_confirmation(msg, config.forwarding_gmail)
    if forwarding:
        return InboundResult(forwarding=forwarding)

    flagged = _ses_flagged(msg)
    if flagged:
        return InboundResult(ignored_reason=flagged)
    if not _forwarded_by(msg, config.forwarding_gmail):
        return InboundResult(ignored_reason="not forwarded by the configured Gmail address")
    senders = _addresses(msg, "From")
    if not any(_sender_matches(a, config.santander_senders) for a in senders):
        return InboundResult(ignored_reason=f"sender {senders} is not a configured Santander sender")

    return InboundResult(entry=parse_email(msg, message_id(msg, key)))
