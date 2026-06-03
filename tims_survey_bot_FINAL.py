"""
============================================================
  Tim Hortons Survey Auto-Filler  — FINAL WORKING VERSION
  CLI:  python tims_survey_bot_FINAL.py
  Web:  uvicorn app:app --reload  →  http://127.0.0.1:8000
============================================================
  One-time setup:
    pip install -r requirements.txt
    playwright install chromium
============================================================
"""

import asyncio

from survey_bot import run_survey

# ── CHANGE THIS EVERY TIME (CLI only) ─────────────────────
SURVEY_CODE = "559253721129027060248"
# ─────────────────────────────────────────────────────────


async def _print_log(msg: str, level: str = "info") -> None:
    icons = {"success": "✅", "warn": "⚠️", "error": "❌", "step": "  ", "info": "  "}
    print(f"{icons.get(level, '  ')} {msg}")


async def run():
    print("\n🍵  Tim Hortons Survey Bot — Starting...")
    print(f"   Code: {SURVEY_CODE}\n")
    result = await run_survey(SURVEY_CODE, on_log=_print_log)
    print(f"\n  Result: {result['status']} — {result['message']}\n")


if __name__ == "__main__":
    asyncio.run(run())
