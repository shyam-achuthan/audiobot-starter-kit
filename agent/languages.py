"""Languages supported at launch and helpers to normalise STT language codes."""

from __future__ import annotations

SUPPORTED: dict[str, str] = {
    "en-IN": "English",
    "hi-IN": "Hindi",
    "ta-IN": "Tamil",
    "te-IN": "Telugu",
    "kn-IN": "Kannada",
    "ml-IN": "Malayalam",
}

# The local turn-detector model (v1-mini) only covers these base languages.
# Others fall back to silence-based endpointing (VAD + min/max delay).
TURN_DETECTOR_LANGS = {"en", "hi"}


def normalize(code: str | None) -> str | None:
    """Map an STT language code ("hi", "hi-IN", "HI_in") to a supported BCP-47 code."""
    if not code:
        return None
    base = code.replace("_", "-").split("-")[0].lower()
    for full in SUPPORTED:
        if full.split("-")[0] == base:
            return full
    return None
