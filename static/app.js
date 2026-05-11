/* ═══════════════════════════════════════════════
   Session Manager — Client
   ═══════════════════════════════════════════════ */

const state = {
    sessions: [],
    currentSource: null,
    currentSession: null,
    searchQuery: "",
    searchTimer: null,
    viewMode: "list",       // "list" | "detail"
    groupBy: "project",     // "project" | "time" | "model"
    collapsedGroups: new Set(),

    // Config management
    activeSection: "sessions",  // "sessions" | "skills" | "mcp" | "rules" | "plugins"
    skills: [],
    mcpServers: [],
    rules: [],
    plugins: [],
    configStats: null,
};

// ── API ──
async function fetchSessions(source, q) {
    const params = new URLSearchParams();
    if (source && source !== "all") params.set("source", source);
    if (q) params.set("q", q);
    const qs = params.toString();
    const resp = await fetch(`/api/sessions${qs ? "?" + qs : ""}`);
    return resp.json();
}

async function fetchMessages(source, id) {
    const resp = await fetch(`/api/sessions/${source}/${id}`);
    return resp.json();
}

async function deleteSession(source, id) {
    const resp = await fetch(`/api/sessions/${source}/${id}`, { method: "DELETE" });
    return resp.json();
}

async function fetchStats() {
    const resp = await fetch("/api/stats");
    return resp.json();
}

async function fetchSubagents(source, id) {
    const resp = await fetch(`/api/sessions/${source}/${id}/subagents`);
    return resp.json();
}

// ── Config API ──
async function fetchSkills(q) {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    const qs = params.toString();
    const resp = await fetch(`/api/skills${qs ? "?" + qs : ""}`);
    return resp.json();
}

async function fetchSkillBody(skillId) {
    const resp = await fetch(`/api/skills/${encodeURIComponent(skillId)}/body`);
    return resp.text();
}

async function fetchMcpServers(q) {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    const qs = params.toString();
    const resp = await fetch(`/api/mcp${qs ? "?" + qs : ""}`);
    return resp.json();
}

async function fetchRules(scope, q) {
    const params = new URLSearchParams();
    if (scope) params.set("scope", scope);
    if (q) params.set("q", q);
    const qs = params.toString();
    const resp = await fetch(`/api/rules${qs ? "?" + qs : ""}`);
    return resp.json();
}

async function fetchRuleContent(ruleId) {
    const resp = await fetch(`/api/rules/${encodeURIComponent(ruleId)}/content`);
    return resp.text();
}

async function fetchPlugins(q) {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    const qs = params.toString();
    const resp = await fetch(`/api/plugins${qs ? "?" + qs : ""}`);
    return resp.json();
}

async function fetchConfigStats() {
    const resp = await fetch("/api/config/stats");
    return resp.json();
}

// ── Stats ──
function renderStats(stats) {
    if (!stats) return;
    document.getElementById("stat-sessions").textContent = stats.total_sessions.toLocaleString();
    document.getElementById("stat-messages").textContent = stats.total_messages.toLocaleString();
    const totalTokens = stats.total_input_tokens + stats.total_output_tokens;
    document.getElementById("stat-tokens").textContent = totalTokens > 0 ? formatTokenCount(totalTokens) : "0";

    const toolsEl = document.getElementById("stat-tools");
    if (stats.top_tools?.length > 0) {
        toolsEl.innerHTML = stats.top_tools.slice(0, 5).map(
            (t) => `<span class="tool-pill">${escapeHtml(t.name)} <span class="tool-count">${t.count}</span></span>`
        ).join("");
    } else {
        toolsEl.textContent = "--";
    }
}

function renderConfigStats(stats) {
    if (!stats) return;
    document.getElementById("stat-sessions").textContent = stats.total_skills;
    document.getElementById("stat-messages").textContent = stats.total_servers;
    document.getElementById("stat-tokens").textContent = stats.total_rules;
    document.getElementById("stat-tools").innerHTML = `<span>${stats.enabled_plugins} / ${stats.total_plugins} 插件已启用</span>`;
}

// ── Skills List View ──
function renderSkillsListView() {
    state.viewMode = "list";
    const content = document.getElementById("content");
    const skills = state.skills;

    if (skills.length === 0) {
        content.innerHTML = `<div class="empty-state"><div class="empty-title">没有找到 Skills</div></div>`;
        return;
    }

    // group by scope first, then by plugin_name
    const scopeGroups = {};
    for (const s of skills) {
        const scopeKey = s.scope === "user" ? "用户级" : "项目级";
        if (!scopeGroups[scopeKey]) scopeGroups[scopeKey] = [];
        scopeGroups[scopeKey].push(s);
    }

    let html = `<div class="list-view">`;
    for (const scopeName of ["用户级", "项目级"]) {
        const scopeItems = scopeGroups[scopeName];
        if (!scopeItems) continue;

        const scopeCollapsed = state.collapsedGroups.has(scopeName);
        html += `
            <div class="group" data-group="${escapeAttr(scopeName)}">
                <div class="group-header ${scopeCollapsed ? "collapsed" : ""}">
                    <span class="group-arrow">${scopeCollapsed ? "▸" : "▾"}</span>
                    <span class="group-name">${escapeHtml(scopeName)}</span>
                    <span class="group-count">${scopeItems.length}</span>
                </div>
                <div class="group-items" ${scopeCollapsed ? 'style="display:none"' : ""}>`;

        // sub-group by plugin_name
        const pluginGroups = {};
        for (const s of scopeItems) {
            const key = s.plugin_name;
            if (!pluginGroups[key]) pluginGroups[key] = [];
            pluginGroups[key].push(s);
        }

        for (const pluginName of Object.keys(pluginGroups).sort()) {
            const items = pluginGroups[pluginName];
            const collapsed = state.collapsedGroups.has(`${scopeName}/${pluginName}`);
            html += `
                <div class="group" data-group="${escapeAttr(scopeName + "/" + pluginName)}">
                    <div class="group-header ${collapsed ? "collapsed" : ""}">
                        <span class="group-arrow">${collapsed ? "▸" : "▾"}</span>
                        <span class="group-name">${escapeHtml(pluginName)}</span>
                        <span class="group-count">${items.length}</span>
                    </div>
                    <div class="group-items" ${collapsed ? 'style="display:none"' : ""}>`;

            for (const s of items) {
                html += `
                    <div class="session-row" data-id="${escapeAttr(s.id)}" data-type="skill">
                        <div class="row-title">${escapeHtml(s.name)}</div>
                        <div class="row-meta">
                            <span class="source-tag skill">${escapeHtml(s.marketplace)}</span>
                            <span class="row-date">${escapeHtml(s.description.slice(0, 60))}${s.description.length > 60 ? "..." : ""}</span>
                        </div>
                    </div>`;
            }
            html += `</div></div>`;
        }
        html += `</div></div>`;
    }
    html += `</div>`;
    content.innerHTML = html;

    // bind group headers
    content.querySelectorAll(".group-header").forEach((el) => {
        el.addEventListener("click", () => {
            const group = el.closest(".group").dataset.group;
            if (state.collapsedGroups.has(group)) state.collapsedGroups.delete(group);
            else state.collapsedGroups.add(group);
            renderSkillsListView();
        });
    });

    // bind rows
    content.querySelectorAll(".session-row").forEach((el) => {
        el.addEventListener("click", () => loadSkillDetail(el.dataset.id));
    });
}

// ── Skill Detail ──
async function loadSkillDetail(skillId) {
    state.viewMode = "detail";
    const content = document.getElementById("content");
    content.innerHTML = '<div class="loading-state">加载中</div>';

    try {
        const body = await fetchSkillBody(skillId);
        const skill = state.skills.find(s => s.id === skillId);

        let html = `<div class="detail-view">`;
        html += `<div class="detail-header">`;
        html += `<div class="detail-top">`;
        html += `<button class="back-btn">返回</button>`;
        html += `<div class="detail-title">${escapeHtml(skill?.name || skillId)}</div>`;
        html += `</div>`;
        html += `<div class="detail-meta">`;
        html += `<span class="source-tag skill">${escapeHtml(skill?.marketplace || "")}</span>`;
        html += `<span>${escapeHtml(skill?.plugin_name || "")}</span>`;
        if (skill?.license) html += `<span>License: ${escapeHtml(skill.license)}</span>`;
        html += `</div></div>`;
        html += `<div class="detail-content">${renderMarkdown(body)}</div>`;
        html += `</div>`;
        content.innerHTML = html;

        content.querySelector(".back-btn")?.addEventListener("click", () => {
            state.viewMode = "list";
            renderSkillsListView();
        });
    } catch (err) {
        content.innerHTML = `<div class="empty-state"><div class="empty-title">${escapeHtml(err.message)}</div></div>`;
    }
}

// ── MCP List View ──
function renderMcpListView() {
    state.viewMode = "list";
    const content = document.getElementById("content");
    const servers = state.mcpServers;

    if (servers.length === 0) {
        content.innerHTML = `<div class="empty-state"><div class="empty-title">没有找到 MCP 服务器</div></div>`;
        return;
    }

    // group by scope first, then by transport_type
    const scopeGroups = {};
    for (const s of servers) {
        const scopeKey = s.scope === "user" ? "用户级" : `项目级 — ${s.project_path || s.marketplace}`;
        if (!scopeGroups[scopeKey]) scopeGroups[scopeKey] = [];
        scopeGroups[scopeKey].push(s);
    }

    let html = `<div class="list-view">`;
    for (const scopeName of Object.keys(scopeGroups).sort((a, b) => {
        if (a.startsWith("用户级")) return -1;
        if (b.startsWith("用户级")) return 1;
        return a.localeCompare(b);
    })) {
        const scopeItems = scopeGroups[scopeName];
        const scopeCollapsed = state.collapsedGroups.has(scopeName);
        html += `
            <div class="group" data-group="${escapeAttr(scopeName)}">
                <div class="group-header ${scopeCollapsed ? "collapsed" : ""}">
                    <span class="group-arrow">${scopeCollapsed ? "▸" : "▾"}</span>
                    <span class="group-name">${escapeHtml(scopeName)}</span>
                    <span class="group-count">${scopeItems.length}</span>
                </div>
                <div class="group-items" ${scopeCollapsed ? 'style="display:none"' : ""}>`;

        for (const s of scopeItems) {
            const detail = s.transport_type === "stdio" ? `${s.command} ${s.args.join(" ")}` : s.url;
            html += `
                <div class="session-row">
                    <div class="row-title">${escapeHtml(s.name)}</div>
                    <div class="row-meta">
                        <span class="source-tag ${s.transport_type}">${s.transport_type}</span>
                        <span class="row-date">${escapeHtml(detail.slice(0, 80))}${detail.length > 80 ? "..." : ""}</span>
                    </div>
                </div>`;
        }
        html += `</div></div>`;
    }
    html += `</div>`;
    content.innerHTML = html;

    // bind group headers
    content.querySelectorAll(".group-header").forEach((el) => {
        el.addEventListener("click", () => {
            const group = el.closest(".group").dataset.group;
            if (state.collapsedGroups.has(group)) state.collapsedGroups.delete(group);
            else state.collapsedGroups.add(group);
            renderMcpListView();
        });
    });
}

// ── Rules List View ──
function renderRulesListView() {
    state.viewMode = "list";
    const content = document.getElementById("content");
    const rules = state.rules;

    if (rules.length === 0) {
        content.innerHTML = `<div class="empty-state"><div class="empty-title">没有找到 Rules</div></div>`;
        return;
    }

    const groups = {};
    for (const r of rules) {
        const key = r.scope === "user" ? "用户级" : `项目级 — ${r.project_path || ""}`;
        if (!groups[key]) groups[key] = [];
        groups[key].push(r);
    }

    let html = `<div class="list-view">`;
    for (const groupName of Object.keys(groups).sort((a, b) => {
        if (a.startsWith("用户级")) return -1;
        if (b.startsWith("用户级")) return 1;
        return a.localeCompare(b);
    })) {
        const items = groups[groupName];
        const collapsed = state.collapsedGroups.has(groupName);
        html += `
            <div class="group" data-group="${escapeAttr(groupName)}">
                <div class="group-header ${collapsed ? "collapsed" : ""}">
                    <span class="group-arrow">${collapsed ? "▸" : "▾"}</span>
                    <span class="group-name">${escapeHtml(groupName)}</span>
                    <span class="group-count">${items.length}</span>
                </div>
                <div class="group-items" ${collapsed ? 'style="display:none"' : ""}>`;

        for (const r of items) {
            html += `
                <div class="session-row" data-id="${escapeAttr(r.id)}" data-type="rule">
                    <div class="row-title">${escapeHtml(r.name)}</div>
                    <div class="row-meta">
                        <span class="source-tag ${r.scope}">${r.scope === "user" ? "用户" : "项目"}</span>
                        <span class="row-date">${r.content_length.toLocaleString()} 字符</span>
                    </div>
                </div>`;
        }
        html += `</div></div>`;
    }
    html += `</div>`;
    content.innerHTML = html;

    // bind group headers
    content.querySelectorAll(".group-header").forEach((el) => {
        el.addEventListener("click", () => {
            const group = el.closest(".group").dataset.group;
            if (state.collapsedGroups.has(group)) state.collapsedGroups.delete(group);
            else state.collapsedGroups.add(group);
            renderRulesListView();
        });
    });

    // bind rows
    content.querySelectorAll(".session-row").forEach((el) => {
        el.addEventListener("click", () => loadRuleDetail(el.dataset.id));
    });
}

// ── Rule Detail ──
async function loadRuleDetail(ruleId) {
    state.viewMode = "detail";
    const content = document.getElementById("content");
    content.innerHTML = '<div class="loading-state">加载中</div>';

    try {
        const body = await fetchRuleContent(ruleId);
        const rule = state.rules.find(r => r.id === ruleId);

        let html = `<div class="detail-view">`;
        html += `<div class="detail-header">`;
        html += `<div class="detail-top">`;
        html += `<button class="back-btn">返回</button>`;
        html += `<div class="detail-title">${escapeHtml(rule?.name || ruleId)}</div>`;
        html += `</div>`;
        html += `<div class="detail-meta">`;
        html += `<span class="source-tag ${rule?.scope || ""}">${rule?.scope || ""}</span>`;
        html += `<span>${body.length.toLocaleString()} 字符</span>`;
        html += `</div></div>`;
        html += `<div class="detail-content">${escapeHtml(body)}</div>`;
        html += `</div>`;
        content.innerHTML = html;

        content.querySelector(".back-btn")?.addEventListener("click", () => {
            state.viewMode = "list";
            renderRulesListView();
        });
    } catch (err) {
        content.innerHTML = `<div class="empty-state"><div class="empty-title">${escapeHtml(err.message)}</div></div>`;
    }
}

// ── Plugins List View ──
function renderPluginsListView() {
    state.viewMode = "list";
    const content = document.getElementById("content");
    const plugins = state.plugins;

    if (plugins.length === 0) {
        content.innerHTML = `<div class="empty-state"><div class="empty-title">没有找到 Plugins</div></div>`;
        return;
    }

    // group by scope first, then by marketplace
    const scopeGroups = {};
    for (const p of plugins) {
        const scopeKey = p.scope === "user" ? "用户级" : "项目级";
        if (!scopeGroups[scopeKey]) scopeGroups[scopeKey] = [];
        scopeGroups[scopeKey].push(p);
    }

    let html = `<div class="list-view">`;
    for (const scopeName of ["用户级", "项目级"]) {
        const scopeItems = scopeGroups[scopeName];
        if (!scopeItems) continue;

        const scopeCollapsed = state.collapsedGroups.has(scopeName);
        html += `
            <div class="group" data-group="${escapeAttr(scopeName)}">
                <div class="group-header ${scopeCollapsed ? "collapsed" : ""}">
                    <span class="group-arrow">${scopeCollapsed ? "▸" : "▾"}</span>
                    <span class="group-name">${escapeHtml(scopeName)}</span>
                    <span class="group-count">${scopeItems.length}</span>
                </div>
                <div class="group-items" ${scopeCollapsed ? 'style="display:none"' : ""}>`;

        // sub-group by marketplace
        const marketplaceGroups = {};
        for (const p of scopeItems) {
            const key = p.marketplace;
            if (!marketplaceGroups[key]) marketplaceGroups[key] = [];
            marketplaceGroups[key].push(p);
        }

        for (const mktName of Object.keys(marketplaceGroups).sort()) {
            const items = marketplaceGroups[mktName];
            const collapsed = state.collapsedGroups.has(`${scopeName}/${mktName}`);
            html += `
                <div class="group" data-group="${escapeAttr(scopeName + "/" + mktName)}">
                    <div class="group-header ${collapsed ? "collapsed" : ""}">
                        <span class="group-arrow">${collapsed ? "▸" : "▾"}</span>
                        <span class="group-name">${escapeHtml(mktName)}</span>
                        <span class="group-count">${items.length}</span>
                    </div>
                    <div class="group-items" ${collapsed ? 'style="display:none"' : ""}>`;

            for (const p of items) {
                const statusTag = p.blocked
                    ? `<span class="source-tag blocked">blocked</span>`
                    : p.enabled
                        ? `<span class="source-tag enabled">enabled</span>`
                        : `<span class="source-tag">disabled</span>`;
                html += `
                    <div class="session-row">
                        <div class="row-title">${escapeHtml(p.name)}</div>
                        <div class="row-meta">
                            ${statusTag}
                            ${p.skill_count > 0 ? `<span class="row-tokens">${p.skill_count} skills</span>` : ""}
                            <span class="row-date">${escapeHtml(p.description.slice(0, 50))}${p.description.length > 50 ? "..." : ""}</span>
                        </div>
                    </div>`;
            }
            html += `</div></div>`;
        }
        html += `</div></div>`;
    }
    html += `</div>`;
    content.innerHTML = html;

    // bind group headers
    content.querySelectorAll(".group-header").forEach((el) => {
        el.addEventListener("click", () => {
            const group = el.closest(".group").dataset.group;
            if (state.collapsedGroups.has(group)) state.collapsedGroups.delete(group);
            else state.collapsedGroups.add(group);
            renderPluginsListView();
        });
    });
}

// ── Simple Markdown Renderer ──
function renderMarkdown(text) {
    if (!text) return "";
    let html = escapeHtml(text);

    // headings
    html = html.replace(/^### (.+)$/gm, "<h3>$1</h3>");
    html = html.replace(/^## (.+)$/gm, "<h2>$1</h2>");
    html = html.replace(/^# (.+)$/gm, "<h1>$1</h1>");

    // bold
    html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");

    // italic
    html = html.replace(/\*(.+?)\*/g, "<em>$1</em>");

    // inline code
    html = html.replace(/`([^`]+)`/g, "<code>$1</code>");

    // code blocks
    html = html.replace(/```(\w*)\n([\s\S]*?)```/g, "<pre><code>$2</code></pre>");

    // links
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>');

    // unordered lists
    html = html.replace(/^- (.+)$/gm, "<li>$1</li>");
    html = html.replace(/(<li>.*<\/li>\n?)+/g, "<ul>$&</ul>");

    // ordered lists
    html = html.replace(/^\d+\. (.+)$/gm, "<li>$1</li>");

    // blockquotes
    html = html.replace(/^&gt; (.+)$/gm, "<blockquote>$1</blockquote>");

    // horizontal rule
    html = html.replace(/^---$/gm, "<hr>");

    // paragraphs (double newline)
    html = html.replace(/\n\n/g, "</p><p>");
    html = "<p>" + html + "</p>";

    // clean up empty paragraphs
    html = html.replace(/<p>\s*<\/p>/g, "");
    html = html.replace(/<p>\s*(<h[1-3]>)/g, "$1");
    html = html.replace(/(<\/h[1-3]>)\s*<\/p>/g, "$1");
    html = html.replace(/<p>\s*(<pre>)/g, "$1");
    html = html.replace(/(<\/pre>)\s*<\/p>/g, "$1");
    html = html.replace(/<p>\s*(<ul>)/g, "$1");
    html = html.replace(/(<\/ul>)\s*<\/p>/g, "$1");
    html = html.replace(/<p>\s*(<blockquote>)/g, "$1");
    html = html.replace(/(<\/blockquote>)\s*<\/p>/g, "$1");
    html = html.replace(/<p>\s*(<hr>)/g, "$1");
    html = html.replace(/(<hr>)\s*<\/p>/g, "$1");

    return html;
}

// ── Section Switching ──
async function switchSection() {
    const section = state.activeSection;
    const sessionControls = document.querySelector(".session-controls");
    const statsBar = document.getElementById("stats-bar");

    // hide/show session-specific controls
    if (section === "sessions") {
        sessionControls.classList.remove("hidden");
        statsBar.querySelectorAll(".stat-label")[0].textContent = "对话";
        statsBar.querySelectorAll(".stat-label")[1].textContent = "消息";
        statsBar.querySelectorAll(".stat-label")[2].textContent = "TOKENS";
        statsBar.querySelectorAll(".stat-label")[3].textContent = "常用工具";
    } else {
        sessionControls.classList.add("hidden");
        statsBar.querySelectorAll(".stat-label")[0].textContent = "Skills";
        statsBar.querySelectorAll(".stat-label")[1].textContent = "MCP";
        statsBar.querySelectorAll(".stat-label")[2].textContent = "Rules";
        statsBar.querySelectorAll(".stat-label")[3].textContent = "Plugins";
    }

    state.viewMode = "list";
    state.collapsedGroups.clear();

    if (section === "sessions") {
        await refreshSessions();
        loadStats();
    } else if (section === "skills") {
        state.skills = await fetchSkills(state.searchQuery || undefined);
        renderSkillsListView();
        try { renderConfigStats(await fetchConfigStats()); } catch {}
    } else if (section === "mcp") {
        state.mcpServers = await fetchMcpServers(state.searchQuery || undefined);
        renderMcpListView();
        try { renderConfigStats(await fetchConfigStats()); } catch {}
    } else if (section === "rules") {
        state.rules = await fetchRules(null, state.searchQuery || undefined);
        renderRulesListView();
        try { renderConfigStats(await fetchConfigStats()); } catch {}
    } else if (section === "plugins") {
        state.plugins = await fetchPlugins(state.searchQuery || undefined);
        renderPluginsListView();
        try { renderConfigStats(await fetchConfigStats()); } catch {}
    }
}

function formatTokenCount(n) {
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
    if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
    return n.toString();
}

// ── Grouping ──
function groupSessions(sessions, by) {
    const groups = {};
    for (const s of sessions) {
        let key;
        if (by === "project") {
            key = s.project || "unknown";
        } else if (by === "time") {
            const now = new Date();
            const d = new Date(s.updated_at);
            const diffDays = Math.floor((now - d) / 86400000);
            if (diffDays === 0) key = "今天";
            else if (diffDays === 1) key = "昨天";
            else if (diffDays <= 7) key = "本周";
            else if (diffDays <= 30) key = "本月";
            else key = "更早";
        } else if (by === "model") {
            key = s.model || "unknown";
        }
        if (!groups[key]) groups[key] = [];
        groups[key].push(s);
    }
    return groups;
}

// ── List View ──
function renderListView() {
    state.viewMode = "list";
    const content = document.getElementById("content");
    const sessions = state.sessions;

    // group-by buttons active state
    document.querySelectorAll(".group-btn").forEach((btn) => {
        btn.classList.toggle("active", btn.dataset.group === state.groupBy);
    });

    if (sessions.length === 0) {
        content.innerHTML = `
            <div class="empty-state">
                <div class="empty-title">没有找到对话</div>
            </div>`;
        return;
    }

    const groups = groupSessions(sessions, state.groupBy);
    let html = `<div class="list-view">`;

    // sort group keys
    const sortedKeys = Object.keys(groups).sort((a, b) => {
        if (state.groupBy === "time") {
            const order = { "今天": 0, "昨天": 1, "本周": 2, "本月": 3, "更早": 4 };
            return (order[a] ?? 99) - (order[b] ?? 99);
        }
        return a.localeCompare(b);
    });

    for (const groupName of sortedKeys) {
        const groupSessions = groups[groupName];
        const collapsed = state.collapsedGroups.has(groupName);
        html += `
            <div class="group" data-group="${escapeAttr(groupName)}">
                <div class="group-header ${collapsed ? "collapsed" : ""}">
                    <span class="group-arrow">${collapsed ? "▸" : "▾"}</span>
                    <span class="group-name">${escapeHtml(groupName)}</span>
                    <span class="group-count">${groupSessions.length}</span>
                </div>
                <div class="group-items" ${collapsed ? 'style="display:none"' : ""}>`;

        for (const s of groupSessions) {
            const modelShort = s.model ? s.model.split("/").pop().split(":")[0] : "";
            const date = formatRelativeTime(s.updated_at);
            const totalTokens = (s.total_input_tokens || 0) + (s.total_output_tokens || 0);
            html += `
                <div class="session-row" data-id="${s.id}" data-source="${s.source}">
                    <div class="row-title">${escapeHtml(s.title)}</div>
                    <div class="row-meta">
                        <span class="source-tag ${s.source}">${s.source}</span>
                        ${modelShort ? `<span class="row-model">${escapeHtml(modelShort)}</span>` : ""}
                        ${totalTokens > 0 ? `<span class="row-tokens">${formatTokenCount(totalTokens)}</span>` : ""}
                        <span class="row-date">${date}</span>
                    </div>
                </div>`;
        }
        html += `</div></div>`;
    }
    html += `</div>`;
    content.innerHTML = html;

    // bind group headers
    content.querySelectorAll(".group-header").forEach((el) => {
        el.addEventListener("click", () => {
            const group = el.closest(".group").dataset.group;
            if (state.collapsedGroups.has(group)) {
                state.collapsedGroups.delete(group);
            } else {
                state.collapsedGroups.add(group);
            }
            renderListView();
        });
    });

    // bind session rows
    content.querySelectorAll(".session-row").forEach((el) => {
        el.addEventListener("click", () => {
            loadConversation(el.dataset.source, el.dataset.id);
        });
    });
}

// ── Detail View ──
async function loadConversation(source, id) {
    state.viewMode = "detail";
    state.currentSession = { id, source };

    const content = document.getElementById("content");
    content.innerHTML = '<div class="loading-state">加载中</div>';

    try {
        const [messages, sessions] = await Promise.all([
            fetchMessages(source, id),
            Promise.resolve(state.sessions),
        ]);

        const session = sessions.find((s) => s.id === id && s.source === source);
        let html = `<div class="detail-view">`;

        // header
        if (session) {
            const date = new Date(session.created_at).toLocaleString("zh-CN", {
                year: "numeric", month: "2-digit", day: "2-digit",
                hour: "2-digit", minute: "2-digit",
            });
            const totalTokens = (session.total_input_tokens || 0) + (session.total_output_tokens || 0);
            const durationStr = session.duration_ms ? formatDuration(session.duration_ms) : "";

            html += `
                <div class="detail-header">
                    <div class="detail-top">
                        <button class="back-btn">返回</button>
                        <div class="detail-title">${escapeHtml(session.title)}</div>
                        <div class="detail-actions">
                            ${source === "claude" ? `<button class="subagents-btn" data-id="${id}" data-source="${source}">子代理</button>` : ""}
                            <button class="export-btn" data-id="${id}" data-source="${source}">导出</button>
                            <button class="delete-btn" data-id="${id}" data-source="${source}">删除</button>
                        </div>
                    </div>
                    <div class="detail-meta">
                        <span class="source-tag ${session.source}">${session.source}</span>
                        <span>${escapeHtml(session.project)}</span>
                        ${session.model ? `<span>${escapeHtml(session.model)}</span>` : ""}
                        <span>${date}</span>
                        ${session.git_branch ? `<span>branch: ${escapeHtml(session.git_branch)}</span>` : ""}
                        ${totalTokens > 0 ? `<span>${totalTokens.toLocaleString()} tokens</span>` : ""}
                        ${durationStr ? `<span>${durationStr}</span>` : ""}
                    </div>
                </div>`;
        }

        // messages
        html += '<div class="messages" id="messages-container">';
        for (const m of messages) {
            html += renderMessage(m);
        }
        html += "</div></div>";
        content.innerHTML = html;

        // bind back
        content.querySelector(".back-btn")?.addEventListener("click", closeConversation);

        // bind delete
        content.querySelector(".delete-btn")?.addEventListener("click", async (e) => {
            const sid = e.target.dataset.id;
            const src = e.target.dataset.source;
            if (confirm("确定删除此对话？（将移至回收站）")) {
                await deleteSession(src, sid);
                state.currentSession = null;
                await refreshSessions();
                loadStats();
                renderListView();
            }
        });

        // bind export
        content.querySelector(".export-btn")?.addEventListener("click", (e) => {
            window.open(`/api/sessions/${e.target.dataset.source}/${e.target.dataset.id}/export?format=markdown`, "_blank");
        });

        // bind subagents
        content.querySelector(".subagents-btn")?.addEventListener("click", async (e) => {
            const btn = e.currentTarget;
            const existing = content.querySelector(".subagents-panel");
            if (existing) { existing.remove(); return; }

            btn.textContent = "...";
            const agents = await fetchSubagents(btn.dataset.source, btn.dataset.id);
            btn.textContent = "子代理";

            if (agents.length === 0) {
                const panel = document.createElement("div");
                panel.className = "subagents-panel";
                panel.innerHTML = '<div class="subagents-empty">没有子代理</div>';
                content.querySelector(".detail-header").after(panel);
                return;
            }

            let panelHtml = agents.map((a) => `
                <div class="subagent-item">
                    <span class="subagent-type">${escapeHtml(a.type)}</span>
                    <span class="subagent-desc">${escapeHtml(a.description)}</span>
                    <span class="subagent-size">${formatFileSize(a.file_size)}</span>
                </div>`).join("");

            const panel = document.createElement("div");
            panel.className = "subagents-panel";
            panel.innerHTML = `<div class="subagents-header">${agents.length} 个子代理</div>${panelHtml}`;
            content.querySelector(".detail-header").after(panel);
        });

        // bind msg-info click to toggle details
        content.querySelectorAll(".msg-info.clickable").forEach((el) => {
            el.addEventListener("click", () => {
                const details = el.nextElementSibling;
                if (details?.classList.contains("msg-details")) {
                    details.classList.toggle("show");
                    el.classList.toggle("expanded");
                }
            });
        });

        // scroll to bottom
        const msgContainer = document.getElementById("messages-container");
        if (msgContainer) msgContainer.scrollTop = msgContainer.scrollHeight;
    } catch (err) {
        content.innerHTML = `
            <div class="empty-state">
                <div class="empty-title">${escapeHtml(err.message)}</div>
            </div>`;
    }
}

function closeConversation() {
    state.currentSession = null;
    state.viewMode = "list";
    renderListView();
}

// ── Messages ──
function renderMessage(m) {
    const role = m.role;
    let content = escapeHtml(m.content);

    // Collect info line parts
    const infoParts = [];

    // Tool call names
    const allToolCalls = m.tool_calls || [];
    const legacyTools = (!allToolCalls.length && m.metadata?.tool_uses) ? m.metadata.tool_uses : [];
    const toolNames = allToolCalls.map(tc => tc.name);
    legacyTools.forEach(t => toolNames.push(t.name));
    if (toolNames.length > 0) {
        const hasError = allToolCalls.some(tc => tc.is_error);
        infoParts.push(`<span class="info-tools${hasError ? " error" : ""}">${escapeHtml(toolNames.join(", "))}</span>`);
    }

    // Thinking indicator
    const hasThinking = m.thinking || m.metadata?.thinking;
    if (hasThinking) {
        infoParts.push(`<span class="info-thinking">思考</span>`);
    }

    // Tokens
    if (m.usage && (m.usage.input_tokens || m.usage.output_tokens)) {
        const parts = [];
        if (m.usage.input_tokens) parts.push(`in:${formatTokenCount(m.usage.input_tokens)}`);
        if (m.usage.output_tokens) parts.push(`out:${formatTokenCount(m.usage.output_tokens)}`);
        infoParts.push(`<span class="info-tokens">${parts.join(" ")}</span>`);
    }

    // Timestamp
    if (m.timestamp) {
        const d = new Date(m.timestamp);
        infoParts.push(`<span class="info-time">${d.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>`);
    }

    // Build detail block (hidden by default, click info line to expand)
    let detailBlock = "";
    const hasDetails = allToolCalls.length > 0 || hasThinking;
    if (hasDetails) {
        let detailHtml = "";

        for (const tc of allToolCalls) {
            const isError = tc.is_error ? " error" : "";
            const inputJson = tc.input_full && Object.keys(tc.input_full).length > 0
                ? escapeHtml(JSON.stringify(tc.input_full, null, 2)) : "";
            detailHtml += `<div class="tc-detail${isError}">`;
            detailHtml += `<div class="tc-head"><span class="tc-name">${escapeHtml(tc.name)}</span>${tc.duration_ms != null ? `<span class="tc-dur">${tc.duration_ms}ms</span>` : ""}</div>`;
            if (inputJson) detailHtml += `<pre class="tc-json">${inputJson}</pre>`;
            if (tc.result_text) detailHtml += `<div class="tc-result${isError}">${escapeHtml(tc.result_text.slice(0, 800))}${tc.result_text.length > 800 ? "..." : ""}</div>`;
            detailHtml += `</div>`;
        }

        const thinkText = m.thinking || m.metadata?.thinking || "";
        if (thinkText) {
            detailHtml += `<div class="tc-detail think"><div class="tc-head"><span class="tc-name">思考</span></div><div class="tc-think">${escapeHtml(thinkText)}</div></div>`;
        }

        detailBlock = `<div class="msg-details">${detailHtml}</div>`;
    }

    const infoLine = infoParts.length > 0
        ? `<div class="msg-info${hasDetails ? " clickable" : ""}">${infoParts.join("")}</div>`
        : "";

    return `<div class="message ${role}">${content}${infoLine}${detailBlock}</div>`;
}

// ── Refresh ──
async function refreshSessions() {
    state.sessions = await fetchSessions(state.currentSource, state.searchQuery || undefined);
    if (state.viewMode === "list") renderListView();
}

// ── Utilities ──
function escapeHtml(text) {
    if (!text) return "";
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
}

function escapeAttr(text) {
    return text ? text.replace(/"/g, "&quot;").replace(/'/g, "&#39;") : "";
}

function formatDuration(ms) {
    if (!ms || ms <= 0) return "";
    const secs = Math.floor(ms / 1000);
    if (secs < 60) return `${secs}s`;
    const mins = Math.floor(secs / 60);
    const remainSecs = secs % 60;
    if (mins < 60) return `${mins}m ${remainSecs}s`;
    const hours = Math.floor(mins / 60);
    const remainMins = mins % 60;
    return `${hours}h ${remainMins}m`;
}

function formatFileSize(bytes) {
    if (!bytes) return "";
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function formatRelativeTime(isoString) {
    const now = Date.now();
    const then = new Date(isoString).getTime();
    const diff = now - then;
    const mins = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (mins < 1) return "刚刚";
    if (mins < 60) return `${mins}m`;
    if (hours < 24) return `${hours}h`;
    if (days < 30) return `${days}d`;
    return new Date(isoString).toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" });
}

async function loadStats() {
    try {
        renderStats(await fetchStats());
    } catch {}
}

// ── Event Bindings ──

// Source filter
document.querySelectorAll(".filter-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
        document.querySelectorAll(".filter-btn").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        state.currentSource = btn.dataset.source === "all" ? null : btn.dataset.source;
        state.currentSession = null;
        await refreshSessions();
    });
});

// Group-by
document.querySelectorAll(".group-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
        document.querySelectorAll(".group-btn").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        state.groupBy = btn.dataset.group;
        state.collapsedGroups.clear();
        if (state.viewMode === "list") renderListView();
    });
});

// Navigation
document.querySelectorAll(".nav-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
        document.querySelectorAll(".nav-btn").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        state.activeSection = btn.dataset.section;
        state.searchQuery = "";
        document.getElementById("search").value = "";
        await switchSection();
    });
});

// Search
document.getElementById("search").addEventListener("input", (e) => {
    state.searchQuery = e.target.value;
    clearTimeout(state.searchTimer);
    state.searchTimer = setTimeout(() => {
        if (state.activeSection === "sessions") {
            refreshSessions();
        } else {
            switchSection();
        }
    }, 300);
});

// Keyboard
document.addEventListener("keydown", (e) => {
    const search = document.getElementById("search");

    if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        search.focus();
        return;
    }

    if (e.key === "Escape") {
        if (document.activeElement === search) {
            search.value = "";
            state.searchQuery = "";
            if (state.activeSection === "sessions") {
                refreshSessions();
            } else {
                switchSection();
            }
            search.blur();
        } else if (state.viewMode === "detail") {
            if (state.activeSection === "sessions") {
                closeConversation();
            } else {
                state.viewMode = "list";
                switchSection();
            }
        }
        return;
    }
});

// ── Init ──
(async () => {
    state.sessions = await fetchSessions();
    renderListView();
    loadStats();
})();
