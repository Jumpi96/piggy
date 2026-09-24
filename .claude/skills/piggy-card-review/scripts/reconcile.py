"""Reconcile one credit card's month in Piggy against a bank statement. Read-only.

    uv run --with 'psycopg[binary]' --with openpyxl python \\
        .claude/skills/piggy-card-review/scripts/reconcile.py \\
        --card "VISA Adicional" --month 2026-10 --statement ~/Desktop/consumos.xlsx

--month is the month as the Credit page labels it, not the anchor.

--statement takes the bank's "Últimos consumos" .xlsx directly. For a PDF (or any
other layout) extract the lines into JSON and pass that file instead:
    [{"date": "15/12/2025", "desc": "Merpago*x", "cuotas": "10 de 12",
      "currency": "ARS", "cents": 3316950}, ...]
Refunds are negative cents.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import Piggy, anchor_for_label, find_card, pay_date  # noqa: E402

# Installment splits round differently at the bank and in Piggy; he counts these as
# matches. In cents.
TOLERANCE = {"ARS": 100, "USD": 2}


# -- statement ----------------------------------------------------------------------------

def _money(s: str) -> tuple[str, int]:
    """'$1.115.985,61' → ('ARS', 111598561); 'U$S-280,06' → ('USD', -28006)."""
    cur = "USD" if "U$S" in s else "ARS"
    s = s.replace("U$S", "").replace("$", "").replace(".", "").replace(",", ".").strip()
    return cur, round(float(s) * 100)


def parse_xlsx(path: Path) -> dict:
    import openpyxl
    ws = openpyxl.load_workbook(path, data_only=True).active
    rows = [r for r in ws.iter_rows(values_only=True) if any(c is not None for c in r)]
    meta: dict = {"sections": []}
    items, last_date, section = [], None, None
    for i, r in enumerate(rows):
        a = r[0] if isinstance(r[0], str) else ""
        if a == "Fecha de cierre" and i + 1 < len(rows):
            meta["closing"], meta["due"] = rows[i + 1][0], rows[i + 1][1]
        elif a.strip().startswith(("Tarjeta de", "Adicional de")):
            section = a.strip()
            meta["sections"].append(section)
        elif a.startswith("Subtotal"):
            meta.setdefault("subtotals", []).append({"section": a, "ars": r[4], "usd": r[5]})
        elif len(r) > 5 and r[3] and r[3] != "Comprobante":
            last_date = r[0] or last_date      # a blank date means same day as the row above
            raw = r[4] if r[4] not in (None, "") else r[5]
            cur, cents = _money(str(raw))
            items.append({"date": last_date, "desc": (r[1] or "").strip(), "cuotas": r[2] or "",
                          "currency": cur, "cents": cents, "section": section})
    return {"meta": meta, "items": items}


def load_statement(path: Path) -> dict:
    if path.suffix.lower() in (".xlsx", ".xlsm"):
        return parse_xlsx(path)
    if path.suffix.lower() == ".json":
        data = json.loads(path.read_text())
        return data if isinstance(data, dict) else {"meta": {}, "items": data}
    sys.exit(f"can't parse {path.suffix} directly — extract the lines to JSON (see --help)")


# -- matching -----------------------------------------------------------------------------

def signed(t) -> int:
    return t.amount_cents if t.direction == "expense" else -t.amount_cents


def match(items: list[dict], txns: list) -> tuple[list, list, list]:
    """Exact amounts first, then nearest within tolerance — so a 1-cent-off row can't
    steal the exact partner of a different line."""
    used, pairs, pending = set(), [], []
    for it in items:
        hit = next((t for t in txns if t.id not in used and t.currency_code == it["currency"]
                    and signed(t) == it["cents"]), None)
        if hit:
            used.add(hit.id); pairs.append((it, hit))
        else:
            pending.append(it)
    missing = []
    for it in pending:
        tol = TOLERANCE.get(it["currency"], 2)
        near = sorted((t for t in txns if t.id not in used and t.currency_code == it["currency"]
                       and abs(signed(t) - it["cents"]) <= tol),
                      key=lambda t: abs(signed(t) - it["cents"]))
        if near:
            used.add(near[0].id); pairs.append((it, near[0]))
        else:
            missing.append(it)
    return pairs, missing, [t for t in txns if t.id not in used]


def cancelling(entries: list, key) -> set[int]:
    """Indices of entries that net to ~zero with another one (a charge and its refund)."""
    out: set[int] = set()
    for i, x in enumerate(entries):
        for j in range(i + 1, len(entries)):
            (cx, vx), (cy, vy) = key(x), key(entries[j])
            if i not in out and j not in out and cx == cy and vx * vy < 0 \
                    and abs(vx + vy) <= TOLERANCE.get(cx, 2):
                out |= {i, j}
    return out


def last_installment_date(cuotas: str, due: date) -> date | None:
    m = re.match(r"\s*(\d+)\s*de\s*(\d+)", cuotas or "")
    if not m:
        return None
    mo = due.month - 1 + int(m[2]) - int(m[1])
    return date(due.year + mo // 12, mo % 12 + 1, due.day)


def diagnose(p: Piggy, card: dict, it: dict, due: date, pairs: list) -> list[str]:
    """Why a statement line has no Piggy row on this card this month."""
    tol = TOLERANCE.get(it["currency"], 2)
    out = []
    # Two statement lines with the same amount compete for one Piggy row; matching by
    # amount can't tell which one it "really" is, only that one of them is unlogged.
    for other, t in pairs:
        if other["currency"] == it["currency"] and abs(other["cents"] - it["cents"]) <= tol:
            out.append(f"SAME AMOUNT as matched line {other['date']} {other['desc'][:25]!r} "
                       f"→ {t.tag}/{t.note}; one of the two is unlogged")
    rules = p.q("""SELECT r.id, r.note, r.amount_cents, r.start_date, r.end_date, r.active,
                          r.exception_dates, c.name AS card
                   FROM recurring_rules r LEFT JOIN credit_cards c ON c.id = r.credit_card_id
                   WHERE r.user_id = %s AND r.deleted_at IS NULL AND r.currency_code = %s
                     AND abs(r.amount_cents - %s) <= %s ORDER BY r.start_date DESC""",
                (p.user_id, it["currency"], abs(it["cents"]), tol))
    last = last_installment_date(it["cuotas"], due)
    for r in rules:
        exc = r["exception_dates"]
        exc = (json.loads(exc) if isinstance(exc, str) else exc) or []
        why = []
        if r["card"] != card["name"]:
            why.append(f"on card {r['card']}")
        if not r["active"]:
            why.append("inactive")
        if due.isoformat() in exc:
            why.append(f"{due} is in exception_dates")
        if r["end_date"] and r["end_date"] < due:
            why.append(f"ended {r['end_date']}")
        if r["start_date"] > due:
            why.append(f"starts {r['start_date']}")
        if last and r["end_date"] and r["end_date"] < last:
            why.append(f"statement's cuotas {it['cuotas']} run to {last}")
        # Ignore stale rules that simply finished and aren't this purchase, and rules
        # whose occurrence this month is already matched to another line.
        if last is None and why and all(w.startswith(("ended", "on card")) for w in why):
            continue
        if not why and any(t.recurring_rule_id == str(r["id"]) for _, t in pairs):
            continue
        out.append(f"RULE {r['note']!r} {r['id']} [{r['start_date']}→{r['end_date']}]: "
                   + ("; ".join(why) or "should generate — check for an override elsewhere"))
    others = p.q("""SELECT t.date, t.note, t.tag, c.name AS card FROM transactions t
                    LEFT JOIN credit_cards c ON c.id = t.credit_card_id
                    WHERE t.user_id = %s AND t.deleted_at IS NULL AND t.currency_code = %s
                      AND abs(t.amount_cents - %s) <= %s
                      AND t.date BETWEEN %s::date - 75 AND %s::date + 75
                      AND t.credit_card_id IS DISTINCT FROM %s""",
                 (p.user_id, it["currency"], abs(it["cents"]), tol, due, due, card["id"]))
    for o in others:
        out.append(f"SIMILAR on {o['card'] or 'no card'} {o['date']} ({o['tag']}/{o['note']})")
    return out or ["not in Piggy at all"]


# -- report -------------------------------------------------------------------------------

def fmt(cur: str, cents: int) -> str:
    return f"{'U$S' if cur == 'USD' else '$'}{cents / 100:,.2f}"


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--card", required=True)
    ap.add_argument("--month", required=True, help="YYYY-MM as the Credit page labels it")
    ap.add_argument("--statement", required=True, type=Path)
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args()

    p = Piggy()
    card = find_card(p, a.card)
    anchor = anchor_for_label(p, a.month)
    start, end = p.period(anchor)
    due = pay_date(card, a.month)
    st = load_statement(a.statement.expanduser())
    items = st["items"]
    txns = [t for t in p.transactions(start, end) if t.credit_card_id == card["id"]]
    pairs, missing, extra = match(items, txns)
    # A charge and its refund both on the statement (or both in Piggy) need no action.
    zero_m = cancelling(missing, lambda it: (it["currency"], it["cents"]))
    zero_x = cancelling(extra, lambda t: (t.currency_code, signed(t)))
    diag = {id(it): (["cancels out with another line — nothing to log"] if i in zero_m
                     else diagnose(p, card, it, due, pairs)) for i, it in enumerate(missing)}

    if a.json:
        print(json.dumps({
            "card": card, "month": a.month, "anchor": anchor, "window": [start, end], "pay_date": due,
            "meta": st["meta"],
            "matched": [{**it, "piggy_id": t.id, "piggy_cents": signed(t), "tag": t.tag, "note": t.note,
                         "virtual": t.virtual, "to_be_balanced": t.to_be_balanced} for it, t in pairs],
            "missing": [{**it, "diagnosis": diag[id(it)], "cancels_out": i in zero_m}
                        for i, it in enumerate(missing)],
            "extra": [{"id": t.id, "date": t.date, "cents": signed(t), "currency": t.currency_code,
                       "category": t.category, "tag": t.tag, "note": t.note, "virtual": t.virtual,
                       "rule_id": t.recurring_rule_id, "to_be_balanced": t.to_be_balanced,
                       "cancels_out": i in zero_x} for i, t in enumerate(extra)],
        }, default=str, indent=1, ensure_ascii=False))
        return 0

    print(f"{card['name']} · {a.month} · window {start} → {end} (exclusive) · Piggy date {due}")
    print(f"Piggy card: closing day {card['closing_day']}, payment day {card['payment_day']}")
    if st["meta"].get("closing"):
        print(f"Statement:  closing {st['meta']['closing']}, due {st['meta']['due']}")
    if len(st["meta"].get("sections", [])) > 1:
        print(f"Sections:   {' | '.join(st['meta']['sections'])}")

    print(f"\nMATCHED {len(pairs)}/{len(items)}")
    for it, t in pairs:
        off = signed(t) - it["cents"]
        print(f"  {str(it['date']):10} {it['desc'][:30]:30} {it['cuotas']:8} {fmt(it['currency'], it['cents']):>15}"
              f"  → {t.tag or ''}/{t.note or ''}{' (rule)' if t.virtual else ''}"
              f"{' TBB' if t.to_be_balanced else ''}{f'  [{off:+d}¢]' if off else ''}")

    print(f"\nMISSING FROM PIGGY {len(missing)}")
    for it in missing:
        print(f"  {str(it['date']):10} {it['desc'][:30]:30} {it['cuotas']:8} {fmt(it['currency'], it['cents']):>15}")
        for d in diag[id(it)]:
            print(f"      ↳ {d}")

    print(f"\nIN PIGGY, NOT ON STATEMENT {len(extra)}")
    for i, t in enumerate(extra):
        print(f"  {t.date} {fmt(t.currency_code, signed(t)):>15}  {t.category}/{t.tag} {t.note or ''}"
              f"{' (rule ' + str(t.recurring_rule_id) + ')' if t.virtual else ''}"
              f"{'  <-> cancels out' if i in zero_x else ''}")

    print("\nTOTALS        statement      matched+missing")
    for cur in sorted({it["currency"] for it in items}):
        s = sum(it["cents"] for it in items if it["currency"] == cur)
        mm = sum(signed(t) for it, t in pairs if it["currency"] == cur) \
            + sum(it["cents"] for it in missing if it["currency"] == cur)
        print(f"  {cur}  {fmt(cur, s):>16}  {fmt(cur, mm):>16}   diff {fmt(cur, mm - s)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
