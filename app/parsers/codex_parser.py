from __future__ import annotations

import json
import logging
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

from app.models import Message, SessionSummary, TokenUsage, ToolCall
from app.parsers.base import SessionParser

logger = logging.getLogger(__name__)


class CodexParser(SessionParser):
    def __init__(self, codex_dir: str | None = None):
        self.codex_dir = Path(codex_dir or Path.home() / ".codex")
        self.db_path = self.codex_dir / "state_5.sqlite"

    def _get_connection(self) -> sqlite3.Connection:
        conn = sqlite3.connect(str(self.db_path))
        conn.row_factory = sqlite3.Row
        return conn

    def _get_threads(self) -> list[dict]:
        if not self.db_path.exists():
            return []
        conn = self._get_connection()
        try:
            rows = conn.execute(
                "SELECT id, title, model, model_provider, cwd, created_at, "
                "updated_at, tokens_used, archived, rollout_path, "
                "git_sha, git_branch, first_user_message "
                "FROM threads ORDER BY updated_at DESC"
            ).fetchall()
            return [dict(r) for r in rows]
        finally:
            conn.close()

    def _get_thread_by_id(self, session_id: str) -> dict | None:
        if not self.db_path.exists():
            return None
        conn = self._get_connection()
        try:
            row = conn.execute(
                "SELECT id, title, model, model_provider, cwd, created_at, "
                "updated_at, tokens_used, archived, rollout_path, "
                "git_sha, git_branch, first_user_message "
                "FROM threads WHERE id = ?", (session_id,)
            ).fetchone()
            return dict(row) if row else None
        finally:
            conn.close()

    def _parse_rollout_full(self, rollout_path: str) -> tuple[list[Message], dict]:
        """Parse all messages and extract session-level metadata."""
        path = Path(rollout_path)
        if not path.exists():
            return [], {}

        messages: list[Message] = []
        session_meta: dict = {
            "total_input_tokens": 0,
            "total_output_tokens": 0,
            "duration_ms": None,
        }

        # Track running commands for tool_call matching
        # key: call_id or command text, value: ToolCall
        pending_commands: dict[str, ToolCall] = {}
        total_duration = 0

        try:
            with open(path, encoding="utf-8") as f:
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
                payload = entry.get("payload", {})

                if entry_type == "event_msg":
                    sub = payload.get("type", "")

                    if sub == "token_count":
                        inp = payload.get("input_tokens", 0)
                        out = payload.get("output_tokens", 0)
                        session_meta["total_input_tokens"] += inp
                        session_meta["total_output_tokens"] += out

                    elif sub == "task_complete":
                        dur = payload.get("duration_ms")
                        if dur:
                            total_duration += dur

            session_meta["duration_ms"] = total_duration if total_duration > 0 else None

            # second pass: build messages
            for entry in raw_entries:
                entry_type = entry.get("type")
                payload = entry.get("payload", {})

                if entry_type == "response_item":
                    role = payload.get("role", "")
                    content = payload.get("content", "")

                    if role == "developer":
                        continue

                    elif role == "user":
                        text = self._extract_input_text(content)
                        if not text:
                            continue
                        if text.startswith("<environment_context>") or text.startswith("<permissions"):
                            continue
                        if messages and messages[-1].role == "user" and messages[-1].content.strip() == text.strip():
                            continue
                        messages.append(Message(role="user", content=text))

                    elif role == "assistant":
                        text, tool_calls = self._extract_output_with_tools(content)
                        if text or tool_calls:
                            messages.append(Message(
                                role="assistant",
                                content=text,
                                tool_calls=tool_calls,
                            ))

                elif entry_type == "event_msg":
                    sub = payload.get("type", "")

                    if sub == "user_message":
                        msg_text = str(payload.get("message", ""))
                        if msg_text:
                            if not messages or messages[-1].content.strip() != msg_text.strip():
                                messages.append(Message(role="user", content=msg_text))

                    elif sub == "exec_command_begin":
                        call_id = payload.get("call_id", "")
                        command = payload.get("command", "")
                        cwd = payload.get("cwd", "")
                        tc = ToolCall(
                            id=call_id,
                            name="bash",
                            input_summary=command[:100] if command else "",
                            input_full={"command": command, "cwd": cwd} if cwd else {"command": command},
                        )
                        if call_id:
                            pending_commands[call_id] = tc
                        # attach to last assistant message
                        if messages and messages[-1].role == "assistant":
                            messages[-1].tool_calls.append(tc)

                    elif sub == "exec_command_end":
                        call_id = payload.get("call_id", "")
                        exit_code = payload.get("exit_code", None)
                        aggregated_output = payload.get("aggregated_output", "")
                        if call_id and call_id in pending_commands:
                            tc = pending_commands[call_id]
                            tc.result_text = aggregated_output[:2000] if aggregated_output else ""
                            tc.is_error = exit_code is not None and exit_code != 0
                            tc.duration_ms = payload.get("duration_ms")
                            del pending_commands[call_id]

                    elif sub == "task_complete":
                        last = payload.get("last_agent_message")
                        if last:
                            if not messages or messages[-1].content.strip() != str(last).strip():
                                messages.append(Message(role="assistant", content=str(last)))

                    elif sub == "error":
                        err = payload.get("message", "")
                        if err:
                            messages.append(Message(
                                role="system",
                                content=f"[Error] {err}",
                            ))

        except (OSError, UnicodeDecodeError) as e:
            logger.warning("Failed to parse rollout %s: %s", rollout_path, e)

        return messages, session_meta

    def _parse_rollout(self, rollout_path: str) -> list[Message]:
        messages, _ = self._parse_rollout_full(rollout_path)
        return messages

    @staticmethod
    def _extract_input_text(content) -> str:
        if isinstance(content, str):
            return content
        if isinstance(content, list):
            texts = []
            for block in content:
                if isinstance(block, dict) and block.get("type") == "input_text":
                    t = block.get("text", "")
                    if t:
                        texts.append(t)
            return "\n".join(texts)
        return str(content)

    @staticmethod
    def _extract_output_with_tools(content) -> tuple[str, list[ToolCall]]:
        """Extract text and tool calls from assistant output content."""
        if isinstance(content, str):
            return content, []
        if isinstance(content, list):
            texts = []
            tool_calls = []
            for block in content:
                if not isinstance(block, dict):
                    continue
                btype = block.get("type", "")
                if btype == "output_text" or btype == "text":
                    t = block.get("text", "")
                    if t:
                        texts.append(t)
                elif btype == "function_call":
                    args = block.get("arguments", "")
                    if isinstance(args, str):
                        try:
                            args = json.loads(args)
                        except (json.JSONDecodeError, TypeError):
                            args = {"raw": args}
                    tool_calls.append(ToolCall(
                        id=block.get("call_id", ""),
                        name=block.get("name", ""),
                        input_summary=str(args)[:100],
                        input_full=args if isinstance(args, dict) else {"arguments": args},
                    ))
            return "\n".join(texts), tool_calls
        return str(content), []

    def list_sessions(self) -> list[SessionSummary]:
        sessions = []
        for thread in self._get_threads():
            ts = thread["created_at"]
            created = datetime.fromtimestamp(ts, tz=timezone.utc) if ts else datetime.now(timezone.utc)
            uts = thread["updated_at"]
            updated = datetime.fromtimestamp(uts, tz=timezone.utc) if uts else created

            cwd = thread.get("cwd") or ""
            if cwd.startswith("\\\\?\\"):
                cwd = cwd[4:]

            # Parse rollout once for metadata + message count + tool counts
            total_input = 0
            total_output = 0
            duration_ms = None
            msg_count = 0
            tool_call_counts: dict[str, int] = {}
            rollout_path = thread.get("rollout_path", "")
            if rollout_path:
                msgs, meta = self._parse_rollout_full(rollout_path)
                total_input = meta.get("total_input_tokens", 0)
                total_output = meta.get("total_output_tokens", 0)
                duration_ms = meta.get("duration_ms")
                msg_count = len(msgs)
                for m in msgs:
                    for tc in m.tool_calls:
                        tool_call_counts[tc.name] = tool_call_counts.get(tc.name, 0) + 1

            title = thread.get("title") or (thread.get("first_user_message") or "")[:80] or thread["id"]

            sessions.append(SessionSummary(
                id=thread["id"],
                source="codex",
                title=title,
                project=cwd,
                model=thread.get("model") or "",
                created_at=created,
                updated_at=updated,
                message_count=msg_count,
                tokens_used=thread.get("tokens_used"),
                file_path=rollout_path,
                total_input_tokens=total_input,
                total_output_tokens=total_output,
                duration_ms=duration_ms,
                git_branch=thread.get("git_branch") or "",
                tool_call_counts=tool_call_counts,
            ))
        sessions.sort(key=lambda s: s.updated_at, reverse=True)
        return sessions

    def get_messages(self, session_id: str) -> list[Message]:
        thread = self._get_thread_by_id(session_id)
        if thread and thread.get("rollout_path"):
            return self._parse_rollout(thread["rollout_path"])
        return []

    def delete_session(self, session_id: str) -> bool:
        from send2trash import send2trash

        thread = self._get_thread_by_id(session_id)
        if not thread:
            return False

        rollout_path = thread.get("rollout_path", "")
        if rollout_path and Path(rollout_path).exists():
            try:
                send2trash(rollout_path)
            except OSError as e:
                logger.warning("Failed to send rollout to trash: %s", e)
                return False

        conn = self._get_connection()
        try:
            conn.execute("DELETE FROM threads WHERE id = ?", (session_id,))
            conn.commit()
            return True
        except sqlite3.Error as e:
            logger.warning("Failed to delete thread %s from DB: %s", session_id, e)
            return False
        finally:
            conn.close()
