"""Runtime settings for the voice pipeline, read from the environment.

Every provider/model choice lives here so it can be swapped by config.
Phase 4 moves per-agent overrides into the admin dashboard (stored in Postgres).
"""

from __future__ import annotations

import os
from dataclasses import dataclass


def _env(name: str, default: str) -> str:
    return os.environ.get(name) or default


def _float(name: str, default: float) -> float:
    try:
        return float(os.environ.get(name, default))
    except ValueError:
        return default


def _bool(name: str, default: bool) -> bool:
    v = os.environ.get(name)
    return default if v is None else v.strip().lower() in {"1", "true", "yes", "on"}


@dataclass(frozen=True)
class Settings:
    # Speech-to-text
    stt_provider: str
    stt_model: str
    stt_language: str  # "unknown" = auto-detect per utterance
    stt_mode: str
    stt_flush_signal: bool  # force a final transcript as soon as VAD sees end of speech
    # Seconds without any frame (incl. pong) before the STT socket is treated as dead. LiveKit's
    # 6 s default drops healthy Sarvam sockets: Sarvam often answers pings late mid-call.
    stt_liveness_timeout: float

    # Text-to-speech
    tts_provider: str
    tts_model: str
    tts_speaker: str
    tts_default_language: str

    # Optional HTTP proxy for traffic to cloud speech providers (corporate networks,
    # or when Docker's direct egress is broken). Internal services never use it.
    outbound_proxy: str | None

    # LLM (always through the LiteLLM gateway, OpenAI-compatible)
    litellm_url: str
    litellm_api_key: str
    llm_model: str
    llm_temperature: float

    # Recording consent used when an agent has no override: off | notice | ask
    recording_consent: str
    # Default human number for live transfers on phone calls (agents can override in Admin)
    transfer_number: str

    # Turn-taking
    endpointing_min_delay: float
    endpointing_max_delay: float
    interruption_min_duration: float
    preemptive_generation: bool

    @classmethod
    def from_env(cls) -> "Settings":
        return cls(
            stt_provider=_env("STT_PROVIDER", "sarvam"),
            stt_model=_env("STT_MODEL", "saaras:v4"),
            stt_language=_env("STT_LANGUAGE", "unknown"),
            stt_mode=_env("STT_MODE", "transcribe"),
            stt_flush_signal=_bool("STT_FLUSH_SIGNAL", True),
            stt_liveness_timeout=_float("STT_LIVENESS_TIMEOUT", 30.0),
            tts_provider=_env("TTS_PROVIDER", "sarvam"),
            tts_model=_env("TTS_MODEL", "bulbul:v3"),
            tts_speaker=_env("TTS_SPEAKER", "priya"),
            tts_default_language=_env("TTS_DEFAULT_LANGUAGE", "en-IN"),
            outbound_proxy=os.environ.get("OUTBOUND_PROXY") or None,
            litellm_url=_env("LITELLM_URL", "http://litellm:4000").rstrip("/"),
            litellm_api_key=_env("LITELLM_API_KEY", "sk-missing"),
            llm_model=_env("LLM_MODEL", "agent-fast"),
            llm_temperature=_float("LLM_TEMPERATURE", 0.4),
            recording_consent=_env("RECORDING_CONSENT", "notice"),
            transfer_number=os.environ.get("TRANSFER_NUMBER", "").strip(),
            endpointing_min_delay=_float("ENDPOINTING_MIN_DELAY", 0.3),
            endpointing_max_delay=_float("ENDPOINTING_MAX_DELAY", 1.2),
            interruption_min_duration=_float("INTERRUPTION_MIN_DURATION", 0.5),
            preemptive_generation=_bool("PREEMPTIVE_GENERATION", True),
        )
