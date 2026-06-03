# AP Survey Bot

Automates the Tim Hortons / Qualtrics receipt survey using Playwright. Web UI supports manual entry, camera scan, or photo upload with automatic code detection (Tesseract.js).

## Setup

```bash
python3 -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
playwright install chromium
```

## Web app (recommended)

```bash
uvicorn app:app --reload
```

Open [http://127.0.0.1:8000](http://127.0.0.1:8000). Enter your 21-digit code, or use **Use camera** / **Upload photo** to scan the receipt. Then click **Start survey**. Progress and logs stream live in the browser.

## CLI

Edit `SURVEY_CODE` in `tims_survey_bot_FINAL.py`, then:

```bash
python tims_survey_bot_FINAL.py
```
