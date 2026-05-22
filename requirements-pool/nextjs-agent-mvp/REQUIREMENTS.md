# Next.js Agent MVP Requirements

> Status: Completed
> Created: 2026-05-21
> Priority: High

---

## 1. 问题陈述

### 当前局限性

- `manusxl/` 当前是普通 React/JSX 设计稿目录，入口为 `index.html`，通过 CDN 引入 React、ReactDOM、Babel，再加载 `app.jsx`、`shell.jsx`、`workspace.jsx`、`meta.jsx` 等文件。
- 当前前端没有标准工程化结构，没有 TypeScript、路由、服务端接口、构建脚本、环境变量管理，也不能安全地接入大模型 API Key。
- `OpenManus-main/` 是可参考的 Agent 源码，核心在 Python 的 `Manus`、`ToolCallAgent`、`BaseAgent`、工具集合和 LLM 封装中；但本次用户已确认前后端统一使用 Next.js 技术栈，因此不能继续沿用原 P0 文档里的 FastAPI + React/Vite 作为第一实现路径。
- 需求池现有 P0 文档以 FastAPI、React/Vite、Claude Sonnet 为默认假设；本需求需要新增一条 Next.js + TypeScript + DeepSeek V4 Flash 的 MVP 路线。

### 痛点

1. 前端只是静态设计稿，无法作为真实产品运行。
2. JS 文件缺少类型约束，后续 Agent 步骤、工具调用、文件产物等数据结构容易失控。
3. 大模型 API Key 若放在前端会泄露，必须放到服务端环境变量。
4. Manus 核心体验不是单次问答，而是“用户输入任务 → Agent 分步执行 → 实时展示过程 → 交付结果”，当前缺少完整闭环。
5. OpenManus 可复用概念多，但需要先确定 Next.js 产品形态下的最小闭环，避免一开始陷入完整工具链迁移。

---

## 2. 需求列表

### R1: Next.js + TypeScript 产品骨架

| ID | 需求描述 | 优先级 |
|----|----------|--------|
| R1.1 | 在 `manusxl/` 旁新建标准 Next.js + TypeScript 项目，不直接在旧 JSX 设计稿中原地改造 | P0 |
| R1.2 | 使用 App Router、TypeScript、ESLint、现代 React 组件结构 | P0 |
| R1.3 | 迁移现有 `manusxl` 的核心页面视觉：任务输入、执行中步骤面板、完成交付物、Library、Settings | P0 |
| R1.4 | 将原 JSX 中的共享 UI、主题、状态样例拆成 typed components、typed fixtures 和样式模块 | P0 |

### R2: 网页端 Agent 聊天与执行过程展示

| ID | 需求描述 | 优先级 |
|----|----------|--------|
| R2.1 | 首页直接进入工作台，不做营销落地页 | P0 |
| R2.2 | 用户可输入自然语言任务并提交 | P0 |
| R2.3 | UI 展示 Agent 执行过程，包括 thinking、tool_call、tool_result、message、finished、failed | P0 |
| R2.4 | 支持任务运行中、完成、失败、取消等状态展示 | P0 |
| R2.5 | 支持任务历史列表，点击后可查看历史步骤和结果 | P0 |

### R3: Next.js 服务端 API

| ID | 需求描述 | 优先级 |
|----|----------|--------|
| R3.1 | 提供 `POST /api/tasks` 创建任务 | P0 |
| R3.2 | 提供 `GET /api/tasks/:id` 查询任务状态、步骤和交付物 | P0 |
| R3.3 | 提供流式接口，用于前端实时接收 Agent 步骤，优先采用 SSE；如后续需要双向控制再扩展 WebSocket | P0 |
| R3.4 | 初版可使用内存任务存储，接口边界预留 SQLite/PostgreSQL 持久化 | P0 |
| R3.5 | 所有模型调用只发生在服务端 API 中，前端不得接触 API Key | P0 |

### R4: DeepSeek V4 Flash 接入

| ID | 需求描述 | 优先级 |
|----|----------|--------|
| R4.1 | 使用 DeepSeek 官方 OpenAI 兼容接口，base URL 为 `https://api.deepseek.com` | P0 |
| R4.2 | 默认模型使用 `deepseek-v4-flash` | P0 |
| R4.3 | API Key 从 `.env.local` 中的 `DEEPSEEK_API_KEY` 读取，不写入源码 | P0 |
| R4.4 | 封装统一 LLM client，后续可扩展模型配置、thinking/non-thinking 模式、工具调用 | P0 |

### R5: MVP Agent 执行闭环

| ID | 需求描述 | 优先级 |
|----|----------|--------|
| R5.1 | 第一版先实现轻量 Agent Loop：生成计划、逐步执行、输出步骤、给出最终回答 | P0 |
| R5.2 | 初版工具可先做 mock/simulated tools，用于验证 UI 和事件流；真实浏览器/文件/沙盒工具作为下一阶段接入 | P0 |
| R5.3 | 事件结构需兼容 OpenManus 的 think/act/observe 模型，便于后续迁移工具链 | P0 |
| R5.4 | 保留与 `OpenManus-main/app/agent/*`、`app/tool/*`、`app/llm.py` 的概念映射文档 | P0 |

---

## 3. 架构概览

### 目标架构

```text
Browser UI
  |
  | submit task / stream events
  v
Next.js App Router
  |
  +-- Server Components: workspace, library, settings shell
  +-- Route Handlers: /api/tasks, /api/tasks/[id], /api/tasks/[id]/events
  +-- Agent Runtime: task manager, event emitter, lightweight agent loop
  +-- LLM Client: DeepSeek OpenAI-compatible client
  |
  v
DeepSeek API
```

### 组件职责

| 组件 | 位置 | 职责 |
|------|------|------|
| Next.js App | 新项目目录，待确认命名 | 页面、路由、API、服务端运行时 |
| Workspace UI | `app/page.tsx` + components | 任务输入、步骤展示、交付物区域 |
| Task API | `app/api/tasks/*` | 创建任务、查询任务、流式事件 |
| Agent Runtime | `src/server/agent/*` | MVP Agent Loop、任务状态机、事件生产 |
| LLM Client | `src/server/llm/deepseek.ts` | DeepSeek V4 Flash 调用 |
| Shared Types | `src/types/*` | Message、Task、AgentStep、ToolCall、Artifact 等类型 |
| Legacy Design Source | `manusxl/*.jsx` | 迁移时参考的视觉和交互稿 |
| OpenManus Reference | `OpenManus-main/app/*` | Agent、工具链、LLM 适配的概念参考 |

---

## 4. 影响的文件

### 新增文件

| 文件 | 用途 |
|------|------|
| `requirements-pool/nextjs-agent-mvp/README.md` | 需求入口 |
| `requirements-pool/nextjs-agent-mvp/REQUIREMENTS.md` | 本需求文档 |
| `requirements-pool/nextjs-agent-mvp/DESIGN.md` | 技术设计文档 |
| 新 Next.js 项目目录 | 用户确认后创建，承载 TypeScript 产品实现 |

### 修改文件

| 文件 | 变更内容 |
|------|----------|
| `requirements-pool/README.md` | 添加本需求到需求池索引和统计 |

### 后续实施时可能迁移的旧文件

| 文件 | 迁移用途 |
|------|----------|
| `manusxl/app.jsx` | 页面组合和画板状态参考 |
| `manusxl/shell.jsx` | 主题、图标、基础 UI 组件参考 |
| `manusxl/workspace.jsx` | 工作台、任务步骤、交付物界面参考 |
| `manusxl/meta.jsx` | Library、Settings 界面参考 |

---

## 5. 验收标准

1. 新项目为标准 Next.js + TypeScript 工程，能够本地启动和构建。
2. 前端首页即工作台，用户可以提交任务。
3. 提交任务后 UI 能实时展示至少 5 类事件：thinking、tool_call、tool_result、message、finished/failed。
4. 服务端通过环境变量读取 `DEEPSEEK_API_KEY`，前端 bundle 中不包含 API Key。
5. 默认模型为 `deepseek-v4-flash`，base URL 为 `https://api.deepseek.com`。
6. 任务详情可展示完整步骤历史。
7. 旧 `manusxl` 视觉稿中的主工作台、运行中、完成、Library、Settings 至少完成第一版迁移。
8. 实施前必须由用户审核并确认本需求与技术设计。

---

## 6. 不在范围内

- 本阶段不实现完整 OpenManus Python 工具链迁移。
- 本阶段不实现浏览器自动化、真实文件沙盒、Docker/K8s、多用户、OAuth。
- 本阶段不做桌面端 My Computer。
- 本阶段不把 API Key 写入源码或提交到仓库。
- 本阶段不追求完整 Manus 1:1 复制，只做网页端 Agent 聊天与执行过程展示的 MVP。

---

## 7. 实施进度

- [x] 需求边界确认
- [x] 初步源码探索
- [x] DeepSeek 模型标识确认
- [x] 创建需求文档
- [x] 用户确认开始一次性开发
- [x] 创建 Next.js + TypeScript 项目骨架
- [x] 实现任务 API、SSE 事件流、DeepSeek 客户端和轻量 Agent Loop
- [x] 迁移工作台 UI、Library、Settings、交付物区域
- [x] 安装依赖并运行本地验证
- [x] 浏览器验收：页面可访问、DeepSeek 配置可见、任务完成、交付物展示、无控制台错误
- [x] 扩展交付物：Markdown、CSV、XLSX、PPTX、PDF、HTML、ZIP、Agent Trace JSON
- [x] 扩展工具层：真实网页搜索、URL 读取、任务工作区、数据分析、交付物生成工具
- [x] 工具层浏览器验收：真实 web_research 返回搜索结果，工作区文件落盘，8 类交付物生成
- [x] 交付物存储升级：artifact 正文写入 `.manusxl-data/workspaces/<taskId>/artifacts/`，`tasks.json` 仅保留元数据
- [x] 受控代码执行：接入 `python_execute` 与 `shell_execute`，输出写入任务 workspace 的 `tmp/`
- [x] 代码执行验收：Python 生成 `tmp/python-analysis.json`，Shell 生成 `tmp/shell-inspection.txt`
- [x] SQLite 持久化：新增 `manusxl.sqlite`，包含 `tasks`、`task_steps`、`task_files` 表，并迁移历史 `tasks.json`
- [x] Library 搜索：任务列表支持按 prompt / task id 搜索
- [x] 配置面板：模型、base URL、API Key 可保存到 SQLite 的 `app_config` 表
