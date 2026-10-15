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

`gmail_forwarding_confirmation_es.eml` is Gmail's real forwarding confirmation, in Spanish. It
has no code, only a confirm link (`vf-`) and a cancel link (`uf-`). The addresses and both link
tokens were replaced, and SES's `Authentication-Results` (DMARC pass) was kept.

## Mercado Pago: real report, anonymized

`mp_release_1.csv` is rows from a real release report (one month, `,` separator), keeping one
example of every pattern seen: a card purchase abroad (net debit ≠ gross), a transfer to another
Mercado Pago user, a transfer out (`payout`), interest (`asset_management`), an incoming payment,
a cancelled hold, a purchase with a partial refund, a hold still open, and a tip. SOURCE_IDs,
external references and the balance/total rows were replaced.

Each movement is three rows sharing a SOURCE_ID: `reserve_for_*` debit, `reserve_for_*` credit,
then the movement. The payments API responses used in the tests (`test_mercadopago.py`) are real
shapes trimmed to the fields the importer reads.

## Synthetic

Files prefixed `synthetic_`, and the emails in `tests/emails.py`, are hand-written stand-ins.
They follow the documented format and plausible wording, but they are **not** real output.

- `synthetic_mp_release.csv`: kept for what the real report lacks (a `;` separator and a
  movement without SOURCE_ID).

Each real sample gets a test asserting the parsed kind, amount, currency, date, description and
`account_ref` (the text that maps to a Piggy credit card).
