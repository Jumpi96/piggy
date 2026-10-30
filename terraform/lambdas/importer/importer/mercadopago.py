"""
Mercado Pago importer, based on the Releases report ("Dinero liberado") API.

Flow: once `mp_setup` has configured it, Mercado Pago creates a report each morning covering the
previous day (a daily frequency ignores the hour). Reports appear around 05:00 Argentina time:
the listing's `date_created` is labelled GMT-4 but is really UTC, as the file names show. The daily run lists recent reports, downloads them and keeps
the outflows and the interest ("rendimientos") rows. Re-processing a report is harmless: rows dedupe on SOURCE_ID.

Checked against a real account's report (tests/fixtures/mp_release_1.csv). Every movement comes
as three rows sharing a SOURCE_ID: `reserve_for_<x>` debit, `reserve_for_<x>` credit (the hold
and its release), then the movement itself (`payment`, `payout`, `tip`...). Only that last row
is imported. A hold released with no movement (a cancelled authorization) imports nothing.

Purchases with the Mercado Pago prepaid card are card authorizations (`pending_capture` in the
payments API): on the purchase day the report has only the hold debit. The merchant captures a
day or two later, and Mercado Pago then writes the release and the `payment` row back-dated to
the purchase time, so they never reach a later daily report (each covers one day). An open hold
is therefore imported as the purchase itself, keyed like the `payment` row it becomes, so a
report that later carries the capture dedupes onto it. An authorization cancelled after its day
closes is the one false positive; it is dismissed in the Inbox.

The report has no counterparty column, so `payment`/`tip` rows are described from the payments
API (merchant name or payment description). A transfer to another Mercado Pago user carries no
name there, only the recipient's user id, so it is named after that user's public nickname
(GET /users/{id}, e.g. "MACARENALUZBARRADO"). Transfers out (`payout`) aren't in that API.
"""
from __future__ import annotations

import csv
import http.client
import io
import json
import logging
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter
from datetime import datetime, timedelta, timezone
from typing import Any, Callable, Optional

from .common import Entry, collapse_ws, normalize, parse_amount_cents, row_hash, to_ar_date

logger = logging.getLogger(__name__)

API_ROOT = "https://api.mercadopago.com"
BASE_URL = API_ROOT + "/v1/account/release_report"

REPORT_COLUMNS = [
    "DATE",
    "SOURCE_ID",
    "EXTERNAL_REFERENCE",
    "RECORD_TYPE",
    "DESCRIPTION",
    "NET_CREDIT_AMOUNT",
    "NET_DEBIT_AMOUNT",
    "GROSS_AMOUNT",
    "PAYMENT_METHOD",
    "PAYMENT_METHOD_TYPE",
]

REPORT_CONFIG = {
    "file_name_prefix": "piggy-release",
    "include_withdrawal_at_end": False,
    "execute_after_withdrawal": False,
    # The API default is GMT-04, which misdates movements made between 23:00 and midnight.
    "display_timezone": "GMT-03",
    "notification_email_list": [],
    # Daily takes no "value" (that is the weekday/month day for weekly/monthly); sending one is
    # rejected as "Invalid frequency". Mercado Pago also stores the hour as 0 for daily reports.
    "frequency": {"type": "daily", "hour": 0},
    "columns": [{"key": c} for c in REPORT_COLUMNS],
}

# Rows that are balances or totals, not movements.
SKIPPED_RECORD_TYPES = {"initial_available_balance", "total", "subtotal"}

# A hold and its release (see the module docstring): never a movement on their own.
SKIPPED_DESCRIPTION_PREFIXES = ("reserve_for_",)

# DESCRIPTION values (normalized, substring match) that mark an inflow as interest earned.
# The real report labels the daily "rendimientos" credit `asset_management`.
DEFAULT_INTEREST_MARKERS = ("asset_management",)

# Fallback descriptions by DESCRIPTION, used when the payments API has nothing better.
DESCRIPTION_LABELS = {
    "payment": "Pago", "payout": "Transferencia enviada", "tip": "Propina", "asset_management": "Rendimientos",
}

# Marks an entry built from an open hold (see the module docstring), in its raw row.
PENDING_CAPTURE_FLAG = "PIGGY_PENDING_CAPTURE"

# Report rows whose SOURCE_ID is a payment id that GET /v1/payments/{id} can describe.
PAYMENT_DESCRIPTIONS = {"payment", "tip"}

# Payment descriptions that say nothing (transfers between Mercado Pago users use "Varios").
UNINFORMATIVE_PAYMENT_DESCRIPTIONS = {"", "varios"}

# How far back the daily run looks for generated reports (overlap is free thanks to dedupe).
REPORT_LOOKBACK_DAYS = 3

HttpFn = Callable[[str, str, Optional[dict[str, Any]]], tuple[int, bytes]]


class MercadoPagoError(RuntimeError):
    pass


def _http(token: str) -> HttpFn:
    def request(method: str, url: str, body: Optional[dict[str, Any]] = None) -> tuple[int, bytes]:
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(url, data=data, method=method)
        req.add_header("Authorization", f"Bearer {token}")
        if data is not None:
            req.add_header("Content-Type", "application/json")
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                return resp.status, resp.read()
        except urllib.error.HTTPError as e:
            return e.code, e.read()

    return request


class Client:
    def __init__(self, token: str, http: Optional[HttpFn] = None, sleep: Callable[[float], None] = time.sleep):
        self._http = http or _http(token)
        self._sleep = sleep

    def _call(self, method: str, path: str, body: Optional[dict[str, Any]] = None, retries: int = 3,
              base: str = BASE_URL) -> tuple[int, bytes]:
        url = base + path
        for attempt in range(retries + 1):
            status, payload = self._http(method, url, body)
            if status == 401 or status == 403:
                raise MercadoPagoError(f"Mercado Pago rejected the access token ({status})")
            # 203 means the request was accepted but nothing was created; 429/5xx are transient.
            if status in (203, 429) or status >= 500:
                if attempt < retries:
                    self._sleep(2 ** attempt * 5)
                    continue
                raise MercadoPagoError(f"Mercado Pago {method} {path} kept failing ({status})")
            if status >= 400:
                raise MercadoPagoError(f"Mercado Pago {method} {path} failed ({status}): {payload[:300]!r}")
            return status, payload
        raise AssertionError("unreachable")

    def ensure_config(self) -> dict[str, Any]:
        """Creates or updates the report config, then enables scheduled generation. Idempotent."""
        status, payload = self._http("GET", BASE_URL + "/config", None)
        method = "PUT" if status == 200 else "POST"
        _, payload = self._call(method, "/config", REPORT_CONFIG)
        config = json.loads(payload or b"{}")
        if not config.get("scheduled"):
            self._call("POST", "/schedule")
        return config

    def request_report(self, begin_date: str, end_date: str) -> None:
        """Asks for a manual (backfill) report; it appears in /list minutes later."""
        self._call("POST", "", {
            "begin_date": f"{begin_date}T00:00:00Z",
            "end_date": f"{end_date}T23:59:59Z",
        })

    def list_reports(self) -> list[dict[str, Any]]:
        _, payload = self._call("GET", "/list")
        data = json.loads(payload or b"[]")
        return data if isinstance(data, list) else data.get("results", [])

    def download(self, file_name: str) -> str:
        _, payload = self._call("GET", "/" + urllib.parse.quote(file_name))
        return payload.decode("utf-8-sig")

    def payment(self, payment_id: str) -> Optional[dict[str, Any]]:
        """The payment behind a report row, or None if the API doesn't know it."""
        try:
            _, payload = self._call("GET", "/v1/payments/" + urllib.parse.quote(payment_id), base=API_ROOT)
        except MercadoPagoError as exc:
            if "rejected the access token" in str(exc):
                raise
            logger.warning("Mercado Pago payment %s not described: %s", payment_id, exc)
            return None
        return json.loads(payload or b"{}")

    def user_nickname(self, user_id: Any) -> Optional[str]:
        """A Mercado Pago user's public nickname, or None if it can't be read. Best effort, so it
        never fails the run: the token was already proven by the report calls (a 403 here is
        that profile), and a network error or an odd body just leaves the transfer unnamed."""
        try:
            _, payload = self._call("GET", "/users/" + urllib.parse.quote(str(user_id)), base=API_ROOT)
            profile = json.loads(payload or b"{}")
        except (MercadoPagoError, OSError, http.client.HTTPException, ValueError) as exc:
            logger.warning("Mercado Pago user %s not described: %s", user_id, exc)
            return None
        nickname = profile.get("nickname") if isinstance(profile, dict) else None
        return collapse_ws(str(nickname or "")) or None


def transfer_recipient_id(payment: dict[str, Any]) -> Optional[Any]:
    """The Mercado Pago user a transfer went to, if the payment is one."""
    if payment.get("operation_type") != "money_transfer":
        return None
    return (payment.get("collector") or {}).get("id") or payment.get("collector_id")


def describe_payment(payment: dict[str, Any], recipient: Optional[str] = None) -> Optional[str]:
    """A human description of a payment: the card merchant, else its description. Transfers
    between Mercado Pago users only say "Varios", so they read as a transfer to `recipient`
    (the recipient's nickname), or just as a sent transfer when it isn't known."""
    interaction = payment.get("point_of_interaction") or {}
    commerce = ((interaction.get("transaction_data") or {}).get("commerce") or {}).get("name")
    description = collapse_ws(str(payment.get("description") or ""))
    if payment.get("operation_type") == "money_transfer":
        label = f"Transferencia a {recipient}" if recipient else "Transferencia enviada"
        if normalize(description) in UNINFORMATIVE_PAYMENT_DESCRIPTIONS:
            return label
        return f"{label} · {description}"
    if commerce:
        return collapse_ws(commerce)
    return description or None


def recent_report_files(reports: list[dict[str, Any]], now: datetime, lookback_days: int = REPORT_LOOKBACK_DAYS) -> list[str]:
    """File names of generated reports created within the lookback window, oldest first."""
    cutoff = now - timedelta(days=lookback_days)
    picked: list[tuple[datetime, str]] = []
    for r in reports:
        file_name = r.get("file_name")
        if not file_name or not str(file_name).endswith(".csv"):
            continue
        status = str(r.get("status") or "processed").lower()
        if status not in ("processed", "enabled", "done", "ready"):
            continue
        created = _parse_datetime(r.get("date_created") or r.get("generation_date") or "")
        if created is None or created >= cutoff:
            picked.append((created or now, file_name))
    return [name for _, name in sorted(picked)]


def _parse_datetime(value: str) -> Optional[datetime]:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def _row_date(value: str) -> Optional[str]:
    parsed = _parse_datetime(value.strip())
    if parsed is not None:
        return to_ar_date(parsed)
    # Fall back to a bare date at the start of the string.
    try:
        return datetime.strptime(value.strip()[:10], "%Y-%m-%d").date().isoformat()
    except ValueError:
        return None


def _movement_description(description: str) -> str:
    """`reserve_for_payment` -> `payment`: the movement a hold belongs to (normalized)."""
    norm = normalize(description)
    for prefix in SKIPPED_DESCRIPTION_PREFIXES:
        if norm.startswith(prefix):
            return norm[len(prefix):]
    return norm


def _cents(row: dict[str, str], column: str) -> int:
    return parse_amount_cents(row.get(column, "")) or 0


def _entry(row: dict[str, str], kind: str, direction: str, amount_cents: int, description: str) -> Entry:
    source_id = row.get("SOURCE_ID", "")
    return Entry(
        source="mercadopago",
        # One SOURCE_ID can carry several movements (a payment and its refund), so the kind
        # is part of the key; rows without an id dedupe on their content.
        external_id=f"{source_id}:{kind}" if source_id else row_hash(row),
        kind=kind,
        date=_row_date(row.get("DATE", "")),
        direction=direction,
        amount_cents=amount_cents,
        currency_code="ARS",
        description=DESCRIPTION_LABELS.get(normalize(description), description) or None,
        account_ref="mp",
        raw=row,
    )


def parse_release_csv(
    text: str,
    interest_markers: tuple[str, ...] = DEFAULT_INTEREST_MARKERS,
    stats: Optional[dict[str, Counter]] = None,
) -> list[Entry]:
    """
    Keeps outflows (expense) and interest inflows (income); drops balance/total rows and every
    other inflow. A hold still open at the end of the report (a card purchase pending capture)
    counts as an outflow. `stats`, if given, collects PAYMENT_METHOD and inflow DESCRIPTION counts.
    """
    if stats is not None:
        stats.setdefault("payment_methods", Counter())
        stats.setdefault("inflow_descriptions", Counter())

    sample = text[:4096]
    try:
        dialect = csv.Sniffer().sniff(sample, delimiters=";,\t")
    except csv.Error:
        dialect = csv.excel
    reader = csv.DictReader(io.StringIO(text), dialect=dialect)
    markers = tuple(normalize(m) for m in interest_markers)

    rows: list[dict[str, str]] = []
    for raw_row in reader:
        row = {(k or "").strip().upper(): (v or "").strip() for k, v in raw_row.items() if k}
        description = row.get("DESCRIPTION", "")
        if normalize(row.get("RECORD_TYPE", "")) in SKIPPED_RECORD_TYPES or normalize(description) in SKIPPED_RECORD_TYPES:
            continue
        rows.append(row)

    # Per SOURCE_ID: whether a movement row exists, and how much of its holds is still open.
    has_movement: set[str] = set()
    open_hold: Counter = Counter()
    for row in rows:
        source_id = row.get("SOURCE_ID", "")
        if not source_id:
            continue
        if normalize(row.get("DESCRIPTION", "")).startswith(SKIPPED_DESCRIPTION_PREFIXES):
            open_hold[source_id] += _cents(row, "NET_DEBIT_AMOUNT") - _cents(row, "NET_CREDIT_AMOUNT")
        else:
            has_movement.add(source_id)

    entries: list[Entry] = []
    emitted_holds: set[str] = set()
    for row in rows:
        description = row.get("DESCRIPTION", "")
        source_id = row.get("SOURCE_ID", "")

        if normalize(description).startswith(SKIPPED_DESCRIPTION_PREFIXES):
            # Holds only stand in for a movement the report doesn't have (yet).
            if (source_id and source_id not in has_movement and source_id not in emitted_holds
                    and open_hold[source_id] > 0 and _cents(row, "NET_DEBIT_AMOUNT") > 0):
                emitted_holds.add(source_id)
                entries.append(_entry(
                    {**row, PENDING_CAPTURE_FLAG: "true"}, "mp_outflow", "expense",
                    open_hold[source_id], _movement_description(description),
                ))
            continue

        net = _cents(row, "NET_CREDIT_AMOUNT") - _cents(row, "NET_DEBIT_AMOUNT")
        if net == 0:
            continue

        if stats is not None:
            stats["payment_methods"][row.get("PAYMENT_METHOD") or "(empty)"] += 1

        if net < 0:
            kind, direction = "mp_outflow", "expense"
        else:
            if stats is not None:
                stats["inflow_descriptions"][description or "(empty)"] += 1
            if not any(m in normalize(description) for m in markers):
                continue  # top-ups, transfers received, refunds...: not imported
            kind, direction = "mp_interest", "income"

        entries.append(_entry(row, kind, direction, abs(net), description))
    return entries


def run_daily(client: Client, now: Optional[datetime] = None) -> tuple[list[Entry], dict[str, Any]]:
    """Downloads recent reports and returns their entries plus stats for import_status."""
    now = now or datetime.now(timezone.utc)
    files = recent_report_files(client.list_reports(), now)
    stats: dict[str, Counter] = {}
    entries: dict[str, Entry] = {}
    for file_name in files:
        for entry in parse_release_csv(client.download(file_name), stats=stats):
            entries[entry.external_id] = entry
    nicknames: dict[Any, Optional[str]] = {}
    for entry in entries.values():
        source_id = entry.raw.get("SOURCE_ID", "")
        if source_id and _movement_description(entry.raw.get("DESCRIPTION", "")) in PAYMENT_DESCRIPTIONS:
            payment = client.payment(source_id)
            recipient = None
            recipient_id = transfer_recipient_id(payment) if payment else None
            if recipient_id:
                if recipient_id not in nicknames:
                    nicknames[recipient_id] = client.user_nickname(recipient_id)
                recipient = nicknames[recipient_id]
            described = describe_payment(payment, recipient) if payment else None
            if described:
                entry.description = described
    info = {
        "reports": files,
        "payment_methods_seen": dict(stats.get("payment_methods", {})),
        "inflow_descriptions": dict(stats.get("inflow_descriptions", {})),
    }
    logger.info("Mercado Pago: %d report(s), %d entries, stats=%s", len(files), len(entries), info)
    return list(entries.values()), info

