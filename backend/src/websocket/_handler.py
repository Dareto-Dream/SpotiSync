
import json
import random
import time

from fastapi import WebSocket, WebSocketDisconnect

from modules.room import (
    get_room_by_code,
    update_room_heartbeat,
    leave_room,
    close_room,
    register_room_socket,
    unregister_room_socket,
    get_room_sockets,
    get_room_members,
    update_room_playback_state,
)
from modules.playback import (
    add_to_queue,
    get_queue,
    remove_from_queue,
    search_tracks,
    transfer_playback,
    play,
    pause,
    skip_to_next,
    skip_to_previous,
    seek,
    get_current_playback,
)
from modules.auth import get_valid_access_token

clients = {}  # socket_id -> { ws, user_id, room_code, is_host }


async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    socket_id = generate_socket_id()
    print(f"WebSocket connected: {socket_id}")

    try:
        while True:
            data = await websocket.receive_text()
            try:
                message = json.loads(data)
            except Exception:
                await send_error(websocket, 'Invalid message format')
                continue

            await handle_message(socket_id, websocket, message)
    except WebSocketDisconnect:
        await handle_disconnect(socket_id)
    except Exception as exc:
        print('WebSocket error:', exc)
        await handle_disconnect(socket_id)


async def handle_message(socket_id, ws, message):
    msg_type = message.get('type')
    payload = message.get('payload') or {}

    if msg_type == 'join_room':
        await handle_join_room(socket_id, ws, payload)
    elif msg_type == 'leave_room':
        await handle_leave_room(socket_id)
    elif msg_type == 'heartbeat':
        await handle_heartbeat(socket_id, payload)
    elif msg_type == 'search_tracks':
        await handle_search_tracks(socket_id, ws, payload)
    elif msg_type == 'add_to_queue':
        await handle_add_to_queue(socket_id, payload)
    elif msg_type == 'remove_from_queue':
        await handle_remove_from_queue(socket_id, payload)
    elif msg_type == 'playback_control':
        await handle_playback_control(socket_id, payload)
    elif msg_type == 'sync_playback':
        await handle_sync_playback(socket_id, payload)
    elif msg_type == 'transfer_device':
        await handle_transfer_device(socket_id, payload)
    elif msg_type == 'request_token':
        await handle_request_token(socket_id, ws, payload)
    else:
        await send_error(ws, f"Unknown message type: {msg_type}")

async def handle_join_room(socket_id, ws, payload):
    room_code = payload.get('roomCode')
    user_id = payload.get('userId')
    display_name = payload.get('displayName')
    is_host = payload.get('isHost') or False

    try:
        room = await get_room_by_code(room_code)
        if not room:
            return await send_error(ws, 'Room not found')
        if not room['is_active']:
            return await send_error(ws, 'Room is not active')

        clients[socket_id] = {
            'ws': ws,
            'userId': user_id,
            'roomCode': room_code,
            'isHost': is_host,
        }

        register_room_socket(room_code, socket_id, is_host)

        members = await get_room_members(room_code)
        queue = await get_queue(room_code)

        await send(ws, 'room_joined', {
            'roomCode': room_code,
            'room': room,
            'members': members,
            'queue': queue,
        })

        await broadcast_to_room(
            room_code,
            'member_joined',
            {'userId': user_id, 'displayName': display_name, 'isHost': is_host},
            exclude_socket_id=socket_id,
        )

        print(f"{user_id} joined room {room_code} as {'host' if is_host else 'member'}")
    except Exception as exc:
        print('Error joining room:', exc)
        await send_error(ws, str(exc))


async def handle_leave_room(socket_id):
    client = clients.get(socket_id)
    if not client:
        return

    room_code = client['roomCode']
    user_id = client['userId']

    try:
        await leave_room(room_code, user_id)
        role = unregister_room_socket(room_code, socket_id)

        if role == 'host':
            await close_room(room_code)
            await broadcast_to_room(room_code, 'room_closed', {'reason': 'Host disconnected'})

            to_close = [sid for sid, c in clients.items() if c['roomCode'] == room_code]
            for sid in to_close:
                try:
                    await clients[sid]['ws'].close()
                except Exception:
                    pass
                clients.pop(sid, None)
        else:
            await broadcast_to_room(room_code, 'member_left', {'userId': user_id})

        clients.pop(socket_id, None)
        print(f"{user_id} left room {room_code}")
    except Exception as exc:
        print('Error leaving room:', exc)


async def handle_heartbeat(socket_id, payload):
    client = clients.get(socket_id)
    if not client or not client.get('isHost'):
        return

    room_code = client['roomCode']
    await update_room_heartbeat(room_code)


async def handle_search_tracks(socket_id, ws, payload):
    client = clients.get(socket_id)
    if not client:
        return await send_error(ws, 'Not in a room')

    query_text = payload.get('query')
    user_id = client['userId']

    try:
        access_token = await get_valid_access_token(user_id)
        results = await search_tracks(access_token, query_text)
        await send(ws, 'search_results', {'results': results})
    except Exception as exc:
        print('Error searching tracks:', exc)
        await send_error(ws, 'Failed to search tracks')


async def handle_add_to_queue(socket_id, payload):
    client = clients.get(socket_id)
    if not client:
        return

    room_code = client['roomCode']
    user_id = client['userId']
    track = payload.get('track')

    try:
        queue = await add_to_queue(room_code, track, user_id)
        await broadcast_to_room(room_code, 'queue_updated', {'queue': queue})
    except Exception as exc:
        print('Error adding to queue:', exc)

async def handle_remove_from_queue(socket_id, payload):
    client = clients.get(socket_id)
    if not client:
        return

    room_code = client['roomCode']
    is_host = client.get('isHost')
    queue_item_id = payload.get('queueItemId')

    if not is_host:
        return await send_error(client['ws'], 'Only host can remove from queue')

    try:
        queue = await remove_from_queue(room_code, queue_item_id)
        await broadcast_to_room(room_code, 'queue_updated', {'queue': queue})
    except Exception as exc:
        print('Error removing from queue:', exc)


async def handle_playback_control(socket_id, payload):
    client = clients.get(socket_id)
    if not client or not client.get('isHost'):
        return await send_error(client['ws'] if client else None, 'Only host can control playback')

    user_id = client['userId']
    room_code = client['roomCode']
    action = payload.get('action')
    device_id = payload.get('deviceId')
    track_uri = payload.get('trackUri')
    position_ms = payload.get('positionMs')

    try:
        access_token = await get_valid_access_token(user_id)

        if action == 'play':
            await play(access_token, device_id, track_uri, position_ms)
        elif action == 'pause':
            await pause(access_token, device_id)
        elif action == 'next':
            await skip_to_next(access_token, device_id)
        elif action == 'previous':
            await skip_to_previous(access_token, device_id)
        elif action == 'seek':
            await seek(access_token, position_ms, device_id)

        await broadcast_to_room(
            room_code,
            'playback_changed',
            {
                'action': action,
                'deviceId': device_id,
                'trackUri': track_uri,
                'positionMs': position_ms,
            },
        )
    except Exception as exc:
        print('Error controlling playback:', exc)
        await send_error(client['ws'], 'Failed to control playback')


async def handle_sync_playback(socket_id, payload):
    client = clients.get(socket_id)
    if not client or not client.get('isHost'):
        return

    room_code = client['roomCode']
    state = payload.get('state')

    try:
        await update_room_playback_state(room_code, state)
        await broadcast_to_room(room_code, 'playback_state', state, exclude_socket_id=socket_id)
    except Exception as exc:
        print('Error syncing playback:', exc)


async def handle_transfer_device(socket_id, payload):
    client = clients.get(socket_id)
    if not client or not client.get('isHost'):
        return await send_error(client['ws'] if client else None, 'Only host can transfer device')

    user_id = client['userId']
    room_code = client['roomCode']
    device_id = payload.get('deviceId')

    try:
        access_token = await get_valid_access_token(user_id)
        await transfer_playback(access_token, device_id)
        await send(client['ws'], 'device_transferred', {'deviceId': device_id})
        await update_room_playback_state(room_code, {'deviceId': device_id})
    except Exception as exc:
        print('Error transferring device:', exc)
        await send_error(client['ws'], 'Failed to transfer device')

async def handle_request_token(socket_id, ws, payload):
    client = clients.get(socket_id)
    if not client:
        return await send_error(ws, 'Not connected')

    user_id = client['userId']

    try:
        access_token = await get_valid_access_token(user_id)
        await send(ws, 'token_response', {'accessToken': access_token})
    except Exception as exc:
        print('Error getting token:', exc)
        await send_error(ws, 'Failed to get access token')


async def handle_disconnect(socket_id):
    client = clients.get(socket_id)
    if client:
        await handle_leave_room(socket_id)

    clients.pop(socket_id, None)
    print(f"WebSocket disconnected: {socket_id}")


async def send(ws: WebSocket, msg_type: str, payload: dict):
    if ws is None:
        return
    await ws.send_text(json.dumps({'type': msg_type, 'payload': payload}))


async def send_error(ws: WebSocket, message: str):
    await send(ws, 'error', {'message': message})


async def broadcast_to_room(room_code, msg_type, payload, exclude_socket_id=None):
    for socket_id, client in list(clients.items()):
        if client['roomCode'] == room_code and socket_id != exclude_socket_id:
            await send(client['ws'], msg_type, payload)


def generate_socket_id():
    return f"ws_{int(time.time() * 1000)}_{random.random().__str__()[2:11]}"
