"""AP Survey Bot — local dev & Railway/Render backend."""

import asyncio
import json
import os
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from survey_bot import encode_screenshot, run_survey, validate_code

ROOT = Path(__file__).parent
PUBLIC = ROOT / "public"
STATIC = ROOT / "static" if (ROOT / "static").exists() else PUBLIC

app = FastAPI(title="AP Survey Bot")

allowed = os.environ.get("ALLOWED_ORIGINS", "*").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in allowed if o.strip()],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

if PUBLIC.exists():
    app.mount("/static", StaticFiles(directory=PUBLIC), name="static")


class RunRequest(BaseModel):
    survey_code: str = Field(..., min_length=1)


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
    }


@app.get("/screenshots/{name}")
async def screenshot(name: str):
    for base in (ROOT, Path("/tmp")):
        path = base / name
        if path.exists() and path.suffix.lower() == ".png":
            return FileResponse(path, media_type="image/png")
    raise HTTPException(404, "Screenshot not found")


@app.post("/api/run-sync")
async def api_run_sync(body: RunRequest):
    """JSON response for Vercel proxy / serverless backends."""
    ok, msg = validate_code(body.survey_code)
    if not ok:
        raise HTTPException(400, msg)

    logs: list[dict] = []

    async def on_log(message: str, level: str = "info"):
        logs.append({"type": "log", "message": message, "level": level})

    result = await run_survey(msg, on_log=on_log)
    screenshot_b64 = encode_screenshot(result.get("screenshot"))

    return {
        "logs": logs,
        "status": result["status"],
        "message": result["message"],
        "screenshot": result.get("screenshot"),
        "screenshot_b64": screenshot_b64,
    }


@app.post("/api/run")
async def api_run(body: RunRequest):
    """SSE stream for local development."""
    ok, msg = validate_code(body.survey_code)
    if not ok:
        raise HTTPException(400, msg)

    queue: asyncio.Queue = asyncio.Queue()

    async def on_log(message: str, level: str = "info"):
        await queue.put({"type": "log", "message": message, "level": level})

    async def worker():
        try:
            result = await run_survey(msg, on_log=on_log)
            entry = {**result, "type": "done"}
            entry["screenshot_b64"] = encode_screenshot(result.get("screenshot"))
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
