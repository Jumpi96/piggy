"""Postgres access for the importers (direct connection as the database owner, bypassing RLS)."""
from __future__ import annotations

import json
import logging
import socket
from typing import Any, Iterable, Optional
from urllib.parse import urlparse

from .common import Entry

logger = logging.getLogger(__name__)

IMPORT_SETTINGS_KEY = "import_settings"
IMPORT_STATUS_KEY = "import_status"

DEFAULT_KINDS = {
    "card_purchase": True,
    "debit_purchase": True,
    "transfer_out": True,
    "transfer_in": False,
    "mp_outflow": True,
    "mp_interest": True,
}


def connect(db_url: str):
    """Connects preferring IPv4 (Lambda has no IPv6 route to Supabase), like the backup Lambda."""
    import psycopg2  # imported lazily so parsers and tests don't need the driver

    parsed = urlparse(db_url)
    try:
        ipv4 = socket.getaddrinfo(parsed.hostname, None, socket.AF_INET)[0][4][0]
    except socket.gaierror:
        ipv4 = None
    return psycopg2.connect(
        hostaddr=ipv4,
        host=parsed.hostname,
        port=parsed.port or 5432,
        dbname=parsed.path.lstrip("/"),
        user=parsed.username,
        password=parsed.password,
        connect_timeout=10,
    )


class Settings:
    """The user's `import_settings` parameter (edited in the app's Settings > Imports)."""

    def __init__(self, value: Optional[dict[str, Any]]):
        value = value or {}
        self.kinds = {**DEFAULT_KINDS, **(value.get("kinds") or {})}
        self.since: Optional[str] = value.get("since") or None

    def wants(self, entry: Entry) -> bool:
        # Unparsed emails are always kept: they must be reviewed, never silently dropped.
        if entry.kind != "unknown" and not self.kinds.get(entry.kind, False):
            return False
        if self.since and entry.date and entry.date < self.since:
            return False
        return True


def load_settings(conn, user_id: str) -> Settings:
    with conn.cursor() as cur:
        cur.execute(
            "select value from parameters where user_id = %s and key = %s",
            (user_id, IMPORT_SETTINGS_KEY),
        )
        row = cur.fetchone()
    value = row[0] if row else None
    if isinstance(value, str):
        value = json.loads(value)
    return Settings(value)


def existing_external_ids(conn, user_id: str, source: str, external_ids: Iterable[str]) -> set[str]:
    ids = list(external_ids)
    if not ids:
        return set()
    with conn.cursor() as cur:
        cur.execute(
            "select external_id from import_entries where user_id = %s and source = %s and external_id = any(%s)",
            (user_id, source, ids),
        )
        return {r[0] for r in cur.fetchall()}


def insert_entries(conn, user_id: str, entries: Iterable[Entry]) -> int:
    """Inserts entries, skipping ones already imported. Returns how many were new."""
    inserted = 0
    with conn.cursor() as cur:
        for e in entries:
            cur.execute(
                """
                insert into import_entries (
                    user_id, source, external_id, kind, date, direction, amount_cents,
                    currency_code, description, account_ref, installments, raw, parse_error
                ) values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb, %s)
                on conflict (user_id, source, external_id) do nothing
                """,
                (
                    user_id, e.source, e.external_id, e.kind, e.date, e.direction, e.amount_cents,
                    e.currency_code, e.description, e.account_ref, e.installments, e.raw_json(), e.parse_error,
                ),
            )
            inserted += cur.rowcount
    conn.commit()
    return inserted


def update_status(conn, user_id: str, source: str, fields: dict[str, Any]) -> None:
    """
    Merges `fields` into parameters.import_status[source]. Each source only touches its own
    key, and keys not in `fields` (e.g. a forwarding code) are kept.
    """
    patch = json.dumps(fields, default=str)
    with conn.cursor() as cur:
        cur.execute(
            """
            insert into parameters (user_id, key, value)
            values (%(user_id)s, %(key)s, jsonb_build_object(%(source)s, %(patch)s::jsonb))
            on conflict (user_id, key) do update set value =
                coalesce(parameters.value, '{}'::jsonb)
                || jsonb_build_object(
                    %(source)s,
                    coalesce(parameters.value -> %(source)s, '{}'::jsonb) || %(patch)s::jsonb
                )
            """,
            {"user_id": user_id, "key": IMPORT_STATUS_KEY, "source": source, "patch": patch},
        )
    conn.commit()
