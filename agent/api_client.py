"""Thin async client for the NestJS API (business logic lives there, not in the agent)."""

from __future__ import annotations

import logging
import os
from typing import Any

import aiohttp

logger = logging.getLogger("audiobots.api")


class ApiError(Exception):
    """API call failed. `message` is safe to show to the LLM (it guides the next step)."""

    def __init__(self, status: int, message: str) -> None:
        super().__init__(message)
        self.status = status
        self.message = message


class ApiClient:
    def __init__(self, base_url: str | None = None, token: str | None = None) -> None:
        self._base = (base_url or os.environ.get("API_URL", "http://api:4000")).rstrip("/")
        self._token = token or os.environ.get("AGENT_API_TOKEN", "")
        self._http: aiohttp.ClientSession | None = None

    async def _session(self) -> aiohttp.ClientSession:
        if self._http is None or self._http.closed:
            self._http = aiohttp.ClientSession(
                headers={"Authorization": f"Bearer {self._token}"},
                timeout=aiohttp.ClientTimeout(total=8),
            )
        return self._http

    async def _req(self, method: str, path: str, *, json: dict | None = None,
                   params: dict | None = None) -> Any:
        http = await self._session()
        body = {k: v for k, v in (json or {}).items() if v is not None} if json else None
        try:
            async with http.request(method, f"{self._base}{path}", json=body, params=params) as r:
                data = await r.json(content_type=None)
                if r.status >= 400:
                    msg = data.get("message") if isinstance(data, dict) else str(data)
                    if isinstance(msg, list):  # class-validator returns a list of messages
                        msg = "; ".join(msg)
                    raise ApiError(r.status, str(msg))
                return data
        except aiohttp.ClientError as e:
            logger.warning("API %s %s failed: %s", method, path, e)
            raise ApiError(503, "the booking system is temporarily unavailable") from e

    # ---- calls ----
    async def create_call(self, room: str, workflow: str, channel: str = "web") -> dict:
        return await self._req("POST", "/v1/calls", json={"room": room, "workflow": workflow, "channel": channel})

    async def update_call(self, call_id: str, **fields: Any) -> dict:
        return await self._req("PATCH", f"/v1/calls/{call_id}", json=fields)

    async def add_turn(self, call_id: str, **fields: Any) -> dict:
        return await self._req("POST", f"/v1/calls/{call_id}/turns", json=fields)

    # ---- leads ----
    async def create_lead(self, **fields: Any) -> dict:
        return await self._req("POST", "/v1/leads", json=fields)

    async def update_lead(self, lead_id: str, **fields: Any) -> dict:
        return await self._req("PATCH", f"/v1/leads/{lead_id}", json=fields)

    # ---- tickets ----
    async def create_ticket(self, **fields: Any) -> dict:
        return await self._req("POST", "/v1/tickets", json=fields)

    async def lookup_tickets(self, *, ref: str | None = None, phone: str | None = None) -> list[dict]:
        params = {k: v for k, v in {"ref": ref, "phone": phone}.items() if v}
        return await self._req("GET", "/v1/tickets/lookup", params=params)

    # ---- business profile + knowledge ----
    async def get_profile(self) -> dict:
        return await self._req("GET", "/v1/profile")

    async def search_knowledge(self, query: str, workflow: str, top_k: int = 4) -> dict:
        return await self._req("POST", "/v1/knowledge/search",
                               json={"query": query, "workflow": workflow, "topK": top_k})

    async def aclose(self) -> None:
        if self._http and not self._http.closed:
            await self._http.close()
