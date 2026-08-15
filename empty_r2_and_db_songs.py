import psycopg2
import boto3
import os
from botocore.config import Config

# DB connection details
db_host = "aws-0-ap-northeast-2.pooler.supabase.com"
db_port = 5432
db_name = "postgres"
db_user = "postgres.yuwyzyvwxbwzlhrbyaqe"
db_pass = "Sathishbabu@16102005"

# R2 connection details
r2_account_id = "a8bb2d3760581ae283864f0bfae655bd"
r2_access_key = "520481a431fb87db7bb4ed9c24d10226"
r2_secret_key = "4f5071d683827ee32f69ca8524c51ca9fe44a8ae33fdb5a545565e8ca8122693"
r2_bucket = "spotibase-songs"

def purge_database_songs():
    print("1. Purging all songs from PostgreSQL database...")
    conn = psycopg2.connect(
        host=db_host,
        port=db_port,
        dbname=db_name,
        user=db_user,
        password=db_pass,
        sslmode="require"
    )
    cursor = conn.cursor()
    
    # Delete child references first or use CASCADE
    cursor.execute("DELETE FROM playlist_songs;")
    cursor.execute("DELETE FROM listening_history;")
    cursor.execute("DELETE FROM downloads;")
    cursor.execute("DELETE FROM song_contributing_artists;")
    try:
        cursor.execute("DELETE FROM song_analytics;")
    except Exception:
        conn.rollback()
        cursor = conn.cursor()
        
    cursor.execute("DELETE FROM songs;")
    songs_deleted = cursor.rowcount
    conn.commit()
    cursor.close()
    conn.close()
    print(f"   --> Deleted {songs_deleted} song record(s) from database.")

def purge_r2_bucket():
    print(f"2. Purging all objects from Cloudflare R2 bucket '{r2_bucket}'...")
    s3 = boto3.client(
        "s3",
        endpoint_url=f"https://{r2_account_id}.r2.cloudflarestorage.com",
        aws_access_key_id=r2_access_key,
        aws_secret_access_key=r2_secret_key,
        config=Config(signature_version="s3v4"),
        region_name="auto"
    )
    
    paginator = s3.get_paginator("list_objects_v2")
    deleted_objects = 0
    total_bytes_cleared = 0
    
    for page in paginator.paginate(Bucket=r2_bucket):
        if "Contents" in page:
            objects_to_delete = []
            for obj in page["Contents"]:
                objects_to_delete.append({"Key": obj["Key"]})
                total_bytes_cleared += obj["Size"]
                deleted_objects += 1
                
            if objects_to_delete:
                s3.delete_objects(
                    Bucket=r2_bucket,
                    Delete={"Objects": objects_to_delete}
                )
                print(f"   --> Deleted batch of {len(objects_to_delete)} object(s).")
                
    print(f"   --> Total R2 objects deleted: {deleted_objects}")
    print(f"   --> Total R2 storage cleared: {total_bytes_cleared / (1024 * 1024):.2f} MB ({total_bytes_cleared} bytes).")

if __name__ == "__main__":
    try:
        purge_database_songs()
        purge_r2_bucket()
        print("\nSUCCESS: All songs deleted and Cloudflare R2 bucket fully emptied!")
    except Exception as e:
        print(f"\nERROR: Failed to empty R2 / DB songs: {e}")
