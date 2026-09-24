"""Shared bits: locate piggy-advisor's engine, resolve a month label and a card."""
from __future__ import annotations

import sys
from datetime import date, timedelta
from pathlib import Path


def _advisor_scripts() -> Path:
    # Walk up rather than hard-code a depth, so this works from the main checkout and
    # from a worktree nested under .claude/worktrees/.
    for parent in Path(__file__).resolve().parents:
        cand = parent / ".claude" / "skills" / "piggy-advisor" / "scripts"
        if (cand / "piggy.py").exists():
            return cand
    sys.exit("piggy-advisor skill not found — this skill reuses its scripts/piggy.py engine.")


sys.path.insert(0, str(_advisor_scripts()))
from piggy import Piggy, iter_anchors, usd  # noqa: E402,F401


def anchor_for_label(p: Piggy, month: str) -> str:
    """The anchor whose period the app *labels* `month` (YYYY-MM): the calendar month
    holding most of the period's days. With start day 20, '2026-10' → anchor 2026-09."""
    y, m = map(int, month.split("-"))
    prev = f"{y - (m == 1)}-{(m - 2) % 12 + 1:02d}"
    for a in iter_anchors(prev, month):
        s, e = p.period(a)
        days: dict[tuple[int, int], int] = {}
        d = s
        while d < e:
            days[(d.year, d.month)] = days.get((d.year, d.month), 0) + 1
            d += timedelta(days=1)
        if max(days, key=days.get) == (y, m):
            return a
    return month


def find_card(p: Piggy, name: str) -> dict:
    cards = p.cards()
    hit = [c for c in cards if c["name"].lower() == name.lower()] or \
          [c for c in cards if name.lower() in c["name"].lower()]
    if len(hit) != 1:
        sys.exit(f"card {name!r} matched {[c['name'] for c in hit] or 'nothing'}; "
                 f"known cards: {[c['name'] for c in cards]}")
    return hit[0]


def pay_date(card: dict, month: str) -> date:
    y, m = map(int, month.split("-"))
    return date(y, m, card["payment_day"])
