import os
from contextlib import contextmanager
import psycopg
from psycopg.rows import dict_row

@contextmanager
def db():
    # Neon pooled endpoint; short transaction; no idle browser connection.
    with psycopg.connect(os.environ['DATABASE_URL'], connect_timeout=5, row_factory=dict_row, prepare_threshold=None) as conn:
        with conn.cursor() as cur:
            cur.execute("SET LOCAL statement_timeout = '15s'")
            cur.execute("SET LOCAL lock_timeout = '3s'")
            yield cur
