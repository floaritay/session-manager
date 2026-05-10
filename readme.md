# Session Manager

管理 Claude Code 和 OpenAI Codex 对话记录的本地 Web 应用。

## 功能特性

### 对话浏览

- 统一查看 Claude Code 和 OpenAI Codex 的所有对话记录
- 按来源筛选：全部 / 仅 Claude / 仅 Codex
- 三种分组方式：
  - **按项目**：按对话所属项目目录分组
  - **按时间**：今天 / 昨天 / 本周 / 本月 / 更早
  - **按模型**：按使用的 AI 模型分组
- 每个分组默认展开，点击分组标题可折叠/展开
- 全文搜索：同时搜索对话标题和消息内容

### 对话详情

- 点击对话进入详情视图，显示完整对话内容
- 消息角色区分：用户消息（灰色背景）、助手消息（白色背景）、系统消息（黄色居中）
- 每条消息下方显示紧凑信息行：
  - 工具调用名称（绿色，有错误时显示红色）
  - 思考过程标记（紫色）
  - Token 用量（输入/输出）
  - 消息时间戳
- 点击信息行可展开查看详细内容：
  - 工具调用的完整输入参数（JSON 格式）
  - 工具调用的返回结果
  - 工具调用耗时（毫秒）
  - 思考过程全文
- 支持查看子代理（Subagent）调用记录

### 统计面板

页面顶部显示四项统计：
- **对话**：对话总数
- **消息**：所有对话的消息总数
- **TOKENS**：输入 + 输出 Token 总量（自动格式化为 K/M）
- **常用工具**：使用频率最高的 5 个工具及其调用次数

统计数据缓存 60 秒，删除对话后自动刷新。

### 对话管理

- **导出**：将对话导出为 Markdown 或 JSON 格式，在新窗口打开
- **删除**：单个删除，移至系统回收站（非永久删除）
- **批量删除**：API 支持批量删除多条对话

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

### Claude Code

- **路径**：`~/.claude/projects/<编码路径>/<uuid>.jsonl`
- **解析方式**：两遍扫描 JSONL 文件
  - 第一遍：提取会话元数据（AI 生成标题、时长、Git 分支、时间戳）
  - 第二遍：构建消息列表，通过 `pending_tool_calls` 字典匹配 `tool_use` 和 `tool_result`
- **子代理**：读取 `subagents/` 目录下的 `.meta.json` 文件
- **删除**：通过 `send2trash` 移至回收站

### OpenAI Codex

- **路径**：`~/.codex/state_5.sqlite`（会话元数据）+ rollout JSONL 文件（消息内容）
- **解析方式**：从 SQLite `threads` 表读取会话信息，两遍解析 rollout 文件
  - `exec_command_begin/end` 事件 → ToolCall 对象
  - `token_count` 事件 → TokenUsage
  - `task_complete` 事件 → 时长计算
- **删除**：同时删除 SQLite 记录和 rollout 文件

---

## 页面操作指南

### 列表视图

1. **筛选来源**：点击顶部 "全部" / "Claude" / "Codex" 按钮
2. **切换分组**：点击 "项目" / "时间" / "模型" 按钮
3. **折叠分组**：点击分组标题栏
4. **搜索**：在右侧搜索框输入关键词，自动搜索标题和消息内容
5. **进入对话**：点击任意对话行

### 详情视图

1. **返回列表**：点击左上角 "返回" 按钮或按 `Escape`
2. **查看工具调用**：点击消息下方的绿色工具名称，展开查看输入参数和返回结果
3. **查看思考过程**：点击紫色 "思考" 标记展开
4. **查看子代理**：点击 "子代理" 按钮（仅 Claude 对话可用）
5. **导出对话**：点击 "导出" 按钮，以 Markdown 格式在新窗口打开
6. **删除对话**：点击 "删除" 按钮，确认后移至回收站

---

## API 接口

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/stats` | 获取统计数据 |
| `GET` | `/api/sessions?source=&q=` | 列出/搜索对话 |
| `GET` | `/api/sessions/{source}/{id}` | 获取对话消息 |
| `GET` | `/api/sessions/{source}/{id}/subagents` | 获取子代理列表 |
| `GET` | `/api/sessions/{source}/{id}/export?format=markdown\|json` | 导出对话 |
| `POST` | `/api/sessions/delete-batch` | 批量删除（body: `{"sessions": [{"source": "claude", "id": "..."}]}`) |
| `DELETE` | `/api/sessions/{source}/{id}` | 删除单个对话 |

`source` 参数值为 `claude` 或 `codex`。

---

## 技术架构

```
~/.claude/projects/<path>/<uuid>.jsonl   → ClaudeParser
~/.codex/state_5.sqlite + rollout JSONL  → CodexParser
                                              ↓
                                       SessionService (合并两者)
                                              ↓
                                         FastAPI (/api/*)
                                              ↓
                                    单页应用 (HTML + CSS + JS)
```

- **后端**：FastAPI + Pydantic，无数据库，直接解析文件
- **前端**：原生 HTML/CSS/JS，无框架，无构建步骤
- **字体**：IBM Plex Mono（等宽）
- **样式**：白色背景 + 黑色文字，2px 粗边框强调，极简单色风格
