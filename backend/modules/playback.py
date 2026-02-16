import asyncio
import spotipy

from database.db import query
from modules.room import get_room_by_code


def _get_spotify_client(access_token: str):
    return spotipy.Spotify(auth=access_token, requests_timeout=20)


async def add_to_queue(room_code: str, track: dict, added_by: str):
    try:
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

        await query(
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
    except Exception as exc:
        print('Error adding to queue:', exc)
        raise


async def get_queue(room_code: str):
    try:
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
    except Exception as exc:
        print('Error getting queue:', exc)
        return []


async def remove_from_queue(room_code: str, queue_item_id: int):
    try:
        room = await get_room_by_code(room_code)

        if not room:
            raise Exception('Room not found')

        await query(
            """
            DELETE FROM queue_items
            WHERE room_id = $1 AND id = $2
            """,
            [room['id'], queue_item_id],
        )

        await query(
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
            [room['id']],
        )

        return await get_queue(room_code)
    except Exception as exc:
        print('Error removing from queue:', exc)
        raise


async def clear_queue(room_code: str):
    try:
        room = await get_room_by_code(room_code)

        if not room:
            raise Exception('Room not found')

        await query(
            """
            DELETE FROM queue_items WHERE room_id = $1
            """,
            [room['id']],
        )
    except Exception as exc:
        print('Error clearing queue:', exc)


async def transfer_playback(access_token: str, device_id: str):
    try:
        spotify = _get_spotify_client(access_token)
        await asyncio.to_thread(spotify.transfer_playback, device_id=device_id, force_play=False)

        print(f"Transferred playback to device {device_id}")
        return True
    except Exception as exc:
        print('Error transferring playback:', exc)
        raise


async def play(access_token: str, device_id: str, track_uri: str = None, position_ms: int = 0):
    try:
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
    except Exception as exc:
        print('Error starting playback:', exc)
        raise


async def pause(access_token: str, device_id: str = None):
    try:
        spotify = _get_spotify_client(access_token)
        await asyncio.to_thread(spotify.pause_playback, device_id=device_id)

        return True
    except Exception as exc:
        print('Error pausing playback:', exc)
        raise


async def skip_to_next(access_token: str, device_id: str = None):
    try:
        spotify = _get_spotify_client(access_token)
        await asyncio.to_thread(spotify.next_track, device_id=device_id)

        return True
    except Exception as exc:
        print('Error skipping to next:', exc)
        raise


async def skip_to_previous(access_token: str, device_id: str = None):
    try:
        spotify = _get_spotify_client(access_token)
        await asyncio.to_thread(spotify.previous_track, device_id=device_id)

        return True
    except Exception as exc:
        print('Error skipping to previous:', exc)
        raise


async def seek(access_token: str, position_ms: int, device_id: str = None):
    try:
        spotify = _get_spotify_client(access_token)
        await asyncio.to_thread(spotify.seek_track, position_ms, device_id=device_id)

        return True
    except Exception as exc:
        print('Error seeking:', exc)
        raise


async def get_current_playback(access_token: str):
    try:
        spotify = _get_spotify_client(access_token)
        return await asyncio.to_thread(spotify.current_playback)
    except Exception as exc:
        print('Error getting current playback:', exc)
        raise


async def search_tracks(access_token: str, query: str, limit: int = 20):
    try:
        spotify = _get_spotify_client(access_token)
        data = await asyncio.to_thread(spotify.search, q=query, type='track', limit=limit)

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
    except Exception as exc:
        print('Error searching tracks:', exc)
        raise
