"""
Piggy importer Lambda. One package, deployed as two functions selected by IMPORT_SOURCE:

- santander:   triggered by S3 when SES stores a forwarded Santander alert email.
- mercadopago: daily schedule; event {"action": "daily" | "mp_setup" | "mp_backfill", ...}.

Both write Inbox rows (import_entries) and their own key of parameters.import_status, and raise
on failure so the CloudWatch alarm emails the user.
"""
import logging
import os
from datetime import datetime, timezone

from importer import db
from importer.inbound_email import GateConfig, handle_message, s3_objects
from importer.mercadopago import Client, run_daily

logger = logging.getLogger()
logger.setLevel(logging.INFO)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def handle_santander(event, conn, user_id):
    import boto3  # provided by the Lambda runtime

    s3 = boto3.client("s3")
    config = GateConfig(
        santander_senders=[s for s in os.environ.get("SANTANDER_SENDER", "").split(",") if s.strip()],
        forwarding_gmail=os.environ["FORWARDING_GMAIL"],
    )
    settings = db.load_settings(conn, user_id)
    imported = 0
    forwarding_works = False
    for bucket, key in s3_objects(event):
        raw = s3.get_object(Bucket=bucket, Key=key)["Body"].read()
        result = handle_message(raw, key, config)
        if result.forwarding_code:
            logger.info("Gmail forwarding confirmation code received")
            db.update_status(conn, user_id, "santander", {"forwarding_code": result.forwarding_code})
            continue
        if result.ignored_reason:
            logger.warning("Ignored s3://%s/%s: %s", bucket, key, result.ignored_reason)
            continue
        entry = result.entry
        if not forwarding_works:
            # A forwarded alert got through, so the confirmation code is no longer needed.
            forwarding_works = True
            db.update_status(conn, user_id, "santander", {"forwarding_code": None})
        if not settings.wants(entry):
            logger.info("Skipped %s (%s, %s): disabled in settings or before start date", entry.external_id, entry.kind, entry.date)
            continue
        if entry.parse_error:
            logger.warning("Parsed %s with problems: %s", key, entry.parse_error)
        imported += db.insert_entries(conn, user_id, [entry])
    return {"imported": imported}


def handle_mercadopago(event, conn, user_id):
    client = Client(os.environ["MP_ACCESS_TOKEN"])
    action = (event or {}).get("action", "daily")

    if action == "mp_setup":
        config = client.ensure_config()
        logger.info("Mercado Pago report config: %s", config)
        return {"config": config}

    if action == "mp_backfill":
        client.request_report(event["begin_date"], event["end_date"])
        return {"requested": [event["begin_date"], event["end_date"]]}

    settings = db.load_settings(conn, user_id)
    entries, info = run_daily(client)
    wanted = [e for e in entries if settings.wants(e)]
    imported = db.insert_entries(conn, user_id, wanted)
    return {"imported": imported, **info}


HANDLERS = {"santander": handle_santander, "mercadopago": handle_mercadopago}


def handler(event, context):
    source = os.environ["IMPORT_SOURCE"]
    user_id = os.environ["PIGGY_USER_ID"]
    conn = db.connect(os.environ["SUPABASE_DB_URL"])
    try:
        try:
            result = HANDLERS[source](event, conn, user_id)
        except Exception as e:
            conn.rollback()
            logger.exception("%s import failed", source)
            db.update_status(conn, user_id, source, {"last_run_at": _now(), "last_error": str(e)[:500]})
            raise
        if "imported" in result:
            db.update_status(conn, user_id, source, {
                "last_run_at": _now(),
                "last_ok_at": _now(),
                "last_error": None,
                "imported": result["imported"],
                **{k: v for k, v in result.items() if k in ("payment_methods_seen", "inflow_descriptions")},
            })
        logger.info("%s import done: %s", source, result)
        return result
    finally:
        conn.close()
