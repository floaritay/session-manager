from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from pathlib import Path

from app.models import Message, SessionSummary, TokenUsage, ToolCall
from app.parsers.base import SessionParser


class ClaudeParser(SessionParser):
    def __init__(self, claude_dir: str | None = None):
        self.claude_dir = Path(claude_dir or Path.home() / ".claude")
        self.projects_dir = self.claude_dir / "projects"

    def _find_jsonl_files(self) -> list[Path]:
        files: list[Path] = []
        if not self.projects_dir.exists():
            return files
        for project_dir in self.projects_dir.iterdir():
            if not project_dir.is_dir():
                continue
            for f in project_dir.glob("*.jsonl"):
                if f.parent.name == "subagents":
                    continue
                files.append(f)
        return files

    def _parse_session_file(self, filepath: Path) -> SessionSummary | None:
        messages, session_meta = self._parse_messages_full(filepath)
        if not messages:
            return None

        session_id = filepath.stem
        project_name = filepath.parent.name

        # title priority: ai-title > first user message > session_id
        title = session_id
        ai_title = session_meta.get("ai_title", "")
        if ai_title:
            title = ai_title
        else:
            for m in messages:
                if m.role == "user" and not m.content.startswith("<local-command"):
                    title = m.content[:80].replace("\n", " ") or session_id
                    break

        created_at = session_meta.get("created_at", datetime.now(timezone.utc))
        updated_at = session_meta.get("updated_at", created_at)

        model = session_meta.get("model", "")
        git_branch = session_meta.get("git_branch", "")

        return SessionSummary(
            id=session_id,
            source="claude",
            title=title,
            project=project_name,
            model=model,
            created_at=created_at,
            updated_at=updated_at,
            message_count=len(messages),
            file_path=str(filepath),
            total_input_tokens=session_meta.get("total_input_tokens", 0),
            total_output_tokens=session_meta.get("total_output_tokens", 0),
            duration_ms=session_meta.get("duration_ms"),
            ai_title=ai_title,
            git_branch=git_branch,
        )

    def _parse_messages_full(self, filepath: Path) -> tuple[list[Message], dict]:
        """Parse all messages and extract session-level metadata."""
        messages: list[Message] = []
        session_meta: dict = {
            "ai_title": "",
            "model": "",
            "git_branch": "",
            "total_input_tokens": 0,
            "total_output_tokens": 0,
            "duration_ms": None,
            "created_at": None,
            "updated_at": None,
        }
        total_duration = 0

        try:
            with open(filepath, encoding="utf-8") as f:
                raw_entries = []
                for line in f:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        raw_entries.append(json.loads(line))
                    except json.JSONDecodeError:
                        continue

            # first pass: extract session-level metadata
            for entry in raw_entries:
                entry_type = entry.get("type")

                if entry_type == "ai-title" and entry.get("aiTitle"):
                    session_meta["ai_title"] = entry["aiTitle"]

                if entry_type == "system" and entry.get("subtype") == "turn_duration":
                    dm = entry.get("durationMs")
                    if dm:
                        total_duration += dm

                ts_str = entry.get("timestamp")
                if ts_str:
                    try:
                        ts = datetime.fromisoformat(ts_str.replace("Z", "+00:00"))
                        if session_meta["created_at"] is None or ts < session_meta["created_at"]:
                            session_meta["created_at"] = ts
                        if session_meta["updated_at"] is None or ts > session_meta["updated_at"]:
                            session_meta["updated_at"] = ts
                    except (ValueError, TypeError):
                        pass

                if entry.get("gitBranch"):
                    session_meta["git_branch"] = entry["gitBranch"]

            session_meta["duration_ms"] = total_duration if total_duration > 0 else None

            # second pass: build messages
            # tool_use_id -> ToolCall mapping for matching results
            pending_tool_calls: dict[str, ToolCall] = {}

            for entry in raw_entries:
                entry_type = entry.get("type")
                if entry_type not in ("user", "assistant"):
                    continue

                msg_data = entry.get("message", {})
                raw_content = msg_data.get("content", "")
                timestamp_str = entry.get("timestamp")
                ts = None
                if timestamp_str:
                    try:
                        ts = datetime.fromisoformat(timestamp_str.replace("Z", "+00:00"))
                    except (ValueError, AttributeError):
                        pass

                if entry_type == "assistant":
                    model = msg_data.get("model", "")
                    stop_reason = msg_data.get("stop_reason", "")
                    usage_raw = msg_data.get("usage")

                    usage = None
                    if usage_raw:
                        usage = TokenUsage(
                            input_tokens=usage_raw.get("input_tokens", 0),
                            output_tokens=usage_raw.get("output_tokens", 0),
                            cache_read_tokens=usage_raw.get("cache_read_input_tokens", 0),
                            cache_creation_tokens=usage_raw.get("cache_creation_input_tokens", 0),
                        )
                        session_meta["total_input_tokens"] += usage.input_tokens
                        session_meta["total_output_tokens"] += usage.output_tokens
                        if model and not session_meta["model"]:
                            session_meta["model"] = model

                    text, thinking_str, tool_calls = self._extract_assistant_blocks(raw_content)

                    # register pending tool calls for result matching
                    for tc in tool_calls:
                        if tc.id:
                            pending_tool_calls[tc.id] = tc

                    if not text and not tool_calls:
                        continue

                    messages.append(Message(
                        role="assistant",
                        content=text,
                        timestamp=ts,
                        model=model,
                        stop_reason=stop_reason,
                        usage=usage,
                        tool_calls=tool_calls,
                        thinking=thinking_str,
                    ))

                elif entry_type == "user":
                    text, tool_results = self._extract_user_blocks(raw_content)

                    # match tool_results to pending tool_calls
                    for tr in tool_results:
                        tid = tr.get("tool_use_id", "")
                        if tid and tid in pending_tool_calls:
                            tc = pending_tool_calls[tid]
                            tc_result = tr.get("content", "")
                            if isinstance(tc_result, list):
                                parts = []
                                for b in tc_result:
                                    if isinstance(b, dict) and b.get("type") == "text":
                                        parts.append(b.get("text", ""))
                                tc_result = "\n".join(parts)
                            tc.result_text = str(tc_result) if tc_result else ""
                            tc.is_error = tr.get("is_error", False)
                            del pending_tool_calls[tid]

                    if not text:
                        continue
                    if text.startswith("<local-command-caveat>"):
                        continue
                    if text.startswith("<command-name>"):
                        text = self._extract_command_text(text)
                        if not text:
                            continue

                    messages.append(Message(
                        role="user",
                        content=text,
                        timestamp=ts,
                    ))

        except (OSError, UnicodeDecodeError):
            pass

        return messages, session_meta

    def _parse_messages(self, filepath: Path) -> list[Message]:
        messages, _ = self._parse_messages_full(filepath)
        return messages

    def _extract_user_blocks(self, content) -> tuple[str, list[dict]]:
        """Extract user text and tool_result blocks separately."""
        if isinstance(content, str):
            return content, []
        if isinstance(content, list):
            has_text = False
            texts = []
            tool_results = []
            for block in content:
                if not isinstance(block, dict):
                    continue
                if block.get("type") == "text":
                    has_text = True
                    texts.append(block.get("text", ""))
                elif block.get("type") == "tool_result":
                    tool_results.append(block)
            if not has_text and tool_results:
                return "", tool_results
            return "\n".join(texts), tool_results
        return str(content), []

    def _extract_user_text(self, content) -> str:
        text, _ = self._extract_user_blocks(content)
        return text

    @staticmethod
    def _extract_command_text(text: str) -> str:
        m = re.search(r"<command-message>(.*?)</command-message>", text, re.DOTALL)
        if m:
            return m.group(1).strip()
        m = re.search(r"<command-args>(.*?)</command-args>", text, re.DOTALL)
        if m:
            return m.group(1).strip()
        m = re.search(r"<command-name>(.*?)</command-name>", text)
        if m:
            return m.group(1).strip()
        return ""

    def _extract_assistant_blocks(self, content) -> tuple[str, str, list[ToolCall]]:
        """Extract text, thinking, and ToolCall objects from assistant content."""
        if isinstance(content, str):
            return content, "", []
        if isinstance(content, list):
            texts = []
            thinking_parts = []
            tool_calls = []
            for block in content:
                if not isinstance(block, dict):
                    continue
                btype = block.get("type", "")
                if btype == "text":
                    t = block.get("text", "")
                    if t:
                        texts.append(t)
                elif btype == "thinking":
                    t = block.get("thinking", "")
                    if t:
                        thinking_parts.append(t)
                elif btype == "tool_use":
                    inp = block.get("input", {})
                    tool_calls.append(ToolCall(
                        id=block.get("id", ""),
                        name=block.get("name", ""),
                        input_summary=self._summarize_tool_input(inp),
                        input_full=inp,
                    ))
            return "\n".join(texts), "\n".join(thinking_parts), tool_calls
        return str(content), "", []

    def _extract_assistant_content(self, content) -> tuple[str, dict]:
        """Legacy wrapper for backward compatibility."""
        text, thinking, tool_calls = self._extract_assistant_blocks(content)
        meta = {}
        if thinking:
            meta["thinking"] = thinking
        if tool_calls:
            meta["tool_uses"] = [
                {"name": tc.name, "input_summary": tc.input_summary}
                for tc in tool_calls
            ]
        return text, meta

    @staticmethod
    def _summarize_tool_input(inp: dict) -> str:
        if not inp:
            return ""
        for v in inp.values():
            if isinstance(v, str) and len(v) > 0:
                return v[:100]
        return json.dumps(inp, ensure_ascii=False)[:100]

    def list_sessions(self) -> list[SessionSummary]:
        sessions = []
        for filepath in self._find_jsonl_files():
            s = self._parse_session_file(filepath)
            if s:
                sessions.append(s)
        sessions.sort(key=lambda s: s.updated_at, reverse=True)
        return sessions

    def get_messages(self, session_id: str) -> list[Message]:
        for filepath in self._find_jsonl_files():
            if filepath.stem == session_id:
                return self._parse_messages(filepath)
        return []

    def list_subagents(self, session_id: str) -> list[dict]:
        subagents = []
        for filepath in self._find_jsonl_files():
            if filepath.stem == session_id:
                subagents_dir = filepath.parent / session_id / "subagents"
                if not subagents_dir.is_dir():
                    return subagents
                for meta_file in subagents_dir.glob("*.meta.json"):
                    try:
                        with open(meta_file, encoding="utf-8") as f:
                            meta = json.load(f)
                        agent_id = meta_file.stem.replace(".meta", "")
                        jsonl_path = subagents_dir / f"{agent_id}.jsonl"
                        size = jsonl_path.stat().st_size if jsonl_path.exists() else 0
                        subagents.append({
                            "id": agent_id,
                            "type": meta.get("agentType", ""),
                            "description": meta.get("description", ""),
                            "file_size": size,
                        })
                    except (OSError, json.JSONDecodeError):
                        continue
                break
        return subagents

    def delete_session(self, session_id: str) -> bool:
        from send2trash import send2trash

        for filepath in self._find_jsonl_files():
            if filepath.stem == session_id:
                session_dir = filepath.parent / session_id
                try:
                    send2trash(str(filepath))
                    if session_dir.is_dir():
                        send2trash(str(session_dir))
                    return True
                except Exception:
                    return False
        return False
