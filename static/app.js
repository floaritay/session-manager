/* ═══════════════════════════════════════════════
   Session Manager — Client
   ═══════════════════════════════════════════════ */

const state = {
    sessions: [],
    currentSource: null,
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

    // Pagination
    page: 1,
    perPage: 50,
    totalPages: 1,
    total: 0,

    // Batch operations
    batchMode: false,
    selected: new Set(),

    // Charts
    dateChart: null,
    modelChart: null,

    // Favorites
    favorites: new Set(),

    // Notes
    notes: {},

    // Favorites filter
    showFavoritesOnly: false,
};

// ── Toast Notifications ──
function showToast(message, type = "info") {
    const container = document.getElementById("toast-container");
    const toast = document.createElement("div");
    toast.className = `toast ${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => {
        toast.style.opacity = "0";
        toast.style.transition = "opacity 0.3s";
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// ── Unified API Call ──
async function apiCall(url, options = {}) {
    const resp = await fetch(url, options);
    if (!resp.ok) {
        const text = await resp.text().catch(() => "");
        throw new Error(text || `HTTP ${resp.status}`);
    }
    return resp;
}

async function apiJson(url, options = {}) {
    const resp = await apiCall(url, options);
    return resp.json();
}

async function apiText(url, options = {}) {
    const resp = await apiCall(url, options);
    return resp.text();
}

// ── API ──
async function fetchSessions(source, q, page, perPage, favorites) {
    const params = new URLSearchParams();
    if (source && source !== "all") params.set("source", source);
    if (q) params.set("q", q);
    if (page) params.set("page", page);
    if (perPage) params.set("per_page", perPage);
    if (favorites) params.set("favorites", "true");
    const qs = params.toString();
    return apiJson(`/api/sessions${qs ? "?" + qs : ""}`);
}

async function fetchMessages(source, id) {
    return apiJson(`/api/sessions/${source}/${id}`);
}

async function deleteSession(source, id) {
    return apiJson(`/api/sessions/${source}/${id}`, { method: "DELETE" });
}

async function deleteSessionsBatch(sessions) {
    return apiJson("/api/sessions/delete-batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessions }),
    });
}

async function fetchStats() {
    return apiJson("/api/stats");
}

async function fetchSubagents(source, id) {
    return apiJson(`/api/sessions/${source}/${id}/subagents`);
}

// ── Config API ──
async function fetchSkills(q) {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    const qs = params.toString();
    return apiJson(`/api/skills${qs ? "?" + qs : ""}`);
}

async function fetchSkillBody(skillId) {
    return apiText(`/api/skills/${encodeURIComponent(skillId)}/body`);
}

async function fetchMcpServers(q) {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    const qs = params.toString();
    return apiJson(`/api/mcp${qs ? "?" + qs : ""}`);
}

async function fetchRules(scope, q) {
    const params = new URLSearchParams();
    if (scope) params.set("scope", scope);
    if (q) params.set("q", q);
    const qs = params.toString();
    return apiJson(`/api/rules${qs ? "?" + qs : ""}`);
}

async function fetchRuleContent(ruleId) {
    return apiText(`/api/rules/${encodeURIComponent(ruleId)}/content`);
}

async function fetchPlugins(q) {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    const qs = params.toString();
    return apiJson(`/api/plugins${qs ? "?" + qs : ""}`);
}

async function fetchConfigStats() {
    return apiJson("/api/config/stats");
}

// ── Favorites API ──
async function fetchFavorites() {
    return apiJson("/api/favorites");
}

// ── Notes API (bulk) ──
async function fetchAllNotes() {
    return apiJson("/api/notes");
}

async function toggleFavorite(source, id) {
    return apiJson(`/api/favorites/${source}/${id}`, { method: "POST" });
}

// ── Notes API ──
async function fetchNote(source, id) {
    return apiJson(`/api/sessions/${source}/${id}/note`);
}

async function saveNote(source, id, note) {
    return apiJson(`/api/sessions/${source}/${id}/note`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note }),
    });
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

    // Update charts
    renderCharts(stats);
}

function renderConfigStats(stats) {
    if (!stats) return;
    document.getElementById("stat-sessions").textContent = stats.total_skills;
    document.getElementById("stat-messages").textContent = stats.total_servers;
    document.getElementById("stat-tokens").textContent = stats.total_rules;
    document.getElementById("stat-tools").innerHTML = `<span>${stats.enabled_plugins} / ${stats.total_plugins} 插件已启用</span>`;
}

// ── Charts ──
function renderCharts(stats) {
    const chartsArea = document.getElementById("charts-area");
    if (typeof Chart === "undefined") {
        chartsArea.classList.remove("visible");
        return;
    }
    if (!stats.sessions_by_date?.length && !stats.sessions_by_source) {
        chartsArea.classList.remove("visible");
        return;
    }
    chartsArea.classList.add("visible");

    const isDark = document.body.getAttribute("data-theme") === "dark";
    const gridColor = isDark ? "#333" : "#e5e5e5";
    const textColor = isDark ? "#999" : "#999";

    // Date chart
    if (stats.sessions_by_date?.length) {
        const dateCtx = document.getElementById("chart-dates");
        if (state.dateChart) state.dateChart.destroy();
        state.dateChart = new Chart(dateCtx, {
            type: "line",
            data: {
                labels: stats.sessions_by_date.map(d => d.date),
                datasets: [{
                    label: "Sessions",
                    data: stats.sessions_by_date.map(d => d.count),
                    borderColor: isDark ? "#a78bfa" : "#7c3aed",
                    backgroundColor: isDark ? "rgba(167,139,250,0.1)" : "rgba(124,58,237,0.1)",
                    fill: true,
                    tension: 0.3,
                    pointRadius: 2,
                }],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                    x: { grid: { color: gridColor }, ticks: { color: textColor, maxRotation: 45, font: { size: 10 } } },
                    y: { grid: { color: gridColor }, ticks: { color: textColor, font: { size: 10 } }, beginAtZero: true },
                },
            },
        });
    }

    // Model distribution chart
    if (stats.sessions_by_source) {
        const modelCtx = document.getElementById("chart-models");
        if (state.modelChart) state.modelChart.destroy();
        const labels = Object.keys(stats.sessions_by_source);
        const data = Object.values(stats.sessions_by_source);
        const colors = isDark
            ? ["#a78bfa", "#4ade80", "#fbbf24", "#f87171"]
            : ["#7c3aed", "#16a34a", "#d97706", "#dc2626"];
        state.modelChart = new Chart(modelCtx, {
            type: "doughnut",
            data: {
                labels,
                datasets: [{ data, backgroundColor: colors.slice(0, labels.length), borderWidth: 0 }],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { position: "right", labels: { color: textColor, font: { size: 11 }, padding: 12 } },
                },
            },
        });
    }
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
            const detail = s.transport_type === "stdio" ? `${s.command} ${(s.args || []).join(" ")}` : s.url;
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
        html += `<div class="detail-actions">`;
        html += `<button class="export-btn edit-rule-btn" data-id="${escapeAttr(ruleId)}">编辑</button>`;
        html += `</div>`;
        html += `</div>`;
        html += `<div class="detail-meta">`;
        html += `<span class="source-tag ${rule?.scope || ""}">${rule?.scope || ""}</span>`;
        html += `<span>${body.length.toLocaleString()} 字符</span>`;
        html += `</div></div>`;
        html += `<div class="detail-content" id="rule-content">${escapeHtml(body)}</div>`;
        html += `</div>`;
        content.innerHTML = html;

        content.querySelector(".back-btn")?.addEventListener("click", () => {
            state.viewMode = "list";
            renderRulesListView();
        });

        // Edit button
        content.querySelector(".edit-rule-btn")?.addEventListener("click", () => {
            const ruleContent = document.getElementById("rule-content");
            const currentText = body;
            ruleContent.innerHTML = `
                <textarea class="edit-textarea" style="width:100%;height:calc(100vh - 260px);font-family:var(--font);font-size:13px;padding:12px;background:var(--bg-surface);color:var(--text);border:1px solid var(--border);resize:none;white-space:pre;tab-size:4;">${escapeHtml(currentText)}</textarea>
                <div style="margin-top:8px;display:flex;gap:8px;">
                    <button class="back-btn save-rule-btn">保存</button>
                    <button class="back-btn cancel-edit-btn" style="background:transparent;color:var(--text-secondary);">取消</button>
                </div>`;
            ruleContent.style.whiteSpace = "normal";

            content.querySelector(".cancel-edit-btn")?.addEventListener("click", () => loadRuleDetail(ruleId));
            content.querySelector(".save-rule-btn")?.addEventListener("click", async () => {
                const textarea = ruleContent.querySelector("textarea");
                try {
                    await apiCall(`/api/rules/${encodeURIComponent(ruleId)}/content`, {
                        method: "PUT",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ content: textarea.value }),
                    });
                    showToast("规则已保存", "success");
                    loadRuleDetail(ruleId);
                } catch (err) {
                    showToast(`保存失败: ${err.message}`, "error");
                }
            });
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

    // code blocks (must come before inline code)
    html = html.replace(/```(\w*)\n?([\s\S]*?)```/g, "<pre><code>$2</code></pre>");

    // headings
    html = html.replace(/^### (.+)$/gm, "<h3>$1</h3>");
    html = html.replace(/^## (.+)$/gm, "<h2>$1</h2>");
    html = html.replace(/^# (.+)$/gm, "<h1>$1</h1>");

    // bold
    html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");

    // italic
    html = html.replace(/\*(.+?)\*/g, "<em>$1</em>");

    // inline code (after code blocks to avoid matching inside them)
    html = html.replace(/`([^`]+)`/g, "<code>$1</code>");

    // links
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>');

    // unordered lists
    html = html.replace(/^- (.+)$/gm, "<li>$1</li>");
    html = html.replace(/(<li>.*<\/li>\n?)+/g, "<ul>$&</ul>");

    // ordered lists (process before unordered to avoid conflicts)
    html = html.replace(/^\d+\. (.+)$/gm, "<oli>$1</oli>");
    html = html.replace(/(<oli>.*<\/oli>\n?)+/g, "<ol>$&</ol>");
    html = html.replace(/<\/?oli>/g, function(tag) {
        return tag.replace("oli", "li");
    });

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
    html = html.replace(/<p>\s*(<ol>)/g, "$1");
    html = html.replace(/(<\/ol>)\s*<\/p>/g, "$1");
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
    const batchBar = document.getElementById("batch-bar");
    const chartsArea = document.getElementById("charts-area");

    // hide/show session-specific controls
    if (section === "sessions") {
        sessionControls.classList.remove("hidden");
        statsBar.querySelectorAll(".stat-label")[0].textContent = "对话";
        statsBar.querySelectorAll(".stat-label")[1].textContent = "消息";
        statsBar.querySelectorAll(".stat-label")[2].textContent = "TOKENS";
        statsBar.querySelectorAll(".stat-label")[3].textContent = "常用工具";
        chartsArea.classList.remove("visible");
    } else {
        sessionControls.classList.add("hidden");
        batchBar.classList.remove("visible");
        chartsArea.classList.remove("visible");
        statsBar.querySelectorAll(".stat-label")[0].textContent = "Skills";
        statsBar.querySelectorAll(".stat-label")[1].textContent = "MCP";
        statsBar.querySelectorAll(".stat-label")[2].textContent = "Rules";
        statsBar.querySelectorAll(".stat-label")[3].textContent = "Plugins";
    }

    state.viewMode = "list";
    state.collapsedGroups.clear();
    exitBatchMode();

    if (section === "sessions") {
        await refreshSessions();
        loadStats();
    } else if (section === "skills") {
        try {
            state.skills = await fetchSkills(state.searchQuery || undefined);
            renderSkillsListView();
            renderConfigStats(await fetchConfigStats());
        } catch (err) {
            showToast(`加载失败: ${err.message}`, "error");
        }
    } else if (section === "mcp") {
        try {
            state.mcpServers = await fetchMcpServers(state.searchQuery || undefined);
            renderMcpListView();
            renderConfigStats(await fetchConfigStats());
        } catch (err) {
            showToast(`加载失败: ${err.message}`, "error");
        }
    } else if (section === "rules") {
        try {
            state.rules = await fetchRules(null, state.searchQuery || undefined);
            renderRulesListView();
            renderConfigStats(await fetchConfigStats());
        } catch (err) {
            showToast(`加载失败: ${err.message}`, "error");
        }
    } else if (section === "plugins") {
        try {
            state.plugins = await fetchPlugins(state.searchQuery || undefined);
            renderPluginsListView();
            renderConfigStats(await fetchConfigStats());
        } catch (err) {
            showToast(`加载失败: ${err.message}`, "error");
        }
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

// ── Pagination ──
function renderPagination() {
    if (state.totalPages <= 1) return "";
    let html = `<div class="pagination">`;
    html += `<button class="page-btn" data-page="${state.page - 1}" ${state.page <= 1 ? "disabled" : ""}>上一页</button>`;
    const maxVisible = 7;
    let startPage = Math.max(1, state.page - Math.floor(maxVisible / 2));
    let endPage = Math.min(state.totalPages, startPage + maxVisible - 1);
    if (endPage - startPage < maxVisible - 1) {
        startPage = Math.max(1, endPage - maxVisible + 1);
    }
    if (startPage > 1) {
        html += `<button class="page-btn" data-page="1">1</button>`;
        if (startPage > 2) html += `<span class="page-info">...</span>`;
    }
    for (let i = startPage; i <= endPage; i++) {
        html += `<button class="page-btn${i === state.page ? " active" : ""}" data-page="${i}">${i}</button>`;
    }
    if (endPage < state.totalPages) {
        if (endPage < state.totalPages - 1) html += `<span class="page-info">...</span>`;
        html += `<button class="page-btn" data-page="${state.totalPages}">${state.totalPages}</button>`;
    }
    html += `<button class="page-btn" data-page="${state.page + 1}" ${state.page >= state.totalPages ? "disabled" : ""}>下一页</button>`;
    html += `<span class="page-info">${state.total} 条</span>`;
    html += `</div>`;
    return html;
}

function bindPagination(container) {
    container.querySelectorAll(".page-btn").forEach((btn) => {
        btn.addEventListener("click", async () => {
            const page = parseInt(btn.dataset.page);
            if (page < 1 || page > state.totalPages || page === state.page) return;
            state.page = page;
            await refreshSessions();
        });
    });
}

// ── Batch Operations ──
function enterBatchMode() {
    state.batchMode = true;
    state.selected.clear();
    document.getElementById("batch-bar").classList.add("visible");
    renderListView();
}

function exitBatchMode() {
    state.batchMode = false;
    state.selected.clear();
    document.getElementById("batch-bar").classList.remove("visible");
}

function updateBatchCount() {
    document.getElementById("batch-count").textContent = `已选 ${state.selected.size} 项`;
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
        const groupItems = groups[groupName];
        const collapsed = state.collapsedGroups.has(groupName);
        html += `
            <div class="group" data-group="${escapeAttr(groupName)}">
                <div class="group-header ${collapsed ? "collapsed" : ""}">
                    <span class="group-arrow">${collapsed ? "▸" : "▾"}</span>
                    <span class="group-name">${escapeHtml(groupName)}</span>
                    <span class="group-count">${groupItems.length}</span>
                </div>
                <div class="group-items" ${collapsed ? 'style="display:none"' : ""}>`;

        for (const s of groupItems) {
            const modelShort = s.model ? s.model.split("/").pop().split(":")[0] : "";
            const date = formatRelativeTime(s.updated_at);
            const totalTokens = (s.total_input_tokens || 0) + (s.total_output_tokens || 0);
            const isFav = state.favorites.has(`${s.source}:${s.id}`);
            const isSelected = state.selected.has(`${s.source}:${s.id}`);
            const checkHtml = state.batchMode
                ? `<input type="checkbox" class="row-check" data-key="${escapeAttr(s.source + ":" + s.id)}" ${isSelected ? "checked" : ""}>`
                : "";
            const favHtml = `<span class="fav-star${isFav ? " active" : ""}" data-source="${escapeAttr(s.source)}" data-id="${escapeAttr(s.id)}" title="收藏">${isFav ? "★" : "☆"}</span>`;
            const noteKey = `${s.source}:${s.id}`;
            const noteText = state.notes[noteKey] || "";
            const noteHtml = noteText ? `<span class="note-indicator" title="${escapeAttr(noteText)}">${escapeHtml(noteText.slice(0, 15))}${noteText.length > 15 ? "..." : ""}</span>` : "";
            html += `
                <div class="session-row${isSelected ? " selected" : ""}" data-id="${escapeAttr(s.id)}" data-source="${escapeAttr(s.source)}">
                    ${checkHtml}
                    ${favHtml}
                    <div class="row-title">${escapeHtml(s.title)}</div>
                    <div class="row-meta">
                        <span class="source-tag ${s.source}">${s.source}</span>
                        ${modelShort ? `<span class="row-model">${escapeHtml(modelShort)}</span>` : ""}
                        ${totalTokens > 0 ? `<span class="row-tokens">${formatTokenCount(totalTokens)}</span>` : ""}
                        ${noteHtml}
                        <span class="row-date">${date}</span>
                    </div>
                </div>`;
        }
        html += `</div></div>`;
    }
    html += `</div>`;
    html += renderPagination();
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
        el.addEventListener("click", (e) => {
            if (e.target.classList.contains("row-check") || e.target.classList.contains("fav-star")) return;
            if (state.batchMode) {
                const check = el.querySelector(".row-check");
                if (check) {
                    check.checked = !check.checked;
                    const key = check.dataset.key;
                    if (check.checked) state.selected.add(key);
                    else state.selected.delete(key);
                    el.classList.toggle("selected", check.checked);
                    updateBatchCount();
                }
                return;
            }
            loadConversation(el.dataset.source, el.dataset.id);
        });
    });

    // bind checkboxes
    content.querySelectorAll(".row-check").forEach((check) => {
        check.addEventListener("change", (e) => {
            e.stopPropagation();
            const key = check.dataset.key;
            if (check.checked) state.selected.add(key);
            else state.selected.delete(key);
            check.closest(".session-row").classList.toggle("selected", check.checked);
            updateBatchCount();
        });
    });

    // bind favorite stars
    content.querySelectorAll(".fav-star").forEach((star) => {
        star.addEventListener("click", async (e) => {
            e.stopPropagation();
            const src = star.dataset.source;
            const sid = star.dataset.id;
            try {
                await toggleFavorite(src, sid);
                const key = `${src}:${sid}`;
                if (state.favorites.has(key)) {
                    state.favorites.delete(key);
                    star.textContent = "☆";
                    star.classList.remove("active");
                } else {
                    state.favorites.add(key);
                    star.textContent = "★";
                    star.classList.add("active");
                }
            } catch (err) {
                showToast(`操作失败: ${err.message}`, "error");
            }
        });
    });

    // bind pagination
    bindPagination(content);
}

// ── Detail View ──
async function loadConversation(source, id) {
    state.viewMode = "detail";
    document.getElementById("stats-bar").style.display = "none";
    document.getElementById("charts-area").style.display = "none";

    const content = document.getElementById("content");
    content.innerHTML = '<div class="loading-state">加载中</div>';

    try {
        const messages = await fetchMessages(source, id);
        const session = state.sessions.find((s) => s.id === id && s.source === source);
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
                            ${source === "claude" ? `<button class="subagents-btn" data-id="${escapeAttr(id)}" data-source="${escapeAttr(source)}">子代理</button>` : ""}
                            <button class="export-btn" data-id="${escapeAttr(id)}" data-source="${escapeAttr(source)}">导出</button>
                            <button class="note-btn" data-id="${escapeAttr(id)}" data-source="${escapeAttr(source)}">备注</button>
                            <button class="delete-btn" data-id="${escapeAttr(id)}" data-source="${escapeAttr(source)}">删除</button>
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
                try {
                    await deleteSession(src, sid);
                    await refreshSessions();
                    loadStats();
                    renderListView();
                    showToast("已删除", "success");
                } catch (err) {
                    showToast(`删除失败: ${err.message}`, "error");
                }
            }
        });

        // bind export
        content.querySelector(".export-btn")?.addEventListener("click", (e) => {
            window.open(`/api/sessions/${e.target.dataset.source}/${e.target.dataset.id}/export?format=markdown`, "_blank");
        });

        // bind note
        content.querySelector(".note-btn")?.addEventListener("click", async (e) => {
            const sid = e.target.dataset.id;
            const src = e.target.dataset.source;
            try {
                const data = await fetchNote(src, sid);
                const note = prompt("输入备注:", data.note || "");
                if (note !== null) {
                    await saveNote(src, sid, note);
                    state.notes[`${src}:${sid}`] = note || undefined;
                    if (!note) delete state.notes[`${src}:${sid}`];
                    showToast("备注已保存", "success");
                }
            } catch (err) {
                showToast(`操作失败: ${err.message}`, "error");
            }
        });

        // bind subagents
        content.querySelector(".subagents-btn")?.addEventListener("click", async (e) => {
            const btn = e.currentTarget;
            const existing = content.querySelector(".subagents-panel");
            if (existing) { existing.remove(); return; }

            btn.textContent = "...";
            try {
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
            } catch (err) {
                btn.textContent = "子代理";
                showToast(`加载子代理失败: ${err.message}`, "error");
            }
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
    state.viewMode = "list";
    document.getElementById("stats-bar").style.display = "";
    document.getElementById("charts-area").style.display = "";
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
    try {
        const data = await fetchSessions(
            state.currentSource,
            state.searchQuery || undefined,
            state.page,
            state.perPage,
            state.showFavoritesOnly
        );
        state.sessions = data.sessions;
        state.total = data.total;
        state.totalPages = data.total_pages;
        state.page = data.page;
        if (state.viewMode === "list") renderListView();
    } catch (err) {
        showToast(`加载失败: ${err.message}`, "error");
    }
}

// ── Utilities ──
function escapeHtml(text) {
    if (text == null) return "";
    return String(text)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
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
    } catch (err) {
        showToast(`加载统计失败: ${err.message}`, "error");
    }
}

// ── Theme Toggle ──
function initTheme() {
    const saved = localStorage.getItem("theme") || "light";
    document.body.setAttribute("data-theme", saved);
    updateThemeButton(saved);
}

function toggleTheme() {
    const current = document.body.getAttribute("data-theme") || "light";
    const next = current === "dark" ? "light" : "dark";
    document.body.setAttribute("data-theme", next);
    localStorage.setItem("theme", next);
    updateThemeButton(next);
    // Redraw charts with new colors
    if (state.activeSection === "sessions") loadStats();
}

function updateThemeButton(theme) {
    const btn = document.getElementById("theme-toggle");
    if (btn) btn.textContent = theme === "dark" ? "☾" : "☀";
}

// ── Event Bindings ──

// Theme toggle
document.getElementById("theme-toggle")?.addEventListener("click", toggleTheme);

// Source filter
document.querySelectorAll(".filter-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
        document.querySelectorAll(".filter-btn").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        const src = btn.dataset.source;
        state.showFavoritesOnly = src === "favorites";
        state.currentSource = (src === "all" || src === "favorites") ? null : src;
        state.page = 1;
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
        state.page = 1;
        clearTimeout(state.searchTimer);
        document.getElementById("search").value = "";
        await switchSection();
    });
});

// Search
document.getElementById("search").addEventListener("input", (e) => {
    state.searchQuery = e.target.value;
    clearTimeout(state.searchTimer);
    state.searchTimer = setTimeout(() => {
        state.page = 1;
        if (state.activeSection === "sessions") {
            refreshSessions();
        } else {
            switchSection();
        }
    }, 300);
});

// Batch operations
document.getElementById("batch-select-all")?.addEventListener("click", () => {
    const allKeys = state.sessions.map(s => `${s.source}:${s.id}`);
    const allSelected = allKeys.every(k => state.selected.has(k));
    if (allSelected) {
        state.selected.clear();
    } else {
        allKeys.forEach(k => state.selected.add(k));
    }
    updateBatchCount();
    renderListView();
});

document.getElementById("batch-delete")?.addEventListener("click", async () => {
    if (state.selected.size === 0) return;
    if (!confirm(`确定删除 ${state.selected.size} 个对话？（将移至回收站）`)) return;
    const sessions = Array.from(state.selected).map(key => {
        const [source, id] = key.split(":");
        return { source, id };
    });
    try {
        await deleteSessionsBatch(sessions);
        showToast(`已删除 ${sessions.length} 个对话`, "success");
        exitBatchMode();
        await refreshSessions();
        loadStats();
    } catch (err) {
        showToast(`批量删除失败: ${err.message}`, "error");
    }
});

document.getElementById("batch-export")?.addEventListener("click", () => {
    if (state.selected.size === 0) return;
    const ids = Array.from(state.selected).join(",");
    window.open(`/api/sessions/export-all?format=markdown&ids=${encodeURIComponent(ids)}`, "_blank");
});

document.getElementById("batch-cancel")?.addEventListener("click", () => {
    exitBatchMode();
    renderListView();
});

document.getElementById("export-all")?.addEventListener("click", () => {
    window.open("/api/sessions/export-all?format=json", "_blank");
});

// Right-click to enter batch mode
document.getElementById("content")?.addEventListener("contextmenu", (e) => {
    if (state.activeSection !== "sessions" || state.viewMode !== "list") return;
    if (!state.batchMode) {
        e.preventDefault();
        enterBatchMode();
    }
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
            state.page = 1;
            if (state.activeSection === "sessions") {
                refreshSessions();
            } else {
                switchSection();
            }
            search.blur();
        } else if (state.batchMode) {
            exitBatchMode();
            renderListView();
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
    initTheme();
    try {
        // Load favorites and notes
        try {
            const [favData, notesData] = await Promise.all([
                fetchFavorites(),
                fetchAllNotes(),
            ]);
            state.favorites = new Set(favData.favorites || []);
            state.notes = notesData.notes || {};
        } catch (err) {
            showToast(`加载收藏/备注失败: ${err.message}`, "error");
        }

        const data = await fetchSessions(undefined, undefined, 1, state.perPage);
        state.sessions = data.sessions;
        state.total = data.total;
        state.totalPages = data.total_pages;
        state.page = data.page;
        renderListView();
        loadStats();
    } catch (err) {
        showToast(`初始化失败: ${err.message}`, "error");
        document.getElementById("content").innerHTML = `<div class="empty-state"><div class="empty-title">加载失败: ${escapeHtml(err.message)}</div></div>`;
    }

    // SSE for real-time updates
    try {
        const evtSource = new EventSource("/api/events");
        evtSource.onmessage = (e) => {
            if (!e.data) return;
            try {
                const data = JSON.parse(e.data);
                if (data.type === "sessions_changed") {
                    showToast(`检测到新对话 (${data.count} 个)`, "info");
                    if (state.activeSection === "sessions" && state.viewMode === "list") {
                        state.page = 1;
                        refreshSessions();
                        loadStats();
                    }
                }
            } catch {}
        };
        evtSource.onerror = () => {
            // SSE will auto-reconnect
        };
    } catch {}
})();
