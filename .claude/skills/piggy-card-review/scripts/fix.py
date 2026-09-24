"""Apply a reviewed set of statement fixes. Dry-run unless --commit.

    uv run --with 'psycopg[binary]' python \\
        .claude/skills/piggy-card-review/scripts/fix.py plan.json [--commit]

plan.json is a list of operations, all applied in ONE database transaction:

  {"op": "occurrence", "rule": "<rule uuid>", "date": "2026-10-03", "tbb": true}
      Materialise one occurrence of a rule as a physical override row
      (recurring_rule_id + original_date). Works even when the date is in the rule's
      exception_dates — the physical row is shown regardless. Optional "amount_cents".
      If a row already owns (rule, date) — even a voided one — it's restored and
      updated instead, because the unique index counts soft-deleted rows.

  {"op": "extend", "rule": "<rule uuid>", "end": "2026-12-03", "hide_before": "2026-10-01"}
      Move the rule's end_date. Occurrences newly exposed before "hide_before" are
      added to exception_dates so already-closed periods don't silently change.

  {"op": "shift", "rule": "<rule uuid>", "start": "2026-11-03", "end": "2027-01-03"}
      Move a rule's window (start and/or end), e.g. installments the bank posted a
      month later than he logged them.

  {"op": "add", "date": "2026-10-03", "card": "VISA Black", "direction": "expense",
   "amount_cents": 1018, "currency": "USD", "category": "Recreation",
   "tag": "tecnología", "note": "Fly.io", "tbb": true}
      A one-off card charge, pinned to the effective exchange rate.

  {"op": "void", "id": "<transaction uuid>"}
      Soft-delete a physical row. Refuses override rows — voiding one resurrects the
      virtual at its original_date (see piggy-advisor).

Prints every statement, then (with --commit) the expense total of each period from
6 before to 3 after the first touched date, before vs after.
"""
from __future__ import annotations

import argparse
import json
import sys
import uuid
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import Piggy, find_card, iter_anchors, usd  # noqa: E402
from piggy import add_months_clamped, generate_occurrences  # noqa: E402


def rate_id(p: Piggy, currency: str, d: date) -> str | None:
    """Same pinning as piggy.py add-txn: newest rate created in or before d's month."""
    if currency.upper() == "USD":
        return None
    rows = p.q("SELECT id, created_at FROM exchange_rates WHERE user_id = %s AND currency_code = %s "
               "ORDER BY created_at DESC", (p.user_id, currency))
    ok = [r for r in rows if r["created_at"].strftime("%Y-%m") <= d.strftime("%Y-%m")] or rows
    return str(ok[0]["id"]) if ok else None


def rule(p: Piggy, rid: str) -> dict:
    hit = [r for r in p.rules() if r["id"] == rid]
    if not hit:
        sys.exit(f"no live rule {rid}")
    return hit[0]


def build(p: Piggy, op: dict) -> tuple[list[tuple[str, tuple]], date]:
    """→ (statements, a date the op touches)."""
    kind = op["op"]
    if kind == "occurrence":
        r, d = rule(p, op["rule"]), date.fromisoformat(op["date"])
        amount = int(op.get("amount_cents", r["amount_cents"]))
        tbb = bool(op.get("tbb", False))
        existing = p.q("SELECT id, deleted_at FROM transactions WHERE user_id = %s "
                       "AND recurring_rule_id = %s AND original_date = %s", (p.user_id, r["id"], d))
        if existing:
            return [("UPDATE transactions SET deleted_at = NULL, date = %s, amount_cents = %s, "
                     "to_be_balanced = %s, updated_at = now() WHERE id = %s AND user_id = %s",
                     (d, amount, tbb, str(existing[0]["id"]), p.user_id))], d
        return [("""INSERT INTO transactions
                 (id, user_id, date, direction, amount_cents, currency_code, exchange_rate_id,
                  category, tag, payment_method, credit_card_id, recurring_rule_id, original_date,
                  to_be_balanced, note)
                 VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
                 (str(uuid.uuid4()), p.user_id, d, r["direction"], amount, r["currency_code"],
                  rate_id(p, r["currency_code"], d), r["category"], r["tag"], r["payment_method"],
                  r.get("credit_card_id"), r["id"], d, tbb, r.get("note")))], d

    if kind in ("extend", "shift"):
        r = rule(p, op["rule"])
        new_start = date.fromisoformat(op["start"]) if op.get("start") else r["start_date"]
        new_end = date.fromisoformat(op["end"]) if op.get("end") else r["end_date"]
        exc = list(r["exception_dates"])
        if op.get("hide_before"):
            cutoff = date.fromisoformat(op["hide_before"])
            before = {t.original_date for t in generate_occurrences(r, date(1900, 1, 1), cutoff, [])}
            after_rule = {**r, "start_date": new_start, "end_date": new_end}
            after = {t.original_date for t in generate_occurrences(after_rule, date(1900, 1, 1), cutoff, [])}
            exc = sorted(set(exc) | {d.isoformat() for d in after - before})
        # A full-row re-pull on his phone follows any UPDATE; exception_dates is the
        # column that has broken on that path before (see piggy-advisor).
        return [("UPDATE recurring_rules SET start_date = %s, end_date = %s, exception_dates = %s::jsonb "
                 "WHERE id = %s AND user_id = %s",
                 (new_start, new_end, json.dumps(exc), r["id"], p.user_id))], min(new_start, r["start_date"])

    if kind == "add":
        card = find_card(p, op["card"])
        d = date.fromisoformat(op["date"])
        res = p.insert_transaction(
            txn_date=d, direction=op.get("direction", "expense"), amount_cents=int(op["amount_cents"]),
            currency_code=op["currency"], category=op["category"], tag=op["tag"],
            payment_method="card", credit_card_id=card["id"], note=op.get("note"),
            to_be_balanced=bool(op.get("tbb", False)), commit=False)
        return [(res["sql"], res["args"])], d

    if kind == "void":
        row = p.q("SELECT date, recurring_rule_id FROM transactions WHERE id = %s AND user_id = %s",
                  (op["id"], p.user_id))
        if not row:
            sys.exit(f"no transaction {op['id']}")
        if row[0]["recurring_rule_id"]:
            sys.exit(f"{op['id']} is a recurring override — voiding it resurrects the virtual. "
                     "Zero its amount or add the date to exception_dates instead.")
        res = p.void_transaction(op["id"], commit=False)
        return [(res["sql"], res["args"])], row[0]["date"]

    sys.exit(f"unknown op {kind!r}")


def snapshot(p: Piggy, anchors: list[str]) -> dict[str, float]:
    out = {}
    for a in anchors:
        s, e = p.period(a)
        out[a] = sum(t.usd_cents for t in p.transactions(s, e) if t.direction == "expense")
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("plan", type=Path)
    ap.add_argument("--commit", action="store_true")
    a = ap.parse_args()

    ops = json.loads(a.plan.read_text())
    p = Piggy(allow_write=a.commit)
    stmts, touched = [], []
    for op in ops:
        s, d = build(p, op)
        stmts += s
        touched.append(d)
        print(f"\n# {json.dumps(op, ensure_ascii=False)}")
        for sql, args in s:
            print("  " + " ".join(sql.split()))
            print(f"    {args}")

    lo = add_months_clamped(min(touched), -6)
    hi = add_months_clamped(max(max(touched), date.today()), 3)
    anchors = list(iter_anchors(p.anchor_of(lo), p.anchor_of(hi)))

    if not a.commit:
        print("\nDRY RUN — nothing written. Re-run with --commit after he approves.")
        return 0

    before = snapshot(p, anchors)
    with p.conn.transaction():
        for sql, args in stmts:
            p.q(sql, args)
    after = snapshot(p, anchors)
    print("\nPERIOD (label)                 before          after          change")
    for k in anchors:
        d = after[k] - before[k]
        print(f"  {k} {p.label(k):22} {usd(before[k]):>13}  {usd(after[k]):>13}  "
              f"{usd(d) if round(d) else '—':>12}")
    print("\nCommitted. His phone picks this up on its next online sync.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
