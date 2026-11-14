"""Benchmark streaming STT finalization: time from the end of the caller's speech
to the FINAL transcript, for several Sarvam endpoints/settings.

  docker compose run --rm --no-deps agent python scripts/stt_latency.py
"""

from __future__ import annotations

import asyncio
import statistics
import time
from collections.abc import Callable

import aiohttp
from livekit import rtc
from livekit.agents import stt as lk_stt
from livekit.plugins import sarvam

SR = 16000
FRAME = SR // 50  # 20 ms
TEXTS = {
    "en-IN": "Hi, I want to know what plans you offer for small businesses.",
    "hi-IN": "क्या आप मुझे बता सकते हैं कि सबसे सस्ता प्लान कौन सा है?",
    "ta-IN": "இந்தத் திட்டத்தில் வாடிக்கையாளர் ஆதரவு உள்ளதா?",
}
RUNS = 2


async def synth(http, lang: str, text: str) -> rtc.AudioFrame:
    tts = sarvam.TTS(model="bulbul:v3", speaker="rahul", target_language_code=lang, http_session=http)
    frames = [ev.frame async for ev in tts.synthesize(text)]
    await tts.aclose()
    audio = rtc.combine_audio_frames(frames)
    rs = rtc.AudioResampler(audio.sample_rate, SR, num_channels=1)
    return rtc.combine_audio_frames(rs.push(audio) + rs.flush())


def frames_of(audio: rtc.AudioFrame):
    data = memoryview(audio.data)
    for i in range(0, len(data) - FRAME + 1, FRAME):
        f = rtc.AudioFrame.create(SR, 1, FRAME)
        memoryview(f.data)[:] = data[i : i + FRAME]
        yield f


async def measure(engine: lk_stt.STT, audio: rtc.AudioFrame, flush: bool) -> tuple[float, str, str]:
    stream = engine.stream()
    speech_end: float | None = None
    result: dict = {}
    got_final = asyncio.Event()

    async def reader():
        async for ev in stream:
            if ev.type == lk_stt.SpeechEventType.FINAL_TRANSCRIPT and ev.alternatives and speech_end:
                alt = ev.alternatives[0]
                if alt.text.strip():
                    result.update(t=time.perf_counter() - speech_end, text=alt.text, lang=alt.language)
                    got_final.set()
                    return

    task = asyncio.create_task(reader())
    silence = rtc.AudioFrame.create(SR, 1, FRAME)
    for _ in range(10):  # 200 ms lead-in
        stream.push_frame(silence)
        await asyncio.sleep(0.02)
    for f in frames_of(audio):
        stream.push_frame(f)
        await asyncio.sleep(0.02)  # real time
    speech_end = time.perf_counter()
    if flush:
        stream.flush()
    # keep the "mic" open with silence until the final arrives (max 5 s)
    for _ in range(250):
        if got_final.is_set():
            break
        stream.push_frame(silence)
        await asyncio.sleep(0.02)
    task.cancel()
    await stream.aclose()
    return result.get("t", float("nan")), str(result.get("lang")), result.get("text", "<no final>")


async def main() -> None:
    async with aiohttp.ClientSession() as http:
        clips = {lang: await synth(http, lang, t) for lang, t in TEXTS.items()}
        configs: list[tuple[str, Callable[[], lk_stt.STT], bool]] = [
            ("v4 stream, no flush", lambda: sarvam.STT(language="unknown", model="saaras:v4", http_session=http), False),
            ("v4 stream + flush", lambda: sarvam.STT(language="unknown", model="saaras:v4", flush_signal=True, http_session=http), True),
            ("realtime fast/manual + flush", lambda: sarvam.STTRealtime(language="auto", stream_type="fast", endpointing="manual", http_session=http), True),
            ("realtime fast/vad 300ms", lambda: sarvam.STTRealtime(language="auto", stream_type="fast", endpointing="vad", vad_min_silence_ms=300, http_session=http), False),
            ("realtime balanced/manual + flush", lambda: sarvam.STTRealtime(language="auto", stream_type="balanced", endpointing="manual", http_session=http), True),
        ]
        for name, make, flush in configs:
            times = []
            for lang, audio in clips.items():
                for _ in range(RUNS):
                    try:
                        engine = make()
                        t, got_lang, text = await measure(engine, audio, flush)
                        await engine.aclose()
                    except Exception as e:  # noqa: BLE001
                        print(f"{name:34} {lang} ERROR {type(e).__name__}: {str(e)[:140]}")
                        break
                    times.append(t)
                    print(f"{name:34} {lang} final after {t * 1000:5.0f} ms  lang={got_lang:6} {text[:60]}")
            ok = [t for t in times if t == t]
            if ok:
                print(f"==> {name}: median {statistics.median(ok) * 1000:.0f} ms over {len(ok)} runs\n")


if __name__ == "__main__":
    asyncio.run(main())
