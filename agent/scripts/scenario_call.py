"""Scripted multi-turn workflow test: a synthetic caller speaks a scenario
(Sarvam TTS audio into a mic track), waits for the agent after each line, then
prints the conversation, per-turn latency and what was stored via the API.

  docker compose run --rm --no-deps -v "$PWD/agent:/app" agent \
      python scripts/scenario_call.py support|lead|sales_hi|router_support

Each line is spoken only after the agent has finished talking, so scenarios
should give the caller's details up front and confirm with "yes" when asked.
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
import time

import aiohttp
from livekit import rtc
from livekit.plugins import sarvam

API_URL = os.environ.get("API_URL", "http://api:4000")
TOKEN = os.environ.get("AGENT_API_TOKEN", "")
LIVEKIT_INTERNAL = os.environ.get("LIVEKIT_URL", "ws://livekit:7880")
SR = 48000
FRAME = SR // 100
VERBOSE = os.environ.get("VERBOSE") == "1"
T0 = time.monotonic()

SCENARIOS: dict[str, dict] = {
    "support": {
        "workflow": "support",
        "lines": [
            ("en-IN", "Hi, your mobile app crashes every time I try to log in, since yesterday."),
            ("en-IN", "My name is Ravi Kumar and my mobile number is 9 8 4 5 0, 1 2 3 4 5."),
            ("en-IN", "Yes, that is correct."),
            ("en-IN", "I can't use the app at all, so it is blocking me."),
            ("en-IN", "No, that's all. Thank you, bye."),
        ],
        "expect": {"ticket_type": "support"},
    },
    # Recording consent (Phase 6). Needs the recording profile (make up-rec).
    # Default "notice" mode: the caller objects, so the recording must be stopped and deleted.
    "consent_no": {
        "workflow": "support",
        "lines": [
            ("en-IN", "Please don't record this call."),
            ("en-IN", "My invoices are not reaching my customers by email. That's all I wanted to ask, thanks, bye."),
        ],
        "expect": {"recording": "declined"},
    },
    # Run with the Support agent's consent set to "Ask first": the caller agrees, so it is recorded.
    "consent_yes": {
        "workflow": "support",
        "lines": [
            ("en-IN", "Yes, you can record it."),
            ("en-IN", "My invoices are not reaching my customers by email. That's all I wanted to ask, thanks, bye."),
        ],
        "expect": {"recording": "ready"},
    },
    "lead": {
        "workflow": "lead_qualification",
        "lines": [
            ("en-IN", "We need a CRM for our sales team of twenty people and would like a proposal."),
            ("en-IN", "I am Priya Sharma from Sharma Traders. I am the owner, so I decide."),
            ("en-IN", "Our budget is around three lakh rupees and we want to start next month."),
            ("en-IN", "My mobile number is 9 8 7 6 5, 4 3 2 1 0."),
            ("en-IN", "Yes, correct. Please call me tomorrow after four PM."),
            ("en-IN", "No, that's everything. Thanks, bye."),
        ],
        "expect": {"lead": True, "ticket_type": "callback"},
    },
    "sales_hi": {
        "workflow": "sales",
        "lines": [
            ("hi-IN", "नमस्ते, मुझे अपनी दुकान के लिए बिलिंग सॉफ्टवेयर चाहिए, इसकी कीमत क्या है?"),
            ("hi-IN", "ठीक है, मेरा नाम अमित वर्मा है और मेरा नंबर 9 1 2 3 4, 5 6 7 8 9 है।"),
            ("hi-IN", "हाँ, सही है। कल सुबह ग्यारह बजे कॉल कर दीजिए।"),
            ("hi-IN", "नहीं, बस इतना ही। धन्यवाद।"),
        ],
        "expect": {"lead": True, "ticket_type": "callback"},
    },
    "router_support": {
        "workflow": "router",
        "lines": [
            ("en-IN", "Hi, I have a problem with my existing account, I am not getting invoices by email."),
            ("en-IN", "It started last week. My name is Neha Iyer, mobile 9 9 8 8 7, 7 6 6 5 5."),
            ("en-IN", "Yes, that's right."),
            ("en-IN", "Normal priority is fine. That's all, thank you."),
        ],
        "expect": {"path": ["router", "support"], "ticket_type": "support"},
    },
    # ---- Phase 3: answers must come from the knowledge base (samples/knowledge) ----
    "kb_pricing": {
        "workflow": "sales",
        "lines": [
            ("en-IN", "Hi, how much does the Business plan cost per month?"),
            ("en-IN", "And if I buy the annual plan, can I get a refund later?"),
            ("en-IN", "Okay, that's all I needed. Thanks, bye."),
        ],
        # each group: the agent must say at least one of these (case-insensitive)
        "expect": {"says": [["1,299", "1299", "thousand two hundred", "twelve hundred"], ["30 days", "thirty days"]]},
    },
    "kb_hindi_support": {
        "workflow": "support",
        "lines": [
            ("hi-IN", "नमस्ते, मेरा थर्मल प्रिंटर बिल प्रिंट नहीं कर रहा है।"),
            ("hi-IN", "ठीक है, मैं कोशिश करता हूँ। धन्यवाद, बस इतना ही।"),
        ],
        "expect": {"says": [["bluetooth", "ब्लूटूथ"]]},
    },
    "kb_unknown": {
        "workflow": "sales",
        "lines": [
            ("en-IN", "Does QuickBill integrate with Shopify?"),
            ("en-IN", "No, that's fine. Bye."),
        ],
        # not in the KB: must not claim it does; should defer to a specialist
        "expect": {"says": [["specialist", "confirm", "check", "team"]], "not_says": ["yes, quickbill integrates", "yes, it integrates"]},
    },
}


async def synth(http, lang: str, text: str) -> rtc.AudioFrame:
    tts = sarvam.TTS(model="bulbul:v3", speaker="rahul", target_language_code=lang, http_session=http)
    frames = [ev.frame async for ev in tts.synthesize(text)]
    await tts.aclose()
    audio = rtc.combine_audio_frames(frames)
    rs = rtc.AudioResampler(audio.sample_rate, SR, num_channels=1)
    return rtc.combine_audio_frames(rs.push(audio) + rs.flush())


class Mic:
    """Single writer to the AudioSource: queued clips, silence otherwise (real-time paced)."""

    def __init__(self, source: rtc.AudioSource) -> None:
        self._source = source
        self._clips: asyncio.Queue = asyncio.Queue()
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


async def main(name: str) -> int:
    sc = SCENARIOS[name]
    headers = {"Authorization": f"Bearer {TOKEN}"}
    proxy = os.environ.get("OUTBOUND_PROXY") or None
    async with aiohttp.ClientSession() as http, aiohttp.ClientSession(proxy=proxy) as ext:
        print(f"scenario={name} workflow={sc['workflow']} — synthesising {len(sc['lines'])} caller lines…")
        clips = [(lang, text, await synth(ext, lang, text)) for lang, text in sc["lines"]]
        widget_key = os.environ.get("WIDGET_KEY")
        if widget_key:
            # Start the call the way the website widget does: via the web proxy, with the site's Origin.
            # (The widget's own agent answers; the scenario's workflow is ignored.)
            web = os.environ.get("WEB_URL", "http://web:3000")
            origin = os.environ.get("WIDGET_ORIGIN", "http://localhost:8088")
            async with http.post(f"{web}/backend/v1/widget/session", json={"key": widget_key},
                                 headers={"Origin": origin}) as r:
                tok = await r.json()
                if r.status >= 400:
                    print(f"FAIL: widget session refused: {tok}")
                    return 1
            print(f"widget session ok (max {tok.get('maxMinutes')} min)")
        else:
            async with http.post(f"{API_URL}/v1/livekit/token", json={"workflow": sc["workflow"]},
                                 headers={"Authorization": f"Bearer {os.environ.get('AGENT_API_TOKEN', '')}"}) as r:
                tok = await r.json()

        room = rtc.Room()
        state = {"agent": "initializing", "changed": time.monotonic(), "call_id": None, "ended": False}
        turns: list[dict] = []

        @room.on("data_received")
        def _on_data(pkt: rtc.DataPacket) -> None:
            if pkt.topic != "agent":
                return
            ev = json.loads(pkt.data)
            if VERBOSE and ev["type"] in ("state", "transcript"):
                extra = ev.get("state") or (("final: " if ev.get("final") else "interim: ") + ev.get("text", ""))
                print(f"    {time.monotonic() - T0:6.1f}s {ev['type']}: {extra}")
            if ev["type"] == "state":
                state["agent"], state["changed"] = ev["state"], time.monotonic()
            elif ev["type"] == "agent.ready":
                state["call_id"] = ev.get("callId")
            elif ev["type"] == "turn":
                turns.append(ev)
                lat = ev["latency"]
                print(f"  [{ev['agent']:<18}] e2e={lat['e2e_ms']}ms  user: {ev['user_text']}\n"
                      f"  {'':20}       agent: {ev['agent_text']}")
            elif ev["type"] == "error":
                print("  AGENT ERROR:", ev)

        @room.on("participant_disconnected")
        def _on_left(p: rtc.RemoteParticipant) -> None:
            if p.kind == rtc.ParticipantKind.PARTICIPANT_KIND_AGENT:
                state["ended"] = True

        await room.connect(LIVEKIT_INTERNAL, tok["token"])
        source = rtc.AudioSource(SR, 1)
        await room.local_participant.publish_track(
            rtc.LocalAudioTrack.create_audio_track("mic", source),
            rtc.TrackPublishOptions(source=rtc.TrackSource.SOURCE_MICROPHONE),
        )
        mic = Mic(source)

        async def agent_idle(since: float | None = None, timeout: float = 40) -> None:
            """Wait for the agent to respond and finish.

            With `since`, first wait until the agent reacts (state changes after the caller's
            line; the final transcript lands ~1-2 s after the audio ends), then until it has
            been 'listening' for 1.5 s. Gives up quietly after `timeout`.
            """
            t0 = time.monotonic()
            while since is not None and state["changed"] <= since and not state["ended"]:
                if time.monotonic() - t0 > 12:  # agent chose not to reply
                    break
                await asyncio.sleep(0.1)
            while time.monotonic() - t0 < timeout and not state["ended"]:
                if state["agent"] == "listening" and time.monotonic() - state["changed"] > 1.5:
                    return
                await asyncio.sleep(0.1)

        await agent_idle()
        for lang, text, audio in clips:
            if state["ended"]:
                break
            if VERBOSE:
                print(f"    {time.monotonic() - T0:6.1f}s CALLER SAYS: {text}")
            await mic.say(audio)
            await agent_idle(since=time.monotonic())

        # let a goodbye + end_call finish
        for _ in range(100):
            if state["ended"]:
                break
            await asyncio.sleep(0.1)
        mic.close()
        await room.disconnect()

        # ---- verify what was stored ----
        await asyncio.sleep(3)  # shutdown callback marks the call ended
        call_id = state["call_id"]
        if not call_id:
            print("FAIL: no call id received")
            return 1
        async with http.get(f"{API_URL}/v1/calls/{call_id}", headers=headers) as r:
            call = await r.json()
        print("\n--- stored ---")
        if call.get("widgetId"):
            print(f"widget: {call['widgetId']}")
        print(f"call: status={call['status']} outcome={call['outcome']} path={call['agentPath']} "
              f"turns={call['turnCount']} median_e2e={call['medianE2eMs']}ms caller={call['callerName']} {call['callerPhone']}")
        for lead in call.get("leads", []):
            print("lead:", {k: lead[k] for k in ("name", "phone", "company", "need", "budget", "authority",
                                                 "timeline", "teamSize", "score", "status", "preferredCallbackTime")
                            if lead.get(k) is not None})
        for t in call.get("tickets", []):
            print(f"ticket: {t['ref']} {t['type']} {t['priority']} '{t['subject']}' cb={t['preferredCallbackTime']}")

        if exp_rec := sc["expect"].get("recording"):
            # The file is uploaded a few seconds after the call ends.
            for _ in range(30):
                rec = (call.get("recording") or {}).get("status")
                if rec not in ("recording", "processing"):
                    break
                await asyncio.sleep(1)
                async with http.get(f"{API_URL}/v1/calls/{call_id}", headers=headers) as r:
                    call = await r.json()
            print("recording:", call.get("recording"))

        ok, exp = True, sc["expect"]
        if exp.get("lead") and not call.get("leads"):
            ok = False; print("FAIL: expected a lead")
        if exp.get("ticket_type") and not any(t["type"] == exp["ticket_type"] for t in call.get("tickets", [])):
            ok = False; print(f"FAIL: expected a {exp['ticket_type']} ticket")
        if exp.get("recording") and (call.get("recording") or {}).get("status") != exp["recording"]:
            ok = False; print(f"FAIL: expected recording {exp['recording']}")
        if exp.get("path") and call["agentPath"][: len(exp["path"])] != exp["path"]:
            ok = False; print(f"FAIL: expected path {exp['path']}")
        said = " ".join((t.get("agent_text") or "") for t in turns).lower()
        for group in exp.get("says", []):
            if not any(g.lower() in said for g in group):
                ok = False; print(f"FAIL: agent never said any of {group}")
        for bad in exp.get("not_says", []):
            if bad.lower() in said:
                ok = False; print(f"FAIL: agent said '{bad}'")
        print("RESULT:", "PASS" if ok else "FAIL")
        return 0 if ok else 1


if __name__ == "__main__":
    which = sys.argv[1] if len(sys.argv) > 1 else "support"
    if which not in SCENARIOS:
        sys.exit(f"unknown scenario {which!r}; choose from {sorted(SCENARIOS)}")
    sys.exit(asyncio.run(main(which)))
