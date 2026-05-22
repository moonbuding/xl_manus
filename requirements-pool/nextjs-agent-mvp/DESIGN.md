# Next.js Agent MVP Technical Design

> Requirement: REQUIREMENTS.md
> Status: Implemented
> Created: 2026-05-21

---

## 1. 架构概览

### 当前架构

- `manusxl/` 是静态 React/JSX 设计稿，通过 `index.html` + CDN React + Babel 在浏览器运行。
- `OpenManus-main/` 是 Python Agent 源码，包含 `BaseAgent.run()` 主循环、`ToolCallAgent.think()/act()`、`Manus` 工具集合、`LLM` OpenAI 兼容封装。
- 现有需求池 P0 默认 FastAPI + React/Vite + Claude，本次已由用户确认改为 Next.js + TypeScript + DeepSeek V4 Flash。

### 目标架构

```text
Next.js TypeScript App
  app/
    page.tsx                         # 工作台首页
    api/tasks/route.ts               # 创建任务
    api/tasks/[taskId]/route.ts      # 查询任务
    api/tasks/[taskId]/events/route.ts # SSE 事件流
  src/
    components/agent-workspace/*     # 输入、步骤、产物、任务列表
    server/agent/*                   # 轻量 Agent Runtime
    server/llm/deepseek.ts           # DeepSeek client
    server/tasks/task-store.ts       # MVP 任务状态
    types/agent.ts                   # 共享类型
```

---

## 2. 核心设计

### 2.1 项目创建策略

用户已确认不在旧 `manusxl` 原地改造，而是新建标准 Next.js + TypeScript 项目，再迁移旧页面。

建议新项目目录命名为：

```text
manusxl-next/
```

原因：

- 保留 `manusxl/` 作为设计稿和视觉参考。
- 避免新旧文件混杂。
- 等新项目稳定后，可选择归档旧 `manusxl/` 或将目录名切换。

### 2.2 运行时边界

- 前端只负责展示和交互。
- Next.js Route Handlers 负责创建任务、查询任务、推送事件。
- Agent Runtime 运行在服务端，持有任务状态和事件队列。
- DeepSeek API Key 只在服务端读取。

### 2.3 模型选择

已查官方文档，DeepSeek V4 Flash 的 API model id 为：

```text
deepseek-v4-flash
```

OpenAI 兼容 base URL：

```text
https://api.deepseek.com
```

环境变量：

```text
DEEPSEEK_API_KEY=...
DEEPSEEK_MODEL=deepseek-v4-flash
DEEPSEEK_BASE_URL=https://api.deepseek.com
```

---

## 3. 详细设计

### 3.1 数据类型

```ts
export type TaskStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

export type AgentEventType =
  | "thinking"
  | "plan"
  | "tool_call"
  | "tool_result"
  | "message"
  | "artifact"
  | "finished"
  | "failed";

export interface AgentEvent {
  id: string;
  taskId: string;
  type: AgentEventType;
  createdAt: string;
  stepIndex: number;
  title?: string;
  content?: string;
  payload?: unknown;
}

export interface Task {
  id: string;
  prompt: string;
  status: TaskStatus;
  model: string;
  createdAt: string;
  updatedAt: string;
  events: AgentEvent[];
  artifacts: Artifact[];
  error?: string;
}

export interface Artifact {
  id: string;
  taskId: string;
  name: string;
  type: "xlsx" | "pptx" | "pdf" | "html" | "zip" | "txt" | "json";
  url?: string;
  size?: number;
}
```

### 3.2 MVP Agent Runtime

第一版不直接移植 OpenManus Python，而是实现 Next.js 内轻量 Agent Loop，用于打通产品体验：

1. 接收用户 prompt。
2. 调用 DeepSeek 生成简短执行计划。
3. 将计划拆成步骤事件推给前端。
4. 对每个步骤生成模拟工具调用和观察结果。
5. 最后调用 DeepSeek 汇总最终结果。
6. 将完整步骤保存在任务状态中。

后续真实工具接入时，把 simulated tool executor 替换为真实工具层即可。

### 3.3 与 OpenManus 的映射关系

| OpenManus 概念 | Next.js MVP 概念 | 备注 |
|----------------|------------------|------|
| `BaseAgent.run()` | `runAgentTask(taskId, prompt)` | 服务端任务主循环 |
| `ToolCallAgent.think()` | `generatePlan()` / `nextAction()` | 先做轻量规划与动作生成 |
| `ToolCallAgent.act()` | `executeToolCall()` | 初版 mock，后续接真实工具 |
| `Message` / `Memory` | `AgentEvent[]` + future message store | 前端优先展示事件，后续补 message history |
| `ToolCollection` | `ToolRegistry` | 后续扩展浏览器、文件、搜索工具 |
| `LLM.ask_tool()` | `deepseek.chat()` | DeepSeek OpenAI 兼容接口 |

### 3.4 流式事件

优先用 SSE：

- 前端实现简单。
- 单向推送足够覆盖第一版“看 Agent 工作”。
- 与 Next.js Route Handler 兼容。

如果后续需要暂停、恢复、人工确认、远程浏览器控制，再升级为 WebSocket。

---

## 4. API 设计

### `POST /api/tasks`

Request:

```json
{
  "prompt": "调研中国新能源车前五，并生成对比分析",
  "model": "deepseek-v4-flash"
}
```

Response:

```json
{
  "taskId": "task_xxx",
  "status": "queued"
}
```

### `GET /api/tasks/:taskId`

Response:

```json
{
  "id": "task_xxx",
  "prompt": "...",
  "status": "running",
  "events": [],
  "artifacts": []
}
```

### `GET /api/tasks/:taskId/events`

SSE event:

```text
event: agent_event
data: {"id":"evt_xxx","type":"thinking","content":"正在拆解任务..."}
```

---

## 5. 前端组件

### 页面结构

```text
AgentWorkspace
  Sidebar
    TaskList
    SettingsButton
  MainPanel
    TaskHeader
    StepTimeline
    ArtifactRail
    PromptComposer
```

### 从旧 `manusxl` 迁移的界面

| 旧设计稿 | 新组件 |
|----------|--------|
| `ScreenA_Empty` | `EmptyWorkspace` |
| `ScreenB_Timeline` | `StepTimeline` |
| `ScreenC_Cards` | 作为步骤视图候选，MVP 可先不默认启用 |
| `ScreenD_Done` | `CompletedTaskView` + `ArtifactRail` |
| `ScreenE_Library` | `TaskLibrary` |
| `ScreenF_Settings` | `SettingsPanel` |
| `THEMES` | `theme.css` 或 Tailwind tokens |
| `I` icons | 优先替换为 `lucide-react` |

### 设计约束

- 首页就是产品工作台。
- 不做宣传页。
- 步骤面板要稳定，不因内容长度导致布局跳动。
- API Key 设置不放在前端输入框作为 MVP 默认路径，优先使用 `.env.local`。

---

## 6. 集成点

### DeepSeek Client

建议使用 OpenAI SDK 的兼容模式：

```ts
import OpenAI from "openai";

export const deepseek = new OpenAI({
  apiKey: process.env.DEEPSEEK_API_KEY,
  baseURL: process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com",
});
```

默认模型：

```ts
const model = process.env.DEEPSEEK_MODEL ?? "deepseek-v4-flash";
```

### 环境变量校验

服务端启动或第一次请求时检查：

- `DEEPSEEK_API_KEY` 必填
- `DEEPSEEK_MODEL` 可选
- `DEEPSEEK_BASE_URL` 可选

---

## 7. 实施阶段

### Phase 1: Next.js 骨架

- 新建 `manusxl-next/`
- 初始化 Next.js + TypeScript
- 安装必要依赖：OpenAI SDK、lucide-react、样式方案
- 建立目录结构和共享类型

验证：

- 本地启动成功
- TypeScript 检查通过

### Phase 2: 迁移 UI

- 从旧 `manusxl` 提取工作台主界面
- 改写为 typed React components
- 建立 mock tasks 和 mock events

验证：

- 浏览器打开后可看到工作台、任务列表、步骤流、交付物区域

### Phase 3: API 与任务状态

- 实现 `POST /api/tasks`
- 实现 `GET /api/tasks/:id`
- 实现内存 task store

验证：

- 前端提交任务后能得到 task id
- 刷新任务详情可看到状态变化

### Phase 4: SSE 事件流

- 实现 `/api/tasks/:id/events`
- 前端订阅事件并追加到步骤面板
- 支持完成和失败事件

验证：

- 提交任务后实时出现步骤

### Phase 5: DeepSeek 接入

- 封装 DeepSeek client
- 用 `deepseek-v4-flash` 生成计划与最终总结
- 错误时前端显示失败状态

验证：

- 使用真实 API Key 完成一次任务
- 前端 bundle 中不出现 API Key

---

## 8. 文件清单

### 文档阶段已创建

| 文件 | 状态 |
|------|------|
| `requirements-pool/nextjs-agent-mvp/README.md` | 已创建 |
| `requirements-pool/nextjs-agent-mvp/REQUIREMENTS.md` | 已创建 |
| `requirements-pool/nextjs-agent-mvp/DESIGN.md` | 已创建 |

### 实施阶段拟新增

| 文件/目录 | 用途 |
|-----------|------|
| `manusxl-next/` | 新 Next.js TypeScript 项目 |
| `manusxl-next/app/page.tsx` | 工作台首页 |
| `manusxl-next/app/api/tasks/route.ts` | 创建任务 |
| `manusxl-next/app/api/tasks/[taskId]/route.ts` | 查询任务 |
| `manusxl-next/app/api/tasks/[taskId]/events/route.ts` | SSE 流 |
| `manusxl-next/src/server/llm/deepseek.ts` | DeepSeek client |
| `manusxl-next/src/server/agent/*` | MVP Agent Runtime |
| `manusxl-next/src/server/tasks/*` | 任务状态管理 |
| `manusxl-next/src/types/agent.ts` | 共享类型 |
| `manusxl-next/.env.local.example` | 环境变量示例，不含真实 key |

---

## 9. 验证清单

- [x] `npm run dev` 能启动 Next.js
- [x] `npm run typecheck` 或等价检查通过
- [x] `npm run lint` 通过
- [x] `npm run build` 通过
- [x] 首页可提交任务
- [x] 任务步骤实时展示
- [x] DeepSeek 调用成功
- [x] API Key 使用 `.env.local`，不写入源码提交路径
- [x] 旧 `manusxl` 的主视觉体验已迁移到新项目第一版
- [x] 真实交付物生成：Markdown、CSV、XLSX、PPTX、PDF、HTML、ZIP、Agent Trace JSON
- [x] 服务端工具注册层：`task_planner`、`web_research`、`web_fetch`、`file_workspace`、`data_analysis`、`artifact_writer`
- [x] 真实网页搜索验收：任务事件中返回 5 条候选资料，并沉淀到 Agent Trace
- [x] artifacts/tmp 分层：新任务交付物落盘到独立 workspace，下载接口从真实文件读取并兼容旧内联任务
- [x] 受控沙盒执行：`python_execute` 写入 `tmp/python-analysis.json`，`shell_execute` 写入 `tmp/shell-inspection.txt`
- [x] SQLite Repository：`tasks`、`task_steps`、`task_files`、`app_config` 表已建立，历史 JSON 可迁移
- [x] 配置面板可编辑：支持保存 DeepSeek model / base URL / API Key

---

## 10. 风险与缓解措施

| 风险 | 影响 | 缓解 |
|------|------|------|
| Next.js 服务端长任务在 serverless 环境下受限 | 任务可能中断 | MVP 默认本地/自托管 Node runtime；后续再拆 worker |
| 内存 task store 重启丢失 | 历史不可持久化 | MVP 接受，接口边界预留 SQLite |
| 一开始移植完整 OpenManus 成本过高 | 进度失控 | 先做轻量 Agent Loop 和事件流，再逐步替换真实工具 |
| API Key 泄露 | 安全风险 | 只用 `.env.local`，不写源码，不传前端 |
| DeepSeek thinking 模式和工具调用细节变化 | Agent 行为不稳定 | 封装 LLM 层，保留模型参数配置入口 |
| 旧设计稿大量 inline style | 迁移成本高 | 先保留视觉重点，逐步组件化和类型化 |

---

## 11. 待用户确认的问题

1. 新 Next.js 项目目录是否使用 `manusxl-next/`？如果你希望最终目录仍叫 `manusxl/`，我建议先新建 `manusxl-next/`，验收后再替换。
2. MVP 的真实工具是否允许先 mock？我的建议是允许，这样可以先把核心产品体验和 DeepSeek 调用跑通。
3. 任务历史 MVP 是否接受内存存储？如果你希望一开始就可持久化，可以把 SQLite 提前到 Phase 3。
