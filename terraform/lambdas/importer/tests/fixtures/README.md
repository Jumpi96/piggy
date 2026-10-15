# Importer fixtures

## Santander: real alerts, anonymized

`santander_<kind>_<n>.eml` are real alert emails exported from Gmail ("Show original" → Download).
The HTML layout is kept as sent. Card digits, account numbers, names, receipt numbers, amounts
and merchants were replaced, the recipient became `me@gmail.com`, and the image parts were dropped.

| Fixture | What it is |
|---|---|
| `santander_card_purchase_1.eml` | Visa credit purchase in 3 cuotas |
| `santander_card_purchase_2.eml` | Visa credit purchase in 1 cuota, from another card |
| `santander_debit_purchase_1.eml` | Visa debit purchase in ARS |
| `santander_debit_purchase_2.eml` | Visa debit purchase in USD (`U$S`) |
| `santander_transfer_out_1.eml` | Transfer sent (no date in the body; the `Date` header is used) |

`test_santander_fixtures.py` also wraps each one in the headers Gmail and SES add when it is
forwarded (`as_stored_in_s3`), to check that it passes the gate. Once an alert really arrives
through SES, add its S3 copy as `santander_<kind>_<n>_forwarded.eml`.

There is no real "transfer received" sample yet; that kind is covered only by the synthetic
emails in `tests/emails.py`.

## Synthetic

Files prefixed `synthetic_`, and the emails in `tests/emails.py`, are hand-written stand-ins.
They follow the documented format and plausible wording, but they are **not** real output.

- `synthetic_mp_release.csv`: replace or complement it with `mp_release_<n>.csv`, a real
  release report (amounts and ids may be changed; keep the layout).

Each real sample gets a test asserting the parsed kind, amount, currency, date, description and
`account_ref` (the text that maps to a Piggy credit card).
