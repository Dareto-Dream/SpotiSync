import asyncio
import os
import random

from database.db import query

ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

# In-memory tracking for active connections
active_rooms = {}  # room_code -> { host_socket_id, member_sockets: set }



async def assert_room_host(room_code: str, host_id: str):
    room = await get_room_by_code(room_code)
    if not room:
        raise Exception('Room not found')
    if room['host_id'] != host_id:
        raise Exception('Only the host can perform this action')
    if not room['is_active']:
        raise Exception('Room is not active')
    return room


async def set_room_device(room_code: str, device_id: str | None):
    await query(
        """
        UPDATE rooms
        SET device_id = $1
        WHERE room_code = $2
        """,
        [device_id, room_code],
    )

def _generate_room_code(length=6):
    return ''.join(random.choice(ALPHABET) for _ in range(length))


async def start_room_cleanup():
    timeout_ms = int(os.getenv('ROOM_TIMEOUT') or 15000)

    async def cleanup_loop():
        while True:
            try:
                result = await query(
                    """
                    UPDATE rooms
                    SET is_active = false
                    WHERE is_active = true
                      AND last_heartbeat < NOW() - ($1 * INTERVAL '1 millisecond')
                    RETURNING room_code
                    """,
                    [timeout_ms],
                )

                for row in result.rows:
                    print(f"Room {row['room_code']} timed out, marking inactive")
                    active_rooms.pop(row['room_code'], None)
            except Exception as exc:
                print('Error in room cleanup:', exc)

            await asyncio.sleep(5)

    asyncio.create_task(cleanup_loop())


async def create_room(host_id: str, display_name: str):
    room_code = _generate_room_code()

    try:
        result = await query(
            """
            INSERT INTO rooms (room_code, host_id, is_active, last_heartbeat)
            VALUES ($1, $2, true, CURRENT_TIMESTAMP)
            RETURNING id, room_code
            """,
            [room_code, host_id],
        )

        room_id = result.rows[0]['id']

        await query(
            """
            INSERT INTO room_members (room_id, user_id, display_name, is_host)
            VALUES ($1, $2, $3, true)
            """,
            [room_id, host_id, display_name],
        )

        print(f"Created room {room_code} for host {host_id}")

        return {"roomId": room_id, "roomCode": room_code, "hostId": host_id}
    except Exception as exc:
        print('Error creating room:', exc)
        raise


async def get_room_by_code(room_code: str):
    try:
        result = await query(
            """
            SELECT id, room_code, host_id, is_active, current_track_uri,
                   current_track_position_ms, is_playing, device_id, last_heartbeat
            FROM rooms
            WHERE room_code = $1
            """,
            [room_code],
        )

        if len(result.rows) == 0:
            return None

        return result.rows[0]
    except Exception as exc:
        print('Error getting room:', exc)
        raise


async def update_room_heartbeat(room_code: str):
    try:
        await query(
            """
            UPDATE rooms
            SET last_heartbeat = CURRENT_TIMESTAMP
            WHERE room_code = $1 AND is_active = true
            """,
            [room_code],
        )
    except Exception as exc:
        print('Error updating heartbeat:', exc)


async def join_room(room_code: str, user_id: str, display_name: str):
    try:
        room = await get_room_by_code(room_code)

        if not room:
            raise Exception('Room not found')

        if not room['is_active']:
            raise Exception('Room is not active')

        await query(
            """
            INSERT INTO room_members (room_id, user_id, display_name, is_host)
            VALUES ($1, $2, $3, false)
            ON CONFLICT (room_id, user_id) DO NOTHING
            """,
            [room['id'], user_id, display_name],
        )

        members_result = await query(
            """
            SELECT user_id, display_name, is_host, joined_at
            FROM room_members
            WHERE room_id = $1
            ORDER BY joined_at
            """,
            [room['id']],
        )

        return {"room": room, "members": members_result.rows}
    except Exception as exc:
        print('Error joining room:', exc)
        raise


async def leave_room(room_code: str, user_id: str):
    try:
        room = await get_room_by_code(room_code)

        if not room:
            return

        await query(
            """
            DELETE FROM room_members
            WHERE room_id = $1 AND user_id = $2
            """,
            [room['id'], user_id],
        )

        if room['host_id'] == user_id:
            await close_room(room_code)
    except Exception as exc:
        print('Error leaving room:', exc)


async def close_room(room_code: str):
    try:
        room = await get_room_by_code(room_code)

        if not room:
            return

        await query(
            """
            UPDATE rooms
            SET is_active = false
            WHERE room_code = $1
            """,
            [room_code],
        )

        await query(
            """
            DELETE FROM room_members
            WHERE room_id = $1
            """,
            [room['id']],
        )

        await query(
            """
            DELETE FROM queue_items
            WHERE room_id = $1
            """,
            [room['id']],
        )

        print(f"Closed room {room_code}")
        active_rooms.pop(room_code, None)
    except Exception as exc:
        print('Error closing room:', exc)


async def get_room_members(room_code: str):
    try:
        room = await get_room_by_code(room_code)

        if not room:
            return []

        result = await query(
            """
            SELECT user_id, display_name, is_host, joined_at
            FROM room_members
            WHERE room_id = $1
            ORDER BY joined_at
            """,
            [room['id']],
        )

        return result.rows
    except Exception as exc:
        print('Error getting room members:', exc)
        return []


async def update_room_playback_state(room_code: str, state: dict):
    try:
        room = await get_room_by_code(room_code)

        if not room:
            return

        await query(
            """
            UPDATE rooms
            SET current_track_uri = $1,
                current_track_position_ms = $2,
                is_playing = $3,
                device_id = $4
            WHERE room_code = $5
            """,
            [
                state.get('trackUri') or None,
                state.get('positionMs') or 0,
                state.get('isPlaying') or False,
                state.get('deviceId') or None,
                room_code,
            ],
        )
    except Exception as exc:
        print('Error updating playback state:', exc)


def register_room_socket(room_code: str, socket_id: str, is_host: bool):
    if room_code not in active_rooms:
        active_rooms[room_code] = {
            'hostSocketId': None,
            'memberSockets': set(),
        }

    room = active_rooms[room_code]

    if is_host:
        room['hostSocketId'] = socket_id
    else:
        room['memberSockets'].add(socket_id)


def unregister_room_socket(room_code: str, socket_id: str):
    if room_code not in active_rooms:
        return None

    room = active_rooms[room_code]

    if room.get('hostSocketId') == socket_id:
        room['hostSocketId'] = None
        return 'host'
    if socket_id in room.get('memberSockets', set()):
        room['memberSockets'].discard(socket_id)
        return 'member'

    return None


def get_room_sockets(room_code: str):
    if room_code not in active_rooms:
        return {'hostSocketId': None, 'memberSockets': []}

    room = active_rooms[room_code]
    return {
        'hostSocketId': room.get('hostSocketId'),
        'memberSockets': list(room.get('memberSockets', set())),
    }
