from __future__ import annotations

import json
from pathlib import Path

from app.models import McpServerSummary


class McpParser:
    def __init__(self):
        self.marketplaces_dir = Path.home() / ".claude" / "plugins" / "marketplaces"
        self.settings_path = Path.home() / ".claude" / "settings.json"
        self.projects_dir = Path.home() / ".claude" / "projects"

    def _decode_project_path(self, encoded: str) -> str:
        if "--" in encoded:
            parts = encoded.split("--", 1)
            drive = parts[0]
            rest = parts[1].replace("-", "_")
            return f"{drive}:\\{rest}"
        return encoded

    def list_servers(self) -> list[McpServerSummary]:
        servers: list[McpServerSummary] = []
        seen_ids: set[str] = set()

        # 1. Scan external_plugins in marketplaces (user-level)
        if self.marketplaces_dir.exists():
            for marketplace_dir in self.marketplaces_dir.iterdir():
                if not marketplace_dir.is_dir():
                    continue
                ext_plugins = marketplace_dir / "external_plugins"
                if not ext_plugins.exists():
                    continue
                for plugin_dir in ext_plugins.iterdir():
                    if not plugin_dir.is_dir():
                        continue
                    mcp_file = plugin_dir / ".mcp.json"
                    if mcp_file.exists():
                        for s in self._parse_mcp_file(mcp_file, marketplace_dir.name, "user"):
                            if s.id not in seen_ids:
                                servers.append(s)
                                seen_ids.add(s.id)

        # 2. Check settings.json for mcpServers (user-level)
        if self.settings_path.exists():
            try:
                settings = json.loads(self.settings_path.read_text(encoding="utf-8"))
                mcp_servers = settings.get("mcpServers", {})
                for name, config in mcp_servers.items():
                    if isinstance(config, dict):
                        s = self._make_summary(name, config, "settings", str(self.settings_path), "user")
                        if s.id not in seen_ids:
                            servers.append(s)
                            seen_ids.add(s.id)
            except Exception:
                pass

        # 3. Scan project directories for .mcp.json (project-level)
        if self.projects_dir.exists():
            for project_dir in self.projects_dir.iterdir():
                if not project_dir.is_dir():
                    continue
                project_path = self._decode_project_path(project_dir.name)
                mcp_file = project_dir / ".mcp.json"
                if mcp_file.exists():
                    for s in self._parse_mcp_file(mcp_file, project_dir.name, "project", project_path):
                        servers.append(s)
                # Also check settings.local.json for mcpServers
                settings_local = project_dir / "settings.local.json"
                if settings_local.exists():
                    try:
                        sl = json.loads(settings_local.read_text(encoding="utf-8"))
                        mcp = sl.get("mcpServers", {})
                        for name, config in mcp.items():
                            if isinstance(config, dict):
                                s = self._make_summary(name, config, project_dir.name, str(settings_local), "project", project_path)
                                servers.append(s)
                    except Exception:
                        pass

        servers.sort(key=lambda s: (0 if s.scope == "user" else 1, s.name))
        return servers

    def _parse_mcp_file(self, path: Path, marketplace: str, scope: str = "user", project_path: str = "") -> list[McpServerSummary]:
        servers: list[McpServerSummary] = []
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            for name, config in data.items():
                if isinstance(config, dict):
                    servers.append(self._make_summary(name, config, marketplace, str(path), scope, project_path))
        except Exception:
            pass
        return servers

    def _make_summary(self, name: str, config: dict, marketplace: str, source_file: str, scope: str = "user", project_path: str = "") -> McpServerSummary:
        server_id = f"{name}@{marketplace}"

        if "command" in config:
            transport_type = "stdio"
            command = config.get("command", "")
            args = config.get("args", [])
            return McpServerSummary(
                id=server_id, name=name, transport_type=transport_type,
                command=command, args=args, marketplace=marketplace, source_file=source_file,
                scope=scope, project_path=project_path,
            )
        elif config.get("type") == "http":
            return McpServerSummary(
                id=server_id, name=name, transport_type="http",
                url=config.get("url", ""), headers=config.get("headers", {}),
                marketplace=marketplace, source_file=source_file,
                scope=scope, project_path=project_path,
            )
        elif config.get("type") == "sse":
            return McpServerSummary(
                id=server_id, name=name, transport_type="sse",
                url=config.get("url", ""),
                marketplace=marketplace, source_file=source_file,
                scope=scope, project_path=project_path,
            )
        else:
            return McpServerSummary(
                id=server_id, name=name, transport_type="unknown",
                marketplace=marketplace, source_file=source_file,
                scope=scope, project_path=project_path,
            )
