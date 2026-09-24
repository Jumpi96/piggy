---
name: piggy-card-review
description: Reconcile one credit card's month in Piggy against the bank's statement (xlsx "Últimos consumos" export, PDF, or pasted lines) — what matches, what's missing from Piggy and why, what's in Piggy but not on the statement — and, only when asked, fix the gaps (materialise skipped installments, extend installment rules, log missing one-offs, flag them TO BALANCE). Use when he gives a month + a card + a statement file, says "compare / review / reconcile my <card> for <month>", "do the same as the credit page", or asks to fix the mismatches found.
---

# Piggy card review

He hands over **a month, a card, and a statement**. You produce the reconciliation he'd
otherwise do by hand on the Credit page, then fix what he asks you to fix.

This skill is a thin layer over **`piggy-advisor`** — it imports that skill's
`scripts/piggy.py` engine (recurring expansion, override de-dup, periods, FX) and its
`.env` credentials. Read `piggy-advisor/SKILL.md` first if you haven't this session:
its guardrails (read-only by default, show SQL before writing, overrides and
`exception_dates` pitfalls) all apply here.

```bash
# from the repo root
R=".claude/skills/piggy-card-review/scripts"
uv run --with 'psycopg[binary]' --with openpyxl python $R/reconcile.py \
    --card "<card name>" --month YYYY-MM --statement <file>        # read-only report
uv run --with 'psycopg[binary]' python $R/fix.py plan.json          # dry run
uv run --with 'psycopg[binary]' python $R/fix.py plan.json --commit # after he says go
```

## 1. Pin down what's being compared

- **Month = the Credit page label**, not a calendar month and not the anchor. With a
  `month_start_day` of D, "October" is the period whose majority of days fall in
  October (e.g. D=20 → Sep 20 → Oct 19). `reconcile.py` resolves this; say the window
  out loud in your answer.
- **Card rows sit on the card's payment day** inside that window (`payment_day` from
  `credit_cards`), not on the purchase date. A statement "due 05/10" lands on the
  card's `payment_day` in October in Piggy.
- **The statement file.** The bank's `.xlsx` export parses directly. A PDF or a
  screenshot doesn't: read it yourself, write the lines to a JSON file
  (`[{"date","desc","cuotas","currency":"ARS|USD","cents"}]`, refunds negative), and
  pass that. Check the lines you extracted add up to the statement's subtotals before
  trusting them.
- One statement can carry **several sections** (main card, additional card, a
  replacement card number after loss/theft). They all belong to the one Piggy card he
  named unless he says otherwise; `reconcile.py` prints the sections so you notice.

## 2. Run the reconciliation

`reconcile.py` matches statement lines to Piggy rows **by currency and amount** —
exact first, then nearest within tolerance (ARS ±$1.00, USD ±$0.02). **Cents off is
expected** — installment splits round differently at the bank and in Piggy — and he
counts those as matches. Don't report them as discrepancies.

It prints four blocks: MATCHED, MISSING FROM PIGGY (each with a diagnosis), IN PIGGY
NOT ON STATEMENT, and TOTALS (statement vs matched+missing — should agree to within
rounding; if it doesn't, the parse is wrong, fix that before reporting anything).

What the diagnoses mean and what's usually behind them:

| Diagnosis | Usual story | Fix op |
|---|---|---|
| `<date> is in exception_dates` | He skipped that occurrence (often during an earlier reconcile) but the bank still charged it | `occurrence` |
| `ended <date>` + `cuotas N de M run to <date>` | Installment rule's window is shorter than the real plan | `extend` (+ `hide_before`) and usually `occurrence` for this month |
| `starts <date>` | Rule starts a month late / early vs the bank | `shift` |
| `on card X` | Logged on the wrong card | ask — moving it is an app edit |
| `SAME AMOUNT as matched line …` | Two identical charges (two $20 subscriptions); one Piggy row can't cover both | log the other one |
| `SIMILAR on <card> <date>` | Possibly logged elsewhere — check before adding a duplicate | ask |
| `not in Piggy at all` | Never logged | `add` |
| `cancels out` | A charge and its refund, both on the statement (or both in Piggy) | nothing |

Also check, every time:

- **Closing day drift.** Compare the statement's closing date with the card's
  `closing_day`. If the bank closed later, purchases between the two days sit on this
  statement but Piggy files them a month later — anything he logs from that gap must be
  dated to this month's payment day by hand.
- **Rows in Piggy not on the statement** that are installment rules: often a purchase
  the bank hasn't posted yet (rule should `shift` a month) or one charged to another
  card. Ask; don't guess.
- **Matches by amount are not proof of identity.** When a Piggy row's note clearly
  names something else than the statement line it matched (a rule for service A
  soaking up an identical charge for service B), say so.

## 3. Report

Lead with the verdict and the size of the gap in USD, then: matched count (with "cents
off counted as matches"), a table of missing lines grouped as *installments whose rule
skipped/ended* vs *one-offs never logged*, the in-Piggy-only rows, and any closing-day
drift. End by offering the fix. **Change nothing in this step.**

## 4. Fix — only when he asks

Write a plan file (scratchpad) and dry-run it; show him the statements in a readable
table; commit only after an explicit go. Ops (full reference in `fix.py --help`):

- `occurrence` — a physical override row for one occurrence of a rule on this month's
  payment date. Use this for a skipped installment even when the date is in
  `exception_dates`: the physical row shows regardless, and it doesn't touch the rule
  (which would force a full-row re-pull on his phone). Restores an existing/voided
  override for the same `(rule, date)` instead of inserting — the unique index counts
  soft-deleted rows.
- `extend` — move a rule's `end_date` to the real last installment. **Always pass
  `hide_before`** (the start of the period being reviewed) unless he says the missed
  past months should appear: extending across closed periods would otherwise silently
  add occurrences to months he already reconciled. Ask which he wants when the gap is
  non-empty; the default is hide.
- `shift` — move a rule's start/end window.
- `add` — a one-off card charge (pinned FX rate). Default category/tag from the
  closest comparable row he already has (same merchant earlier, or the matched rows'
  conventions); list your guesses in the dry-run table so he can correct them.
- `void` — soft-delete a physical one-off. Refuses override rows.

**"TO BALANCE" (`"tbb": true`)**: when he asks for the fixed rows to carry TO BALANCE,
set it on the rows created for *this* review (the `occurrence` / `add` rows) — never on
the rule, so future months stay clean. Nov/Dec occurrences produced by an `extend`
remain plain recurring virtuals unless he asks otherwise.

After `--commit`, `fix.py` prints the expense total of every period around the change,
before vs after. Check that only the periods you meant to touch moved, and by the
amounts you expected (the reviewed month by the added rows; later months by extended
installments; closed months by $0). Re-run `reconcile.py` to show the new match count.
Then tell him the phone picks it up on its next online sync.

## Fixing the skill itself

`reconcile.py` handles the parsing and matching; `fix.py` handles writes;
`common.py` locates `piggy-advisor` by walking up the tree (so it works from a
worktree). Bank layouts change — if the xlsx parse misses lines, the totals block will
disagree with the statement subtotal; fix `parse_xlsx` rather than hand-patching.
