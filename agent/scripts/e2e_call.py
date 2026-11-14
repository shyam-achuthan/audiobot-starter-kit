"""End-to-end call test without a human: a scripted caller joins a room, speaks
pre-synthesised utterances (Sarvam TTS) into its "microphone" track and prints
the agent's replies plus per-turn latency from the agent's telemetry events.

  docker compose run --rm --no-deps agent python scripts/e2e_call.py [workflow]
"""

from __future__ import annotations

import asyncio
import json
import os
import sys

import aiohttp
from livekit import rtc
from livekit.plugins import sarvam

API_URL = os.environ.get("API_URL", "http://api:4000")
LIVEKIT_INTERNAL = os.environ.get("LIVEKIT_URL", "ws://livekit:7880")
SR = 48000
FRAME = SR // 100  # 10 ms

UTTERANCES = [
    ("en-IN", "Hi, I want to know what plans you offer for small businesses."),
    ("hi-IN", "अच्छा, क्या आप मुझे हिंदी में बता सकते हैं कि सबसे सस्ता प्लान कौन सा है?"),
    ("ta-IN", "சரி, இந்த திட்டத்தில் வாடிக்கையாளர் ஆதரவு உள்ளதா?"),
]


async def synth(http: aiohttp.ClientSession, lang: str, text: str) -> rtc.AudioFrame:
    tts = sarvam.TTS(model="bulbul:v3", speaker="rahul", target_language_code=lang, http_session=http)
    frames = [ev.frame async for ev in tts.synthesize(text)]
    await tts.aclose()
    audio = rtc.combine_audio_frames(frames)
    rs = rtc.AudioResampler(audio.sample_rate, SR, num_channels=1)
    return rtc.combine_audio_frames(rs.push(audio) + rs.flush())


class Mic:
    """Single writer to the AudioSource: plays queued clips, silence otherwise.

    capture_frame paces in real time, so this behaves like a live microphone.
    """

    def __init__(self, source: rtc.AudioSource) -> None:
        self._source = source
        self._clips: asyncio.Queue[tuple[rtc.AudioFrame, asyncio.Event]] = asyncio.Queue()
        self._task = asyncio.create_task(self._run())

    async def say(self, audio: rtc.AudioFrame) -> None:
        done = asyncio.Event()
        await self._clips.put((audio, done))
        await done.wait()

    async def _run(self) -> None:
        silence = rtc.AudioFrame.create(SR, 1, FRAME)
        while True:
            try:
                audio, done = self._clips.get_nowait()
            except asyncio.QueueEmpty:
                await self._source.capture_frame(silence)
                continue
            data = memoryview(audio.data)
            for i in range(0, len(data) - FRAME + 1, FRAME):
                f = rtc.AudioFrame.create(SR, 1, FRAME)
                memoryview(f.data)[:] = data[i : i + FRAME]
                await self._source.capture_frame(f)
            done.set()

    def close(self) -> None:
        self._task.cancel()


async def main(workflow: str) -> None:
    async with aiohttp.ClientSession() as http:
        print("synthesising caller audio…")
        clips = [(lang, text, await synth(http, lang, text)) for lang, text in UTTERANCES]

        async with http.post(f"{API_URL}/v1/livekit/token", json={"workflow": workflow}) as r:
            r.raise_for_status()
            tok = await r.json()

    room = rtc.Room()
    turns: asyncio.Queue[dict] = asyncio.Queue()
    state = {"agent": "-"}
    listening = asyncio.Event()

    @room.on("data_received")
    def _on_data(pkt: rtc.DataPacket) -> None:
        if pkt.topic != "agent":
            return
        ev = json.loads(pkt.data)
        if ev["type"] == "state":
            state["agent"] = ev["state"]
            if ev["state"] == "listening":
                listening.set()
            else:
                listening.clear()
        elif ev["type"] == "turn":
            turns.put_nowait(ev)
        elif ev["type"] == "error":
            print("AGENT ERROR:", ev)

    await room.connect(LIVEKIT_INTERNAL, tok["token"])
    print(f"joined {tok['room']} as {tok['identity']} (workflow={workflow})")
    source = rtc.AudioSource(SR, 1)
    track = rtc.LocalAudioTrack.create_audio_track("mic", source)
    await room.local_participant.publish_track(
        track, rtc.TrackPublishOptions(source=rtc.TrackSource.SOURCE_MICROPHONE)
    )

    mic = Mic(source)  # streams silence between utterances, like a real open mic

    async def wait_turn(label: str) -> dict:
        t = await asyncio.wait_for(turns.get(), timeout=30)
        lat = t["latency"]
        print(
            f"\n[{label}] lang={t['language']} e2e={lat['e2e_ms']}ms "
            f"(eot={lat['end_of_turn_ms']} stt={lat['stt_ms']} llm_ttft={lat['llm_ttft_ms']} tts_ttfb={lat['tts_ttfb_ms']})"
            f"\n   user:  {t['user_text']}\n   agent: {t['agent_text']}"
        )
        return t

    await wait_turn("greeting")
    results = []
    for lang, text, audio in clips:
        await asyncio.wait_for(listening.wait(), timeout=30)  # let the agent finish talking
        await asyncio.sleep(0.5)
        await mic.say(audio)
        results.append(await wait_turn(lang))

    e2e = [r["latency"]["e2e_ms"] for r in results if r["latency"]["e2e_ms"] is not None]
    if e2e:
        print(f"\nvoice-to-voice: min={min(e2e)}ms max={max(e2e)}ms avg={sum(e2e) // len(e2e)}ms")
    mic.close()
    await room.disconnect()


if __name__ == "__main__":
    asyncio.run(main(sys.argv[1] if len(sys.argv) > 1 else "sales"))
