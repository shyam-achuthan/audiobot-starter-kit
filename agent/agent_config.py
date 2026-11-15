"""Per-agent settings that admins change in the dashboard (prompt, model, voice, turn timing).

The built-in defaults live here and in prompts.py; the worker reports them to the API so the
dashboard can show them. At the start of every call the worker fetches the effective settings
(defaults + admin overrides), so a change applies to the next call without a redeploy.
"""

from __future__ import annotations

import json
import logging
import os
import urllib.request
from dataclasses import asdict, dataclass

import prompts
from settings import Settings

logger = logging.getLogger("audiobots.agent_config")

WORKFLOWS = ("router", "lead_qualification", "sales", "support")


@dataclass(frozen=True)
class AgentSettings:
    role: str
    greeting: str
    llm_model: str
    tts_speaker: str
    tts_pace: float
    endpointing_min_delay: float
    endpointing_max_delay: float
    allow_interruptions: bool
    interruption_min_duration: float

    def to_api(self) -> dict:
        """camelCase keys, as stored by the API."""
        d = asdict(self)
        return {
            "role": d["role"], "greeting": d["greeting"], "llmModel": d["llm_model"],
            "ttsSpeaker": d["tts_speaker"], "ttsPace": d["tts_pace"],
            "endpointingMinDelay": d["endpointing_min_delay"],
            "endpointingMaxDelay": d["endpointing_max_delay"],
            "allowInterruptions": d["allow_interruptions"],
            "interruptionMinDuration": d["interruption_min_duration"],
        }


def builtin(workflow: str, s: Settings) -> AgentSettings:
    return AgentSettings(
        role=prompts.ROLES.get(workflow, prompts.ROLES["router"]),
        greeting=prompts.GREETINGS.get(workflow, prompts.GREETINGS["router"]),
        llm_model=s.llm_model,
        tts_speaker=s.tts_speaker,
        tts_pace=1.0,
        endpointing_min_delay=s.endpointing_min_delay,
        endpointing_max_delay=s.endpointing_max_delay,
        allow_interruptions=True,
        interruption_min_duration=s.interruption_min_duration,
    )


def _num(v, lo: float, hi: float) -> float | None:
    try:
        x = float(v)
    except (TypeError, ValueError):
        return None
    return x if lo <= x <= hi else None


def _text(o: dict, key: str, default: str) -> str:
    v = o.get(key)
    return v.strip() if isinstance(v, str) and v.strip() else default


def resolve(workflow: str, s: Settings, overrides: dict | None) -> AgentSettings:
    """Built-in defaults + admin overrides (from the API's `overrides`). Bad values are ignored."""
    base = builtin(workflow, s)
    o = overrides or {}
    pick = lambda v, d: d if v is None else v  # noqa: E731
    min_delay = pick(_num(o.get("endpointingMinDelay"), 0.1, 3), base.endpointing_min_delay)
    max_delay = pick(_num(o.get("endpointingMaxDelay"), 0.3, 6), base.endpointing_max_delay)
    return AgentSettings(
        role=_text(o, "role", base.role),
        greeting=_text(o, "greeting", base.greeting),
        llm_model=_text(o, "llmModel", base.llm_model),
        tts_speaker=_text(o, "ttsSpeaker", base.tts_speaker),
        tts_pace=pick(_num(o.get("ttsPace"), 0.5, 2), base.tts_pace),
        endpointing_min_delay=min_delay,
        endpointing_max_delay=max(max_delay, min_delay),
        allow_interruptions=o["allowInterruptions"] if isinstance(o.get("allowInterruptions"), bool) else base.allow_interruptions,
        interruption_min_duration=pick(_num(o.get("interruptionMinDuration"), 0.1, 2), base.interruption_min_duration),
    )


def voices(s: Settings) -> list[dict]:
    """Voices the configured TTS offers, for the dashboard's voice picker."""
    if s.tts_provider != "sarvam":
        return []
    try:
        from livekit.plugins.sarvam.tts import MODEL_SPEAKER_COMPATIBILITY
    except ImportError:
        return []
    groups = MODEL_SPEAKER_COMPATIBILITY.get(s.tts_model, {})
    out = []
    for gender in ("female", "male"):
        out += [{"id": v, "gender": gender} for v in groups.get(gender, [])]
    known = {v["id"] for v in out}
    out += [{"id": v} for v in groups.get("all", []) if v not in known]
    return out


def defaults_payload(s: Settings) -> dict:
    return {
        "agents": {wf: builtin(wf, s).to_api() for wf in WORKFLOWS},
        "ttsSpeakers": voices(s),
        "ttsModel": s.tts_model,
    }


def report_defaults_sync(s: Settings) -> bool:
    """Best-effort, blocking (used from prewarm). The entrypoint retries if this fails."""
    base = os.environ.get("API_URL", "http://api:4000").rstrip("/")
    req = urllib.request.Request(
        f"{base}/v1/agents/defaults",
        data=json.dumps(defaults_payload(s)).encode(),
        method="PUT",
        headers={"content-type": "application/json",
                 "authorization": f"Bearer {os.environ.get('AGENT_API_TOKEN', '')}"},
    )
    try:
        with urllib.request.urlopen(req, timeout=3) as r:
            return r.status < 300
    except Exception as e:  # noqa: BLE001 - startup must not fail because the API is down
        logger.warning("could not report agent defaults yet: %s", e)
        return False
