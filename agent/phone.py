"""Phone (SIP) calls: who is calling, waiting for an outbound call to be answered, and transfers.

Inbound calls arrive through the LiveKit SIP bridge as a SIP participant whose attributes carry the
caller's and the dialled number. Outbound calls are started by the API, which puts the call id,
agent and reason in the participant's metadata.
"""

from __future__ import annotations

import asyncio
import json
import logging
from dataclasses import dataclass

from livekit import api, rtc

logger = logging.getLogger("audiobots.phone")


@dataclass
class CallInfo:
    channel: str = "web"  # web | sip
    direction: str = "inbound"
    workflow: str | None = None  # from metadata (web token or outbound call)
    remote_number: str | None = None  # caller (inbound) or callee (outbound)
    local_number: str | None = None  # our number
    call_id: str | None = None  # outbound: created by the API
    ticket_ref: str | None = None
    context: str | None = None  # outbound: what the call is about
    sip_identity: str | None = None


def describe(participant: rtc.RemoteParticipant) -> CallInfo:
    try:
        meta = json.loads(participant.metadata or "{}")
    except json.JSONDecodeError:
        meta = {}
    if participant.kind != rtc.ParticipantKind.PARTICIPANT_KIND_SIP:
        return CallInfo(channel=meta.get("channel", "web"), workflow=meta.get("workflow"))
    attrs = participant.attributes or {}
    outbound = meta.get("direction") == "outbound"
    return CallInfo(
        channel="sip",
        direction="outbound" if outbound else "inbound",
        workflow=meta.get("workflow"),
        remote_number=attrs.get("sip.phoneNumber"),
        local_number=attrs.get("sip.trunkPhoneNumber"),
        call_id=meta.get("callId"),
        ticket_ref=meta.get("ticketRef"),
        context=meta.get("context"),
        sip_identity=participant.identity,
    )


async def wait_until_answered(room: rtc.Room, participant: rtc.RemoteParticipant, timeout: float = 60) -> bool:
    """Outbound calls: the SIP participant joins while it's still ringing. Wait for the pickup."""
    if participant.attributes.get("sip.callStatus") == "active":
        return True
    done: asyncio.Future[bool] = asyncio.get_running_loop().create_future()

    def on_attributes(changed: dict, p: rtc.Participant) -> None:
        if p.identity == participant.identity and p.attributes.get("sip.callStatus") == "active" and not done.done():
            done.set_result(True)

    def on_left(p: rtc.RemoteParticipant) -> None:
        if p.identity == participant.identity and not done.done():
            done.set_result(False)

    room.on("participant_attributes_changed", on_attributes)
    room.on("participant_disconnected", on_left)
    try:
        return await asyncio.wait_for(done, timeout)
    except asyncio.TimeoutError:
        return False
    finally:
        room.off("participant_attributes_changed", on_attributes)
        room.off("participant_disconnected", on_left)


async def transfer(lk: api.LiveKitAPI, room: str, identity: str, number: str) -> None:
    """Hand the phone call to a human number (SIP REFER through the trunk)."""
    target = number if number.startswith(("sip:", "tel:")) else f"tel:{number}"
    await lk.sip.transfer_sip_participant(api.TransferSIPParticipantRequest(
        room_name=room, participant_identity=identity, transfer_to=target, play_dialtone=False,
    ))
    logger.info("transferred %s in %s to %s", identity, room, target)
