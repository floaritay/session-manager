# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
pip install -r requirements.txt   # install dependencies
python main.py                     # start server on http://127.0.0.1:8765
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
```

### Backend (`app/`)

- **`models.py`** — Pydantic models: `SessionSummary`, `Message`, `ToolCall`, `TokenUsage`, `SkillSummary`, `McpServerSummary`, `RuleSummary`, `PluginSummary`
- **`parsers/base.py`** — Abstract `SessionParser` with `list_sessions()`, `get_messages()`, `delete_session()`
- **`parsers/claude_parser.py`** — Two-pass JSONL parser. First pass extracts session metadata (ai-title, duration, git_branch, timestamps). Second pass builds messages with tool_result matching via `pending_tool_calls` dict. Also has `list_subagents()` for subagent JSONL files.
- **`parsers/codex_parser.py`** — Reads sessions from SQLite `threads` table, parses rollout JSONL for messages. Handles `exec_command_begin/end` events as ToolCall objects.
- **`parsers/skills_parser.py`** — Reads SKILL.md files from installed plugin paths only (not all cache). Parses YAML frontmatter. Deduplicates by reading `installed_plugins.json`.
- **`parsers/mcp_parser.py`** — Reads MCP configs from marketplace external_plugins, settings.json mcpServers, and project-level .mcp.json/settings.local.json. Detects transport type (stdio/http/sse).
- **`parsers/rules_parser.py`** — Reads global `~/.CLAUDE.md` and project-level CLAUDE.md + settings.local.json. Decodes project paths from directory names (e.g. `D--session-manager` → `D:\session_manager`).
- **`parsers/plugins_parser.py`** — Reads installed_plugins.json, settings.json enabledPlugins, blocklist.json. Handles both dict and list formats for plugin entries.
- **`services/session_service.py`** — Merges Claude + Codex parsers, adds `get_stats()`, `search_sessions()`, `export_session()`. Stats are cached for 60s.
- **`services/config_service.py`** — Merges 4 config parsers. All list methods cached for 60s. Supports search filtering.
- **`server.py`** — FastAPI routes for both session and config management.

### Frontend (`static/`, `templates/`)

Single `index.html` with `app.js` and `style.css`. No framework, no bundler.

Navigation bar with 5 sections: 对话, Skills, MCP, Rules, Plugins.

- **Sessions section** — Two view modes: "list" (grouped by project/time/model) and "detail" (conversation with foldable tool calls, thinking, tokens). Message metadata renders as a compact info line below each message.
- **Config sections** — All grouped by scope (用户级/项目级). Skills and Plugins have sub-groups (by plugin name / marketplace). Skills and Rules have detail views.

`state.activeSection` controls which section is displayed. `state.viewMode` controls list vs detail within a section.

### Key patterns

- Claude JSONL entries have `type` field (user, assistant, system, ai-title, etc.). Assistant messages contain `message.content` as either string or list of blocks (text, thinking, tool_use). User messages may contain `tool_result` blocks that reference `tool_use_id`.
- Codex rollout entries have `type` (response_item, event_msg) with `payload`. `event_msg` subtypes include exec_command_begin/end, token_count, task_complete, error.
- Deletion uses `send2trash` (recycle bin), not permanent delete. Codex delete always removes from SQLite even if rollout file is missing.
- The `source` parameter ("claude" or "codex") is required for all per-session API endpoints.
- Config parsers use `scope` field: "user" for global configs, "project" for project-level. SkillsParser only reads from `installed_plugins.json` paths to avoid cache duplicates.
- Project directory names are encoded: `D--session-manager` → `D:\session_manager` (drive letter + `--` + path with `-` replacing `_`).
