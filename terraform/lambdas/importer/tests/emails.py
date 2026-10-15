"""Builders for synthetic test emails.

They cover what the real fixtures don't (labels with a colon, transfers received,
unrecognized mail) and drive the gate checks.
"""
from email.message import EmailMessage

SANTANDER = "Santander <mensajesyavisos@mails.santander.com.ar>"
GMAIL = "me@gmail.com"
INBOUND = "santander-abc123@in.example.com"


def build(subject: str, html: str, sender: str = SANTANDER, forwarded: bool = True,
          spam: str = "PASS", message_id: str = "<alert-1@santander.com.ar>",
          date: str = "Tue, 14 Oct 2026 16:05:00 -0300") -> bytes:
    msg = EmailMessage()
    msg["From"] = sender
    msg["To"] = GMAIL
    msg["Subject"] = subject
    msg["Date"] = date
    msg["Message-ID"] = message_id
    if forwarded:
        msg["X-Forwarded-To"] = INBOUND
        msg["X-Forwarded-For"] = f"{GMAIL} {INBOUND}"
    msg["X-SES-Spam-Verdict"] = spam
    msg["X-SES-Virus-Verdict"] = "PASS"
    msg.set_content("Este correo tiene formato HTML.")
    msg.add_alternative(html, subtype="html")
    return bytes(msg)


CARD_PURCHASE = build(
    "Aviso de compra con tu Tarjeta de Crédito",
    """<html><head><style>p{color:red}</style></head><body>
    <h2>Realizaste una compra</h2>
    <table>
      <tr><td>Tarjeta:</td><td>VISA terminada en 1234</td></tr>
      <tr><td>Comercio:</td><td>SUPERMERCADO DIA 123</td></tr>
      <tr><td>Fecha:</td><td>14/10/2026 15:58</td></tr>
      <tr><td>Importe:</td><td>$ 12.345,67</td></tr>
      <tr><td>Cuotas:</td><td>1 cuota</td></tr>
    </table></body></html>""",
)

USD_INSTALLMENTS = build(
    "Aviso de compra con tu Tarjeta de Crédito",
    """<p>Realizaste una compra con tu tarjeta American Express terminada en 9999</p>
    <p>Comercio: NETFLIX.COM</p><p>Fecha: 13/10/2026</p><p>Importe: U$S 45,99 en 3 cuotas</p>""",
    message_id="<alert-2@santander.com.ar>",
)

DEBIT_PURCHASE = build(
    "Compra con tarjeta de débito",
    """<p>Realizaste un pago con tu Tarjeta de Débito terminada en 5678</p>
    <p>Comercio:</p><p>FARMACITY</p><p>Fecha: 12/10/2026</p><p>Monto: $ 8.900,00</p>""",
    message_id="<alert-3@santander.com.ar>",
)

TRANSFER_OUT = build(
    "Transferencia realizada",
    """<p>Realizaste una transferencia</p><p>Destinatario: JUAN PEREZ</p>
    <p>Importe: $ 150.000</p><p>Fecha: 11/10/2026</p>""",
    message_id="<alert-4@santander.com.ar>",
)

TRANSFER_IN = build(
    "Recibiste una transferencia",
    """<p>Recibiste una transferencia de: EMPRESA SA</p><p>De: EMPRESA SA</p><p>Importe: $ 1.000.000,00</p>""",
    message_id="<alert-5@santander.com.ar>",
)

UNRECOGNIZED = build(
    "Novedades de tu cuenta",
    "<p>Tenemos novedades para vos. Ingresá a Online Banking.</p>",
    message_id="<alert-6@santander.com.ar>",
)

FORWARDING_CONFIRMATION = build(
    "(#123456789) Gmail Forwarding Confirmation - Receive Mail from me@gmail.com",
    f"""<p>{GMAIL} has requested to automatically forward mail to your email address {INBOUND}.</p>
    <p>Confirmation code: 123456789</p>""",
    sender="Gmail Team <forwarding-noreply@google.com>",
    forwarded=False,
    message_id="<confirm@google.com>",
)
