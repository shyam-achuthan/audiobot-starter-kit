"""AudioBots agent worker.

Phase 0: registers with LiveKit, joins every new room (automatic dispatch),
reads the visitor's chosen workflow from their token metadata and announces
itself over the data channel. The voice pipeline (Sarvam STT/TTS + LiteLLM)
arrives in Phase 1.
"""

from __future__ import annotations

import json
import logging

from livekit.agents import AgentServer, JobContext, cli

logger = logging.getLogger("audiobots.agent")

server = AgentServer()


def workflow_of(metadata: str | None) -> str:
    try:
        return json.loads(metadata or "{}").get("workflow", "router")
    except json.JSONDecodeError:
        return "router"


@server.rtc_session()
async def entrypoint(ctx: JobContext) -> None:
    await ctx.connect()
    logger.info("joined room %s", ctx.room.name)

    participant = await ctx.wait_for_participant()
    workflow = workflow_of(participant.metadata)
    logger.info("participant %s started workflow=%s", participant.identity, workflow)

    await ctx.room.local_participant.publish_data(
        json.dumps({"type": "agent.ready", "workflow": workflow, "phase": 0}).encode(),
        reliable=True,
        topic="agent",
    )


if __name__ == "__main__":
    cli.run_app(server)
