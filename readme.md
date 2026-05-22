# Session Manager

管理 Claude Code 和 OpenAI Codex 对话记录，以及 Claude Code 配置（Skills、MCP、Rules、Plugins）的本地 Web 应用。

## 功能特性

![alt text](images/Session-Manager.png)

### 对话管理

- 统一查看 Claude Code 和 OpenAI Codex 的所有对话记录
- 按来源筛选：全部 / 仅 Claude / 仅 Codex
- 三种分组方式：按项目、按时间（今天/昨天/本周/本月/更早）、按模型
- 每个分组默认展开，点击分组标题可折叠/展开
- 全文搜索：同时搜索对话标题和消息内容
- 点击对话进入详情视图，显示完整对话内容
- 消息下方显示紧凑信息行：工具调用名称、思考过程、Token 用量、时间戳
- 点击信息行可展开查看工具调用参数、返回结果、思考过程全文
- 查看子代理（Subagent）调用记录
- 导出对话为 Markdown / JSON 格式
- 删除对话至系统回收站
- 统计面板：对话数、消息数、Token 总量、常用工具

### Skills 管理

- 查看所有已安装的 Skills，按用户级/项目级分组
- 每组内按插件名分组，显示 Skill 名称、描述、来源市场
- 点击 Skill 查看完整 SKILL.md 内容（Markdown 渲染）
- 只显示已安装版本，自动过滤旧缓存避免重复

### MCP 服务器管理

- 查看所有配置的 MCP 服务器，按用户级/项目级分组
- 显示传输类型（stdio/http/sse）、命令或 URL
- 用户级来自 `~/.claude/plugins/marketplaces/` 和 `settings.json`
- 项目级来自项目目录下的 `.mcp.json` 和 `settings.local.json`

### Rules 管理

- 查看所有规则文件，按用户级/项目级分组
- 用户级：`~/.CLAUDE.md`
- 项目级：各项目的 `CLAUDE.md` 和 `.claude/settings.local.json`
- 点击规则查看完整文件内容

### Plugins 管理

- 查看所有已安装插件，按用户级/项目级分组
- 每组内按市场来源分组
- 显示启用/禁用/封锁状态、Skill 数量、描述
- 统计面板显示已启用插件数量

### 键盘快捷键

| 按键 | 功能 |
|------|------|
| `Ctrl+K` | 聚焦搜索框 |
| `Escape` | 清空搜索并失焦 / 从详情视图返回列表 |

---

## 安装

```bash
pip install -r requirements.txt
```

依赖项：
- `fastapi` >= 0.115.0
- `uvicorn` >= 0.34.0
- `jinja2` >= 3.1.0
- `send2trash` >= 1.8.0
- `pydantic` >= 2.0.0

## 运行

```bash
python main.py
```

启动后自动打开浏览器访问 `http://127.0.0.1:8765`。

如果端口被占用，先查找并关闭进程：

```bash
netstat -ano | grep ":8765"
taskkill //F //PID <进程ID>
```

---

## 数据来源

### 对话记录

- **Claude Code**：`~/.claude/projects/<编码路径>/<uuid>.jsonl`，两遍扫描解析
- **OpenAI Codex**：`~/.codex/state_5.sqlite` + rollout JSONL 文件

### Skills

- 路径：`~/.claude/plugins/cache/<市场>/<插件>/<版本>/skills/<名称>/SKILL.md`
- 只读取 `installed_plugins.json` 中已安装的版本，避免旧缓存重复
- 解析 YAML frontmatter（name、description、license）

### MCP 服务器

- 用户级：`~/.claude/plugins/marketplaces/*/external_plugins/*/.mcp.json` + `settings.json` mcpServers
- 项目级：项目目录下 `.mcp.json` + `.claude/settings.local.json` mcpServers
- 支持三种传输类型：stdio（命令行）、http（远程）、sse（Server-Sent Events）

### Rules

- 用户级：`~/.CLAUDE.md`
- 项目级：`<项目>/CLAUDE.md` + `<项目>/.claude/settings.local.json`

### Plugins

- 已安装插件：`~/.claude/plugins/installed_plugins.json`
- 启用状态：`~/.claude/settings.json` enabledPlugins
- 封锁列表：`~/.claude/plugins/blocklist.json`
- 插件元数据：`<安装路径>/.claude-plugin/plugin.json`

---

## 页面操作指南

### 导航栏

顶部导航栏有五个标签：**对话**、**Skills**、**MCP**、**Rules**、**Plugins**。点击切换不同视图。

### 对话视图

1. **筛选来源**：点击 "全部" / "Claude" / "Codex" 按钮
2. **切换分组**：点击 "项目" / "时间" / "模型" 按钮
3. **折叠分组**：点击分组标题栏
4. **搜索**：在搜索框输入关键词
5. **进入对话**：点击任意对话行
6. **返回列表**：点击 "返回" 按钮或按 `Escape`

### 配置视图（Skills / MCP / Rules / Plugins）

1. 所有配置视图按 **用户级** / **项目级** 分组
2. 点击分组标题栏可折叠/展开
3. Skills 和 Plugins 有二级分组（按插件名/市场来源）
4. 点击 Skill 或 Rule 可查看详情内容
5. 搜索框在所有标签页下可用

---

## API 接口

### 对话

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/stats` | 获取统计数据 |
| `GET` | `/api/sessions?source=&q=` | 列出/搜索对话 |
| `GET` | `/api/sessions/{source}/{id}` | 获取对话消息 |
| `GET` | `/api/sessions/{source}/{id}/subagents` | 获取子代理列表 |
| `GET` | `/api/sessions/{source}/{id}/export?format=markdown\|json` | 导出对话 |
| `POST` | `/api/sessions/delete-batch` | 批量删除 |
| `DELETE` | `/api/sessions/{source}/{id}` | 删除单个对话 |

### 配置管理

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/config/stats` | 配置统计 |
| `GET` | `/api/skills?q=` | 技能列表 |
| `GET` | `/api/skills/{id:path}/body` | 技能全文 |
| `GET` | `/api/mcp?q=` | MCP 服务器列表 |
| `GET` | `/api/rules?scope=&q=` | 规则列表 |
| `GET` | `/api/rules/{id:path}/content` | 规则全文 |
| `GET` | `/api/plugins?q=` | 插件列表 |

---

## 技术架构

```
对话数据:
~/.claude/projects/<path>/<uuid>.jsonl   → ClaudeParser
~/.codex/state_5.sqlite + rollout JSONL  → CodexParser
                                              ↓
                                       SessionService
                                              ↓
配置数据:
~/.claude/plugins/cache/.../SKILL.md     → SkillsParser
~/.claude/plugins/marketplaces/.../.mcp.json → McpParser
~/.CLAUDE.md + 项目/CLAUDE.md            → RulesParser
~/.claude/plugins/installed_plugins.json  → PluginsParser
                                              ↓
                                       ConfigService
                                              ↓
                                         FastAPI (/api/*)
                                              ↓
                                    单页应用 (HTML + CSS + JS)
```

- **后端**：FastAPI + Pydantic，无数据库，直接解析文件
- **前端**：原生 HTML/CSS/JS，无框架，无构建步骤
- **字体**：IBM Plex Mono（等宽）
- **样式**：白色背景 + 黑色文字，2px 粗边框强调，极简单色风格
