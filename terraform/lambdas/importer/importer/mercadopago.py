"""
Mercado Pago importer, based on the Releases report ("Dinero liberado") API.

Flow: the report is generated daily by Mercado Pago (06:00 GMT-3, set up once with
`mp_setup`); the daily run lists recent reports, downloads them and keeps the outflows and the
interest ("rendimientos") rows. Re-processing a report is harmless: rows dedupe on SOURCE_ID.

Endpoints and some column values still have to be confirmed against a real account (see the
README's Phase 0 checklist); everything uncertain is isolated in constants below.
"""
from __future__ import annotations

import csv
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

BASE_URL = "https://api.mercadopago.com/v1/account/release_report"

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
    "frequency": {"type": "daily", "value": 1, "hour": 6},
    "columns": [{"key": c} for c in REPORT_COLUMNS],
}

# Rows that are balances or totals, not movements.
SKIPPED_RECORD_TYPES = {"initial_available_balance", "total", "subtotal"}

# DESCRIPTION values (normalized, substring match) that mark an inflow as interest earned.
# To be confirmed with a real report: the daily run records every inflow description it
# sees in import_status.mercadopago.inflow_descriptions so the right value can be pinned.
DEFAULT_INTEREST_MARKERS = ("asset_management", "rendimiento", "interest", "yield")

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

    def _call(self, method: str, path: str, body: Optional[dict[str, Any]] = None, retries: int = 3) -> tuple[int, bytes]:
        url = BASE_URL + path
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


def parse_release_csv(
    text: str,
    interest_markers: tuple[str, ...] = DEFAULT_INTEREST_MARKERS,
    stats: Optional[dict[str, Counter]] = None,
) -> list[Entry]:
    """
    Keeps outflows (expense) and interest inflows (income); drops balance/total rows and every
    other inflow. `stats`, if given, collects PAYMENT_METHOD and inflow DESCRIPTION counts.
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

    entries: list[Entry] = []
    for raw_row in reader:
        row = {(k or "").strip().upper(): (v or "").strip() for k, v in raw_row.items() if k}
        record_type = normalize(row.get("RECORD_TYPE", ""))
        description = row.get("DESCRIPTION", "")
        if record_type in SKIPPED_RECORD_TYPES or normalize(description) in SKIPPED_RECORD_TYPES:
            continue

        credit = parse_amount_cents(row.get("NET_CREDIT_AMOUNT", "")) or 0
        debit = parse_amount_cents(row.get("NET_DEBIT_AMOUNT", "")) or 0
        net = credit - debit
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

        source_id = row.get("SOURCE_ID", "")
        entries.append(Entry(
            source="mercadopago",
            # One SOURCE_ID can carry several rows (e.g. a payment and its refund), so the
            # kind is part of the key; rows without an id dedupe on their content.
            external_id=f"{source_id}:{kind}" if source_id else row_hash(row),
            kind=kind,
            date=_row_date(row.get("DATE", "")),
            direction=direction,
            amount_cents=abs(net),
            currency_code="ARS",
            description=collapse_ws(" · ".join(
                v for v in (description, row.get("PAYMENT_METHOD", ""), row.get("EXTERNAL_REFERENCE", "")) if v
            )) or None,
            account_ref="mp",
            raw=row,
        ))
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
    info = {
        "reports": files,
        "payment_methods_seen": dict(stats.get("payment_methods", {})),
        "inflow_descriptions": dict(stats.get("inflow_descriptions", {})),
    }
    logger.info("Mercado Pago: %d report(s), %d entries, stats=%s", len(files), len(entries), info)
    return list(entries.values()), info

