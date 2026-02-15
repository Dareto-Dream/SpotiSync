import httpx

from database.db import query
from modules.room import get_room_by_code


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
        async with httpx.AsyncClient(timeout=20.0) as client:
            await client.put(
                'https://api.spotify.com/v1/me/player',
                json={'device_ids': [device_id], 'play': False},
                headers={
                    'Authorization': f"Bearer {access_token}",
                    'Content-Type': 'application/json',
                },
            )

        print(f"Transferred playback to device {device_id}")
        return True
    except Exception as exc:
        error_message = getattr(getattr(exc, 'response', None), 'text', None) or str(exc)
        print('Error transferring playback:', error_message)
        raise


async def play(access_token: str, device_id: str, track_uri: str = None, position_ms: int = 0):
    try:
        body = {'uris': [track_uri], 'position_ms': position_ms} if track_uri else {}
        url = 'https://api.spotify.com/v1/me/player/play'
        if device_id:
            url = f"{url}?device_id={device_id}"

        async with httpx.AsyncClient(timeout=20.0) as client:
            await client.put(
                url,
                json=body,
                headers={
                    'Authorization': f"Bearer {access_token}",
                    'Content-Type': 'application/json',
                },
            )

        return True
    except Exception as exc:
        error_message = getattr(getattr(exc, 'response', None), 'text', None) or str(exc)
        print('Error starting playback:', error_message)
        raise


async def pause(access_token: str, device_id: str = None):
    try:
        url = 'https://api.spotify.com/v1/me/player/pause'
        if device_id:
            url = f"{url}?device_id={device_id}"

        async with httpx.AsyncClient(timeout=20.0) as client:
            await client.put(
                url,
                json={},
                headers={
                    'Authorization': f"Bearer {access_token}",
                    'Content-Type': 'application/json',
                },
            )

        return True
    except Exception as exc:
        error_message = getattr(getattr(exc, 'response', None), 'text', None) or str(exc)
        print('Error pausing playback:', error_message)
        raise


async def skip_to_next(access_token: str, device_id: str = None):
    try:
        url = 'https://api.spotify.com/v1/me/player/next'
        if device_id:
            url = f"{url}?device_id={device_id}"

        async with httpx.AsyncClient(timeout=20.0) as client:
            await client.post(
                url,
                json={},
                headers={
                    'Authorization': f"Bearer {access_token}",
                    'Content-Type': 'application/json',
                },
            )

        return True
    except Exception as exc:
        error_message = getattr(getattr(exc, 'response', None), 'text', None) or str(exc)
        print('Error skipping to next:', error_message)
        raise


async def skip_to_previous(access_token: str, device_id: str = None):
    try:
        url = 'https://api.spotify.com/v1/me/player/previous'
        if device_id:
            url = f"{url}?device_id={device_id}"

        async with httpx.AsyncClient(timeout=20.0) as client:
            await client.post(
                url,
                json={},
                headers={
                    'Authorization': f"Bearer {access_token}",
                    'Content-Type': 'application/json',
                },
            )

        return True
    except Exception as exc:
        error_message = getattr(getattr(exc, 'response', None), 'text', None) or str(exc)
        print('Error skipping to previous:', error_message)
        raise


async def seek(access_token: str, position_ms: int, device_id: str = None):
    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            await client.put(
                'https://api.spotify.com/v1/me/player/seek',
                params={'position_ms': position_ms, **({'device_id': device_id} if device_id else {})},
                headers={
                    'Authorization': f"Bearer {access_token}",
                    'Content-Type': 'application/json',
                },
            )

        return True
    except Exception as exc:
        error_message = getattr(getattr(exc, 'response', None), 'text', None) or str(exc)
        print('Error seeking:', error_message)
        raise


async def get_current_playback(access_token: str):
    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            response = await client.get(
                'https://api.spotify.com/v1/me/player',
                headers={'Authorization': f"Bearer {access_token}"},
            )

        if response.status_code == 204:
            return None

        response.raise_for_status()
        return response.json()
    except Exception as exc:
        error_message = getattr(getattr(exc, 'response', None), 'text', None) or str(exc)
        print('Error getting current playback:', error_message)
        raise


async def search_tracks(access_token: str, query: str, limit: int = 20):
    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            response = await client.get(
                'https://api.spotify.com/v1/search',
                params={'q': query, 'type': 'track', 'limit': limit},
                headers={'Authorization': f"Bearer {access_token}"},
            )
            response.raise_for_status()
            data = response.json()

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
        error_message = getattr(getattr(exc, 'response', None), 'text', None) or str(exc)
        print('Error searching tracks:', error_message)
        raise
