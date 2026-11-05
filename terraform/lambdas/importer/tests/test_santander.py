import emails
import pytest
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


def test_gate_accepts_a_genuine_alert_that_ses_scored_as_spam():
    # Real case: a purchase alert and a transfer alert, SPF/DKIM/DMARC all passing, spam verdict FAIL.
    raw = emails.build("Pagaste $32.799,00", "<p>Compra VISA $ 1</p>", spam="FAIL")
    result = handle_message(raw, "k", CONFIG)
    assert result.ignored_reason is None and result.entry is not None


def test_gate_accepts_the_authentication_results_shape_ses_writes_for_forwarded_mail():
    auth = ("amazonses.com; spf=pass (spfCheck: domain of _spf.google.com designates 209.85.210.170 as permitted "
            "sender) client-ip=209.85.210.170; envelope-from=me+caf_=santander-abc=in.example.com@gmail.com; "
            "helo=mail-pf1-f170.google.com; dkim=pass header.i=@mails.santander.com.ar; dmarc=pass header.from=mails.santander.com.ar;")
    raw = emails.build("Pagaste $32.799,00", "<p>Compra VISA $ 1</p>", spam="FAIL", auth_results=auth)
    assert handle_message(raw, "k", CONFIG).entry is not None


def test_gate_accepts_a_signing_identity_with_a_local_part_on_a_santander_domain():
    raw = emails.build("Aviso", "<p>x</p>", auth_results="amazonses.com; dkim=pass header.i=avisos@mails.santander.com.ar;")
    assert handle_message(raw, "k", CONFIG).entry is not None


def test_gate_rejects_a_virus():
    raw = emails.build("Aviso de compra", "<p>Compra VISA $ 1</p>").replace(b"X-SES-Virus-Verdict: PASS", b"X-SES-Virus-Verdict: FAIL")
    assert "Virus" in handle_message(raw, "k", CONFIG).ignored_reason


@pytest.mark.parametrize("auth", [
    "",  # SES verified nothing
    "amazonses.com; spf=pass; dkim=fail header.i=@mails.santander.com.ar; dmarc=fail header.from=mails.santander.com.ar;",
    "amazonses.com; spf=pass; dkim=pass header.i=@attacker.example; dmarc=pass header.from=attacker.example;",
    "mx.google.com; dkim=pass header.i=@mails.santander.com.ar;",  # not SES's own header
    # The signing identity can carry a local part: the domain is what follows the "@".
    "amazonses.com; dkim=pass header.i=mails.santander.com.ar@attacker.example; dmarc=pass header.from=attacker.example;",
    "amazonses.com; dkim=pass header.i=@mails.santander.com.ar.attacker.example;",
])
def test_gate_requires_a_valid_santander_dkim_signature(auth):
    raw = emails.build("Aviso de compra", "<p>Compra VISA $ 1</p>", auth_results=auth)
    assert "DKIM" in handle_message(raw, "k", CONFIG).ignored_reason


def test_gate_ignores_a_forged_authentication_results_below_ses_s():
    raw = emails.build("Aviso de compra", "<p>Compra VISA $ 1</p>",
                       auth_results="amazonses.com; dkim=fail header.i=@mails.santander.com.ar;")
    # A sender-added header further down the headers must not rescue a failed SES result.
    head, _, body = raw.partition(b"\n\n")
    forged = b"Authentication-Results: " + emails.SANTANDER_DKIM_PASS.encode()
    spoofed = head + b"\n" + forged + b"\n\n" + body
    assert spoofed.index(b"dkim=fail") < spoofed.index(b"dkim=pass")
    assert "DKIM" in handle_message(spoofed, "k", CONFIG).ignored_reason


def test_gate_requires_the_signature_to_match_the_from_domain():
    other = "Santander <avisos@santander.com.ar>"
    raw = emails.build("Aviso", "<p>x</p>", sender=other, auth_results="amazonses.com; dkim=pass header.i=@mails.santander.com.ar;")
    # santander.com.ar and mails.santander.com.ar are the same organization: aligned.
    assert handle_message(raw, "k", CONFIG).entry is not None
    unrelated = emails.build("Aviso", "<p>x</p>", sender="Santander <x@mails.santander.com.ar>",
                             auth_results="amazonses.com; dkim=pass header.i=@santander.com.ar;")
    assert handle_message(unrelated, "k", CONFIG).entry is not None


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
