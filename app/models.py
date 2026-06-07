from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class TokenUsage(BaseModel):
    input_tokens: int = 0
    output_tokens: int = 0
    cache_read_tokens: int = 0
    cache_creation_tokens: int = 0


class ToolCall(BaseModel):
    id: str = ""
    name: str
    input_summary: str = ""
    input_full: dict = Field(default_factory=dict)
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
    tool_calls: list[ToolCall] = Field(default_factory=list)
    thinking: str = ""
    metadata: dict = Field(default_factory=dict)


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
    tool_call_counts: dict[str, int] = Field(default_factory=dict)


class SkillSummary(BaseModel):
    id: str
    name: str
    description: str = ""
    license: str = ""
    plugin_name: str
    marketplace: str
    file_path: str
    body_preview: str = ""
    scope: str = "user"  # "user" | "project"
    project_path: str = ""


class McpServerSummary(BaseModel):
    id: str
    name: str
    transport_type: str  # "stdio" | "http" | "sse"
    command: str = ""
    args: list[str] = Field(default_factory=list)
    url: str = ""
    headers: dict = Field(default_factory=dict)
    marketplace: str = ""
    source_file: str = ""
    scope: str = "user"  # "user" | "project"
    project_path: str = ""


class RuleSummary(BaseModel):
    id: str
    name: str
    scope: str  # "user" | "project"
    file_path: str
    content_preview: str = ""
    content_length: int = 0
    project_path: str = ""


class PluginSummary(BaseModel):
    id: str
    name: str
    description: str = ""
    author: str = ""
    marketplace: str
    version: str = ""
    enabled: bool = False
    blocked: bool = False
    installed_at: str = ""
    skill_count: int = 0
    install_path: str = ""
    scope: str = "user"  # "user" | "project"
    project_path: str = ""
