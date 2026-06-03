"""Tim Hortons survey automation — shared by CLI and web app."""

import asyncio
import base64
import os
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


async def run_survey(
    survey_code: str,
    on_log: Optional[LogFn] = None,
    *,
    headless: bool = True,
) -> dict:
    """
    Run the survey bot. Returns status dict:
    { "status": "success"|"used"|"stuck"|"error", "message": str, "screenshot": str|None }
    """
    log = on_log or _noop_log
    code = survey_code.replace("-", "").replace(" ", "").strip()

    await log(f"Starting survey with code …{code[-6:]}", "info")

    screenshot_path: Optional[str] = None

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
            result = {"status": "error", "message": "Survey did not complete.", "screenshot": None}

            for step in range(1, 50):
                await page.wait_for_timeout(500)
                prog = await page.evaluate(
                    "() => { const b = document.querySelector('[aria-valuenow]'); "
                    "return b ? parseInt(b.getAttribute('aria-valuenow')) : 0; }"
                )
                body = await page.evaluate("document.body.innerText")
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
                    screenshot_path = str(_screenshot_dir() / "survey_done.png")
                    await page.screenshot(path=screenshot_path)
                    await log("Survey submitted successfully!", "success")
                    result = {
                        "status": "success",
                        "message": "Survey completed.",
                        "screenshot": screenshot_path,
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
                    }
                    break

                await smart_answer(body)
                await next_js()

            await browser.close()
            return result

    except Exception as e:
        await log(f"Error: {e}", "error")
        return {"status": "error", "message": str(e), "screenshot": screenshot_path}


def validate_code(code: str) -> tuple[bool, str]:
    cleaned = code.replace("-", "").replace(" ", "").strip()
    if not cleaned:
        return False, "Enter your 21-digit receipt code."
    if not cleaned.isdigit():
        return False, "Code must contain only digits."
    if len(cleaned) != 21:
        return False, f"Code must be 21 digits (you entered {len(cleaned)})."
    return True, cleaned
