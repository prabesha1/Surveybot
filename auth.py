"""Access control for Prabesh Tims Bot — a small allow-list of known users."""

import base64
import hashlib
import hmac
import json
import os
import time
from typing import Optional

# Authorized users. Anyone not listed here cannot run the bot.
# In production, override these by setting the AUTH_USERS env var to JSON, e.g.
#   AUTH_USERS='[{"username":"ironman","password":"something-better"}]'
_BUILTIN_USERS = [
    {"username": "ironman", "password": "ironman", "role": "admin"},
    {"username": "Ajaya Purja", "password": "jandapurja555", "role": "user"},
]


def _load_users() -> list[dict]:
    raw = os.environ.get("AUTH_USERS", "").strip()
    if raw:
        try:
            parsed = json.loads(raw)
            if isinstance(parsed, list) and parsed:
                return parsed
        except json.JSONDecodeError:
            pass
    return _BUILTIN_USERS


USERS = _load_users()
TOKEN_TTL = int(os.environ.get("AUTH_TTL_SECONDS", 12 * 60 * 60))
_SECRET = os.environ.get("AUTH_SECRET") or "prabesh-tims-bot-local-secret"


def usernames() -> list[str]:
    return [u["username"] for u in USERS]


def _b64encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode().rstrip("=")


def _b64decode(value: str) -> bytes:
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


def _sign(payload: str) -> str:
    return hmac.new(_SECRET.encode(), payload.encode(), hashlib.sha256).hexdigest()


def authenticate(username: str, password: str) -> Optional[dict]:
    """Return {"username", "role"} when credentials match, otherwise None."""
    candidate = (username or "").strip().lower()
    supplied = password or ""

    matched: Optional[dict] = None
    for user in USERS:
        # Check every user without short-circuiting so a wrong username takes
        # the same time as a wrong password.
        name_ok = hmac.compare_digest(str(user["username"]).lower(), candidate)
        pass_ok = hmac.compare_digest(str(user["password"]), supplied)
        if name_ok and pass_ok:
            matched = {
                "username": str(user["username"]),
                "role": str(user.get("role", "user")),
            }
    return matched


def create_token(username: str, role: str = "user") -> str:
    payload = {"u": username, "r": role, "exp": int(time.time()) + TOKEN_TTL}
    encoded = _b64encode(json.dumps(payload, separators=(",", ":")).encode())
    return f"{encoded}.{_sign(encoded)}"


def verify_token(token: str) -> Optional[dict]:
    """Return {"username", "role"} carried by a valid, unexpired token."""
    if not token or "." not in token:
        return None
    encoded, _, signature = token.partition(".")
    if not hmac.compare_digest(signature, _sign(encoded)):
        return None
    try:
        payload = json.loads(_b64decode(encoded))
    except Exception:
        return None
    if int(payload.get("exp", 0)) < time.time():
        return None
    username = payload.get("u")
    if not username:
        return None
    return {"username": username, "role": payload.get("r", "user")}
