"""
Inbound email handling: SES stores each received message in S3, which triggers the Santander
Lambda. Before parsing, a message must pass a gate, because anyone can send mail to the
inbound address:

- it was auto-forwarded by the user's own Gmail (Gmail adds X-Forwarded-For / X-Forwarded-To),
- its original From is one of the configured Santander senders,
- SES did not flag it as spam or a virus.

Gmail's one-time "forwarding confirmation" email is recognised separately: its code is
surfaced in the app so the forwarding address can be verified without reading S3.
"""
from __future__ import annotations

import email
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


@dataclass
class GateConfig:
    santander_senders: list[str]  # full addresses or bare domains, e.g. "santander.com.ar"
    forwarding_gmail: str


@dataclass
class InboundResult:
    entry: Optional[Entry] = None
    forwarding_code: Optional[str] = None
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


def forwarding_confirmation_code(msg: Message, gmail: str) -> Optional[str]:
    """The code from Gmail's 'Forwarding Confirmation' email for this Gmail address, if it is one."""
    if GMAIL_FORWARDING_SENDER not in _addresses(msg, "From"):
        return None
    subject = str(msg.get("Subject", ""))
    text = f"{subject}\n{message_text(msg)}"
    if gmail.strip().lower() not in text.lower():
        return None
    m = re.search(r"\(#(\d{6,})\)", subject) or re.search(r"(?:confirmation code|c[oó]digo de confirmaci[oó]n)\D{0,20}(\d{6,})", text, re.IGNORECASE)
    return m.group(1) if m else None


def message_id(msg: Message, fallback: str) -> str:
    """The original Message-ID (kept by Gmail when forwarding), else the S3 key."""
    value = str(msg.get("Message-ID", "")).strip()
    return value or f"s3:{fallback}"


def handle_message(raw: bytes, key: str, config: GateConfig) -> InboundResult:
    msg = parse_message(raw)

    code = forwarding_confirmation_code(msg, config.forwarding_gmail)
    if code:
        return InboundResult(forwarding_code=code)

    flagged = _ses_flagged(msg)
    if flagged:
        return InboundResult(ignored_reason=flagged)
    if not _forwarded_by(msg, config.forwarding_gmail):
        return InboundResult(ignored_reason="not forwarded by the configured Gmail address")
    senders = _addresses(msg, "From")
    if not any(_sender_matches(a, config.santander_senders) for a in senders):
        return InboundResult(ignored_reason=f"sender {senders} is not a configured Santander sender")

    return InboundResult(entry=parse_email(msg, message_id(msg, key)))
