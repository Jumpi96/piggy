import os
import boto3
from datetime import datetime, timedelta
import psycopg2
from urllib.parse import urlparse
import logging

logger = logging.getLogger()
logger.setLevel(logging.INFO)

s3 = boto3.client('s3')

def handler(event, context):
    """
    Lambda function to backup Supabase database to S3.
    Keeps weekly backups for 30 days.

    Requires SUPABASE_DB_URL in the format:
    postgresql://postgres.{PROJECT_ID}:{PASSWORD}@aws-0-{REGION}.pooler.supabase.com:6543/postgres

    OR connection details as separate environment variables.
    """
    bucket = os.environ['BACKUP_BUCKET']

    # Support both full connection string or separate components
    db_url = os.environ.get('SUPABASE_DB_URL')

    if not db_url:
        # Build connection string from components
        db_host = os.environ.get('SUPABASE_DB_HOST')
        db_port = os.environ.get('SUPABASE_DB_PORT', '5432')
        db_name = os.environ.get('SUPABASE_DB_NAME', 'postgres')
        db_user = os.environ.get('SUPABASE_DB_USER', 'postgres')
        db_password = os.environ.get('SUPABASE_DB_PASSWORD')

        if not all([db_host, db_password]):
            raise ValueError("Missing required database credentials")

        db_url = f"postgresql://{db_user}:{db_password}@{db_host}:{db_port}/{db_name}"

    timestamp = datetime.utcnow().strftime('%Y-%m-%d_%H-%M-%S')
    filename = f'backup-{timestamp}.sql'
    tmp_path = f'/tmp/{filename}'

    logger.info(f"Starting database backup: {filename}")

    try:
        # Parse connection URL
        parsed = urlparse(db_url)

        # Connect to database with IPv4 preference
        # Use connection string with hostaddr to force IPv4 resolution
        import socket

        # Get IPv4 address
        try:
            addr_info = socket.getaddrinfo(parsed.hostname, None, socket.AF_INET)
            ipv4_addr = addr_info[0][4][0]
            logger.info(f"Resolved {parsed.hostname} to IPv4: {ipv4_addr}")
        except socket.gaierror:
            logger.warning("Failed to resolve IPv4, using hostname directly")
            ipv4_addr = parsed.hostname

        conn = psycopg2.connect(
            hostaddr=ipv4_addr if ipv4_addr != parsed.hostname else None,
            host=parsed.hostname,
            port=parsed.port or 5432,
            database=parsed.path.lstrip('/'),
            user=parsed.username,
            password=parsed.password
        )

        logger.info("Connected to database successfully")

        # Create SQL dump
        with open(tmp_path, 'w') as f:
            cursor = conn.cursor()

            # Get all table names in public schema
            cursor.execute("""
                SELECT tablename FROM pg_tables
                WHERE schemaname = 'public'
                ORDER BY tablename
            """)
            tables = cursor.fetchall()

            logger.info(f"Found {len(tables)} tables to backup")

            # Write header
            f.write("-- PostgreSQL Database Backup\n")
            f.write(f"-- Generated: {timestamp}\n")
            f.write("-- Source: Supabase Database\n\n")
            f.write("SET statement_timeout = 0;\n")
            f.write("SET lock_timeout = 0;\n")
            f.write("SET client_encoding = 'UTF8';\n\n")

            # Dump each table
            for (table,) in tables:
                logger.info(f"Backing up table: {table}")

                # Get CREATE TABLE statement
                cursor.execute(f"""
                    SELECT 'CREATE TABLE IF NOT EXISTS ' || '{table}' || ' (' ||
                    array_to_string(
                        array_agg(
                            column_name || ' ' || data_type ||
                            CASE WHEN character_maximum_length IS NOT NULL
                                THEN '(' || character_maximum_length || ')'
                                ELSE ''
                            END ||
                            CASE WHEN is_nullable = 'NO' THEN ' NOT NULL' ELSE '' END
                        ), ', '
                    ) || ');'
                    FROM information_schema.columns
                    WHERE table_name = '{table}' AND table_schema = 'public'
                """)
                create_stmt = cursor.fetchone()
                if create_stmt and create_stmt[0]:
                    f.write(f"\n-- Table: {table}\n")
                    f.write(create_stmt[0] + "\n\n")

                # Get data
                cursor.execute(f'SELECT * FROM "{table}"')
                rows = cursor.fetchall()

                if rows:
                    # Get column names
                    cursor.execute(f"""
                        SELECT column_name FROM information_schema.columns
                        WHERE table_name = '{table}' AND table_schema = 'public'
                        ORDER BY ordinal_position
                    """)
                    columns = [col[0] for col in cursor.fetchall()]

                    f.write(f"-- Data for table: {table}\n")
                    for row in rows:
                        values = []
                        for val in row:
                            if val is None:
                                values.append('NULL')
                            elif isinstance(val, str):
                                # Escape single quotes
                                escaped = val.replace("'", "''")
                                values.append(f"'{escaped}'")
                            elif isinstance(val, (datetime, )):
                                values.append(f"'{val}'")
                            else:
                                values.append(str(val))

                        cols_str = ', '.join(f'"{col}"' for col in columns)
                        vals_str = ', '.join(values)
                        f.write(f'INSERT INTO "{table}" ({cols_str}) VALUES ({vals_str});\n')

                    f.write("\n")

            cursor.close()

        conn.close()
        logger.info("Database dump completed successfully")

        # Upload to S3
        with open(tmp_path, 'rb') as f:
            s3.put_object(
                Bucket=bucket,
                Key=filename,
                Body=f,
                ServerSideEncryption='AES256'
            )

        logger.info(f"Backup uploaded to s3://{bucket}/{filename}")

        # Cleanup old backups (keep only last 30 days)
        cleanup_old_backups(bucket)

        # Cleanup temp file
        os.remove(tmp_path)

        return {
            'statusCode': 200,
            'body': f'Backup successful: {filename}'
        }

    except Exception as e:
        logger.error(f"Backup failed: {str(e)}")
        raise

def cleanup_old_backups(bucket):
    """Remove backups older than 30 days"""
    try:
        cutoff_date = datetime.utcnow() - timedelta(days=30)

        response = s3.list_objects_v2(Bucket=bucket, Prefix='backup-')

        if 'Contents' not in response:
            logger.info("No backups found to cleanup")
            return

        deleted_count = 0
        for obj in response['Contents']:
            if obj['LastModified'].replace(tzinfo=None) < cutoff_date:
                s3.delete_object(Bucket=bucket, Key=obj['Key'])
                deleted_count += 1
                logger.info(f"Deleted old backup: {obj['Key']}")

        logger.info(f"Cleanup complete. Deleted {deleted_count} old backup(s)")

    except Exception as e:
        logger.error(f"Cleanup failed: {str(e)}")
        # Don't fail the backup if cleanup fails
