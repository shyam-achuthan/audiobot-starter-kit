"""Builds the test phone's caller audio: Sarvam TTS lines with pauses for the agent to answer.

  docker compose run --rm --no-deps -v "$PWD/agent:/app" -v "$PWD/infra/testphone/audio:/audio" \
      agent python scripts/sip_audio.py inbound|outbound|transfer

Writes /audio/caller.wav (16 kHz mono), which the test phone (infra/testphone) plays as the caller.
"""

from __future__ import annotations

import asyncio
import sys
import wave

import aiohttp
from livekit import rtc
from livekit.plugins import sarvam

SR = 16000
# (seconds of silence before the line, language, line). The first pause covers the agent's greeting.
SCRIPTS = {
    "inbound": [
        (11, "en-IN", "Hi, your mobile app crashes every time I try to log in, since yesterday."),
        (14, "en-IN", "No, that's all. Thank you, bye."),
    ],
    "transfer": [
        (11, "en-IN", "Can you connect me to a person, please? I want to talk to a human."),
        (20, "en-IN", "Okay, thank you."),
    ],
    "outbound": [
        (9, "en-IN", "Yes, this is a good time."),
        (14, "en-IN", "Okay, thank you. That's all for now, bye."),
    ],
}
TAIL_S = 12


async def synth(http: aiohttp.ClientSession, lang: str, text: str) -> bytes:
    tts = sarvam.TTS(model="bulbul:v3", speaker="rahul", target_language_code=lang, http_session=http)
    frames = [ev.frame async for ev in tts.synthesize(text)]
    await tts.aclose()
    audio = rtc.combine_audio_frames(frames)
    rs = rtc.AudioResampler(audio.sample_rate, SR, num_channels=1)
    return bytes(rtc.combine_audio_frames(rs.push(audio) + rs.flush()).data)


async def main(kind: str) -> None:
    pcm = bytearray()
    async with aiohttp.ClientSession() as http:
        for pause, lang, text in SCRIPTS[kind]:
            pcm += b"\0\0" * int(pause * SR)
            pcm += await synth(http, lang, text)
    pcm += b"\0\0" * (TAIL_S * SR)
    with wave.open("/audio/caller.wav", "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(bytes(pcm))
    print(f"wrote /audio/caller.wav ({len(pcm) / 2 / SR:.1f} s)")


if __name__ == "__main__":
    asyncio.run(main(sys.argv[1] if len(sys.argv) > 1 else "inbound"))
