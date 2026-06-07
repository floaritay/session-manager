from __future__ import annotations

import json
import time
from collections import Counter
from datetime import datetime

from app.models import Message, SessionSummary
from app.parsers.claude_parser import ClaudeParser
from app.parsers.codex_parser import CodexParser


class SessionService:
    def __init__(self):
        self.claude = ClaudeParser()
        self.codex = CodexParser()
        self._cache: dict = {}
        self._cache_ts: dict[str, float] = {}

    def _get_cached(self, key: str, loader, ttl: int = 60):
        now = time.time()
        if key in self._cache and (now - self._cache_ts.get(key, 0)) < ttl:
            return self._cache[key]
        result = loader()
        self._cache[key] = result
        self._cache_ts[key] = now
        return result

    def _invalidate(self, *keys: str):
        for key in keys:
            self._cache.pop(key, None)
            self._cache_ts.pop(key, None)

    def list_sessions(self, source: str | None = None) -> list[SessionSummary]:
        def _load():
            sessions: list[SessionSummary] = []
            sessions.extend(self.claude.list_sessions())
            sessions.extend(self.codex.list_sessions())
            sessions.sort(key=lambda s: s.updated_at, reverse=True)
            return sessions

        all_sessions = self._get_cached("sessions", _load)
        if source:
            return [s for s in all_sessions if s.source == source]
        return list(all_sessions)

    def get_messages(self, session_id: str, source: str) -> list[Message]:
        cache_key = f"messages:{source}:{session_id}"
        def _load():
            if source == "claude":
                return self.claude.get_messages(session_id)
            elif source == "codex":
                return self.codex.get_messages(session_id)
            return []
        return self._get_cached(cache_key, _load, ttl=120)

    def delete_session(self, session_id: str, source: str) -> bool:
        ok = False
        if source == "claude":
            ok = self.claude.delete_session(session_id)
        elif source == "codex":
            ok = self.codex.delete_session(session_id)
        if ok:
            self._invalidate("sessions", "stats", f"messages:{source}:{session_id}")
        return ok

    def get_stats(self) -> dict:
        def _load():
            sessions = self.list_sessions()
            total_sessions = len(sessions)
            total_input = sum(s.total_input_tokens for s in sessions)
            total_output = sum(s.total_output_tokens for s in sessions)
            total_messages = sum(s.message_count for s in sessions)

            by_source: dict[str, int] = {}
            for s in sessions:
                by_source[s.source] = by_source.get(s.source, 0) + 1

            by_date: dict[str, int] = {}
            for s in sessions:
                d = s.created_at.strftime("%Y-%m-%d")
                by_date[d] = by_date.get(d, 0) + 1

            # Aggregate tool counts from pre-computed SessionSummary data
            tool_counter: Counter[str] = Counter()
            for s in sessions:
                for name, count in s.tool_call_counts.items():
                    tool_counter[name] += count

            top_tools = [
                {"name": name, "count": count}
                for name, count in tool_counter.most_common(10)
            ]

            return {
                "total_sessions": total_sessions,
                "total_messages": total_messages,
                "total_input_tokens": total_input,
                "total_output_tokens": total_output,
                "sessions_by_source": by_source,
                "top_tools": top_tools,
                "sessions_by_date": [
                    {"date": d, "count": c}
                    for d, c in sorted(by_date.items())
                ],
            }

        return self._get_cached("stats", _load)

    def search_sessions(self, q: str, source: str | None = None) -> list[SessionSummary]:
        q_lower = q.lower()
        sessions = self.list_sessions(source)
        matched: list[SessionSummary] = []

        for s in sessions:
            # Check title first (no file I/O needed)
            if q_lower in s.title.lower():
                matched.append(s)
                continue

            # Check message content (uses cached messages if available)
            msgs = self.get_messages(s.id, s.source)
            for m in msgs:
                if q_lower in m.content.lower():
                    matched.append(s)
                    break

        return matched

    def list_subagents(self, session_id: str, source: str) -> list[dict]:
        if source == "claude":
            return self.claude.list_subagents(session_id)
        return []

    def export_session(self, session_id: str, source: str, fmt: str = "markdown") -> str:
        messages = self.get_messages(session_id, source)
        sessions = self.list_sessions(source)
        session = next((s for s in sessions if s.id == session_id), None)

        if not session:
            return ""

        if fmt == "json":
            data = {
                "session": session.model_dump(mode="json"),
                "messages": [m.model_dump(mode="json") for m in messages],
            }
            return json.dumps(data, ensure_ascii=False, indent=2)

        # Markdown format
        lines = [
            f"# {session.title}",
            "",
            f"- **Source**: {session.source}",
            f"- **Project**: {session.project}",
            f"- **Model**: {session.model}",
            f"- **Created**: {session.created_at.isoformat()}",
            f"- **Messages**: {session.message_count}",
        ]
        if session.total_input_tokens or session.total_output_tokens:
            lines.append(f"- **Tokens**: {session.total_input_tokens:,} in / {session.total_output_tokens:,} out")
        if session.duration_ms:
            lines.append(f"- **Duration**: {session.duration_ms:,}ms")
        if session.git_branch:
            lines.append(f"- **Branch**: {session.git_branch}")
        lines.append("")
        lines.append("---")
        lines.append("")

        for m in messages:
            role_label = "**User**" if m.role == "user" else "**Assistant**" if m.role == "assistant" else "**System**"
            lines.append(f"### {role_label}")
            lines.append("")
            lines.append(m.content)
            lines.append("")

            if m.thinking:
                lines.append(f"> **Thinking**: {m.thinking[:500]}{'...' if len(m.thinking) > 500 else ''}")
                lines.append("")

            for tc in m.tool_calls:
                lines.append(f"> Tool: `{tc.name}`")
                if tc.input_summary:
                    lines.append(f"> Input: {tc.input_summary}")
                if tc.result_text:
                    lines.append(f"> Result: {tc.result_text[:200]}{'...' if len(tc.result_text) > 200 else ''}")
                lines.append("")

            lines.append("---")
            lines.append("")

        return "\n".join(lines)
