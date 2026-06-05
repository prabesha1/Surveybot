"""Debug session logging — remove after verification."""
import json
import time
from pathlib import Path

_LOG = Path(__file__).parent / ".cursor" / "debug-014ff1.log"


def dbg(location: str, message: str, data: dict, hypothesis_id: str, run_id: str = "pre-fix") -> None:
    # #region agent log
    try:
        _LOG.parent.mkdir(parents=True, exist_ok=True)
        with _LOG.open("a", encoding="utf-8") as f:
            f.write(
                json.dumps(
                    {
                        "sessionId": "014ff1",
                        "runId": run_id,
                        "hypothesisId": hypothesis_id,
                        "location": location,
                        "message": message,
                        "data": data,
                        "timestamp": int(time.time() * 1000),
                    }
                )
                + "\n"
            )
    except Exception:
        pass
    # #endregion
