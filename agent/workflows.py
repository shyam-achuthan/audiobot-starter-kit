"""Workflow agents: receptionist (router) + lead qualification, sales and support.

Agents share one CallData (session userdata) and hand off by returning the next
agent from a tool, carrying the conversation history. All business actions go
through the NestJS API (api_client.py); tools turn API errors into ToolError so
the LLM can recover (e.g. "ask the caller to repeat the number").
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field
from typing import ClassVar

from livekit.agents import Agent, RunContext, ToolError, function_tool, get_job_context
from livekit.agents import llm as lk_llm
from livekit.agents import tts as lk_tts

import agent_config
import pipeline
import prompts
from api_client import ApiClient, ApiError
from settings import Settings

logger = logging.getLogger("audiobots.workflows")


@dataclass
class CallData:
    api: ApiClient
    room: str
    channel: str = "web"
    call_id: str | None = None
    workflow: str = "router"
    language: str | None = None
    lead_id: str | None = None
    caller_name: str | None = None
    caller_phone: str | None = None
    agent_path: list[str] = field(default_factory=list)
    tickets: list[str] = field(default_factory=list)
    profile: dict = field(default_factory=dict)  # business profile from the admin Setup page
    settings: Settings = field(default_factory=Settings.from_env)
    # Admin overrides per workflow (from /v1/agents), loaded at the start of the call.
    overrides: dict[str, dict] = field(default_factory=dict)
    # One LLM per model alias and one TTS per (voice, pace), shared across handoffs.
    _llms: dict[str, lk_llm.LLM] = field(default_factory=dict)
    _ttss: dict[tuple[str, float], lk_tts.TTS] = field(default_factory=dict)

    def agent_settings(self, workflow: str) -> agent_config.AgentSettings:
        return agent_config.resolve(workflow, self.settings, self.overrides.get(workflow))

    def llm_for(self, model: str) -> lk_llm.LLM:
        if model not in self._llms:
            self._llms[model] = pipeline.build_llm(self.settings, model)
        return self._llms[model]

    def tts_for(self, speaker: str, pace: float) -> lk_tts.TTS:
        key = (speaker, pace)
        if key not in self._ttss:
            self._ttss[key] = pipeline.build_tts(
                self.settings, speaker=speaker, pace=pace, language=self.language)
        return self._ttss[key]

    def set_tts_language(self, language: str) -> None:
        for tts in self._ttss.values():
            pipeline.set_tts_language(tts, language)


def _spoken_ref(ref: str) -> str:
    """TKT-1004 -> 'ticket number 1 0 0 4' so TTS reads it digit by digit."""
    return f"ticket number {' '.join(ref.split('-')[-1])}"


async def _call_api(coro):
    try:
        return await coro
    except ApiError as e:
        raise ToolError(e.message) from e


# Values LLMs put in optional fields when they don't know them.
_PLACEHOLDERS = {"", "unknown", "not provided", "not given", "none", "n/a", "na", "null", "nil", "-", "no"}
_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[A-Za-z]{2,}$")

CONFIRM_PHONE = (
    "Before saving, read the number back to the caller in groups (for example '98450, 12345') "
    "and wait for a yes. Then call this tool again with phone_confirmed=true."
)


def _clean_fields(fields: dict) -> tuple[dict, list[str]]:
    """Drop placeholders and invalid optional values instead of failing the whole save."""
    out, skipped = {}, []
    for key, value in fields.items():
        if value is None:
            continue
        if isinstance(value, str):
            value = value.strip()
            if value.lower() in _PLACEHOLDERS:
                continue
            if key == "email" and not _EMAIL_RE.match(value):
                skipped.append(f"email '{value}' is not a valid address")
                continue
        out[key] = value
    return out, skipped


def _require_confirmed(phone: str | None, confirmed: bool) -> None:
    if phone and phone.strip().lower() not in _PLACEHOLDERS and not confirmed:
        raise ToolError(CONFIRM_PHONE)


class BaseAgent(Agent):
    workflow: ClassVar[str] = "router"

    def __init__(self, call: CallData, *, chat_ctx=None, handoff_summary: str | None = None) -> None:
        cfg = call.agent_settings(self.workflow)
        super().__init__(
            instructions=prompts.instructions_for(self.workflow, call.language, call.profile, role=cfg.role),
            chat_ctx=chat_ctx,
            llm=call.llm_for(cfg.llm_model),
            tts=call.tts_for(cfg.tts_speaker, cfg.tts_pace),
            turn_handling={
                "endpointing": {"min_delay": cfg.endpointing_min_delay, "max_delay": cfg.endpointing_max_delay},
                "interruption": {"enabled": cfg.allow_interruptions},
            },
        )
        self.call = call
        self.cfg = cfg
        self.handoff_summary = handoff_summary

    async def on_enter(self) -> None:
        self.call.workflow = self.workflow
        if not self.call.agent_path or self.call.agent_path[-1] != self.workflow:
            self.call.agent_path.append(self.workflow)
        logger.info("agent active: %s (path=%s model=%s voice=%s)", self.workflow, self.call.agent_path,
                    self.cfg.llm_model, self.cfg.tts_speaker)
        instructions = (
            prompts.handoff_for(self.handoff_summary)
            if self.handoff_summary
            else prompts.greeting_for(self.workflow, self.cfg.greeting)
        )
        self.session.generate_reply(instructions=instructions)

    async def set_language(self, language: str) -> None:
        """Pin the reply language in the system prompt (small models drift otherwise)."""
        self.call.language = language
        await self.update_instructions(
            prompts.instructions_for(self.workflow, language, self.call.profile, role=self.cfg.role))

    def _handoff(self, cls: type[BaseAgent], summary: str) -> BaseAgent:
        logger.info("handoff %s -> %s: %s", self.workflow, cls.workflow, summary)
        history = self.chat_ctx.copy(exclude_instructions=True, exclude_function_call=True)
        return cls(self.call, chat_ctx=history, handoff_summary=summary)

    async def _ensure_lead(self, **fields) -> dict:
        """Create the call's lead on first use, then update it.

        Placeholder/invalid optional values are dropped; what was skipped is in lead["_skipped"].
        """
        fields, skipped = _clean_fields(fields)
        if self.call.lead_id:
            lead = await _call_api(self.call.api.update_lead(self.call.lead_id, **fields))
        else:
            lead = await _call_api(self.call.api.create_lead(
                callId=self.call.call_id, language=self.call.language, **fields))
            self.call.lead_id = lead["id"]
        self.call.caller_name = lead.get("name") or self.call.caller_name
        self.call.caller_phone = lead.get("phone") or self.call.caller_phone
        lead["_skipped"] = skipped
        return lead

    async def _callback_ticket(self, reason: str, preferred_time: str | None, subject: str) -> str:
        if not self.call.caller_phone:
            raise ToolError("I need the caller's name and 10-digit mobile number before arranging a callback.")
        ticket = await _call_api(self.call.api.create_ticket(
            callId=self.call.call_id, leadId=self.call.lead_id, type="callback",
            subject=subject, description=reason, priority="high",
            contactName=self.call.caller_name, contactPhone=self.call.caller_phone,
            preferredCallbackTime=preferred_time, language=self.call.language,
        ))
        self.call.tickets.append(ticket["ref"])
        return ticket["ref"]

    # ---- shared tools ----
    @function_tool()
    async def search_knowledge(self, context: RunContext[CallData], query: str) -> str:
        """Search the business's knowledge base (products, plans, prices, policies, hours, troubleshooting).

        Args:
            query: The caller's question, rephrased as a short search query in any language.
        """
        try:
            data = await self.call.api.search_knowledge(query, self.workflow, top_k=4)
        except ApiError as e:
            logger.warning("knowledge search failed: %s", e.message)
            return "The knowledge base is unavailable right now. Offer a specialist callback instead of guessing."
        hits = [r for r in data.get("results", []) if r.get("score", 0) >= 0.45]
        logger.info("knowledge search %r -> %d hit(s)", query, len(hits))
        if not hits:
            return ("No relevant information found. Do not guess: tell the caller a specialist will "
                    "confirm, and offer a callback.")
        excerpts = "\n\n".join(f"[{i + 1}] {h['content']}" for i, h in enumerate(hits))
        return ("Answer ONLY from these excerpts, briefly and in the caller's language. Quote prices "
                "and policies exactly. If they don't answer the question, say a specialist will confirm.\n\n"
                + excerpts)

    @function_tool()
    async def request_human_callback(
        self, context: RunContext[CallData], name: str, phone: str, phone_confirmed: bool,
        reason: str, preferred_time: str | None = None,
    ) -> str:
        """Arrange for a human team member to call the caller back. Use when the caller asks for a person.

        Args:
            name: Caller's name.
            phone: Caller's 10-digit mobile number.
            phone_confirmed: True only after you read the number back and the caller said yes.
            reason: One sentence on what they need help with.
            preferred_time: When they'd like the call, in their words (e.g. "tomorrow after 4 pm").
        """
        _require_confirmed(phone, phone_confirmed)
        await self._ensure_lead(name=name, phone=phone, status="callback",
                                preferredCallbackTime=preferred_time)
        ref = await self._callback_ticket(reason, preferred_time, f"Human callback requested: {name}")
        return f"Callback booked as {_spoken_ref(ref)}. Tell the caller a team member will call them."

    @function_tool()
    async def end_call(self, context: RunContext[CallData]) -> None:
        """End the call. Use only after you have said goodbye and the caller has nothing else."""
        await context.wait_for_playout()  # let the goodbye finish playing
        logger.info("agent ended the call")
        get_job_context().shutdown(reason="agent ended the call")


class RouterAgent(BaseAgent):
    workflow = "router"

    @function_tool()
    async def transfer_to_sales(self, context: RunContext[CallData], summary: str):
        """Hand the caller to the sales assistant (buying, products, pricing questions).

        Args:
            summary: One sentence on what the caller wants.
        """
        return self._handoff(SalesAgent, summary)

    @function_tool()
    async def transfer_to_support(self, context: RunContext[CallData], summary: str):
        """Hand the caller to the support assistant (problems, existing tickets).

        Args:
            summary: One sentence describing the caller's issue.
        """
        return self._handoff(SupportAgent, summary)

    @function_tool()
    async def transfer_to_lead_qualification(self, context: RunContext[CallData], summary: str):
        """Hand the caller to the lead-qualification assistant (business requirement, wants a proposal or contact).

        Args:
            summary: One sentence on the caller's requirement.
        """
        return self._handoff(LeadQualificationAgent, summary)


class LeadQualificationAgent(BaseAgent):
    workflow = "lead_qualification"

    @function_tool()
    async def save_lead_details(
        self, context: RunContext[CallData],
        name: str | None = None, phone: str | None = None, phone_confirmed: bool = False,
        email: str | None = None, company: str | None = None, need: str | None = None,
        team_size: str | None = None, budget: str | None = None, authority: str | None = None,
        timeline: str | None = None,
    ) -> str:
        """Save what you've learned about the lead so far. Pass only fields you just learned; leave unknown ones out.

        Args:
            name: Caller's name.
            phone: 10-digit mobile number.
            phone_confirmed: True only after you read the number back and the caller said yes.
            email: Email address, if offered.
            company: Company or business name.
            need: What they need, in one or two sentences.
            team_size: Team or company size.
            budget: Budget range in their words.
            authority: Who makes the decision (e.g. "caller is the owner").
            timeline: When they want to start.
        """
        _require_confirmed(phone, phone_confirmed)
        lead = await self._ensure_lead(
            name=name, phone=phone, email=email, company=company, need=need,
            teamSize=team_size, budget=budget, authority=authority, timeline=timeline,
        )
        wanted = {"name": "name", "phone": "phone", "need": "need", "timeline": "timeline",
                  "budget": "budget", "authority": "decision maker", "teamSize": "team size"}
        missing = [label for key, label in wanted.items() if not lead.get(key)]
        note = f" Not saved: {'; '.join(lead['_skipped'])}." if lead["_skipped"] else ""
        return "Saved." + note + (f" Still unknown: {', '.join(missing)}." if missing else " All key details captured.")

    @function_tool()
    async def finish_qualification(
        self, context: RunContext[CallData], score: int, qualified: bool,
        preferred_callback_time: str, notes: str | None = None,
    ) -> str:
        """Finish qualification and book the specialist callback.

        Args:
            score: 0-100 lead quality (need, budget, authority, timeline).
            qualified: True if this is a real opportunity worth a specialist's time.
            preferred_callback_time: When the caller wants the specialist to call.
            notes: Anything else useful for the specialist.
        """
        if not self.call.lead_id:
            raise ToolError("Save the caller's details with save_lead_details first.")
        await self._ensure_lead(
            score=max(0, min(100, score)), status="qualified" if qualified else "unqualified",
            preferredCallbackTime=preferred_callback_time, notes=notes,
        )
        ref = await self._callback_ticket(
            notes or "Qualified lead: specialist follow-up", preferred_callback_time,
            f"Sales callback: {self.call.caller_name or 'new lead'} (score {score})",
        )
        return f"Lead saved and callback booked as {_spoken_ref(ref)}."

    @function_tool()
    async def transfer_to_sales(self, context: RunContext[CallData], summary: str):
        """Hand over to the sales assistant if the caller wants product information now.

        Args:
            summary: One sentence on what the caller wants to know.
        """
        return self._handoff(SalesAgent, summary)


class SalesAgent(BaseAgent):
    workflow = "sales"

    @function_tool()
    async def save_contact(
        self, context: RunContext[CallData], name: str, phone: str, phone_confirmed: bool,
        email: str | None = None, need: str | None = None,
    ) -> str:
        """Save an interested caller's contact details as a lead.

        Args:
            name: Caller's name.
            phone: 10-digit mobile number.
            phone_confirmed: True only after you read the number back and the caller said yes.
            email: Email address, if offered.
            need: What they are interested in.
        """
        _require_confirmed(phone, phone_confirmed)
        lead = await self._ensure_lead(name=name, phone=phone, email=email, need=need)
        return "Contact saved." + (f" Not saved: {'; '.join(lead['_skipped'])}." if lead["_skipped"] else "")

    @function_tool()
    async def request_callback(
        self, context: RunContext[CallData], name: str, phone: str, phone_confirmed: bool,
        reason: str, preferred_time: str,
    ) -> str:
        """Book a specialist callback for pricing, a demo or a proposal (also saves the contact).

        Args:
            name: Caller's name.
            phone: 10-digit mobile number.
            phone_confirmed: True only after you read the number back and the caller said yes.
            reason: What the specialist should help with.
            preferred_time: When the caller wants the call, in their words.
        """
        _require_confirmed(phone, phone_confirmed)
        await self._ensure_lead(name=name, phone=phone, need=reason, status="callback",
                                preferredCallbackTime=preferred_time)
        ref = await self._callback_ticket(reason, preferred_time,
                                          f"Sales callback: {self.call.caller_name or 'caller'}")
        return f"Callback booked as {_spoken_ref(ref)}."

    @function_tool()
    async def transfer_to_lead_qualification(self, context: RunContext[CallData], summary: str):
        """Hand over to lead qualification when the caller wants a tailored proposal.

        Args:
            summary: One sentence on the caller's requirement.
        """
        return self._handoff(LeadQualificationAgent, summary)

    @function_tool()
    async def transfer_to_support(self, context: RunContext[CallData], summary: str):
        """Hand over to support for an existing customer's problem.

        Args:
            summary: One sentence describing the issue.
        """
        return self._handoff(SupportAgent, summary)


class SupportAgent(BaseAgent):
    workflow = "support"

    @function_tool()
    async def create_support_ticket(
        self, context: RunContext[CallData], subject: str, description: str,
        priority: str, name: str, phone: str, phone_confirmed: bool,
    ) -> str:
        """Raise a support ticket for the caller's issue.

        Args:
            subject: Short title of the issue.
            description: Clear description: what happens, since when, what they tried.
            priority: One of low, normal, high, urgent.
            name: Caller's name.
            phone: 10-digit mobile number.
            phone_confirmed: True only after you read the number back and the caller said yes.
        """
        _require_confirmed(phone, phone_confirmed)
        priority = priority if priority in {"low", "normal", "high", "urgent"} else "normal"
        await self._ensure_lead(name=name, phone=phone)
        ticket = await _call_api(self.call.api.create_ticket(
            callId=self.call.call_id, leadId=self.call.lead_id, type="support",
            subject=subject, description=description, priority=priority,
            contactName=name, contactPhone=phone, language=self.call.language,
        ))
        self.call.tickets.append(ticket["ref"])
        return f"Ticket created: {_spoken_ref(ticket['ref'])}, priority {priority}."

    @function_tool()
    async def lookup_tickets(
        self, context: RunContext[CallData], ticket_number: str | None = None, phone: str | None = None,
    ) -> str:
        """Look up the status of existing tickets by ticket number or the caller's phone number.

        Args:
            ticket_number: Ticket number the caller gave, e.g. "1004" or "TKT-1004".
            phone: The caller's 10-digit mobile number.
        """
        if not ticket_number and not phone:
            raise ToolError("Ask the caller for their ticket number or registered mobile number.")
        tickets = await _call_api(self.call.api.lookup_tickets(ref=ticket_number, phone=phone))
        if not tickets:
            return "No tickets found for that number."
        return " | ".join(
            f"{_spoken_ref(t['ref'])}: {t['subject']} - status {t['status'].replace('_', ' ')}, "
            f"priority {t['priority']}"
            for t in tickets
        )

    @function_tool()
    async def transfer_to_sales(self, context: RunContext[CallData], summary: str):
        """Hand over to sales if the caller wants to buy something new.

        Args:
            summary: One sentence on what they want.
        """
        return self._handoff(SalesAgent, summary)


AGENTS: dict[str, type[BaseAgent]] = {
    a.workflow: a for a in (RouterAgent, LeadQualificationAgent, SalesAgent, SupportAgent)
}
