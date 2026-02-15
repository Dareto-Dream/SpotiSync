import os

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from starlette.exceptions import HTTPException as StarletteHTTPException
from dotenv import load_dotenv
import uvicorn

from routes.api import router as api_router
from websocket._handler import websocket_endpoint
from database.db import init_db, close_db
from modules.room import start_room_cleanup

load_dotenv()

app = FastAPI()

# Middleware
frontend_url = os.getenv('FRONTEND_URL') or 'http://localhost:3000'
app.add_middleware(
    CORSMiddleware,
    allow_origins=[frontend_url],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Request logging
@app.middleware("http")
async def log_requests(request: Request, call_next):
    print(f"{request.method} {request.url.path}")
    response = await call_next(request)
    return response

# API routes
app.include_router(api_router, prefix="/api")

# Root endpoint
@app.get("/")
async def root():
    return {
        "name": "Spotify Jam Mode API",
        "version": "1.0.0",
        "status": "running",
    }

# WebSocket endpoint
app.websocket("/ws")(websocket_endpoint)

# Error handling
@app.exception_handler(StarletteHTTPException)
async def http_exception_handler(request: Request, exc: StarletteHTTPException):
    if exc.status_code == 404:
        return JSONResponse(status_code=404, content={"error": "Not found"})
    return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})

@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    print("Server error:", exc)
    message = str(exc) if (os.getenv("NODE_ENV") == "development") else None
    content = {"error": "Internal server error"}
    if message:
        content["message"] = message
    return JSONResponse(status_code=500, content=content)

@app.on_event("startup")
async def on_startup():
    await init_db()
    await start_room_cleanup()

@app.on_event("shutdown")
async def on_shutdown():
    await close_db()

if __name__ == "__main__":
    port = int(os.getenv("PORT") or 3001)
    print(
        "\n".join(
            [
                "============================================",
                "   Spotify Jam Mode Backend Server        ",
                "============================================",
                "",
                f"Server running on port {port}",
                f"Environment: {os.getenv('NODE_ENV') or 'development'}",
                f"Frontend URL: {os.getenv('FRONTEND_URL')}",
                "WebSocket path: /ws",
                "",
                "API Endpoints:",
                "- POST   /api/rooms/create",
                "- GET    /api/rooms/:roomCode",
                "- POST   /api/rooms/:roomCode/join",
                "- GET    /api/rooms/:roomCode/queue",
                "- POST   /api/rooms/:roomCode/queue",
                "- DELETE /api/rooms/:roomCode/queue/:id",
                "- GET    /api/search",
                "- GET    /api/auth/login",
                "- GET    /api/auth/callback",
                "- GET    /api/auth/refresh",
                "- GET    /api/health",
                "",
                "Ready to accept connections!",
            ]
        )
    )
    uvicorn.run(app, host="0.0.0.0", port=port, reload=False)
