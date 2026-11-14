"""Smoke test: Sarvam TTS -> audio -> Sarvam STT, per launch language.

Run inside the agent image:
  docker compose run --rm --no-deps agent python scripts/sarvam_roundtrip.py
Prints TTS time-to-first-byte, STT latency, detected language and transcript.
"""

from __future__ import annotations

import asyncio
import os
import sys
import time

import aiohttp
from livekit import rtc

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from livekit.plugins import sarvam  # noqa: E402

from languages import normalize  # noqa: E402
from settings import Settings  # noqa: E402

SAMPLES = {
    "en-IN": "Hello, I would like to know the price of your premium plan.",
    "hi-IN": "नमस्ते, मुझे आपके प्रीमियम प्लान की कीमत जाननी है।",
    "ta-IN": "வணக்கம், உங்கள் பிரீமியம் திட்டத்தின் விலை என்ன?",
    "te-IN": "నమస్కారం, మీ ప్రీమియం ప్లాన్ ధర ఎంత?",
    "kn-IN": "ನಮಸ್ಕಾರ, ನಿಮ್ಮ ಪ್ರೀಮಿಯಂ ಪ್ಲಾನ್ ಬೆಲೆ ಎಷ್ಟು?",
    "ml-IN": "നമസ്കാരം, നിങ്ങളുടെ പ്രീമിയം പ്ലാനിന്റെ വില എത്രയാണ്?",
}


async def main() -> None:
    s = Settings.from_env()
    async with aiohttp.ClientSession() as http:
        stt = sarvam.STT(language="unknown", model=s.stt_model, mode=s.stt_mode, http_session=http)
        print(f"STT={s.stt_model} TTS={s.tts_model}/{s.tts_speaker}\n")
        for lang, text in SAMPLES.items():
            tts = sarvam.TTS(
                model=s.tts_model, speaker=s.tts_speaker, target_language_code=lang, http_session=http
            )
            t0 = time.perf_counter()
            ttfb = None
            frames: list[rtc.AudioFrame] = []
            async for ev in tts.synthesize(text):
                if ttfb is None:
                    ttfb = time.perf_counter() - t0
                frames.append(ev.frame)
            tts_total = time.perf_counter() - t0
            audio = rtc.combine_audio_frames(frames)

            resampler = rtc.AudioResampler(audio.sample_rate, 16000, num_channels=1)
            pcm16k = resampler.push(audio) + resampler.flush()

            t1 = time.perf_counter()
            ev = await stt.recognize(pcm16k)
            stt_ms = (time.perf_counter() - t1) * 1000
            alt = ev.alternatives[0] if ev.alternatives else None
            detected = normalize(alt.language if alt else None)
            ok = "OK " if detected == lang else "MISMATCH"
            print(
                f"[{lang}] {ok} tts_ttfb={ttfb * 1000:.0f}ms tts_total={tts_total * 1000:.0f}ms "
                f"audio={audio.duration:.1f}s stt={stt_ms:.0f}ms detected={detected}\n"
                f"   said:  {text}\n   heard: {alt.text if alt else '-'}"
            )
            await tts.aclose()
        await stt.aclose()


if __name__ == "__main__":
    asyncio.run(main())
