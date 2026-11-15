"""AudioBots agent worker.

Voice loop:
  mic -> Silero VAD -> Sarvam STT (auto language) -> LiteLLM (Gemini) -> Sarvam TTS -> speaker
with local turn detection, barge-in and per-turn latency telemetry.

Multi-agent workflows (receptionist -> lead qualification / sales / support) with tools
backed by the NestJS API; every call and turn is stored in Postgres. Each agent's prompt,
model, voice and turn timing come from the admin dashboard, loaded at the start of the call.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os

from livekit.agents import (
    AgentServer,
    AgentSession,
    APIConnectOptions,
    JobContext,
    JobProcess,
    SessionConnectOptions,
    UserInputTranscribedEvent,
    cli,
    inference,
)
from livekit.plugins import silero

import agent_config
import pipeline
from api_client import ApiClient, ApiError
from languages import SUPPORTED, TURN_DETECTOR_LANGS, normalize
from settings import Settings
from telemetry import CallTelemetry
from workflows import AGENTS, BaseAgent, CallData

logger = logging.getLogger("audiobots.agent")

NO_TURN_MODEL_LANGS = sorted({c.split("-")[0] for c in SUPPORTED} - TURN_DETECTOR_LANGS)


def prewarm(proc: JobProcess) -> None:
    # Load models once per worker process, not per call.
    # min_silence_duration decides when VAD reports end-of-speech; the turn detector
    # still decides end-of-turn. LiveKit requires >= 0.25 s with the turn detector.
    proc.userdata["vad"] = silero.VAD.load(
        min_silence_duration=max(0.25, float(os.environ.get("VAD_MIN_SILENCE", "0.25"))),
    )
    # Let the dashboard show this worker's built-in defaults and voices (retried per call if it fails).
    proc.userdata["defaults_reported"] = agent_config.report_defaults_sync(Settings.from_env())


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
    return wf if wf in AGENTS else "router"


@server.rtc_session()
async def entrypoint(ctx: JobContext) -> None:
    settings = Settings.from_env()
    await ctx.connect()

    participant = await ctx.wait_for_participant()
    workflow = workflow_of(participant.metadata)
    logger.info("call started room=%s workflow=%s", ctx.room.name, workflow)

    # ---- call record (the call still works if the API is down; it just isn't stored) ----
    api = ApiClient()
    call = CallData(api=api, room=ctx.room.name, workflow=workflow, settings=settings)
    try:
        call.call_id = (await api.create_call(ctx.room.name, workflow))["id"]
    except ApiError as e:
        logger.error("could not create call record: %s", e.message)
    try:
        call.profile = await api.get_profile()
    except ApiError as e:
        logger.warning("could not load business profile, using defaults: %s", e.message)
    try:
        call.overrides = {a["workflow"]: a.get("overrides") or {} for a in await api.get_agents()}
    except ApiError as e:
        logger.warning("could not load agent settings, using built-in defaults: %s", e.message)
    if not ctx.proc.userdata.get("defaults_reported"):
        try:
            await api.report_agent_defaults(agent_config.defaults_payload(settings))
            ctx.proc.userdata["defaults_reported"] = True
        except ApiError as e:
            logger.warning("could not report agent defaults: %s", e.message)

    # The answering agent's settings drive the session; later agents bring their own
    # model, voice and endpointing (see BaseAgent).
    start = call.agent_settings(workflow)
    call.recording_consent = start.recording_consent
    if call.call_id and start.recording_consent == "notice":
        # Starts in the background; the greeting waits briefly for it before mentioning recording.
        call.recording_task = asyncio.create_task(api.recording(call.call_id, "start", "notice"))
    try:
        stt = pipeline.build_stt(settings)
        llm = call.llm_for(start.llm_model, workflow)
        tts = call.tts_for(start.tts_speaker, start.tts_pace)
    except ValueError as e:
        # Typically a missing provider key. Tell the caller's UI instead of silently dying.
        logger.error("pipeline config error: %s", e)
        await ctx.room.local_participant.publish_data(
            json.dumps({"type": "error", "code": "config", "message": str(e)}).encode(),
            reliable=True,
            topic="agent",
        )
        if call.call_id:
            try:
                await api.update_call(call.call_id, status="ended")
            except ApiError:
                pass
        await api.aclose()
        ctx.shutdown(reason="pipeline config error")
        return

    session: AgentSession[CallData] = AgentSession(
        userdata=call,
        vad=ctx.proc.userdata["vad"],
        stt=stt,
        llm=llm,
        tts=tts,
        conn_options=SessionConnectOptions(
            stt_conn_options=APIConnectOptions(liveness_timeout=settings.stt_liveness_timeout),
        ),
        turn_handling={
            # Local model only (no LiveKit Cloud). Covers en + hi; other languages
            # end the turn on silence using the endpointing delays below.
            "turn_detection": inference.TurnDetector(
                version="v1-mini",
                # No Tamil/Telugu/Kannada/Malayalam data in the model: a 0 threshold means
                # it never holds those turns open, so they end after min_delay of silence.
                unlikely_threshold={code: 0.0 for code in NO_TURN_MODEL_LANGS},
            ),
            "endpointing": {
                "min_delay": start.endpointing_min_delay,
                "max_delay": start.endpointing_max_delay,
            },
            "interruption": {
                "enabled": start.allow_interruptions,
                "mode": "vad",  # "adaptive" needs LiveKit Cloud
                # Session-wide in LiveKit: comes from the agent that answers the call.
                "min_duration": start.interruption_min_duration,
                "resume_false_interruption": True,
                "false_interruption_timeout": 1.0,
            },
            "preemptive_generation": {"enabled": settings.preemptive_generation},
        },
    )

    async def persist_turn(record: dict) -> None:
        if not call.call_id:
            return
        lat = record["latency"]
        try:
            await api.add_turn(
                call.call_id, turnNo=record["turn"], agent=record["agent"],
                language=record["language"], userText=record["user_text"],
                agentText=record["agent_text"], interrupted=record["interrupted"],
                eotMs=lat["end_of_turn_ms"], sttMs=lat["stt_ms"], llmTtftMs=lat["llm_ttft_ms"],
                ttsTtfbMs=lat["tts_ttfb_ms"], e2eMs=lat["e2e_ms"],
            )
        except ApiError as e:
            logger.warning("could not store turn %s: %s", record["turn"], e.message)

    telemetry = CallTelemetry(
        ctx.room, session, call_id=call.call_id or ctx.room.name,
        agent_name=lambda: call.workflow, on_turn=persist_turn,
    )

    # Voice AND reply language follow the caller (detected per utterance by STT).
    def on_transcribed(ev: UserInputTranscribedEvent) -> None:
        lang = normalize(ev.language)
        if ev.is_final and lang and lang != call.language:
            logger.info("language switch %s -> %s", call.language, lang)
            call.language = lang
            call.set_tts_language(lang)
            agent = session.current_agent
            if isinstance(agent, BaseAgent):
                telemetry.track(agent.set_language(lang))
            telemetry.publish({"type": "language", "language": lang})

    session.on("user_input_transcribed", on_transcribed)

    async def finish_call() -> None:
        await telemetry.aclose()
        if call.call_id:
            try:
                await api.update_call(
                    call.call_id, status="ended", agentPath=call.agent_path or [workflow],
                    language=call.language,
                )
            except ApiError as e:
                logger.warning("could not close call record: %s", e.message)
        await api.aclose()
        await pipeline.close_provider_session()

    ctx.add_shutdown_callback(finish_call)

    # Caller hung up (or the session failed): end the job so finish_call runs promptly.
    def on_close(ev) -> None:
        logger.info("session closed (%s); ending job", getattr(ev, "reason", "unknown"))
        ctx.shutdown(reason="session closed")

    session.on("close", on_close)

    telemetry.publish({"type": "agent.ready", "workflow": workflow, "callId": call.call_id, "phase": 4})
    await session.start(
        agent=AGENTS[workflow](call),
        room=ctx.room,
        record=False,  # LiveKit Cloud recording stays off; calls are recorded by our own Egress (Phase 6)
    )


if __name__ == "__main__":
    cli.run_app(server)
