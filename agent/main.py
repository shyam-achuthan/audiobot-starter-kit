"""AudioBots agent worker.

Phase 1: full voice loop for web calls.
  mic -> Silero VAD -> Sarvam STT (auto language) -> LiteLLM (Gemini Flash)
      -> Sarvam TTS (voice follows the caller's language) -> speaker
with local turn detection, barge-in and per-turn latency telemetry.
"""

from __future__ import annotations

import json
import logging
import os

from livekit.agents import (
    Agent,
    AgentServer,
    AgentSession,
    JobContext,
    JobProcess,
    UserInputTranscribedEvent,
    cli,
    inference,
)
from livekit.plugins import silero

import pipeline
import prompts
from languages import normalize
from settings import Settings
from telemetry import CallTelemetry

logger = logging.getLogger("audiobots.agent")


def prewarm(proc: JobProcess) -> None:
    # Load models once per worker process, not per call.
    # min_silence_duration decides when VAD reports end-of-speech, which also
    # triggers the STT flush. The turn detector still decides end-of-turn, so a
    # short value here cuts latency without cutting callers off mid-sentence.
    proc.userdata["vad"] = silero.VAD.load(
        min_silence_duration=float(os.environ.get("VAD_MIN_SILENCE", "0.3")),
    )


# Warm processes ready to take a call. Default (one per CPU) is wasteful on a laptop;
# raise NUM_IDLE_PROCESSES on the production host.
server = AgentServer(
    setup_fnc=prewarm,
    num_idle_processes=int(os.environ.get("NUM_IDLE_PROCESSES", "2")),
)


def workflow_of(metadata: str | None) -> str:
    try:
        wf = json.loads(metadata or "{}").get("workflow", "router")
    except json.JSONDecodeError:
        return "router"
    return wf if wf in prompts.WORKFLOWS else "router"


class VoiceAgent(Agent):
    def __init__(self, workflow: str) -> None:
        super().__init__(instructions=prompts.instructions_for(workflow))
        self.workflow = workflow

    async def on_enter(self) -> None:
        self.session.generate_reply(instructions=prompts.greeting_for(self.workflow))

    async def set_language(self, language: str) -> None:
        """Pin the reply language in the system prompt (small models drift otherwise)."""
        await self.update_instructions(prompts.instructions_for(self.workflow, language))


@server.rtc_session()
async def entrypoint(ctx: JobContext) -> None:
    settings = Settings.from_env()
    await ctx.connect()

    participant = await ctx.wait_for_participant()
    workflow = workflow_of(participant.metadata)
    logger.info("call started room=%s workflow=%s", ctx.room.name, workflow)

    try:
        stt = pipeline.build_stt(settings)
        llm = pipeline.build_llm(settings)
        tts = pipeline.build_tts(settings)
    except ValueError as e:
        # Typically a missing provider key. Tell the caller's UI instead of silently dying.
        logger.error("pipeline config error: %s", e)
        await ctx.room.local_participant.publish_data(
            json.dumps({"type": "error", "code": "config", "message": str(e)}).encode(),
            reliable=True,
            topic="agent",
        )
        ctx.shutdown(reason="pipeline config error")
        return

    session = AgentSession(
        vad=ctx.proc.userdata["vad"],
        stt=stt,
        llm=llm,
        tts=tts,
        turn_handling={
            # Local model only (no LiveKit Cloud). Covers en + hi; other languages
            # end the turn on silence using the endpointing delays below.
            "turn_detection": inference.TurnDetector(version="v1-mini"),
            "endpointing": {
                "min_delay": settings.endpointing_min_delay,
                "max_delay": settings.endpointing_max_delay,
            },
            "interruption": {
                "enabled": True,
                "mode": "vad",  # "adaptive" needs LiveKit Cloud
                "min_duration": settings.interruption_min_duration,
                "resume_false_interruption": True,
                "false_interruption_timeout": 1.0,
            },
            "preemptive_generation": {"enabled": settings.preemptive_generation},
        },
    )

    telemetry = CallTelemetry(ctx.room, session, call_id=ctx.room.name, workflow=workflow)

    # Make the voice AND the reply language follow the caller (detected per utterance by STT).
    agent = VoiceAgent(workflow)
    current_lang = {"value": None}

    def on_transcribed(ev: UserInputTranscribedEvent) -> None:
        lang = normalize(ev.language)
        if ev.is_final and lang and lang != current_lang["value"]:
            logger.info("language switch %s -> %s", current_lang["value"], lang)
            current_lang["value"] = lang
            pipeline.set_tts_language(tts, lang)
            telemetry.track(agent.set_language(lang))
            telemetry.publish({"type": "language", "language": lang})

    session.on("user_input_transcribed", on_transcribed)
    ctx.add_shutdown_callback(telemetry.aclose)

    telemetry.publish({"type": "agent.ready", "workflow": workflow, "phase": 1})
    await session.start(
        agent=agent,
        room=ctx.room,
        record=False,  # keep audio/transcripts off LiveKit Cloud; recording is Phase 6
    )


if __name__ == "__main__":
    cli.run_app(server)
