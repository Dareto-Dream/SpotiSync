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
)
from modules.playback import (
    get_queue,
    add_to_queue,
    remove_from_queue,
    search_tracks,
)

router = APIRouter()
frontend_url = os.getenv("FRONTEND_URL") or "http://localhost:3000"

# Auth routes
@router.get("/auth/login")
async def auth_login(request: Request):
    state = request.query_params.get("state") or "default"
    auth_url = get_authorization_url(state)
    return {"authUrl": auth_url}

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

# Room routes
@router.post("/rooms/create")
async def rooms_create(request: Request):
    body = await request.json()
    host_id = body.get("hostId")
    display_name = body.get("displayName")

    if not host_id or not display_name:
        return JSONResponse(
            status_code=400, content={"error": "hostId and displayName required"}
        )

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
        return JSONResponse(
            status_code=400, content={"error": "userId and displayName required"}
        )

    try:
        result = await join_room(room_code, user_id, display_name)
        return JSONResponse(content=jsonable_encoder(result))
    except Exception as exc:
        print("Join room error:", exc)
        return JSONResponse(status_code=400, content={"error": str(exc)})

# Queue routes
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
        return JSONResponse(
            status_code=400, content={"error": "track and addedBy required"}
        )

    try:
        queue = await add_to_queue(room_code, track, added_by)
        return JSONResponse(content=jsonable_encoder({"queue": queue}))
    except Exception as exc:
        print("Add to queue error:", exc)
        return JSONResponse(status_code=500, content={"error": "Failed to add to queue"})

@router.delete("/rooms/{room_code}/queue/{queue_item_id}")
async def rooms_queue_remove(room_code: str, queue_item_id: int):
    try:
        queue = await remove_from_queue(room_code, int(queue_item_id))
        return JSONResponse(content=jsonable_encoder({"queue": queue}))
    except Exception as exc:
        print("Remove from queue error:", exc)
        return JSONResponse(status_code=500, content={"error": "Failed to remove from queue"})

# Search routes
@router.get("/search")
async def search(request: Request):
    q = request.query_params.get("q")
    user_id = request.query_params.get("userId")

    if not q or not user_id:
        return JSONResponse(status_code=400, content={"error": "q and userId required"})

    try:
        access_token = await get_valid_access_token(user_id)
        results = await search_tracks(access_token, q)
        return JSONResponse(content=jsonable_encoder({"results": results}))
    except Exception as exc:
        print("Search error:", exc)
        return JSONResponse(status_code=500, content={"error": "Failed to search"})

# Health check
@router.get("/health")
async def health():
    timestamp = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    return {"status": "ok", "timestamp": timestamp}
