"""AP Survey Bot — local dev & Render backend."""

import asyncio
import json
import os
import time
from pathlib import Path
from typing import Optional

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from auth import TOKEN_TTL, authenticate, create_token, usernames, verify_token
from storage import (
    clear_completions,
    completion_stats,
    delete_completion,
    init_db,
    list_completions,
    save_completion,
)
from survey_bot import encode_screenshot, run_survey, validate_code

ROOT = Path(__file__).parent
PUBLIC = ROOT / "public"
STATIC = ROOT / "static" if (ROOT / "static").exists() else PUBLIC
ADMIN_KEY = os.environ.get("ADMIN_KEY", "")

app = FastAPI(title="Prabesh Tims Bot")

allowed = os.environ.get("ALLOWED_ORIGINS", "*").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in allowed if o.strip()],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def on_startup():
    init_db()


def get_client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for")
    real_ip = request.headers.get("x-real-ip")
    if forwarded:
        ip = forwarded.split(",")[0].strip()
    elif real_ip:
        ip = real_ip.strip()
    elif request.client:
        ip = request.client.host
    else:
        ip = "unknown"
    return ip


def _public_file(name: str, media_type: str) -> FileResponse:
    path = PUBLIC / name
    if not path.is_file():
        raise HTTPException(404, f"{name} not found")
    return FileResponse(path, media_type=media_type)


if PUBLIC.exists():
    app.mount("/static", StaticFiles(directory=PUBLIC), name="static")

    @app.get("/styles.css", include_in_schema=False)
    async def serve_styles():
        return _public_file("styles.css", "text/css")

    @app.get("/app.js", include_in_schema=False)
    async def serve_app_js():
        return _public_file("app.js", "application/javascript")

    @app.get("/deploy.json", include_in_schema=False)
    async def serve_deploy_json():
        return _public_file("deploy.json", "application/json")


class RunRequest(BaseModel):
    survey_code: str = Field(..., min_length=1)


class BulkRequest(BaseModel):
    survey_codes: list[str] = Field(default_factory=list)


class LoginRequest(BaseModel):
    username: str = Field(..., min_length=1)
    password: str = Field(..., min_length=1)


# Simple in-memory brute-force throttle: ip -> [failures, window_start].
_LOGIN_FAILURES: dict[str, list[float]] = {}
_MAX_ATTEMPTS = 8
_LOCKOUT_WINDOW = 300  # seconds


def _login_locked(ip: str) -> bool:
    entry = _LOGIN_FAILURES.get(ip)
    if not entry:
        return False
    failures, started = entry
    if time.time() - started > _LOCKOUT_WINDOW:
        _LOGIN_FAILURES.pop(ip, None)
        return False
    return failures >= _MAX_ATTEMPTS


def _record_login_failure(ip: str) -> None:
    entry = _LOGIN_FAILURES.get(ip)
    if not entry or time.time() - entry[1] > _LOCKOUT_WINDOW:
        _LOGIN_FAILURES[ip] = [1, time.time()]
    else:
        entry[0] += 1


def require_user(request: Request) -> dict:
    """Reject anyone without a valid signed token."""
    header = request.headers.get("authorization", "")
    token = header[7:].strip() if header[:7].lower() == "bearer " else ""
    user = verify_token(token)
    if not user:
        raise HTTPException(401, "Please sign in to run the bot.")
    return user


def require_admin(request: Request) -> dict:
    """Admin-only routes. ADMIN_KEY still works for scripts/curl."""
    if ADMIN_KEY and request.headers.get("x-admin-key", "") == ADMIN_KEY:
        return {"username": "admin-key", "role": "admin"}
    user = require_user(request)
    if user.get("role") != "admin":
        raise HTTPException(403, "Admin access required.")
    return user


def _persist_run(receipt_code: str, result: dict, ip_address: str) -> dict | None:
    """Save to SQLite; return saved row summary or None on failure."""
    if result.get("status") != "success":
        return {"saved": False, "reason": "not_success"}
    try:
        row_id = save_completion(
            receipt_code=receipt_code,
            reward_code=result.get("reward_code"),
            ip_address=ip_address,
            status=result.get("status", "unknown"),
        )
        return {
            "saved": True,
            "id": row_id,
            "reward_code": result.get("reward_code"),
            "ip_address": ip_address,
        }
    except Exception as e:
        return {"saved": False, "error": str(e)}


@app.get("/", response_class=HTMLResponse)
async def index():
    html = PUBLIC / "index.html"
    if not html.exists():
        html = STATIC / "index.html"
    return html.read_text(encoding="utf-8")


@app.get("/api/config")
async def api_config():
    return {
        "apiBase": "",
        "mode": "local",
        "storage": True,
        "auth": True,
        "users": usernames(),
    }


@app.post("/api/login")
async def api_login(body: LoginRequest, request: Request):
    ip = get_client_ip(request)
    if _login_locked(ip):
        raise HTTPException(429, "Too many attempts. Try again in a few minutes.")

    user = authenticate(body.username, body.password)
    if not user:
        _record_login_failure(ip)
        raise HTTPException(401, "Incorrect username or password.")

    _LOGIN_FAILURES.pop(ip, None)
    return {
        "token": create_token(user["username"], user["role"]),
        "username": user["username"],
        "role": user["role"],
        "expires_in": TOKEN_TTL,
    }


@app.get("/api/me")
async def api_me(user: dict = Depends(require_user)):
    return {"username": user["username"], "role": user.get("role", "user")}


@app.get("/api/completions")
async def api_completions(limit: int = 200, admin: dict = Depends(require_admin)):
    """Full run history — admin only."""
    return {"items": list_completions(limit=limit), "stats": completion_stats()}


@app.get("/api/stats")
async def api_stats(admin: dict = Depends(require_admin)):
    return completion_stats()


@app.delete("/api/completions/{row_id}")
async def api_delete_completion(row_id: int, admin: dict = Depends(require_admin)):
    if not delete_completion(row_id):
        raise HTTPException(404, "Record not found.")
    return {"deleted": row_id}


@app.delete("/api/completions")
async def api_clear_completions(admin: dict = Depends(require_admin)):
    return {"deleted": clear_completions()}


@app.get("/screenshots/{name}")
async def screenshot(name: str):
    for base in (ROOT, Path("/tmp")):
        path = base / name
        if path.exists() and path.suffix.lower() == ".png":
            return FileResponse(path, media_type="image/png")
    raise HTTPException(404, "Screenshot not found")


@app.post("/api/run-sync")
async def api_run_sync(
    body: RunRequest, request: Request, user: str = Depends(require_user)
):
    ok, msg = validate_code(body.survey_code)
    if not ok:
        raise HTTPException(400, msg)

    ip = get_client_ip(request)
    logs: list[dict] = []

    async def on_log(message: str, level: str = "info"):
        logs.append({"type": "log", "message": message, "level": level})

    result = await run_survey(msg, on_log=on_log)
    screenshot_b64 = encode_screenshot(result.get("screenshot"))
    saved = _persist_run(msg, result, ip)

    if saved and saved.get("saved"):
        logs.append(
            {
                "type": "log",
                "message": f"Saved to database — reward: {saved.get('reward_code') or 'n/a'}, IP: {ip}",
                "level": "success",
            }
        )

    return {
        "logs": logs,
        "status": result["status"],
        "message": result["message"],
        "screenshot": result.get("screenshot"),
        "screenshot_b64": screenshot_b64,
        "reward_code": result.get("reward_code"),
        "saved": saved,
    }


@app.post("/api/run")
async def api_run(
    body: RunRequest, request: Request, user: str = Depends(require_user)
):
    ok, msg = validate_code(body.survey_code)
    if not ok:
        raise HTTPException(400, msg)

    ip = get_client_ip(request)
    queue: asyncio.Queue = asyncio.Queue()

    async def on_log(message: str, level: str = "info"):
        await queue.put({"type": "log", "message": message, "level": level})

    async def worker():
        try:
            result = await run_survey(msg, on_log=on_log)
            saved = _persist_run(msg, result, ip)
            entry = {**result, "type": "done", "saved": saved}
            entry["screenshot_b64"] = encode_screenshot(result.get("screenshot"))
            if saved and saved.get("saved"):
                await on_log(
                    f"Saved — reward: {saved.get('reward_code') or 'n/a'}, IP: {ip}",
                    "success",
                )
            await queue.put(entry)
        except Exception as e:
            await queue.put(
                {"type": "done", "status": "error", "message": str(e), "screenshot": None}
            )
        finally:
            await queue.put(None)

    asyncio.create_task(worker())

    async def stream():
        while True:
            item = await queue.get()
            if item is None:
                break
            yield f"data: {json.dumps(item)}\n\n"

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# --------------------------------------------------------------------------
# Bulk runs
# --------------------------------------------------------------------------

MAX_BULK = 5
# Each concurrent survey holds its own Chromium instance. 2 is a safe default
# for a 512 MB Render instance; raise it only on a larger plan.
BULK_CONCURRENCY = max(1, int(os.environ.get("BULK_CONCURRENCY", 2)))


def _clean_bulk_codes(raw_codes: list[str]) -> list[str]:
    entries = [c for c in (raw_codes or []) if c and c.strip()]
    if not entries:
        raise HTTPException(400, "Enter at least one survey code.")
    if len(entries) > MAX_BULK:
        raise HTTPException(400, f"Bulk runs are limited to {MAX_BULK} codes.")

    cleaned: list[str] = []
    for position, raw in enumerate(entries, start=1):
        ok, msg = validate_code(raw)
        if not ok:
            raise HTTPException(400, f"Code {position}: {msg}")
        cleaned.append(msg)

    if len(set(cleaned)) != len(cleaned):
        raise HTTPException(400, "The same code was entered more than once.")
    return cleaned


async def _run_bulk(codes: list[str], ip: str, emit) -> list[dict]:
    """Run codes with bounded concurrency, emitting progress as it goes."""
    semaphore = asyncio.Semaphore(BULK_CONCURRENCY)
    results: list[Optional[dict]] = [None] * len(codes)

    async def run_one(index: int, code: str) -> None:
        async with semaphore:
            await emit({"type": "item", "index": index, "status": "running"})

            async def on_log(message: str, level: str = "info"):
                await emit(
                    {
                        "type": "log",
                        "index": index,
                        "message": f"[{index + 1}] {message}",
                        "level": level,
                    }
                )

            try:
                result = await run_survey(code, on_log=on_log)
                saved = _persist_run(code, result, ip)
                payload = {
                    "type": "item",
                    "index": index,
                    "status": result["status"],
                    "message": result["message"],
                    "reward_code": result.get("reward_code"),
                    "saved": saved,
                }
            except Exception as e:
                payload = {
                    "type": "item",
                    "index": index,
                    "status": "error",
                    "message": str(e),
                    "reward_code": None,
                    "saved": None,
                }
            results[index] = payload
            await emit(payload)

    await asyncio.gather(*(run_one(i, c) for i, c in enumerate(codes)))
    return [r for r in results if r]


@app.post("/api/run-bulk")
async def api_run_bulk(
    body: BulkRequest, request: Request, user: dict = Depends(require_user)
):
    codes = _clean_bulk_codes(body.survey_codes)
    ip = get_client_ip(request)
    queue: asyncio.Queue = asyncio.Queue()

    async def emit(event: dict):
        await queue.put(event)

    async def worker():
        try:
            results = await _run_bulk(codes, ip, emit)
            await queue.put({"type": "done", "results": results})
        except Exception as e:
            await queue.put({"type": "done", "error": str(e), "results": []})
        finally:
            await queue.put(None)

    asyncio.create_task(worker())

    async def stream():
        while True:
            item = await queue.get()
            if item is None:
                break
            yield f"data: {json.dumps(item)}\n\n"

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.post("/api/run-bulk-sync")
async def api_run_bulk_sync(
    body: BulkRequest, request: Request, user: dict = Depends(require_user)
):
    codes = _clean_bulk_codes(body.survey_codes)
    ip = get_client_ip(request)
    events: list[dict] = []

    async def emit(event: dict):
        events.append(event)

    results = await _run_bulk(codes, ip, emit)
    return {"events": events, "results": results}
