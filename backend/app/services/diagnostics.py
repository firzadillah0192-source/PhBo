"""Privacy-safe diagnostics for the customer image ingestion path."""

from __future__ import annotations

import json
import logging


def user_agent_category(user_agent: str) -> str:
    ua = user_agent.lower()
    ios_device = "iphone" in ua or "ipad" in ua or ("macintosh" in ua and "mobile/" in ua)
    if ios_device and "safari" in ua and "crios" not in ua:
        return "ios_safari"
    if "android" in ua and "chrome" in ua:
        return "android_chrome"
    if "mobile" in ua or "android" in ua or "iphone" in ua or "ipad" in ua:
        return "mobile_other"
    return "desktop_or_other"


def log_image_event(logger: logging.Logger, event: str, **fields) -> None:
    """Emit one-line JSON fields without image bytes, raw UA, or storage paths."""
    logger.info("%s", json.dumps({"event": event, **fields}, separators=(",", ":"), sort_keys=True))
