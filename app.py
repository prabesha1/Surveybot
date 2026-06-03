"""Tim Hortons Survey Bot — web interface."""

import asyncio
import json
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, HTMLResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from survey_bot import run_survey, validate_code

ROOT = Path(__file__).parent
STATIC = ROOT / "static"

app = FastAPI(title="AP Survey Bot")
app.mount("/static", StaticFiles(directory=STATIC), name="static")


class RunRequest(BaseModel):
    survey_code: str = Field(..., min_length=1)


@app.get("/", response_class=HTMLResponse)
async def index():
    return (STATIC / "index.html").read_text(encoding="utf-8")


@app.get("/screenshots/{name}")
async def screenshot(name: str):
    path = ROOT / name
    if not path.exists() or path.suffix.lower() != ".png":
        raise HTTPException(404, "Screenshot not found")
    return FileResponse(path, media_type="image/png")


@app.post("/api/run")
async def api_run(body: RunRequest):
    ok, msg = validate_code(body.survey_code)
    if not ok:
        raise HTTPException(400, msg)

    queue: asyncio.Queue = asyncio.Queue()

    async def on_log(message: str, level: str = "info"):
        await queue.put({"type": "log", "message": message, "level": level})

    async def worker():
        try:
            result = await run_survey(msg, on_log=on_log)
            await queue.put({"type": "done", **result})
        except Exception as e:
            await queue.put({"type": "done", "status": "error", "message": str(e), "screenshot": None})
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
