import os
import psycopg2
from datetime import datetime, timedelta
from urllib.parse import urlparse
import socket
import logging

logger = logging.getLogger()
logger.setLevel(logging.INFO)

def handler(event, context):
    """
    Lambda function to generate recurring transactions at the start of the month.
    Calls the ensure_recurring_generated RPC function with a 24-month horizon.
    """
    db_url = os.environ['SUPABASE_DB_URL']

    logger.info("Starting recurring transaction generation")

    conn = None
    try:
        # Parse connection URL
        parsed = urlparse(db_url)

        # Get IPv4 address
        try:
            addr_info = socket.getaddrinfo(parsed.hostname, None, socket.AF_INET)
            ipv4_addr = addr_info[0][4][0]
            logger.info(f"Resolved {parsed.hostname} to IPv4: {ipv4_addr}")
        except socket.gaierror:
            logger.warning("Failed to resolve IPv4, using hostname directly")
            ipv4_addr = parsed.hostname

        # Connect to database with IPv4
        conn = psycopg2.connect(
            hostaddr=ipv4_addr if ipv4_addr != parsed.hostname else None,
            host=parsed.hostname,
            port=parsed.port or 5432,
            database=parsed.path.lstrip('/'),
            user=parsed.username,
            password=parsed.password
        )
        cursor = conn.cursor()

        # Calculate date 24 months from now
        future_date = datetime.now() + timedelta(days=730)  # ~24 months
        until_date = future_date.strftime('%Y-%m-%d')

        logger.info(f"Generating recurring transactions until: {until_date}")

        # Call the RPC function
        cursor.execute("SELECT ensure_recurring_generated(%s)", (until_date,))
        conn.commit()

        logger.info("Recurring transaction generation completed successfully")

        cursor.close()
        conn.close()

        return {
            'statusCode': 200,
            'body': f'Successfully generated recurring transactions until {until_date}'
        }

    except Exception as e:
        logger.error(f"Failed to generate recurring transactions: {str(e)}")
        if conn:
            conn.rollback()
            conn.close()
        raise
