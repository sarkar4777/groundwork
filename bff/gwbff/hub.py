"""Websocket fan-out. Every client gets every frame, bus frames are capped per second."""

from __future__ import annotations

import asyncio
import json
import time

from fastapi import WebSocket


class Hub:
    def __init__(self, bus_per_s: int = 200):
        self.clients: set[WebSocket] = set()
        self.bus_per_s = bus_per_s
        self._bus_window = (0.0, 0)
        self.sent = 0

    async def add(self, ws: WebSocket) -> None:
        await ws.accept()
        self.clients.add(ws)

    def drop(self, ws: WebSocket) -> None:
        self.clients.discard(ws)

    async def send(self, frame: dict) -> None:
        if frame.get("type") == "bus":
            start, n = self._bus_window
            now = time.monotonic()
            if now - start >= 1.0:
                start, n = now, 0
            if n >= self.bus_per_s:
                self._bus_window = (start, n)
                return
            self._bus_window = (start, n + 1)
        if not self.clients:
            return
        text = json.dumps(frame, separators=(",", ":"), default=str)
        dead = []
        for ws in list(self.clients):
            try:
                await asyncio.wait_for(ws.send_text(text), 1.0)
            except Exception:  # noqa: BLE001
                dead.append(ws)
        for ws in dead:
            self.clients.discard(ws)
        self.sent += 1
