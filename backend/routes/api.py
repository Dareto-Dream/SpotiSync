import os
from urllib.parse import urlencode
from datetime import datetime, timezone

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse, RedirectResponse
from fastapi.encoders import jsonable_encoder

from modules.auth import (
    get_authorization_url,
    exchange_code_for_tokens,
    get_valid_access_token,
    get_user_profile,
)
from modules.room import (
    create_room,
    get_room_by_code,
    join_room,
    get_room_members,
    assert_room_host,
    set_room_device,
)
from modules.playback import (
    get_queue,
    add_to_queue,
    remove_from_queue,
    clear_queue,
    pop_next_queue_item,
    search_tracks,
    transfer_playback,
    play,
    pause,
    skip_to_next,
    skip_to_previous,
    seek,
    get_current_playback,
)

router = APIRouter()
frontend_url = os.getenv("FRONTEND_URL") or "http://localhost:3000"


# ----------------------------
# Auth
# ----------------------------

@router.get("/auth/login")
async def auth_login(state: str | None = None):
    auth_url = get_authorization_url(state)
    return RedirectResponse(auth_url, status_code=302)


@router.get("/auth/callback")
async def auth_callback(request: Request):
    code = request.query_params.get("code")
    state = request.query_params.get("state")
    error = request.query_params.get("error")

    if error:
        return RedirectResponse(f"{frontend_url}?error={error}")

    if not code:
        return RedirectResponse(f"{frontend_url}?error=no_code")

    try:
        result = await exchange_code_for_tokens(code)
        params = {
            "userId": result["userId"],
            "displayName": result["profile"].get("display_name") or result["userId"],
            "state": state or "default",
        }
        return RedirectResponse(f"{frontend_url}/callback?{urlencode(params)}")
    except Exception as exc:
        print("Callback error:", exc)
        return RedirectResponse(f"{frontend_url}?error=auth_failed")


@router.get("/auth/refresh")
async def auth_refresh(request: Request):
    user_id = request.query_params.get("userId")
    if not user_id:
        return JSONResponse(status_code=400, content={"error": "userId required"})

    try:
        access_token = await get_valid_access_token(user_id)
        return {"accessToken": access_token}
    except Exception as exc:
        print("Refresh error:", exc)
        return JSONResponse(status_code=401, content={"error": "Failed to refresh token"})


@router.get("/auth/profile")
async def auth_profile(request: Request):
    user_id = request.query_params.get("userId")
    if not user_id:
        return JSONResponse(status_code=400, content={"error": "userId required"})

    try:
        access_token = await get_valid_access_token(user_id)
        profile = await get_user_profile(access_token)
        return JSONResponse(content=jsonable_encoder(profile))
    except Exception as exc:
        print("Profile error:", exc)
        return JSONResponse(status_code=401, content={"error": "Failed to get profile"})


# ----------------------------
# Rooms
# ----------------------------

@router.post("/rooms/create")
async def rooms_create(request: Request):
    body = await request.json()
    host_id = body.get("hostId")
    display_name = body.get("displayName")

    if not host_id or not display_name:
        return JSONResponse(status_code=400, content={"error": "hostId and displayName required"})

    try:
        room = await create_room(host_id, display_name)
        return JSONResponse(content=jsonable_encoder(room))
    except Exception as exc:
        print("Create room error:", exc)
        return JSONResponse(status_code=500, content={"error": "Failed to create room"})


@router.get("/rooms/{room_code}")
async def rooms_get(room_code: str):
    try:
        room = await get_room_by_code(room_code)
        if not room:
            return JSONResponse(status_code=404, content={"error": "Room not found"})

        members = await get_room_members(room_code)
        queue = await get_queue(room_code)
        return JSONResponse(content=jsonable_encoder({"room": room, "members": members, "queue": queue}))
    except Exception as exc:
        print("Get room error:", exc)
        return JSONResponse(status_code=500, content={"error": "Failed to get room"})


@router.post("/rooms/{room_code}/join")
async def rooms_join(room_code: str, request: Request):
    body = await request.json()
    user_id = body.get("userId")
    display_name = body.get("displayName")

    if not user_id or not display_name:
        return JSONResponse(status_code=400, content={"error": "userId and displayName required"})

    try:
        result = await join_room(room_code, user_id, display_name)
        return JSONResponse(content=jsonable_encoder(result))
    except Exception as exc:
        print("Join room error:", exc)
        return JSONResponse(status_code=400, content={"error": str(exc)})


# ----------------------------
# Queue (collaborative)
# ----------------------------

@router.get("/rooms/{room_code}/queue")
async def rooms_queue(room_code: str):
    try:
        queue = await get_queue(room_code)
        return JSONResponse(content=jsonable_encoder({"queue": queue}))
    except Exception as exc:
        print("Get queue error:", exc)
        return JSONResponse(status_code=500, content={"error": "Failed to get queue"})


@router.post("/rooms/{room_code}/queue")
async def rooms_queue_add(room_code: str, request: Request):
    body = await request.json()
    track = body.get("track")
    added_by = body.get("addedBy")

    if not track or not added_by:
        return JSONResponse(status_code=400, content={"error": "track and addedBy required"})

    try:
        queue = await add_to_queue(room_code, track, added_by)
        return JSONResponse(content=jsonable_encoder({"queue": queue}))
    except Exception as exc:
        print("Add to queue error:", exc)
        return JSONResponse(status_code=500, content={"error": "Failed to add to queue"})


@router.delete("/rooms/{room_code}/queue/{queue_item_id}")
async def rooms_queue_remove(room_code: str, queue_item_id: int, request: Request):
    # host-only removal (keeps UX sane)
    host_id = request.query_params.get("hostId")
    if not host_id:
        return JSONResponse(status_code=400, content={"error": "hostId required"})

    try:
        await assert_room_host(room_code, host_id)
        queue = await remove_from_queue(room_code, int(queue_item_id))
        return JSONResponse(content=jsonable_encoder({"queue": queue}))
    except Exception as exc:
        return JSONResponse(status_code=400, content={"error": str(exc)})


@router.post("/rooms/{room_code}/queue/clear")
async def rooms_queue_clear(room_code: str, request: Request):
    body = await request.json()
    host_id = body.get("hostId")
    if not host_id:
        return JSONResponse(status_code=400, content={"error": "hostId required"})

    try:
        await assert_room_host(room_code, host_id)
        await clear_queue(room_code)
        return JSONResponse(content=jsonable_encoder({"ok": True}))
    except Exception as exc:
        return JSONResponse(status_code=400, content={"error": str(exc)})


# ----------------------------
# Playback (HOST ONLY, via our API)
# ----------------------------

@router.get("/rooms/{room_code}/playback")
async def rooms_playback_get(room_code: str, request: Request):
    host_id = request.query_params.get("hostId")
    if not host_id:
        return JSONResponse(status_code=400, content={"error": "hostId required"})

    try:
        room = await assert_room_host(room_code, host_id)
        access_token = await get_valid_access_token(host_id)

        playback = await get_current_playback(access_token)
        queue = await get_queue(room_code)

        return JSONResponse(content=jsonable_encoder({
            "room": room,
            "playback": playback,
            "queue": queue,
        }))
    except Exception as exc:
        return JSONResponse(status_code=400, content={"error": str(exc)})


@router.post("/rooms/{room_code}/playback/transfer")
async def rooms_playback_transfer(room_code: str, request: Request):
    body = await request.json()
    host_id = body.get("hostId")
    device_id = body.get("deviceId")
    force_play = bool(body.get("forcePlay") or False)

    if not host_id or not device_id:
        return JSONResponse(status_code=400, content={"error": "hostId and deviceId required"})

    try:
        await assert_room_host(room_code, host_id)
        access_token = await get_valid_access_token(host_id)
        await transfer_playback(access_token, device_id, force_play=force_play)
        await set_room_device(room_code, device_id)
        return JSONResponse(content=jsonable_encoder({"ok": True, "deviceId": device_id}))
    except Exception as exc:
        return JSONResponse(status_code=400, content={"error": str(exc)})


@router.post("/rooms/{room_code}/playback/play")
async def rooms_playback_play(room_code: str, request: Request):
    body = await request.json()
    host_id = body.get("hostId")
    device_id = body.get("deviceId")  # optional if already active in Spotify Connect
    track_uri = body.get("trackUri")  # optional
    position_ms = int(body.get("positionMs") or 0)
    use_queue = bool(body.get("useQueue") if body.get("useQueue") is not None else True)

    if not host_id:
        return JSONResponse(status_code=400, content={"error": "hostId required"})

    try:
        room = await assert_room_host(room_code, host_id)
        access_token = await get_valid_access_token(host_id)

        # If no explicit track provided, optionally pull from our queue.
        if not track_uri and use_queue:
            next_item = await pop_next_queue_item(room_code)
            if next_item:
                track_uri = next_item["track_uri"]

        # If still no track, resume Spotify's current context.
        await play(access_token, device_id=device_id or room.get("device_id"), track_uri=track_uri, position_ms=position_ms)

        queue = await get_queue(room_code)
        return JSONResponse(content=jsonable_encoder({"ok": True, "queue": queue, "playedUri": track_uri}))
    except Exception as exc:
        return JSONResponse(status_code=400, content={"error": str(exc)})


@router.post("/rooms/{room_code}/playback/pause")
async def rooms_playback_pause(room_code: str, request: Request):
    body = await request.json()
    host_id = body.get("hostId")
    device_id = body.get("deviceId")

    if not host_id:
        return JSONResponse(status_code=400, content={"error": "hostId required"})

    try:
        room = await assert_room_host(room_code, host_id)
        access_token = await get_valid_access_token(host_id)
        await pause(access_token, device_id=device_id or room.get("device_id"))
        return JSONResponse(content=jsonable_encoder({"ok": True}))
    except Exception as exc:
        return JSONResponse(status_code=400, content={"error": str(exc)})


@router.post("/rooms/{room_code}/playback/next")
async def rooms_playback_next(room_code: str, request: Request):
    body = await request.json()
    host_id = body.get("hostId")
    device_id = body.get("deviceId")
    prefer_queue = bool(body.get("preferQueue") if body.get("preferQueue") is not None else True)

    if not host_id:
        return JSONResponse(status_code=400, content={"error": "hostId required"})

    try:
        room = await assert_room_host(room_code, host_id)
        access_token = await get_valid_access_token(host_id)

        played_uri = None
        if prefer_queue:
            next_item = await pop_next_queue_item(room_code)
            if next_item:
                played_uri = next_item["track_uri"]
                await play(access_token, device_id=device_id or room.get("device_id"), track_uri=played_uri, position_ms=0)
            else:
                await skip_to_next(access_token, device_id=device_id or room.get("device_id"))
        else:
            await skip_to_next(access_token, device_id=device_id or room.get("device_id"))

        queue = await get_queue(room_code)
        return JSONResponse(content=jsonable_encoder({"ok": True, "queue": queue, "playedUri": played_uri}))
    except Exception as exc:
        return JSONResponse(status_code=400, content={"error": str(exc)})


@router.post("/rooms/{room_code}/playback/previous")
async def rooms_playback_previous(room_code: str, request: Request):
    body = await request.json()
    host_id = body.get("hostId")
    device_id = body.get("deviceId")

    if not host_id:
        return JSONResponse(status_code=400, content={"error": "hostId required"})

    try:
        room = await assert_room_host(room_code, host_id)
        access_token = await get_valid_access_token(host_id)
        await skip_to_previous(access_token, device_id=device_id or room.get("device_id"))
        return JSONResponse(content=jsonable_encoder({"ok": True}))
    except Exception as exc:
        return JSONResponse(status_code=400, content={"error": str(exc)})


@router.post("/rooms/{room_code}/playback/seek")
async def rooms_playback_seek(room_code: str, request: Request):
    body = await request.json()
    host_id = body.get("hostId")
    device_id = body.get("deviceId")
    position_ms = body.get("positionMs")

    if not host_id or position_ms is None:
        return JSONResponse(status_code=400, content={"error": "hostId and positionMs required"})

    try:
        room = await assert_room_host(room_code, host_id)
        access_token = await get_valid_access_token(host_id)
        await seek(access_token, int(position_ms), device_id=device_id or room.get("device_id"))
        return JSONResponse(content=jsonable_encoder({"ok": True}))
    except Exception as exc:
        return JSONResponse(status_code=400, content={"error": str(exc)})


# ----------------------------
# Search (host-only, reduces Spotify API load)
# ----------------------------

@router.get("/search")
async def search(request: Request):
    q = request.query_params.get("q")
    user_id = request.query_params.get("userId")

    if not q or not user_id:
        return JSONResponse(status_code=400, content={"error": "q and userId required"})

    try:
        # enforce "host does Spotify"
        # If you want to hard-enforce host-only search, require roomCode + check host. For now this keeps behavior.
        access_token = await get_valid_access_token(user_id)
        results = await search_tracks(access_token, q)
        return JSONResponse(content=jsonable_encoder({"results": results}))
    except Exception as exc:
        print("Search error:", exc)
        return JSONResponse(status_code=500, content={"error": "Failed to search"})


# ----------------------------
# Health
# ----------------------------

@router.get("/health")
async def health():
    timestamp = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    return {"status": "ok", "timestamp": timestamp}
