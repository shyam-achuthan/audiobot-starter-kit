"""Provider factories for STT, LLM and TTS.

Adding a provider = adding one entry to a registry below; agents never import
provider plugins directly. Self-hosted engines (IndicConformer, Indic Parler,
Kokoro, vLLM) get registered here in Phase 9.
"""

from __future__ import annotations

from collections.abc import Callable

from livekit.agents import llm as lk_llm
from livekit.agents import stt as lk_stt
from livekit.agents import tts as lk_tts
from livekit.plugins import openai, sarvam

from settings import Settings


def _sarvam_stt(s: Settings) -> lk_stt.STT:
    return sarvam.STT(
        language=s.stt_language,
        model=s.stt_model,
        mode=s.stt_mode,
        flush_signal=s.stt_flush_signal,
    )


def _sarvam_tts(s: Settings) -> lk_tts.TTS:
    return sarvam.TTS(
        model=s.tts_model,
        speaker=s.tts_speaker,
        target_language_code=s.tts_default_language,
    )


STT_PROVIDERS: dict[str, Callable[[Settings], lk_stt.STT]] = {
    "sarvam": _sarvam_stt,
}

TTS_PROVIDERS: dict[str, Callable[[Settings], lk_tts.TTS]] = {
    "sarvam": _sarvam_tts,
}


def _pick(registry: dict, name: str, kind: str):
    try:
        return registry[name]
    except KeyError:
        raise ValueError(f"Unknown {kind} provider {name!r}; known: {sorted(registry)}") from None


def build_stt(s: Settings) -> lk_stt.STT:
    return _pick(STT_PROVIDERS, s.stt_provider, "STT")(s)


def build_tts(s: Settings) -> lk_tts.TTS:
    return _pick(TTS_PROVIDERS, s.tts_provider, "TTS")(s)


def build_llm(s: Settings, model: str | None = None) -> lk_llm.LLM:
    """All LLM traffic goes through LiteLLM, which handles provider routing + fallbacks."""
    return openai.LLM(
        model=model or s.llm_model,
        base_url=f"{s.litellm_url}/v1",
        api_key=s.litellm_api_key,
        temperature=s.llm_temperature,
    )


def set_tts_language(tts: lk_tts.TTS, language: str) -> None:
    """Switch the TTS voice language mid-call (no-op for providers that auto-detect)."""
    update = getattr(tts, "update_options", None)
    if update is None:
        return
    try:
        update(target_language_code=language)
    except TypeError:
        pass  # provider doesn't take a language option
