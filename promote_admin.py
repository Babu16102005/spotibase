import psycopg2

db_host = "aws-0-ap-northeast-2.pooler.supabase.com"
db_port = 5432
db_name = "postgres"
db_user = "postgres.yuwyzyvwxbwzlhrbyaqe"
db_pass = "Sathishbabu@16102005"

email = "babusanthosh6381@gmail.com"

try:
    conn = psycopg2.connect(
        host=db_host,
        port=db_port,
        dbname=db_name,
        user=db_user,
        password=db_pass,
        sslmode="require"
    )
    cursor = conn.cursor()

    cursor.execute("UPDATE users SET role = 'ADMIN' WHERE email = %s;", (email,))
    conn.commit()

    cursor.execute("SELECT id, username, email, role FROM users WHERE email = %s;", (email,))
    user = cursor.fetchone()
    print("User updated to ADMIN:", user)

    cursor.close()
    conn.close()

except Exception as e:
    print("Error:", e)
