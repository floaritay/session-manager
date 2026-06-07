# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
pip install -r requirements.txt   # install dependencies
python main.py                     # start server on http://127.0.0.1:8765
# or double-click start.bat
```

No test suite or linter configured. Port 8765 must be free before starting — check with `netstat -ano | grep ":8765"` and kill stale processes if needed.

## Architecture

Local web app to browse/manage conversation history from Claude Code and OpenAI Codex, plus Claude Code configuration (Skills, MCP, Rules, Plugins). FastAPI + Jinja2 + vanilla JS, no build step.

### Data flow

```
对话数据:
~/.claude/projects/<path>/<uuid>.jsonl       → ClaudeParser
~/.codex/state_5.sqlite + rollout JSONL      → CodexParser
                                                  ↓
                                           SessionService

配置数据:
~/.claude/plugins/cache/.../SKILL.md         → SkillsParser
~/.claude/plugins/marketplaces/.../.mcp.json → McpParser
~/.CLAUDE.md + 项目/CLAUDE.md                → RulesParser
~/.claude/plugins/installed_plugins.json     → PluginsParser
                                                  ↓
                                           ConfigService
                                                  ↓
                                             FastAPI (/api/*)
                                                  ↓
                                        single-page app.js

持久化数据:
~/.claude/session_manager_data/favorites.json → 收藏
~/.claude/session_manager_data/notes.json     → 备注
                                                  ↓
                                             Storage module
```

### Backend (`app/`)

- **`models.py`** — Pydantic models with `Field(default_factory=...)` for mutable defaults. Models: `SessionSummary` (includes `tool_call_counts`), `Message`, `ToolCall`, `TokenUsage`, `SkillSummary`, `McpServerSummary`, `RuleSummary`, `PluginSummary`
- **`storage.py`** — File-based persistence for favorites and notes in `~/.claude/session_manager_data/`
- **`parsers/base.py`** — Abstract `SessionParser` with `list_sessions()`, `get_messages()`, `delete_session()`
- **`parsers/utils.py`** — Shared utility: `decode_project_path()` for encoded directory names
- **`parsers/claude_parser.py`** — Two-pass JSONL parser with session_id→file_path index. Populates `tool_call_counts` during parsing. Also has `list_subagents()` for subagent JSONL files.
- **`parsers/codex_parser.py`** — Reads sessions from SQLite via `_get_thread_by_id()` (WHERE id=?). Populates `tool_call_counts` during rollout parsing. Parses `arguments` JSON strings into dicts for `input_full`.
- **`parsers/skills_parser.py`** — Reads SKILL.md files from installed plugin paths only. YAML frontmatter parser uses `line.index(":")` to handle colons in values.
- **`parsers/mcp_parser.py`** — Reads MCP configs from marketplace external_plugins, settings.json mcpServers, and project-level .mcp.json/settings.local.json. Detects transport type (stdio/http/sse).
- **`parsers/rules_parser.py`** — Reads global `~/.CLAUDE.md` and project-level CLAUDE.md + settings.local.json.
- **`parsers/plugins_parser.py`** — Reads installed_plugins.json, settings.json enabledPlugins, blocklist.json.
- **`services/session_service.py`** — Unified `_get_cached(key, loader, ttl)` caching. `get_stats()` uses pre-computed `tool_call_counts` (no double-parse). `search_sessions()` uses cached messages. Cache invalidation on delete.
- **`services/config_service.py`** — Same `_get_cached` pattern. `invalidate_cache()` public method for rule editing.
- **`server.py`** — FastAPI routes. SSE background task (`_session_watcher`) checks stats cache every 15s. Pagination via `page`/`per_page` params. Favorites filter via `favorites=true` param. Note search integrated into `q` param. Streaming JSON/ZIP export with `ids` selection filter.

### Frontend (`static/`, `templates/`)

Single `index.html` with `app.js` and `style.css`. No framework, no bundler. Chart.js loaded from CDN with fallback.

Navigation bar with 5 sections: 对话, Skills, MCP, Rules, Plugins.

- **Sessions section** — Two view modes: "list" (grouped by project/time/model) and "detail" (full-screen conversation with foldable tool calls, thinking, tokens). Filters: 全部/Claude/Codex/收藏. Pagination. Batch operations (right-click to enter). Favorite stars. Note indicators.
- **Config sections** — All grouped by scope (用户级/项目级). Skills and Plugins have sub-groups. Skills and Rules have detail views. Rules support inline editing.
- **Dark mode** — Toggle button in header, persisted in localStorage. CSS variables override via `[data-theme="dark"]`.
- **Error handling** — Unified `apiCall()`/`apiJson()`/`apiText()` wrappers with `resp.ok` checking. Toast notification system.
- **SSE** — `EventSource` on `/api/events` for real-time session change notifications.

### Key patterns

- Claude JSONL entries have `type` field (user, assistant, system, ai-title, etc.). Assistant messages contain `message.content` as either string or list of blocks (text, thinking, tool_use). User messages may contain `tool_result` blocks that reference `tool_use_id`.
- Codex rollout entries have `type` (response_item, event_msg) with `payload`. `event_msg` subtypes include exec_command_begin/end, token_count, task_complete, error.
- All parsers use precise exception types (`OSError`, `json.JSONDecodeError`, `sqlite3.Error`) with `logger.warning`/`logger.debug` — no bare `except Exception: pass`.
- Deletion uses `send2trash` (recycle bin), not permanent delete. Codex delete aborts DB removal if file trash fails (prevents DB/filesystem desync).
- The `source` parameter ("claude" or "codex") is required for all per-session API endpoints.
- Project directory names are encoded: `D--session-manager` → `D:\session_manager` (drive letter + `--` + path with `-` replacing `_`).
