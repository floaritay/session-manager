from __future__ import annotations

import json
import os
from pathlib import Path

from app.models import SkillSummary


class SkillsParser:
    def __init__(self):
        self.cache_dir = Path.home() / ".claude" / "plugins" / "cache"
        self.plugins_dir = Path.home() / ".claude" / "plugins"

    def _get_installed_paths(self) -> list[Path]:
        """Get installed plugin paths from installed_plugins.json."""
        installed_path = self.plugins_dir / "installed_plugins.json"
        if not installed_path.exists():
            return []
        try:
            data = json.loads(installed_path.read_text(encoding="utf-8"))
            paths = []
            for key, entry in data.get("plugins", {}).items():
                if isinstance(entry, list):
                    entry = entry[0] if entry else {}
                install_path = entry.get("installPath", "")
                if install_path:
                    paths.append(Path(install_path))
            return paths
        except Exception:
            return []

    def list_skills(self) -> list[SkillSummary]:
        if not self.cache_dir.exists():
            return []

        # Only scan installed plugin paths to avoid duplicates from old cache versions
        installed_paths = self._get_installed_paths()
        skill_files: list[Path] = []

        if installed_paths:
            for plugin_path in installed_paths:
                skills_dir = plugin_path / "skills"
                if skills_dir.exists():
                    for skill_dir in skills_dir.iterdir():
                        if skill_dir.is_dir():
                            skill_md = skill_dir / "SKILL.md"
                            if skill_md.exists():
                                skill_files.append(skill_md)
        else:
            # fallback: scan entire cache
            skill_files = list(self.cache_dir.rglob("skills/*/SKILL.md"))

        skills: list[SkillSummary] = []
        for skill_md in skill_files:
            try:
                skill = self._parse_skill_md(skill_md)
                if skill:
                    skills.append(skill)
            except Exception:
                continue

        skills.sort(key=lambda s: (s.plugin_name, s.name))
        return skills

    def get_skill(self, skill_id: str) -> SkillSummary | None:
        for skill in self.list_skills():
            if skill.id == skill_id:
                return skill
        return None

    def get_skill_body(self, skill_id: str) -> str:
        skill = self.get_skill(skill_id)
        if not skill:
            return ""
        try:
            content = Path(skill.file_path).read_text(encoding="utf-8")
            _, body = self._split_frontmatter(content)
            return body
        except Exception:
            return ""

    def _parse_skill_md(self, path: Path) -> SkillSummary | None:
        content = path.read_text(encoding="utf-8")
        frontmatter, body = self._split_frontmatter(content)

        name = frontmatter.get("name", path.parent.name)
        description = frontmatter.get("description", "")
        license_text = frontmatter.get("license", "")

        # derive plugin_name and marketplace from path
        # path: cache/<marketplace>/<plugin>/<hash>/skills/<name>/SKILL.md
        parts = path.parts
        try:
            cache_idx = parts.index("cache")
            marketplace = parts[cache_idx + 1]
            plugin_name = parts[cache_idx + 2]
        except (ValueError, IndexError):
            marketplace = "unknown"
            plugin_name = "unknown"

        skill_id = f"{name}@{marketplace}/{plugin_name}"
        body_preview = body[:200].strip()
        if len(body) > 200:
            body_preview += "..."

        return SkillSummary(
            id=skill_id,
            name=name,
            description=description,
            license=license_text,
            plugin_name=plugin_name,
            marketplace=marketplace,
            file_path=str(path),
            body_preview=body_preview,
            scope="user",
        )

    def _split_frontmatter(self, content: str) -> tuple[dict[str, str], str]:
        """Parse YAML frontmatter between --- delimiters."""
        frontmatter: dict[str, str] = {}
        body = content

        if content.startswith("---"):
            parts = content.split("---", 2)
            if len(parts) >= 3:
                fm_text = parts[1].strip()
                body = parts[2].strip()
                for line in fm_text.splitlines():
                    if ":" in line:
                        key, _, value = line.partition(":")
                        key = key.strip()
                        value = value.strip().strip('"').strip("'")
                        frontmatter[key] = value

        return frontmatter, body
