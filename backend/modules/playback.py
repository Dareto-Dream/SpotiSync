import asyncio
import spotipy

from database.db import query, execute, run_in_tx
from modules.room import get_room_by_code


def _get_spotify_client(access_token: str):
    return spotipy.Spotify(auth=access_token, requests_timeout=20)


# ----------------------------
# Queue (DB-backed)
# ----------------------------

async def add_to_queue(room_code: str, track: dict, added_by: str):
    """Append a track to the end of the room's queue."""
    room = await get_room_by_code(room_code)
    if not room:
        raise Exception('Room not found')

    pos_result = await query(
        """
        SELECT COALESCE(MAX(position), -1) as max_pos
        FROM queue_items
        WHERE room_id = $1
        """,
        [room['id']],
    )
    next_position = (pos_result.rows[0]['max_pos'] or -1) + 1

    await execute(
        """
        INSERT INTO queue_items
        (room_id, track_uri, track_name, artist_name, album_name, duration_ms, added_by, position)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        """,
        [
            room['id'],
            track.get('uri'),
            track.get('name'),
            track.get('artists'),
            track.get('album'),
            track.get('durationMs'),
            added_by,
            next_position,
        ],
    )

    return await get_queue(room_code)


async def get_queue(room_code: str):
    room = await get_room_by_code(room_code)
    if not room:
        return []

    result = await query(
        """
        SELECT id, track_uri, track_name, artist_name, album_name,
               duration_ms, added_by, position, added_at
        FROM queue_items
        WHERE room_id = $1
        ORDER BY position
        """,
        [room['id']],
    )
    return result.rows


async def remove_from_queue(room_code: str, queue_item_id: int):
    room = await get_room_by_code(room_code)
    if not room:
        raise Exception('Room not found')

    await execute(
        """
        DELETE FROM queue_items
        WHERE room_id = $1 AND id = $2
        """,
        [room['id'], queue_item_id],
    )

    await _reindex_queue(room['id'])
    return await get_queue(room_code)


async def clear_queue(room_code: str):
    room = await get_room_by_code(room_code)
    if not room:
        raise Exception('Room not found')

    await execute(
        """
        DELETE FROM queue_items WHERE room_id = $1
        """,
        [room['id']],
    )


async def pop_next_queue_item(room_code: str):
    """Atomically: take the next queue item (position 0), delete it, reindex, return the item."""
    room = await get_room_by_code(room_code)
    if not room:
        raise Exception('Room not found')

    async def _tx(conn):
        row = await conn.fetchrow(
            """
            SELECT id, track_uri, track_name, artist_name, album_name, duration_ms, added_by, position, added_at
            FROM queue_items
            WHERE room_id = $1
            ORDER BY position
            LIMIT 1
            FOR UPDATE
            """,
            room['id'],
        )
        if not row:
            return None

        qid = row['id']
        await conn.execute(
            """
            DELETE FROM queue_items
            WHERE room_id = $1 AND id = $2
            """,
            room['id'],
            qid,
        )

        # Reindex remaining items.
        await conn.execute(
            """
            UPDATE queue_items
            SET position = subquery.new_position
            FROM (
              SELECT id, ROW_NUMBER() OVER (ORDER BY position) - 1 as new_position
              FROM queue_items
              WHERE room_id = $1
            ) as subquery
            WHERE queue_items.id = subquery.id
            """,
            room['id'],
        )

        return dict(row)

    return await run_in_tx(_tx)


async def _reindex_queue(room_id: int):
    await execute(
        """
        UPDATE queue_items
        SET position = subquery.new_position
        FROM (
          SELECT id, ROW_NUMBER() OVER (ORDER BY position) - 1 as new_position
          FROM queue_items
          WHERE room_id = $1
        ) as subquery
        WHERE queue_items.id = subquery.id
        """,
        [room_id],
    )


# ----------------------------
# Spotify Playback Control (host-only via API)
# ----------------------------

async def transfer_playback(access_token: str, device_id: str, force_play: bool = False):
    spotify = _get_spotify_client(access_token)
    await asyncio.to_thread(spotify.transfer_playback, device_id=device_id, force_play=force_play)
    return True


async def play(access_token: str, device_id: str | None = None, track_uri: str | None = None, position_ms: int = 0):
    spotify = _get_spotify_client(access_token)
    if track_uri:
        await asyncio.to_thread(
            spotify.start_playback,
            device_id=device_id,
            uris=[track_uri],
            position_ms=position_ms,
        )
    else:
        await asyncio.to_thread(spotify.start_playback, device_id=device_id)
    return True


async def pause(access_token: str, device_id: str | None = None):
    spotify = _get_spotify_client(access_token)
    await asyncio.to_thread(spotify.pause_playback, device_id=device_id)
    return True


async def skip_to_next(access_token: str, device_id: str | None = None):
    spotify = _get_spotify_client(access_token)
    await asyncio.to_thread(spotify.next_track, device_id=device_id)
    return True


async def skip_to_previous(access_token: str, device_id: str | None = None):
    spotify = _get_spotify_client(access_token)
    await asyncio.to_thread(spotify.previous_track, device_id=device_id)
    return True


async def seek(access_token: str, position_ms: int, device_id: str | None = None):
    spotify = _get_spotify_client(access_token)
    await asyncio.to_thread(spotify.seek_track, position_ms, device_id=device_id)
    return True


async def get_current_playback(access_token: str):
    spotify = _get_spotify_client(access_token)
    return await asyncio.to_thread(spotify.current_playback)


async def search_tracks(access_token: str, query_text: str, limit: int = 20):
    spotify = _get_spotify_client(access_token)
    data = await asyncio.to_thread(spotify.search, q=query_text, type='track', limit=limit)

    return [
        {
            'uri': track['uri'],
            'id': track['id'],
            'name': track['name'],
            'artists': ', '.join(artist['name'] for artist in track['artists']),
            'album': track['album']['name'],
            'albumArt': (track['album']['images'][0]['url'] if track['album']['images'] else None),
            'durationMs': track['duration_ms'],
            'previewUrl': track['preview_url'],
        }
        for track in data['tracks']['items']
    ]
