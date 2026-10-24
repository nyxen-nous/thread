"""Thread's bounded, ephemeral signaling service. Never accepts file payloads."""
from __future__ import annotations
import asyncio
from collections import OrderedDict, deque
from contextlib import asynccontextmanager, suppress
from dataclasses import dataclass, field
import json
import os
from pathlib import Path
import re
import secrets
import time

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

MAX_MESSAGE = 32_768
MAX_ROOMS = 100
MAX_CONNECTIONS = 250
ROOM_SECONDS = 4 * 60 * 60
JOIN_SECONDS = 90
ID_PATTERN = re.compile(r'^[A-Za-z0-9_-]{24}$')
ORIGINS = {s.strip().rstrip('/') for s in os.getenv('ALLOWED_ORIGINS', 'http://127.0.0.1:5173,http://localhost:5173,http://127.0.0.1:8787,http://localhost:8787').split(',') if s.strip()}
# STUN discovers routes; it does not relay file bytes. Set empty to disable.
STUN_URLS = [s.strip() for s in os.getenv('STUN_URLS', 'stun:stun.cloudflare.com:3478').split(',') if s.strip().startswith(('stun:', 'stuns:'))]


class RateLimit:
    def __init__(self, limit=12, seconds=600, capacity=2048):
        self.limit, self.seconds, self.capacity = limit, seconds, capacity
        self.hits: OrderedDict[str, deque[float]] = OrderedDict()

    def allow(self, key: str) -> bool:
        now = time.monotonic()
        if key not in self.hits:
            if len(self.hits) >= self.capacity:
                # Do not evict a live bucket: churn must not reset limits.
                stale = [k for k, v in self.hits.items() if not v or now-v[-1] >= self.seconds]
                for k in stale:
                    del self.hits[k]
                if len(self.hits) >= self.capacity:
                    return False
            self.hits[key] = deque()
        queue = self.hits[key]
        while queue and now-queue[0] >= self.seconds:
            queue.popleft()
        if len(queue) >= self.limit:
            return False
        queue.append(now)
        return True


@dataclass
class Room:
    host: WebSocket
    created: float = field(default_factory=time.monotonic)
    guest: WebSocket | None = None
    session: str | None = None
    joined_at: float = 0
    approved: bool = False


class Registry:
    def __init__(self):
        self.rooms: dict[str, Room] = {}
        self.connections = 0
        self.creates = RateLimit()
        self.joins = RateLimit(40, 60)
        self.opens = RateLimit(60, 60)


async def send(ws: WebSocket | None, message: dict):
    if ws is not None:
        try:
            await asyncio.wait_for(ws.send_json(message), timeout=5)
        except (RuntimeError, WebSocketDisconnect, OSError, asyncio.TimeoutError):
            pass


async def close(ws: WebSocket | None, code=1000):
    if ws is not None:
        with suppress(RuntimeError, WebSocketDisconnect, OSError):
            await ws.close(code=code)


def create_app() -> FastAPI:
    registry = Registry()

    async def remove_guest(room: Room, reason: str):
        guest, session = room.guest, room.session
        room.guest, room.session, room.approved = None, None, False
        await send(guest, {'type': 'error', 'message': reason})
        await close(guest)
        await send(room.host, {'type': 'guest_left', 'session': session})

    async def remove_room(room_id: str, reason: str):
        room = registry.rooms.pop(room_id, None)
        if room:
            await send(room.guest, {'type': 'ended', 'message': reason})
            await close(room.guest)
            await send(room.host, {'type': 'ended', 'message': reason})
            await close(room.host)

    async def reap():
        while True:
            await asyncio.sleep(10)
            for room_id, room in list(registry.rooms.items()):
                if time.monotonic() - room.created >= ROOM_SECONDS:
                    await remove_room(room_id, 'This share has expired. Ask for a new link.')
                elif room.guest and not room.approved and time.monotonic()-room.joined_at >= JOIN_SECONDS:
                    await remove_guest(room, 'The sender did not approve this request in time.')

    @asynccontextmanager
    async def lifespan(_app):
        task = asyncio.create_task(reap())
        yield
        task.cancel()
        with suppress(asyncio.CancelledError):
            await task
        for room_id in list(registry.rooms):
            await remove_room(room_id, 'The service restarted. Ask the sender to create a new link.')

    app = FastAPI(title='Thread signaling', lifespan=lifespan, docs_url=None, redoc_url=None)
    app.state.registry = registry
    app.add_middleware(CORSMiddleware, allow_origins=sorted(ORIGINS), allow_methods=['GET'], allow_headers=[])

    @app.middleware('http')
    async def headers(request, call_next):
        response = await call_next(request)
        response.headers['Referrer-Policy'] = 'no-referrer'
        response.headers['X-Content-Type-Options'] = 'nosniff'
        response.headers['X-Frame-Options'] = 'DENY'
        response.headers['Permissions-Policy'] = 'camera=(), microphone=(), geolocation=()'
        response.headers['Cache-Control'] = 'no-store' if request.url.path.startswith('/api') else 'no-cache'
        return response

    @app.get('/api/health')
    async def health():
        return {'ok': True, 'service': 'thread', 'protocol': 1}

    @app.get('/api/config')
    async def config():
        return {'protocol': 1, 'iceServers': [{'urls': STUN_URLS}] if STUN_URLS else [], 'roomLifetimeSeconds': ROOM_SECONDS, 'directOnly': True}

    @app.websocket('/api/ws')
    async def signaling(ws: WebSocket):
        if ws.headers.get('origin', '').rstrip('/') not in ORIGINS:
            await ws.close(code=1008)
            return
        ip = ws.client.host if ws.client else 'unknown'
        # Do not trust arbitrary X-Forwarded-For. Configure proxy trust at Uvicorn.
        if registry.connections >= MAX_CONNECTIONS or not registry.opens.allow(ip):
            await ws.close(code=1013)
            return
        registry.connections += 1
        role, room_id, session = None, None, None
        recent = deque()
        try:
            await ws.accept()
            while True:
                packet = await asyncio.wait_for(ws.receive(), timeout=65)
                if packet['type'] == 'websocket.disconnect':
                    break
                raw = packet.get('text')
                if raw is None or len(raw.encode('utf-8')) > MAX_MESSAGE:
                    await ws.close(code=1009)
                    break
                now = time.monotonic()
                while recent and now-recent[0] > 1:
                    recent.popleft()
                recent.append(now)
                if len(recent) > 60:
                    await ws.close(code=1008)
                    break
                try:
                    msg = json.loads(raw)
                except (ValueError, RecursionError):
                    await ws.close(code=1008)
                    break
                if not isinstance(msg, dict) or not isinstance(msg.get('type'), str):
                    await ws.close(code=1008)
                    break
                kind = msg['type']
                if kind == 'ping':
                    await send(ws, {'type': 'pong'})
                    continue
                if role is None:
                    if kind == 'create':
                        if len(registry.rooms) >= MAX_ROOMS or not registry.creates.allow(ip):
                            await send(ws, {'type': 'error', 'message': 'Too many shares right now. Please try again later.'})
                            break
                        room_id = secrets.token_urlsafe(18)
                        registry.rooms[room_id] = Room(ws)
                        role = 'host'
                        await send(ws, {'type': 'created', 'room': room_id, 'expiresIn': ROOM_SECONDS})
                    elif kind == 'join':
                        if not registry.joins.allow(ip):
                            await send(ws, {'type': 'error', 'message': 'Too many connection attempts. Please wait a minute.'})
                            break
                        candidate = msg.get('room')
                        room = registry.rooms.get(candidate) if isinstance(candidate, str) and ID_PATTERN.fullmatch(candidate) else None
                        if room is None or now-room.created >= ROOM_SECONDS:
                            await send(ws, {'type': 'error', 'message': 'This share has ended or expired. Ask the sender for a new link.'})
                            break
                        if room.guest:
                            await send(ws, {'type': 'error', 'message': 'Someone is already connected. Try again after they finish.'})
                            break
                        role, room_id, session = 'guest', candidate, secrets.token_urlsafe(18)
                        room.guest, room.session, room.joined_at, room.approved = ws, session, now, False
                        await send(room.host, {'type': 'guest_joined', 'session': session})
                        await send(ws, {'type': 'joined', 'session': session})
                    else:
                        await ws.close(code=1008)
                        break
                    continue
                room = registry.rooms.get(room_id)
                if room is None:
                    break
                if kind == 'close' and role == 'host':
                    await remove_room(room_id, 'The sender ended this share.')
                    break
                if kind in ('approve', 'reject') and role == 'host' and msg.get('session') == room.session:
                    if kind == 'reject':
                        await remove_guest(room, 'The sender declined this connection.')
                    else:
                        room.approved = True
                    continue
                if kind == 'signal' and msg.get('session') == room.session:
                    envelope = msg.get('envelope')
                    if not isinstance(envelope, dict) or set(envelope) != {'iv', 'data'} or not all(isinstance(envelope[k], str) for k in envelope) or len(envelope['iv']) != 16 or not (16 <= len(envelope['data']) <= 28000):
                        await ws.close(code=1008)
                        break
                    target = room.guest if role == 'host' else room.host
                    await send(target, {'type': 'signal', 'session': room.session, 'envelope': envelope})
                else:
                    await ws.close(code=1008)
                    break
        except (WebSocketDisconnect, RuntimeError, OSError, asyncio.TimeoutError):
            pass
        finally:
            registry.connections -= 1
            if role == 'host' and room_id:
                await remove_room(room_id, 'The sender disconnected. Ask for a new link.')
            elif role == 'guest' and room_id:
                room = registry.rooms.get(room_id)
                if room and room.session == session:
                    room.guest, room.session, room.approved = None, None, False
                    await send(room.host, {'type': 'guest_left', 'session': session})
            await close(ws)

    dist = Path(__file__).resolve().parent.parent / 'dist'
    if dist.is_dir():
        app.mount('/assets', StaticFiles(directory=dist/'assets'), name='assets')
        if (dist/'fonts').is_dir():
            app.mount('/fonts', StaticFiles(directory=dist/'fonts'), name='fonts')

        @app.get('/{path:path}')
        async def frontend(path: str):
            if path == 'favicon.svg':
                return FileResponse(dist/'favicon.svg')
            if path.startswith('api/'):
                return JSONResponse({'detail': 'Not found'}, status_code=404)
            if path and path not in ('how-it-works', 'privacy') and not path.startswith('s/'):
                return JSONResponse({'detail': 'Not found'}, status_code=404)
            return FileResponse(dist/'index.html')
    return app


app = create_app()
