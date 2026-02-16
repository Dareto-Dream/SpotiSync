import asyncio
import time
import os

import asyncpg
from dotenv import load_dotenv

load_dotenv()

_pool = None


class QueryResult:
    def __init__(self, rows, row_count):
        self.rows = rows
        self.rowCount = row_count


async def init_db():
    global _pool
    if _pool is None:
        _pool = await asyncpg.create_pool(
            dsn=os.getenv('DATABASE_URL'),
            min_size=1,
            max_size=20,
            max_inactive_connection_lifetime=30,
            timeout=2,
        )


async def close_db():
    global _pool
    if _pool is not None:
        await _pool.close()
        _pool = None


async def query(text: str, params=None):
    if params is None:
        params = []

    if _pool is None:
        await init_db()

    start = time.time()
    async with _pool.acquire() as connection:
        try:
            rows = await connection.fetch(text, *params)
            duration_ms = int((time.time() - start) * 1000)
            row_count = len(rows)
            print('Executed query', {"text": text.strip()[:100], "duration": duration_ms, "rows": row_count})
            return QueryResult([dict(row) for row in rows], row_count)
        except Exception as exc:
            print('Database query error:', exc)
            raise


async def execute(text: str, params=None):
    if params is None:
        params = []

    if _pool is None:
        await init_db()

    start = time.time()
    async with _pool.acquire() as connection:
        try:
            status = await connection.execute(text, *params)
            duration_ms = int((time.time() - start) * 1000)
            print('Executed statement', {"text": text.strip()[:100], "duration": duration_ms, "status": status})
            return status
        except Exception as exc:
            print('Database execute error:', exc)
            raise


async def get_client():
    if _pool is None:
        await init_db()

    connection = await _pool.acquire()
    timeout = asyncio.get_event_loop().call_later(
        5, lambda: print('A client has been checked out for more than 5 seconds!')
    )

    async def release():
        timeout.cancel()
        await _pool.release(connection)

    return connection, release


async def run_in_tx(fn):
    """Run an async callback inside a single DB transaction."""
    conn, release = await get_client()
    try:
        async with conn.transaction():
            return await fn(conn)
    finally:
        await release()


__all__ = ["query", "execute", "get_client", "run_in_tx", "init_db", "close_db"]
