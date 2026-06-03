import json
import os

import httpx
from http.server import BaseHTTPRequestHandler

from _utils import read_body, send_json

BOT_API_URL = os.environ.get("BOT_API_URL", "").rstrip("/")
TIMEOUT = float(os.environ.get("BOT_API_TIMEOUT", "300"))


class handler(BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        self.send_response(204)
        self.end_headers()

    def do_POST(self):
        body = read_body(self)

        if not BOT_API_URL:
            send_json(
                self,
                503,
                {
                    "status": "error",
                    "message": (
                        "Backend not configured. Deploy to Render (see README) "
                        "and set BOT_API_URL in Vercel to your Render URL."
                    ),
                    "logs": [
                        {
                            "type": "log",
                            "message": "BOT_API_URL environment variable is missing.",
                            "level": "error",
                        }
                    ],
                },
            )
            return

        try:
            payload = json.loads(body) if body else {}
        except json.JSONDecodeError:
            send_json(self, 400, {"status": "error", "message": "Invalid JSON body.", "logs": []})
            return

        try:
            with httpx.Client(timeout=TIMEOUT) as client:
                upstream = client.post(
                    f"{BOT_API_URL}/api/run-sync",
                    json=payload,
                    headers={"Content-Type": "application/json"},
                )
            data = upstream.json()
            send_json(self, upstream.status_code, data)
        except httpx.TimeoutException:
            send_json(
                self,
                504,
                {
                    "status": "error",
                    "message": "Survey timed out on the backend. Try again.",
                    "logs": [],
                },
            )
        except httpx.HTTPError as e:
            send_json(
                self,
                502,
                {
                    "status": "error",
                    "message": f"Backend unreachable: {e}",
                    "logs": [],
                },
            )
        except Exception as e:
            send_json(
                self,
                500,
                {"status": "error", "message": str(e), "logs": []},
            )
