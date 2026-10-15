# Importer fixtures

Files prefixed `synthetic_` are hand-written stand-ins: they follow the documented report format
and plausible email wording, but they are **not** real Mercado Pago or Santander output.

Replace or complement them with real, anonymized samples:

- `mp_release_<n>.csv`: a real release report (amounts and ids may be changed, keep the layout).
- `santander_<kind>_<n>.eml`: real alert emails exported from Gmail ("Show original" → Download),
  with names, document numbers and card digits replaced. Add the forwarded copy (as stored in S3)
  of at least one per kind too.

Each real sample gets a test asserting the parsed kind, amount, currency, date, description and
`account_ref` (the text that maps to a Piggy credit card).
