"""Sanitize shared text and debug artifacts without changing measured source bytes."""
import json
import os
import re

SENSITIVE_KEYS = {"authorization", "auth_token", "password", "api_key", "access_token", "refresh_token", "token"}


def redact(value):
    if isinstance(value, dict):
        return {key: "[REDACTED]" if key.lower() in SENSITIVE_KEYS else redact(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [redact(item) for item in value]
    if isinstance(value, str):
        for key, secret in os.environ.items():
            if key.endswith(("_KEY", "_TOKEN", "_SECRET", "_PASSWORD")) and len(secret) >= 8:
                value = value.replace(secret, "[REDACTED]")
        value = re.sub(r"(?i)Bearer\s+[^\s\"'<>]+", "Bearer [REDACTED]", value)
        value = re.sub(r"eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+", "[REDACTED JWT]", value)
        value = re.sub(r'(?i)(["\']?(?:auth_token|password|api_key|access_token|refresh_token)["\']?\s*[:=]\s*)(["\'])(.*?)(\2)', r'\1\2[REDACTED]\4', value)
        return value
    return value


def shared_json(value) -> str:
    return json.dumps(redact(value), sort_keys=True)
