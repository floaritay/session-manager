from __future__ import annotations

import json
from pathlib import Path

from app.models import PluginSummary


class PluginsParser:
    def __init__(self):
        self.plugins_dir = Path.home() / ".claude" / "plugins"
        self.settings_path = Path.home() / ".claude" / "settings.json"

    def list_plugins(self) -> list[PluginSummary]:
        plugins: list[PluginSummary] = []

        # Read installed plugins
        installed_path = self.plugins_dir / "installed_plugins.json"
        if not installed_path.exists():
            return []

        try:
            installed = json.loads(installed_path.read_text(encoding="utf-8"))
        except Exception:
            return []

        # Read enabled plugins from settings
        enabled_map = self._read_enabled_plugins()

        # Read blocklist
        blocked_map = self._read_blocklist()

        plugins_dict = installed.get("plugins", {})
        for plugin_key, entry in plugins_dict.items():
            # plugin_key format: "name@marketplace"
            if "@" not in plugin_key:
                continue

            # entry can be a dict or a list of dicts
            if isinstance(entry, list):
                entry = entry[0] if entry else {}

            name, _, marketplace = plugin_key.partition("@")
            install_path = entry.get("installPath", "")
            version = entry.get("version", "")
            installed_at = entry.get("installedAt", "")

            # Read plugin.json for metadata
            description = ""
            author = ""
            if install_path:
                plugin_json = Path(install_path) / ".claude-plugin" / "plugin.json"
                if plugin_json.exists():
                    try:
                        meta = json.loads(plugin_json.read_text(encoding="utf-8"))
                        description = meta.get("description", "")
                        author_obj = meta.get("author", {})
                        if isinstance(author_obj, dict):
                            author = author_obj.get("name", "")
                        elif isinstance(author_obj, str):
                            author = author_obj
                    except Exception:
                        pass

            # Count skills
            skill_count = 0
            if install_path:
                skills_dir = Path(install_path) / "skills"
                if skills_dir.exists():
                    skill_count = sum(1 for d in skills_dir.iterdir() if d.is_dir() and (d / "SKILL.md").exists())

            plugins.append(PluginSummary(
                id=plugin_key,
                name=name,
                description=description,
                author=author,
                marketplace=marketplace,
                version=version,
                enabled=enabled_map.get(plugin_key, False),
                blocked=plugin_key in blocked_map,
                installed_at=installed_at,
                skill_count=skill_count,
                install_path=install_path,
                scope="user",
            ))

        plugins.sort(key=lambda p: p.name)
        return plugins

    def _read_enabled_plugins(self) -> dict[str, bool]:
        if not self.settings_path.exists():
            return {}
        try:
            settings = json.loads(self.settings_path.read_text(encoding="utf-8"))
            return settings.get("enabledPlugins", {})
        except Exception:
            return {}

    def _read_blocklist(self) -> dict[str, dict]:
        blocklist_path = self.plugins_dir / "blocklist.json"
        if not blocklist_path.exists():
            return {}
        try:
            data = json.loads(blocklist_path.read_text(encoding="utf-8"))
            result = {}
            for item in data.get("plugins", []):
                result[item.get("plugin", "")] = item
            return result
        except Exception:
            return {}
