"""Per-turn latency + live transcript events.

Every completed turn is logged as one JSON line (event="turn") and published to
the room on the "agent" data topic so the demo page can show it. Phase 2
persists the same records to Postgres via the API.
"""

from __future__ import annotations

import asyncio
import json
import logging
from typing import Any

from livekit import rtc
from livekit.agents import (
    AgentSession,
    AgentStateChangedEvent,
    ConversationItemAddedEvent,
    UserInputTranscribedEvent,
)
from livekit.agents.llm import ChatMessage

from languages import normalize

logger = logging.getLogger("audiobots.telemetry")

TOPIC = "agent"


def _ms(v: float | None) -> int | None:
    return None if v is None else round(v * 1000)


class CallTelemetry:
    def __init__(self, room: rtc.Room, session: AgentSession, call_id: str, workflow: str) -> None:
        self._room = room
        self._call_id = call_id
        self._workflow = workflow
        self._tasks: set[asyncio.Task[Any]] = set()
        self._pending_user: ChatMessage | None = None
        self._turn = 0
        self.language: str | None = None

        session.on("user_input_transcribed", self._on_transcribed)
        session.on("conversation_item_added", self._on_item)
        session.on("agent_state_changed", self._on_state)

    # ---- publishing ----
    def track(self, coro: Any) -> None:
        """Run a coroutine from a sync event handler, keeping a reference until done."""
        task = asyncio.create_task(coro)
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)

    def publish(self, payload: dict[str, Any]) -> None:
        data = json.dumps(payload, ensure_ascii=False).encode()
        self.track(self._room.local_participant.publish_data(data, reliable=True, topic=TOPIC))

    # ---- event handlers ----
    def _on_transcribed(self, ev: UserInputTranscribedEvent) -> None:
        lang = normalize(ev.language)
        if ev.is_final and lang:
            self.language = lang
        self.publish({
            "type": "transcript", "role": "user", "text": ev.transcript,
            "final": ev.is_final, "language": lang,
        })

    def _on_state(self, ev: AgentStateChangedEvent) -> None:
        self.publish({"type": "state", "state": ev.new_state})

    def _on_item(self, ev: ConversationItemAddedEvent) -> None:
        item = ev.item
        if not isinstance(item, ChatMessage):
            return
        if item.role == "user":
            self._pending_user = item
            return
        if item.role != "assistant":
            return

        self._turn += 1
        user = self._pending_user
        self._pending_user = None
        um = dict(user.metrics) if user else {}
        am = dict(item.metrics)
        latency = {
            "end_of_turn_ms": _ms(um.get("end_of_turn_delay")),
            "stt_ms": _ms(um.get("transcription_delay")),
            "llm_ttft_ms": _ms(am.get("llm_node_ttft")),
            "tts_ttfb_ms": _ms(am.get("tts_node_ttfb")),
            "e2e_ms": _ms(am.get("e2e_latency")),
        }
        record = {
            "type": "turn",
            "call_id": self._call_id,
            "workflow": self._workflow,
            "turn": self._turn,
            "language": self.language,
            "user_text": user.text_content if user else None,
            "agent_text": item.text_content,
            "interrupted": bool(getattr(item, "interrupted", False)),
            "latency": latency,
        }
        logger.info("turn", extra={"event": "turn", **record})
        self.publish(record)

    async def aclose(self) -> None:
        if self._tasks:
            await asyncio.gather(*self._tasks, return_exceptions=True)
