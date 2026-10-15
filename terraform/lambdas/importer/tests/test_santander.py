import emails
from conftest import FIXTURES
from importer.inbound_email import GateConfig, handle_message, parse_message, s3_objects
from importer.santander import classify, html_to_text, parse_email

CONFIG = GateConfig(santander_senders=["santander.com.ar"], forwarding_gmail=emails.GMAIL)


def parse(raw: bytes):
    return parse_email(parse_message(raw), "id-1")


def test_credit_card_purchase():
    e = parse(emails.CARD_PURCHASE)
    assert (e.kind, e.direction, e.amount_cents, e.currency_code, e.date) == ("card_purchase", "expense", 1234567, "ARS", "2026-10-14")
    assert e.description == "SUPERMERCADO DIA 123"
    assert e.account_ref == "VISA terminada en 1234"
    assert e.installments == 1
    assert e.parse_error is None
    assert e.raw["subject"].startswith("Aviso de compra")
    assert "p{color:red}" not in e.raw["body"]  # styles are not text


def test_usd_purchase_in_installments():
    e = parse(emails.USD_INSTALLMENTS)
    assert (e.kind, e.amount_cents, e.currency_code, e.installments) == ("card_purchase", 4599, "USD", 3)
    assert e.account_ref.endswith("terminada en 9999")
    assert "American Express" in e.account_ref
    assert e.description == "NETFLIX.COM"


def test_debit_purchase_with_label_on_its_own_line():
    e = parse(emails.DEBIT_PURCHASE)
    assert (e.kind, e.direction, e.amount_cents, e.date) == ("debit_purchase", "expense", 890000, "2026-10-12")
    assert e.description == "FARMACITY"


def test_transfers():
    out = parse(emails.TRANSFER_OUT)
    assert (out.kind, out.direction, out.amount_cents, out.description) == ("transfer_out", "expense", 15000000, "JUAN PEREZ")
    incoming = parse(emails.TRANSFER_IN)
    assert (incoming.kind, incoming.direction, incoming.amount_cents) == ("transfer_in", "income", 100000000)
    assert incoming.description == "EMPRESA SA"


def test_unrecognized_email_becomes_a_needs_review_entry():
    e = parse(emails.UNRECOGNIZED)
    assert e.kind == "unknown"
    assert e.direction is None
    assert "unrecognized alert type" in e.parse_error
    assert "amount not found" in e.parse_error
    # Falls back to the email's Date header (Argentina local).
    assert e.date == "2026-10-14"
    assert "Online Banking" in e.raw["body"]


def test_classify_keywords():
    assert classify("Transferencia realizada a JUAN") == "transfer_out"
    assert classify("Compra con tu tarjeta VISA") == "card_purchase"
    assert classify("Pago con tarjeta de débito") == "debit_purchase"
    assert classify("Hola") == "unknown"


def test_html_to_text_keeps_table_cells_apart():
    assert html_to_text("<table><tr><td>Comercio:</td><td>DIA</td></tr></table>") == "Comercio:\nDIA"


# --- Gate ----------------------------------------------------------------------------

def test_gate_accepts_a_forwarded_santander_alert_and_uses_its_message_id():
    result = handle_message(emails.CARD_PURCHASE, "santander/obj1", CONFIG)
    assert result.ignored_reason is None
    assert result.entry.external_id == "<alert-1@santander.com.ar>"


def test_gate_accepts_exact_sender_addresses_too():
    config = GateConfig(santander_senders=["mensajesyavisos@mails.santander.com.ar"], forwarding_gmail=emails.GMAIL)
    assert handle_message(emails.CARD_PURCHASE, "k", config).entry is not None


def test_gate_rejects_mail_not_forwarded_by_the_user():
    raw = emails.build("Aviso de compra", "<p>Compra VISA $ 1</p>", forwarded=False)
    assert "not forwarded" in handle_message(raw, "k", CONFIG).ignored_reason


def test_gate_rejects_other_senders_even_if_forwarded():
    raw = emails.build("Aviso de compra", "<p>Compra VISA $ 1</p>", sender="Phisher <alerts@santander-ar.example>")
    assert "not a configured Santander sender" in handle_message(raw, "k", CONFIG).ignored_reason
    lookalike = emails.build("Aviso", "<p>x</p>", sender="x@evilsantander.com.ar")
    assert handle_message(lookalike, "k", CONFIG).ignored_reason


def test_gate_rejects_spam():
    raw = emails.build("Aviso de compra", "<p>Compra VISA $ 1</p>", spam="FAIL")
    assert "Spam" in handle_message(raw, "k", CONFIG).ignored_reason


def test_gmail_forwarding_confirmation_code_is_extracted():
    result = handle_message(emails.FORWARDING_CONFIRMATION, "k", CONFIG)
    assert result.forwarding.code == "123456789"
    assert result.forwarding.url is None
    assert result.entry is None


def test_spanish_gmail_confirmation_has_only_a_link():
    """Real (anonymized) email: no code, a confirm link and a cancel link; only confirm is kept."""
    raw = (FIXTURES / "gmail_forwarding_confirmation_es.eml").read_bytes()
    result = handle_message(raw, "k", CONFIG)
    assert result.forwarding.code is None
    assert result.forwarding.url == "https://mail.google.com/mail/vf-%5BCONFIRM-TOKEN%5D-abc123"


def _confirmation_with(auth_results, body_url="https://mail.google.com/mail/vf-%5BTOKEN%5D-x"):
    return emails.build(
        "Confirmación de reenvío de Gmail: recibir correo de me@gmail.com",
        f"<p>{emails.GMAIL} ha solicitado reenviar automáticamente el correo.</p><p>{body_url}</p>",
        sender="Equipo de Gmail <forwarding-noreply@google.com>", forwarded=False, auth_results=auth_results,
    )


def test_confirmation_must_pass_dmarc_as_checked_by_ses():
    assert handle_message(_confirmation_with(emails.GOOGLE_DMARC_PASS), "k", CONFIG).forwarding.url
    for auth in (None, "amazonses.com; spf=pass; dkim=fail; dmarc=fail header.from=google.com;"):
        result = handle_message(_confirmation_with(auth), "k", CONFIG)
        assert result.forwarding is None
        assert result.ignored_reason  # falls through to the normal gate, which rejects it


def test_only_ses_own_authentication_results_counts():
    # SES's failing verdict is on top; a pass the sender added further down must not count.
    raw = _confirmation_with("amazonses.com; spf=fail; dkim=fail; dmarc=fail header.from=google.com;")
    forged = b"Authentication-Results: " + emails.GOOGLE_DMARC_PASS.encode() + b"\nFrom:"
    raw = raw.replace(b"\nFrom:", b"\n" + forged, 1)
    assert raw.index(b"dmarc=fail") < raw.index(b"dmarc=pass")
    assert handle_message(raw, "k", CONFIG).forwarding is None


def test_only_gmail_confirm_links_are_kept():
    for url in ("https://evil.example/mail/vf-x", "https://mail.google.com.evil.example/mail/vf-x",
                "https://mail.google.com/mail/uf-cancel"):
        assert handle_message(_confirmation_with(emails.GOOGLE_DMARC_PASS, url), "k", CONFIG).forwarding is None


def test_s3_objects_decodes_keys():
    event = {"Records": [{"s3": {"bucket": {"name": "b"}, "object": {"key": "santander/a%2Bb+c"}}}]}
    assert s3_objects(event) == [("b", "santander/a+b c")]
