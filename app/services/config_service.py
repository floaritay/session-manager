from __future__ import annotations

import time

from app.models import McpServerSummary, PluginSummary, RuleSummary, SkillSummary
from app.parsers.mcp_parser import McpParser
from app.parsers.plugins_parser import PluginsParser
from app.parsers.rules_parser import RulesParser
from app.parsers.skills_parser import SkillsParser


class ConfigService:
    def __init__(self):
        self.skills_parser = SkillsParser()
        self.mcp_parser = McpParser()
        self.rules_parser = RulesParser()
        self.plugins_parser = PluginsParser()
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

    def list_skills(self, q: str | None = None) -> list[SkillSummary]:
        skills = self._get_cached("skills", self.skills_parser.list_skills)
        if q:
            q_lower = q.lower()
            skills = [s for s in skills if q_lower in s.name.lower() or q_lower in s.description.lower()]
        return skills

    def get_skill(self, skill_id: str) -> SkillSummary | None:
        return self.skills_parser.get_skill(skill_id)

    def get_skill_body(self, skill_id: str) -> str:
        return self.skills_parser.get_skill_body(skill_id)

    def list_servers(self, q: str | None = None) -> list[McpServerSummary]:
        servers = self._get_cached("mcp", self.mcp_parser.list_servers)
        if q:
            q_lower = q.lower()
            servers = [s for s in servers if q_lower in s.name.lower() or q_lower in s.url.lower() or q_lower in s.command.lower()]
        return servers

    def list_rules(self, scope: str | None = None, q: str | None = None) -> list[RuleSummary]:
        rules = self._get_cached("rules", self.rules_parser.list_rules)
        if scope:
            rules = [r for r in rules if r.scope == scope]
        if q:
            q_lower = q.lower()
            rules = [r for r in rules if q_lower in r.name.lower() or q_lower in r.content_preview.lower()]
        return rules

    def get_rule_content(self, rule_id: str) -> str:
        return self.rules_parser.get_rule_content(rule_id)

    def list_plugins(self, q: str | None = None) -> list[PluginSummary]:
        plugins = self._get_cached("plugins", self.plugins_parser.list_plugins)
        if q:
            q_lower = q.lower()
            plugins = [p for p in plugins if q_lower in p.name.lower() or q_lower in p.description.lower()]
        return plugins

    def get_config_stats(self) -> dict:
        def _load():
            skills = self.list_skills()
            servers = self.list_servers()
            rules = self.list_rules()
            plugins = self.list_plugins()
            return {
                "total_skills": len(skills),
                "total_servers": len(servers),
                "total_rules": len(rules),
                "total_plugins": len(plugins),
                "enabled_plugins": sum(1 for p in plugins if p.enabled),
            }
        return self._get_cached("config_stats", _load)
