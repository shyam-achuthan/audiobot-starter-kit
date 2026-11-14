"""Compare streaming TTS time-to-first-audio across Sarvam models.

  docker compose run --rm --no-deps agent python scripts/tts_latency.py
"""

from __future__ import annotations

import asyncio
import statistics
import time

import aiohttp
from livekit.plugins import sarvam

TEXTS = {
    "en-IN": "Sure, our premium plan costs nine hundred and ninety nine rupees a month.",
    "hi-IN": "ज़रूर, हमारा प्रीमियम प्लान नौ सौ निन्यानवे रुपये महीने का है।",
    "ta-IN": "நிச்சயமாக, எங்கள் பிரீமியம் திட்டம் மாதம் தொள்ளாயிரத்து தொண்ணூற்றொன்பது ரூபாய்.",
}
MODELS = [("bulbul:v3", "priya"), ("bulbul:v4-flash", None)]
RUNS = 3


async def ttfa(tts: sarvam.TTS, text: str) -> float:
    stream = tts.stream()
    t0 = time.perf_counter()
    stream.push_text(text)
    stream.end_input()
    first = None
    async for _ in stream:
        if first is None:
            first = time.perf_counter() - t0
    await stream.aclose()
    return first or float("nan")


async def main() -> None:
    async with aiohttp.ClientSession() as http:
        for model, speaker in MODELS:
            for lang, text in TEXTS.items():
                kwargs = {"speaker": speaker} if speaker else {}
                try:
                    tts = sarvam.TTS(model=model, target_language_code=lang, http_session=http, **kwargs)
                    times = [await ttfa(tts, text) for _ in range(RUNS)]
                    await tts.aclose()
                    print(f"{model:16} {lang}  first-audio median={statistics.median(times) * 1000:.0f}ms  runs={[round(t * 1000) for t in times]}")
                except Exception as e:  # noqa: BLE001
                    print(f"{model:16} {lang}  ERROR {type(e).__name__}: {str(e)[:160]}")


if __name__ == "__main__":
    asyncio.run(main())
