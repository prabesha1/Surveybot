# AP Survey Bot

Automates the Tim Hortons / Qualtrics receipt survey using Playwright. Web UI supports manual entry, camera scan, and receipt OCR (Tesseract.js in the browser).

## Deploy architecture (Vercel + Railway)

Playwright cannot run on Vercel serverless (size & time limits). Use a **two-part deploy**:

| Platform | Role |
|----------|------|
| **Vercel** | Static UI (`public/`) + `/api/run` proxy |
| **Railway** (or Render) | Playwright backend (`app.py`) |

```
Browser → Vercel /api/run → Railway /api/run-sync → Playwright
```

Camera/OCR runs entirely in the browser on Vercel — no backend needed for scanning.

---

## 1. Deploy backend to Railway

1. Push this repo to GitHub.
2. [railway.app](https://railway.app) → **New Project** → **Deploy from GitHub** → select `Surveybot`.
3. Railway uses the `Dockerfile` (includes Chromium).
4. After deploy, copy the public URL, e.g. `https://surveybot-production.up.railway.app`.
5. Optional env on Railway:
   - `ALLOWED_ORIGINS` = `https://your-app.vercel.app` (or `*`)

---

## 2. Deploy frontend to Vercel

1. [vercel.com](https://vercel.com) → **Add New Project** → import `Surveybot` from GitHub.
2. Framework preset: **Other** (uses `vercel.json` automatically).
3. **Environment variable** (required for survey automation):

   | Name | Value |
   |------|--------|
   | `BOT_API_URL` | Your Railway URL, no trailing slash |

4. Deploy.

Vercel serves `public/` and routes `/api/run` to a serverless function that proxies to Railway.

---

## Local development

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements-server.txt
playwright install chromium
uvicorn app:app --reload
```

Open [http://127.0.0.1:8000](http://127.0.0.1:8000) — uses live SSE streaming (no proxy).

## CLI

Edit `SURVEY_CODE` in `tims_survey_bot_FINAL.py`, then:

```bash
pip install -r requirements-server.txt
playwright install chromium
python tims_survey_bot_FINAL.py
```

## Project layout

```
public/          → Vercel static site
api/             → Vercel serverless (config + proxy)
app.py           → Railway / local FastAPI backend
survey_bot.py    → Playwright automation
vercel.json      → Vercel config
Dockerfile       → Railway Playwright image
```

## Vercel-only (UI preview)

You can deploy to Vercel without Railway. Camera scan and OCR work; **Start survey** shows a message until `BOT_API_URL` is set.
