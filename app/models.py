from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel


class TokenUsage(BaseModel):
    input_tokens: int = 0
    output_tokens: int = 0
    cache_read_tokens: int = 0
    cache_creation_tokens: int = 0


class ToolCall(BaseModel):
    id: str = ""
    name: str
    input_summary: str = ""
    input_full: dict = {}
    result_text: str = ""
    is_error: bool = False
    duration_ms: int | None = None


class Message(BaseModel):
    role: Literal["user", "assistant", "system"]
    content: str
    timestamp: datetime | None = None
    model: str = ""
    stop_reason: str = ""
    usage: TokenUsage | None = None
    tool_calls: list[ToolCall] = []
    thinking: str = ""
    metadata: dict = {}


class SessionSummary(BaseModel):
    id: str
    source: Literal["claude", "codex"]
    title: str
    project: str
    model: str
    created_at: datetime
    updated_at: datetime
    message_count: int
    tokens_used: int | None = None
    file_path: str
    total_input_tokens: int = 0
    total_output_tokens: int = 0
    duration_ms: int | None = None
    ai_title: str = ""
    git_branch: str = ""
