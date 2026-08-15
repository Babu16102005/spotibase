import psycopg2
import os

db_host = "aws-0-ap-northeast-2.pooler.supabase.com"
db_port = 5432
db_name = "postgres"
db_user = "postgres.yuwyzyvwxbwzlhrbyaqe"
db_pass = "Sathishbabu@16102005"

email = "babusanthosh6381@gmail.com"
username = "babusanthosh6381"

try:
    print(f"Connecting to database {db_host}...")
    conn = psycopg2.connect(
        host=db_host,
        port=db_port,
        dbname=db_name,
        user=db_user,
        password=db_pass,
        sslmode="require"
    )
    cursor = conn.cursor()

    print(f"Deleting existing records for {email} and username {username}...")
    cursor.execute("DELETE FROM users WHERE email = %s OR username = %s;", (email, username))
    deleted_count = cursor.rowcount
    conn.commit()

    print(f"Successfully deleted {deleted_count} user record(s).")
    cursor.close()
    conn.close()

except Exception as e:
    print(f"Error deleting user: {e}")
