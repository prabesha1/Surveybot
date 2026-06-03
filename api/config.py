import os
from http.server import BaseHTTPRequestHandler

from _utils import send_json


class handler(BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        self.send_response(204)
        self.end_headers()

    def do_GET(self):
        bot_url = os.environ.get("BOT_API_URL", "").rstrip("/")
        send_json(
            self,
            200,
            {
                "apiBase": bot_url,
                "mode": "proxy" if bot_url else "unconfigured",
                "hint": (
                    "Set BOT_API_URL on Vercel to your Railway/Render backend URL."
                    if not bot_url
                    else None
                ),
            },
        )
