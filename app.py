"""AP Survey Bot — local dev & Render backend."""

import asyncio
import json
import os
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from storage import init_db, list_completions, save_completion
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
    }


@app.get("/api/completions")
async def api_completions(request: Request, limit: int = 50):
    """List saved completions. Set ADMIN_KEY env and pass X-Admin-Key header if configured."""
    if ADMIN_KEY:
        key = request.headers.get("x-admin-key", "")
        if key != ADMIN_KEY:
            raise HTTPException(401, "Invalid or missing X-Admin-Key header")
    return {"items": list_completions(limit=limit)}


@app.get("/screenshots/{name}")
async def screenshot(name: str):
    for base in (ROOT, Path("/tmp")):
        path = base / name
        if path.exists() and path.suffix.lower() == ".png":
            return FileResponse(path, media_type="image/png")
    raise HTTPException(404, "Screenshot not found")


@app.post("/api/run-sync")
async def api_run_sync(body: RunRequest, request: Request):
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
async def api_run(body: RunRequest, request: Request):
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
