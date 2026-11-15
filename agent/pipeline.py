"""Provider factories for STT, LLM and TTS.

Adding a provider = adding one entry to a registry below; agents never import
provider plugins directly. All providers are cloud-hosted (no self-hosted models,
no GPU); another hosted STT/TTS can be registered here.
"""

from __future__ import annotations

from collections.abc import Callable

import aiohttp

from livekit.agents import llm as lk_llm
from livekit.agents import stt as lk_stt
from livekit.agents import tts as lk_tts
from livekit.plugins import openai, sarvam

from settings import Settings


_provider_session: aiohttp.ClientSession | None = None


def provider_http_session(s: Settings) -> aiohttp.ClientSession | None:
    """Shared HTTP session for cloud providers, routed through OUTBOUND_PROXY if set.

    Returns None without a proxy so plugins use LiveKit's default session.
    Must be called inside the job's event loop; closed by close_provider_session().
    """
    global _provider_session
    if not s.outbound_proxy:
        return None
    if _provider_session is None or _provider_session.closed:
        _provider_session = aiohttp.ClientSession(proxy=s.outbound_proxy)
    return _provider_session


async def close_provider_session() -> None:
    global _provider_session
    if _provider_session is not None and not _provider_session.closed:
        await _provider_session.close()
    _provider_session = None


def _sarvam_stt(s: Settings) -> lk_stt.STT:
    return sarvam.STT(
        language=s.stt_language,
        model=s.stt_model,
        mode=s.stt_mode,
        flush_signal=s.stt_flush_signal,
        http_session=provider_http_session(s),
    )


def _sarvam_tts(s: Settings, speaker: str | None = None, pace: float | None = None,
                language: str | None = None) -> lk_tts.TTS:
    return sarvam.TTS(
        model=s.tts_model,
        speaker=speaker or s.tts_speaker,
        pace=pace or 1.0,
        target_language_code=language or s.tts_default_language,
        http_session=provider_http_session(s),
    )


STT_PROVIDERS: dict[str, Callable[[Settings], lk_stt.STT]] = {
    "sarvam": _sarvam_stt,
}

TTS_PROVIDERS: dict[str, Callable[..., lk_tts.TTS]] = {
    "sarvam": _sarvam_tts,
}


def _pick(registry: dict, name: str, kind: str):
    try:
        return registry[name]
    except KeyError:
        raise ValueError(f"Unknown {kind} provider {name!r}; known: {sorted(registry)}") from None


def build_stt(s: Settings) -> lk_stt.STT:
    return _pick(STT_PROVIDERS, s.stt_provider, "STT")(s)


def build_tts(s: Settings, *, speaker: str | None = None, pace: float | None = None,
              language: str | None = None) -> lk_tts.TTS:
    return _pick(TTS_PROVIDERS, s.tts_provider, "TTS")(s, speaker=speaker, pace=pace, language=language)


def build_llm(s: Settings, model: str | None = None, trace: dict | None = None) -> lk_llm.LLM:
    """All LLM traffic goes through LiteLLM, which handles provider routing + fallbacks.

    `trace` is LiteLLM request metadata (session_id, generation_name, tags, ...); LiteLLM forwards
    it to Langfuse so every turn of a call lands in one Langfuse session.
    """
    return openai.LLM(
        model=model or s.llm_model,
        base_url=f"{s.litellm_url}/v1",
        api_key=s.litellm_api_key,
        temperature=s.llm_temperature,
        **({
            "extra_body": {"metadata": trace},
            # LiveKit adds a per-request x-livekit-session-id header, which LiteLLM would otherwise use
            # as the session; its own x-litellm-session-id header takes precedence.
            "extra_headers": {"x-litellm-session-id": trace["session_id"]},
        } if trace else {}),
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
