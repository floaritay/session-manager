from __future__ import annotations

import json
import logging
from pathlib import Path

from app.models import RuleSummary
from app.parsers.utils import decode_project_path

logger = logging.getLogger(__name__)


class RulesParser:
    def __init__(self):
        self.claude_dir = Path.home() / ".claude"
        self.global_claude_md = Path.home() / "CLAUDE.md"

    def list_rules(self) -> list[RuleSummary]:
        rules: list[RuleSummary] = []

        # 1. Global CLAUDE.md
        if self.global_claude_md.exists():
            try:
                content = self.global_claude_md.read_text(encoding="utf-8")
                rules.append(RuleSummary(
                    id="user:CLAUDE.md",
                    name="~/.CLAUDE.md",
                    scope="user",
                    file_path=str(self.global_claude_md),
                    content_preview=content[:300].strip(),
                    content_length=len(content),
                ))
            except (OSError, UnicodeDecodeError) as e:
                logger.debug("Failed to read global CLAUDE.md: %s", e)

        # 2. Project-level rules
        projects_dir = self.claude_dir / "projects"
        if projects_dir.exists():
            for project_dir in projects_dir.iterdir():
                if not project_dir.is_dir():
                    continue
                encoded_path = project_dir.name
                project_path = decode_project_path(encoded_path)

                # Check for CLAUDE.md in the project
                claude_md = Path(project_path) / "CLAUDE.md"
                if claude_md.exists():
                    try:
                        content = claude_md.read_text(encoding="utf-8")
                        rules.append(RuleSummary(
                            id=f"project:{encoded_path}:CLAUDE.md",
                            name=f"{project_path}/CLAUDE.md",
                            scope="project",
                            file_path=str(claude_md),
                            content_preview=content[:300].strip(),
                            content_length=len(content),
                            project_path=project_path,
                        ))
                    except (OSError, UnicodeDecodeError) as e:
                        logger.debug("Failed to read project CLAUDE.md %s: %s", claude_md, e)

                # Check for settings.local.json
                settings_local = Path(project_path) / ".claude" / "settings.local.json"
                if settings_local.exists():
                    try:
                        content = settings_local.read_text(encoding="utf-8")
                        rules.append(RuleSummary(
                            id=f"project:{encoded_path}:settings.local.json",
                            name=f"{project_path}/.claude/settings.local.json",
                            scope="project",
                            file_path=str(settings_local),
                            content_preview=content[:300].strip(),
                            content_length=len(content),
                            project_path=project_path,
                        ))
                    except (OSError, UnicodeDecodeError) as e:
                        logger.debug("Failed to read settings.local.json %s: %s", settings_local, e)

        rules.sort(key=lambda r: (0 if r.scope == "user" else 1, r.name))
        return rules

    def get_rule_content(self, rule_id: str) -> str:
        rules = self.list_rules()
        for rule in rules:
            if rule.id == rule_id:
                try:
                    return Path(rule.file_path).read_text(encoding="utf-8")
                except (OSError, UnicodeDecodeError) as e:
                    logger.debug("Failed to read rule %s: %s", rule_id, e)
                    return ""
        return ""

