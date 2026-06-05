"""Tim Hortons survey automation — shared by CLI and web app."""

import asyncio
import base64
import os
import re
from pathlib import Path
from typing import Awaitable, Callable, Optional

from playwright.async_api import async_playwright

def _screenshot_dir() -> Path:
    return Path(os.environ.get("TMPDIR", "/tmp"))


def encode_screenshot(path: Optional[str]) -> Optional[str]:
    if not path:
        return None
    p = Path(path)
    if not p.is_file():
        return None
    return base64.b64encode(p.read_bytes()).decode("ascii")


SURVEY_URL = (
    "https://rbixm.qualtrics.com/jfe/form/SV_3lMYn8fpUtkEu7c"
    "?CountryCode=CAN&InviteType=Coupon&SC=21"
)
NO_KEYWORDS = ["problem", "merchandise", "retail", "buy a retail", "purchased"]

LogFn = Callable[[str, str], Awaitable[None]]  # (message, level)


async def _noop_log(_msg: str, _level: str = "info") -> None:
    pass


def extract_reward_code(body_text: str, receipt_code: str) -> Optional[str]:
    """Try to find the validation / reward code shown on the thank-you page."""
    receipt = receipt_code.replace("-", "").replace(" ", "").strip()
    lines = [ln.strip() for ln in body_text.split("\n") if ln.strip()]
    candidates: list[str] = []
    noise_words = {
        "THANK", "SURVEY", "COMPLETE", "COMPLETED", "FEEDBACK", "PARTICIPATING",
        "ENGLISH", "QUALTRICS", "VALIDATION", "COUPON", "REWARD", "PROMO",
    }

    code_keywords = (
        "validation code",
        "your code",
        "coupon code",
        "reward code",
        "promo code",
        "offer code",
        "code is",
        "code:",
    )

    def add_candidate(raw: str) -> None:
        cleaned = re.sub(r"[\s\-]", "", raw).upper()
        if len(cleaned) < 4 or len(cleaned) > 24:
            return
        if not re.fullmatch(r"[A-Z0-9]+", cleaned):
            return
        if cleaned.isalpha():
            return
        if cleaned in noise_words:
            return
        if cleaned == receipt or receipt in cleaned:
            return
        if cleaned.isdigit() and len(cleaned) == 21:
            return
        if cleaned not in candidates:
            candidates.append(cleaned)

    for line in lines:
        lower = line.lower()
        for kw in code_keywords:
            if kw not in lower:
                continue
            idx = lower.find(kw)
            after = line[idx + len(kw) :]
            after = re.sub(r"^[\s:is\-]+", "", after, flags=re.I).strip().strip(".,")
            if re.fullmatch(r"[A-Z0-9][A-Z0-9\-\s]{3,28}", after, re.I):
                add_candidate(after.split()[0])
            for m in re.finditer(r"\b([A-Z0-9]{4,20})\b", after, re.I):
                add_candidate(m.group(1))
            for m in re.finditer(r"\b(\d{6,16})\b", after):
                add_candidate(m.group(1))

        if any(k in lower for k in code_keywords) and len(line) <= 64:
            for m in re.finditer(
                r"\b([A-Z0-9]{2,4}[-\s][A-Z0-9]{3,10}[-\s]?[A-Z0-9]{0,10})\b", line, re.I
            ):
                add_candidate(m.group(1))

    if not candidates:
        for line in lines[-8:]:
            if len(line) > 40 or not re.search(r"\d", line):
                continue
            for m in re.finditer(r"\b([A-Z0-9]{6,16})\b", line, re.I):
                add_candidate(m.group(1))

    return candidates[0] if candidates else None


async def run_survey(
    survey_code: str,
    on_log: Optional[LogFn] = None,
    *,
    headless: bool = True,
) -> dict:
    """
    Run the survey bot. Returns status dict:
    {
      "status": "success"|"used"|"stuck"|"error",
      "message": str,
      "screenshot": str|None,
      "reward_code": str|None,
      "page_text": str|None,
    }
    """
    log = on_log or _noop_log
    code = survey_code.replace("-", "").replace(" ", "").strip()

    await log(f"Starting survey with code …{code[-6:]}", "info")

    screenshot_path: Optional[str] = None
    final_body: Optional[str] = None

    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=headless, slow_mo=150)
            page = await (await browser.new_context()).new_page()
            page.set_default_timeout(20000)

            await page.goto(SURVEY_URL)
            await page.wait_for_timeout(2000)
            await page.fill("input[id='QR~QID9']", code)
            await page.wait_for_timeout(300)

            async def next_js():
                await page.evaluate(
                    "() => { const b = document.getElementById('NextButton') "
                    "|| document.querySelector('input[type=\"submit\"]'); "
                    "if(b) b.click(); }"
                )
                await page.wait_for_timeout(2500)

            async def smart_answer(page_text):
                lower = page_text.lower()
                pick_idx = 1 if any(kw in lower for kw in NO_KEYWORDS) else 0

                await page.evaluate(
                    f"""() => {{
                    const groups = {{}};
                    document.querySelectorAll('input[type="radio"]').forEach(inp => {{
                        if (!groups[inp.name]) groups[inp.name] = [];
                        groups[inp.name].push(inp);
                    }});
                    Object.values(groups).forEach(grp => {{
                        const el = grp[Math.min({pick_idx}, grp.length-1)];
                        el.checked = true;
                        ['mousedown','mouseup','click'].forEach(e =>
                            el.dispatchEvent(new MouseEvent(e, {{bubbles:true}})));
                        el.dispatchEvent(new Event('change', {{bubbles:true}}));
                        const lbl = document.querySelector('label[for="'+el.id+'"]');
                        if (lbl) lbl.dispatchEvent(new MouseEvent('click', {{bubbles:true}}));
                    }});
                }}"""
                )

                await page.evaluate(
                    """() => {
                    const groups = {};
                    document.querySelectorAll('input[type="checkbox"]').forEach(inp => {
                        if (!groups[inp.name]) groups[inp.name] = [];
                        groups[inp.name].push(inp);
                    });
                    Object.values(groups).forEach(grp => {
                        if (!grp[0].checked) {
                            grp[0].checked = true;
                            grp[0].dispatchEvent(new Event('change', {bubbles:true}));
                            grp[0].dispatchEvent(new MouseEvent('click', {bubbles:true}));
                        }
                    });
                }"""
                )

                for ta in await page.query_selector_all("textarea"):
                    if await ta.is_visible() and not await ta.input_value():
                        await ta.fill("Great service, friendly staff, very satisfied!")
                for inp in await page.query_selector_all(
                    "input[type='text'],input[type='TEXT']"
                ):
                    if await inp.is_visible():
                        id_ = await inp.get_attribute("id") or ""
                        if "QID9" not in id_ and not await inp.input_value():
                            await inp.fill("Great service!")
                try:
                    el = await page.query_selector("input[type='email']")
                    if el and await el.is_visible() and not await el.input_value():
                        await el.fill("skip@example.com")
                except Exception:
                    pass

            await next_js()

            last_prog = 0
            stuck_count = 0
            result = {
                "status": "error",
                "message": "Survey did not complete.",
                "screenshot": None,
                "reward_code": None,
            }

            for step in range(1, 50):
                await page.wait_for_timeout(500)
                prog = await page.evaluate(
                    "() => { const b = document.querySelector('[aria-valuenow]'); "
                    "return b ? parseInt(b.getAttribute('aria-valuenow')) : 0; }"
                )
                body = await page.evaluate("document.body.innerText")
                final_body = body
                lower = body.lower()
                lines = [
                    l.strip()
                    for l in body.split("\n")
                    if l.strip()
                    and len(l.strip()) > 3
                    and not any(
                        x in l
                        for x in [
                            "Progress",
                            "English",
                            "Qualtrics",
                            "Español",
                            "Français",
                            "next page",
                            "loading",
                        ]
                    )
                ]
                preview = lines[0][:65] if lines else "..."
                await log(f"Step {step:02d} · {prog}% · {preview}", "step")

                if "already been used" in lower:
                    await log("This code was already submitted.", "warn")
                    result = {
                        "status": "used",
                        "message": "Survey code already used.",
                        "screenshot": None,
                        "reward_code": None,
                    }
                    break

                if prog == 100 or any(
                    k in lower
                    for k in [
                        "thank you for completing",
                        "thank you for your feedback",
                        "thank you for participating",
                    ]
                ):
                    await page.wait_for_timeout(1500)
                    final_body = await page.evaluate("document.body.innerText")
                    reward = extract_reward_code(final_body, code)
                    screenshot_path = str(_screenshot_dir() / "survey_done.png")
                    await page.screenshot(path=screenshot_path)
                    if reward:
                        await log(f"Reward code found: {reward}", "success")
                    else:
                        await log("Survey done — reward code not detected on page.", "warn")
                    result = {
                        "status": "success",
                        "message": "Survey completed."
                        + (f" Code: {reward}" if reward else ""),
                        "screenshot": screenshot_path,
                        "reward_code": reward,
                    }
                    break

                if prog == last_prog:
                    stuck_count += 1
                else:
                    stuck_count = 0
                    last_prog = prog

                if stuck_count >= 6:
                    screenshot_path = str(_screenshot_dir() / f"stuck_{prog}.png")
                    await page.screenshot(path=screenshot_path)
                    await log(f"Stuck at {prog}% — see screenshot.", "warn")
                    result = {
                        "status": "stuck",
                        "message": f"Bot stuck at {prog}%.",
                        "screenshot": screenshot_path,
                        "reward_code": None,
                    }
                    break

                await smart_answer(body)
                await next_js()

            await browser.close()
            return result

    except Exception as e:
        await log(f"Error: {e}", "error")
        return {
            "status": "error",
            "message": str(e),
            "screenshot": screenshot_path,
            "reward_code": None,
        }


def validate_code(code: str) -> tuple[bool, str]:
    cleaned = code.replace("-", "").replace(" ", "").strip()
    if not cleaned:
        return False, "Enter your 21-digit receipt code."
    if not cleaned.isdigit():
        return False, "Code must contain only digits."
    if len(cleaned) != 21:
        return False, f"Code must be 21 digits (you entered {len(cleaned)})."
    return True, cleaned
