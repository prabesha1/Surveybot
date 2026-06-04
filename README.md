# AP Survey Bot

Automates the Tim Hortons / Qualtrics receipt survey using Playwright. Web UI supports manual entry, camera scan, and receipt OCR (Tesseract.js in the browser).

**Playwright cannot run on Vercel** (serverless size/time limits). Use **Render** or **Fly.io** for the bot — or skip Vercel entirely.

---

## Option 1 — Render only (recommended, one platform)

Everything on a single URL: UI + survey bot. No Vercel, no Railway.

1. Push this repo to GitHub.
2. Go to [render.com](https://render.com) → **New** → **Blueprint** → connect `Surveybot` repo  
   (or **New Web Service** → Docker → select repo).
3. Render uses `render.yaml` + `Dockerfile` (Chromium included).
4. Wait for deploy → open your URL, e.g. `https://ap-survey-bot.onrender.com`.
5. Done. Use the site like localhost.

**Free tier note:** Render sleeps after ~15 min idle; first request after sleep may take 30–60s (cold start).

---

## Option 2 — Vercel (UI) + Render (bot)

| Platform | Role |
|----------|------|
| **Vercel** | Fast CDN for `public/` + `/api/run` proxy |
| **Render** | Playwright backend (`app.py`) |

### Step A — Render backend

Same as Option 1 steps 1–4. Copy your Render URL (no trailing slash).

### Step B — Vercel frontend

1. [vercel.com](https://vercel.com) → import **Surveybot** from GitHub.
2. Preset: **Other**
3. **Output Directory:** `public`
4. **Install Command:** leave empty
5. **Build Command:** leave empty (uses `vercel.json`)
6. **Environment variable:**

   | Name | Value |
   |------|--------|
   | `BOT_API_URL` | `https://ap-survey-bot.onrender.com` (your Render URL) |

7. Deploy.

Camera/OCR work on Vercel; **Start survey** calls Render through the proxy.

---

## Option 3 — Fly.io (instead of Render)

```bash
# Install flyctl: https://fly.io/docs/hands-on/install-flyctl/
cd Surveybot
fly launch    # follow prompts, use existing fly.toml
fly deploy
```

Use the Fly URL everywhere you would use Render (e.g. `BOT_API_URL` on Vercel, or open the Fly URL directly for all-in-one).

---

## Vercel dashboard cheat sheet

Uses `vercel.json` automatically. In the dashboard you can leave most fields **empty** (Override if needed):

| Field | Value |
|-------|--------|
| Framework | Other |
| Build Command | `node scripts/vercel-build.js` *(or leave empty — vercel.json sets it)* |
| Output Directory | `public` |
| Install Command | *(empty — no Python on Vercel)* |
| **Environment variable** | `BOT_API_URL` = `https://ap-survey-bot.onrender.com` |

No `api/` serverless functions on Vercel — the UI calls Render directly (avoids the `functions` pattern error).

---

## Local development

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements-server.txt
playwright install chromium
uvicorn app:app --reload
```

Open [http://127.0.0.1:8000](http://127.0.0.1:8000)

## CLI

Edit `SURVEY_CODE` in `tims_survey_bot_FINAL.py`, then:

```bash
pip install -r requirements-server.txt
playwright install chromium
python tims_survey_bot_FINAL.py
```

## Saved completions (SQLite)

After each survey run, the app saves to a local SQLite database (`DATA_DIR/survey_bot.db`):

| Field | Description |
|-------|-------------|
| `receipt_code` | 21-digit code you entered |
| `reward_code` | Code detected on the thank-you page (if found) |
| `ip_address` | Client IP (from `X-Forwarded-For` on Render) |
| `created_at` | UTC timestamp |
| `status` | `success`, `used`, `stuck`, or `error` |

View saved rows:

```bash
curl https://ap-survey-bot.onrender.com/api/completions
```

If you set `ADMIN_KEY` on Render, pass header: `X-Admin-Key: your-secret`.

**Note:** On Render free tier, the database file lives on the server disk and may reset if the service is redeployed or rebuilt. For permanent storage, add a [Render persistent disk](https://render.com/docs/disks) or use PostgreSQL.

## Project layout

```
public/              → Static UI (Vercel or served by app.py on Render)
api/                 → Vercel serverless proxy only
app.py               → Full backend (Render / Fly / local)
survey_bot.py        → Playwright automation
render.yaml          → Render one-click deploy
Dockerfile           → Playwright + Chromium image
fly.toml             → Optional Fly.io deploy
vercel.json          → Optional Vercel static + proxy
```
