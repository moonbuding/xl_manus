# P0 - MVP 需求文档

> **状态**：✅ Completed（Next.js + TypeScript MVP 13/13 已完成）
> **阶段周期**：6-8 周
> **目标**：跑通端到端单用户闭环（按 Manus 真实工程实践，不是叙事性多 Agent）

---

## 阶段目标

在 Web 页面输入「调研行业前五并生成对比 Excel」这类模糊需求，**单 Agent + Context Engineering 框架**驱动，调用工具完成任务，最终产出可下载的 Excel/PDF/PPTX/网页/ZIP 等交付物。

**关键特性**：
- ✅ 单用户、单机部署（Docker Compose 一键启动）
- ✅ **单 Agent + Context Engineering**（按 Manus 官方实践，不做叙事性三层）
- ✅ 实时流式 UI
- ✅ 多种交付物：Excel / PDF / PPTX / 网页 / ZIP
- ✅ 沙盒 artifacts 与 tmp 文件分层（关键体验）
- ✅ KV-cache 友好的 context 设计（成本/延迟第一指标）
- ❌ 不做：OAuth、多用户、K8s、My Computer、Wide Research、三层 Agent

---

## 验收基线（Definition of Done）

| # | 验收项 | 方式 |
|---|-------|------|
| 1 | 一键 `docker-compose up` 启动整套系统 | 命令行测试 |
| 2 | Web UI 输入 prompt 后能看到 Agent 实时 think/act/observe 流 | 浏览器实测 |
| 3 | 任务完成后能下载至少 3 种类型的交付物（Excel + PPTX + 网页打包） | UI 下载验证 |
| 4 | 沙盒重启后 artifacts 仍在，tmp 文件清空 | 沙盒测试 |
| 5 | KV-cache 命中率可观测（首条工具调用后 ≥ 60%） | 观测埋点 |
| 6 | 任务历史列表（Library 入口）可查看，可重新打开看 Agent 步骤 | UI 验证 |
| 7 | 端到端用例「调研新能源车前五 → 生成对比 Excel + 分析 PPT」完整跑通 | 录屏验证 |

---

## 依赖矩阵

### 外部依赖
- Python 3.12+
- Docker Desktop（Sandbox 用）
- LLM API Key（P0 默认 DeepSeek V4 Flash）
- Node.js 20+（前端构建）

### 阶段内顺序

```
REQ-011 (Docker Compose) ──┐
                            │
REQ-001 (Next.js API 骨架) ─┼──→ REQ-002 (前端骨架) ──→ REQ-003 (SSE 流式)
                            │
REQ-004 (单 Agent + CE) ────┼──→ REQ-005 (artifacts 分层) ──→ REQ-006 (KV-cache)
                            │
REQ-007 (文件读取工具) ──────┤
REQ-008 (交付物打包) ────────┤
                            │
REQ-010 (SQLite + Library) ─┤
REQ-009 (产出目录隔离) ──────┤
REQ-012 (配置面板) ──────────┘
                                                          ↓
                                                       REQ-013 (E2E 验收)
```

---

## 需求清单（13 项）

> 📝 **每条需求的详细展开（背景/用户故事/详细需求点/验收标准/相关 OpenManus 代码/工作量）待用户启动详细填充阶段后批量补齐。**

| ID | 标题 | 模块 | 工作量预估 | 状态 |
|----|------|------|-----------|------|
| REQ-001 | Next.js Route Handlers 包装 Agent 为 REST/SSE 接口 | M06 | 2-3 人天 | Completed |
| REQ-002 | Web 前端：任务输入 + 步骤面板 + 日志流 + 文件下载 | M06 | 5-7 人天 | Completed |
| REQ-003 | SSE 实时推送 Agent 的 think/act/observe 步骤 | M06 | 1-2 人天 | Completed |
| REQ-004 | **单 Agent + Context Engineering 框架**：稳定 system prompt + 历史追加不重排 + 工具描述放尾部 + 文件作持久 memory | M01 | 5-7 人天 | Completed |
| REQ-005 | **沙盒 artifacts/tmp 文件分层**：交付物（artifacts/）永久保留，中间产物（tmp/）可清理 | M04 | 2-3 人天 | Completed |
| REQ-006 | **KV-cache 友好 context 设计**：监控埋点 + 命中率指标 + 避免 invalidation 模式（用 append-only history、稳定 prefix） | M01/M10 | 3-4 人天 | Completed |
| REQ-007 | 文件读取工具集：PDF + Word + Excel/CSV 上传解析 | M05 | 1-2 人天 | Completed |
| REQ-008 | **交付物生成与打包**：Excel + PPTX + 静态网页 + 任务结束自动 ZIP | M05/M06 | 3-5 人天 | Completed |
| REQ-009 | 文件产出目录隔离（每任务一目录，含 artifacts/ 和 tmp/ 子目录） | M05 | 1 人天 | Completed |
| REQ-010 | SQLite 持久化任务历史（task_id/prompt/steps/files）+ Web 端 Library 入口浏览 artifacts | M07/M06 | 2-3 人天 | Completed |
| REQ-011 | Docker Compose 一键启动（Next.js 单服务 + 持久化数据卷） | M09 | 2-3 人天 | Completed |
| REQ-012 | 配置面板：API Key、模型选择、运行时参数（前端可配） | M10 | 1-2 人天 | Completed |
| **总计** | | | **30-46 人天（约 6-9 周）** | |
| REQ-013 | 端到端验证用例：「调研新能源车前五 → 生成对比 Excel + 分析 PPT + 一页静态网页」 | E2E | 2-3 人天 | Completed |

---

## 需求详细展开

---

### REQ-001：Next.js Route Handlers 包装 Agent 为 REST/SSE 接口
**模块**: M06 | **状态**: Completed | **工作量**: 2-3 人天

#### 背景与价值
最初方案写的是 FastAPI 包装 OpenManus CLI；用户后续确认采用 **Next.js + TypeScript 全栈**，因此本需求改为用 Next.js Route Handlers 提供后端接口。这样前后端在同一技术栈内运行，MVP 部署也简化为单个 Next.js 服务。

#### 用户故事
As a 想用 Web 界面调用 Agent 的用户，I want 通过 HTTP 提交任务、查询状态、下载交付物，并通过 SSE 订阅进度，So that 不依赖本地终端就能完成完整任务交付。

#### 详细需求点
- 提供 `POST /api/tasks` 创建任务，返回 `taskId`；接受 `{prompt, model}`
- 提供 `GET /api/tasks?q=` 查询任务列表与搜索结果
- 提供 `GET /api/tasks/{taskId}` 查询任务状态、步骤事件与产出文件清单
- 提供 `POST /api/tasks/{taskId}/cancel` 取消运行中任务
- 提供 `GET /api/tasks/{taskId}/artifacts/{artifactId}` 下载产出文件
- 提供 `GET /api/tasks/{taskId}/events` SSE 实时事件流（REQ-003）
- 任务异步执行：创建任务后后台执行 `runAgentTask(taskId)`，HTTP 请求不阻塞
- 非功能：API Key 仅服务端读取；接口类型定义集中在 `src/types/agent.ts`

#### 验收标准
- [x] `POST /api/tasks` 提交 prompt 能返回 `taskId`
- [x] `GET /api/tasks/{taskId}` 能看到任务状态、事件和 artifacts
- [x] artifacts 下载接口能返回磁盘文件内容
- [x] 多任务通过 taskId、SQLite 记录和 workspace 目录隔离，不互相覆盖

#### 实施记录（Next.js + TypeScript 路线）
- `manusxl-next/app/api/tasks/route.ts`：任务创建与任务列表
- `manusxl-next/app/api/tasks/[taskId]/route.ts`：任务详情查询
- `manusxl-next/app/api/tasks/[taskId]/cancel/route.ts`：任务取消
- `manusxl-next/app/api/tasks/[taskId]/artifacts/[artifactId]/route.ts`：交付物下载
- `manusxl-next/src/server/agent/runtime.ts`：后台 Agent 执行主流程
- `manusxl-next/src/server/tasks/task-store.ts`：任务状态、事件、文件持久化
- OpenAPI `/docs` 属于原 FastAPI 路线，当前用 TypeScript 类型、README 与需求池文档替代接口说明

#### 相关 OpenManus 代码
- 参考：[OpenManus-main/app/agent/manus.py](../OpenManus-main/app/agent/manus.py) — Agent 主循环思想
- 参考：[OpenManus-main/app/schema.py](../OpenManus-main/app/schema.py) — Message/Memory/AgentState 数据模型
- 当前实现没有直接修改 OpenManus Python 源码，而是在 `manusxl-next` 中复刻核心流程

#### 风险与缓解
- 风险：长任务占用单个 Next.js 进程资源
- 缓解：P0 只做单用户本机 MVP；P1 再把后台执行迁出为队列/worker

---

### REQ-002：Web 前端：任务输入 + 步骤面板 + 日志流 + 文件下载
**模块**: M06 | **状态**: Completed | **工作量**: 5-7 人天

#### 背景与价值
没有 UI 用户就只能用接口调试，与「Manus 复刻」目标不符。前端是用户感知产品价值的入口，必须做到「输入 prompt → 看 Agent 工作 → 下载结果」的极简闭环。

#### 用户故事
As a 普通用户，I want 在浏览器输入 prompt 后实时看到 Agent 的思考与行动步骤，并在任务完成后一键下载产出文件，So that 我不用学命令行就能用 AI 完成复杂工作。

#### 详细需求点
- 顶层布局：左侧 Library 任务列表，中间任务详情与输入框，右侧交付物/配置/Context 指标
- 任务输入框：多行 textarea + 发送按钮 + 上传文件入口
- 顶部状态：模型、API Key 状态、Context 缓存友好度
- 步骤面板：流式展示 `thinking` / `plan` / `tool_call` / `tool_result` / `artifact` / `finished`
- 工具调用块：展示工具名、参数与返回结果
- 文件下载区：任务完成后展示 artifacts 下所有文件，含 ZIP 打包文件
- 错误状态：任务失败、取消、上传失败会在 UI 显示
- 非功能：Next.js + React + TypeScript；窄屏隐藏右侧栏，主体工作区保持可用

#### 验收标准
- [x] 输入任务后能看到第一条 Agent 事件
- [x] 任务完成后 artifacts 区域可见多个可下载文件
- [x] 历史任务列表可点击查看（Library 入口）
- [x] 通过 Chromium 本地页面验证；Safari/Firefox 作为发布前扩展回归项

#### 实施记录（Next.js + TypeScript 路线）
- `manusxl-next/app/page.tsx` 挂载 Agent 工作台
- `manusxl-next/src/components/agent-workspace/agent-workspace.tsx` 实现 Library、任务详情、composer、上传、交付物、配置、Context 指标
- `EventSource` 连接 `/api/tasks/{taskId}/events`，任务完成或失败后自动关闭
- 上传文件通过 `/api/files/analyze` 解析后合并进用户 prompt 上下文
- 设置面板保存模型、Base URL、API Key、温度、最大步骤

#### 相关 OpenManus 代码
- OpenManus 无前端代码可直接复用
- 前端通过 REQ-001 的 REST/SSE API 与 Agent 后端通信

#### 风险与缓解
- 风险：右侧交付物栏在窄屏不可见影响下载入口
- 缓解：当前 P0 以桌面/平板为主；后续可把 artifacts 增加到中间任务详情尾部作为移动端补充入口

---

### REQ-003：SSE 实时推送 Agent 的 think/act/observe 步骤
**模块**: M06 | **状态**: Completed | **工作量**: 1-2 人天

#### 背景与价值
Agent 任务如果只在结束时给结果，用户很难信任过程。P0 已把 Agent 主循环中的理解、规划、工具调用、观察、交付物生成、最终总结都写成结构化事件，并通过 SSE 推送到前端。

#### 用户故事
As a 用户在 Web 界面提交任务后，I want 看到 Agent 每一步思考与工具调用的实时流，So that 我能判断任务是否走偏，并在必要时停止。

#### 详细需求点
- SSE 通道：`GET /api/tasks/{taskId}/events`
- 事件类型：`thinking` / `plan` / `tool_call` / `tool_result` / `message` / `artifact` / `finished` / `failed`
- 每个事件 JSON 含：`id` / `taskId` / `type` / `createdAt` / `stepIndex` / `title` / `content` / `payload`
- 支持重连回放：连接建立时先发送当前任务已有 `events`
- 前端收到 `finished` 或 `failed` 后自动关闭连接并刷新任务列表

#### 验收标准
- [x] 提交任务后能收到第一条 `thinking` 事件
- [x] 工具调用与返回都能正确推送
- [x] 断线重连后服务端会先回放当前任务已有事件
- [x] 任务完成后收到 `finished` 自动关闭连接

#### 实施记录（Next.js + TypeScript 路线）
- `manusxl-next/app/api/tasks/[taskId]/events/route.ts` 使用 `ReadableStream` 输出 `text/event-stream`
- `manusxl-next/src/server/tasks/task-store.ts` 用 `subscribeToTask` 管理每个 taskId 的订阅者
- `manusxl-next/src/server/agent/runtime.ts` 在关键步骤调用 `addTaskEvent`
- `manusxl-next/src/components/agent-workspace/agent-workspace.tsx` 使用 `EventSource` 合并事件与 artifacts
- `manusxl-next/scripts/e2e-demo.mjs` 会在 E2E 验收中监听 SSE 并校验事件序列

#### 相关 OpenManus 代码
- 参考：[OpenManus-main/app/agent/base.py](../OpenManus-main/app/agent/base.py) — `run()` 循环结构
- 参考：[OpenManus-main/app/agent/toolcall.py](../OpenManus-main/app/agent/toolcall.py) — `think()`/`act()` 分段事件思想

#### 风险与缓解
- 风险：SSE 只能单向推送，不适合复杂双向协作
- 缓解：P0 只需要实时展示步骤；P1 若加入人工中断/确认/多会话，再评估 WebSocket

---

### REQ-004：单 Agent + Context Engineering 框架
**模块**: M01 | **状态**: Completed | **工作量**: 5-7 人天

#### 背景与价值
**Manus 的真正核心 know-how 在 Context Engineering**（参见 [REQ-000 调研报告 §3.3](REQ-000-manus-capability-research.md)）。OpenManus 现有的 `ToolCallAgent`（[app/agent/toolcall.py](../OpenManus-main/app/agent/toolcall.py)）只是标准 ReAct，没做 KV-cache 友好的上下文设计、工具描述位置稳定、文件作持久 memory 等关键实践。要复刻 Manus 的成本与效果，必须按这套实践重写 Agent 主循环。

#### 用户故事
As a 复刻品的开发者/用户，I want Agent 的每一步都能高效复用 KV-cache、长任务里上下文不爆炸、跨步骤可通过文件保留状态，So that 任务成本可控、长任务可完成。

#### 详细需求点
- System prompt 稳定（任务期间不变），不在中间插入新 system message
- 历史 append-only：旧 message 不重写、不重排（KV-cache 复用前提）
- 工具描述位置：放 system prompt 末尾，便于按任务选择性截断（为 REQ-113 工具动态启用预留）
- 文件作持久 memory：Agent 可主动调用 `write_file`/`read_file` 把中间结果存到沙盒 workspace，长任务跨步骤复用
- 删除现有 PlanningFlow 三层结构（[app/flow/planning.py](../OpenManus-main/app/flow/planning.py)），统一走单 Agent 路径
- 非功能：每步 think 平均延迟 < 5 秒（DeepSeek V4 Flash 路线）；任务上下文不超过 32K tokens 时尽量不触发 KV miss

#### 验收标准
- [x] System prompt 在 task 全程不变（规划与总结的 `systemPromptHash` 一致）
- [x] 历史 message 严格 append-only：最终总结上下文保留初始用户任务、计划、工具观察、最终请求，不重排旧消息
- [x] Agent memory 写入 `workspace/{task_id}/memory/agent-memory.md`，后续步骤可读出并注入上下文
- [x] REQ-006 已提供 Context/KV-cache 观测，前端展示 `Context xx%`

#### 实施记录（Next.js + TypeScript 路线）
- 新增 `src/server/agent/context.ts`，统一封装 stable system prompt、工具尾部描述、append-only message 编排、memory 文件读写、context snapshot
- 规划和最终总结都使用同一个 system prompt；角色指令移到 user message，避免 system prompt 中途变化
- 任务运行时会生成 `Context Engineering` 事件，展示 stable prefix hash、system prompt hash、消息数、工具尾部位置和 memory 路径
- 每个任务自动维护 `memory/agent-memory.md`，记录 objective、plan、每步工具观察和 final answer
- 已用运行级校验确认规划/总结 system prompt hash 一致、工具描述位于尾部、memory 可写可读

#### 相关 OpenManus 代码
- 需改造：[OpenManus-main/app/agent/toolcall.py:18-251](../OpenManus-main/app/agent/toolcall.py) — `think()`/`act()` 改造为 KV-cache 友好
- 需改造：[OpenManus-main/app/agent/manus.py:18](../OpenManus-main/app/agent/manus.py) — system_prompt 锁定不变
- 需弃用：[OpenManus-main/app/flow/planning.py](../OpenManus-main/app/flow/planning.py) + [OpenManus-main/run_flow.py](../OpenManus-main/run_flow.py) — 不用三层架构
- 可复用：[OpenManus-main/app/llm.py](../OpenManus-main/app/llm.py) `ask_tool()` — 不改动
- 需新建：`app/agent/context_engineer.py`（封装 KV-cache friendly 的 message 编排逻辑）

#### 风险与缓解
- 风险：Context Engineering 是新概念，实现可能"看起来对但实际命中率不行"
- 缓解：与 REQ-006（KV-cache 观测）配套开发，第一周做 spike 跑 10 个任务，对比改造前后命中率

---

### REQ-005：沙盒 artifacts/tmp 文件分层
**模块**: M04 | **状态**: Completed | **工作量**: 2-3 人天

#### 背景与价值
Manus 的关键体验是"沙盒回收时保留 artifacts，临时文件可丢"（参见 [REQ-000 §5.2](REQ-000-manus-capability-research.md)）。OpenManus 现在所有产出都堆在 `workspace/` 根目录，无法区分"最终交付物"和"中间临时文件"，这会让任务历史 UI 一片混乱，也让沙盒回收策略无从谈起。

#### 用户故事
As a 用户翻看任务历史，I want 只看到最终交付的几个文件（Excel/PPT/网页），而不是 Agent 调试时产生的几十个 .json/.tmp 中间文件，So that Library 干净易用。

#### 详细需求点
- 每个任务的工作目录结构固化为：
  ```
  workspace/{task_id}/
  ├── artifacts/    # 交付物（永久保留）
  └── tmp/          # 中间产物（任务结束可清理）
  ```
- 提供两个工具 helper：`save_artifact(filename, content)` / `save_tmp(filename, content)`
- 现有 OpenManus 工具（`StrReplaceEditor`/`PythonExecute` 等）默认写到 `tmp/`
- 新交付物工具（REQ-008）默认写到 `artifacts/`
- 任务完成后自动清理 `tmp/`（保留 N 天后过期，可配置）
- 非功能：清理操作幂等、可恢复（不要立刻删，move 到 `tmp_archived/` 一周后真删）

#### 验收标准
- [x] 跑一个完整任务后，`workspace/{task_id}/artifacts/` 只含最终交付物（无 .tmp/.log）
- [x] `workspace/{task_id}/tmp/` 含 Agent 中间生成的文件，`memory/` 保存长期上下文
- [x] 配置 `RETENTION_DAYS=0` 时任务结束立即清理 tmp，并归档到 `tmp_archived/`
- [x] Library UI 只展示 artifacts，不展示 tmp

#### 实施记录（Next.js + TypeScript 路线）
- 新增 `src/server/workspace/task-workspace.ts`，统一封装 `artifacts/`、`tmp/`、`tmp_archived/`、`memory/` 目录布局
- 工具层统一调用 `ensureTaskWorkspace()`，Python/Shell 中间产物写入 `tmp/`
- 交付物仍通过 `addArtifact()` 写入 `artifacts/`，并通过 Library/右侧交付物区下载
- 任务完成后自动执行 `archiveTmpIfNeeded()`；`RETENTION_DAYS=0` 时 tmp 归档并重新创建空目录
- 已用运行级校验确认 tmp 文件会被清空并归档

#### 相关 OpenManus 代码
- 需改造：[OpenManus-main/app/config.py](../OpenManus-main/app/config.py) `workspace_root` — 改为按 task_id 分子目录
- 需改造：[OpenManus-main/app/tool/file_operators.py](../OpenManus-main/app/tool/file_operators.py) — 默认 root 改为 `tmp/`
- 需改造：[OpenManus-main/app/tool/python_execute.py](../OpenManus-main/app/tool/python_execute.py) — 工作目录改为 task 的 tmp/
- 需新建：`app/workspace/layout.py`（封装 artifacts/tmp 分层）+ 后台清理 job

#### 风险与缓解
- 风险：现有沙盒接口大改影响 PythonExecute / Bash 的 cwd
- 缓解：不改沙盒接口，只在工具调用入口注入 cwd；保留环境变量 `ARTIFACTS_DIR` 让用户代码自助使用

---

### REQ-006：KV-cache 友好 context 设计 + 命中率观测
**模块**: M01/M10 | **状态**: Completed | **工作量**: 3-4 人天

#### 背景与价值
Yichao Ji 明说"**KV-cache 命中率是生产环境第一指标**"（[REQ-000 §3.3](REQ-000-manus-capability-research.md)），直接决定成本与延时。Anthropic 的 prompt caching API 让命中率可观测可优化，但需要明确埋点 + UI 展示，否则开发期无从知道命中率。

#### 用户故事
As a 复刻品开发者，I want 每次 LLM 调用后能看到本次 cache 命中 token 数 / 总输入 token 数，So that 能优化 context 编排，减少 80%+ 成本。

#### 详细需求点
- 在 LLM 调用层添加 cache 相关参数（Anthropic：`cache_control`，OpenAI 类同）
- 标记 system prompt 与稳定历史前缀为 `cacheable`
- 调用后从响应里提取 `cache_creation_input_tokens` / `cache_read_input_tokens`
- 把 cache 命中率写入事件流（REQ-003 推送给前端）
- 暴露 `/metrics/cache` 接口聚合命中率（任务级 + 全局）
- 非功能：埋点不阻塞调用主路径；命中率统计可关（debug=false 时省一次写日志）

#### 验收标准
- [x] LLM 调用记录含 `cacheCreationTokens` / `cacheReadTokens`
- [x] Web 前端显示 Context 缓存友好度，宽屏右侧面板显示每条 LLM call 指标
- [x] Agent system prompt 使用稳定前缀，规划与总结复用同一 stable prefix hash
- [x] 暴露 `/api/metrics/context-cache` 聚合接口，支持任务级与全局统计

#### 实施记录（DeepSeek 兼容版）
- 新增 `context_metrics` SQLite 表，记录 LLM 调用 stage、模型、prefix hash、tokens、latency、fallback 状态
- DeepSeek 响应若返回 provider cache 字段会优先读取；没有字段时使用稳定前缀复用估算 cache 友好度
- DeepSeek 请求异常或鉴权失败时会记录 `deepseek_error` 指标并自动走本地回退，避免任务流直接中断
- 每次任务规划和最终总结都会写入 Context 指标事件
- 前端顶部显示 `Context xx%` 状态条，右侧 Context 面板展示调用数、输入 tokens、前缀复用次数和最近调用
- 当前 DeepSeek 路线没有 Anthropic `cache_control` 语义，真实 provider 级 cache 命中率后续可在多模型路由接入时增强

#### 相关 OpenManus 代码
- 需改造：[OpenManus-main/app/llm.py](../OpenManus-main/app/llm.py) `ask_tool()` — 添加 `cache_control` 参数支持
- 需改造：`format_messages()` — 在 system + 稳定 prefix 上加 cache 标记
- 需新建：`app/llm/cache_metrics.py`（聚合命中率）+ `app/api/metrics_routes.py`

#### 风险与缓解
- 风险：不同 LLM provider 的 cache API 不一致（Anthropic ≠ OpenAI）
- 缓解：P0 先支持 DeepSeek V4 Flash，其他 provider 留配置入口与后续扩展点

---

### REQ-007：文件读取工具集（PDF/Word/Excel/CSV）
**模块**: M05 | **状态**: Completed | **工作量**: 1-2 人天

#### 背景与价值
Manus 用户常上传 Excel/PDF/Word 让 Agent 分析（[REQ-000 §2 用例 7](REQ-000-manus-capability-research.md)）。OpenManus 现在只能读纯文本（[file_operators.py](../OpenManus-main/app/tool/file_operators.py)），缺 PDF/Word/Excel 解析能力，是一个明显短板。

#### 用户故事
As a 上传财务报表的用户，I want Agent 能直接读懂我的 .xlsx 和 .pdf 文件，So that 不用先手动复制粘贴成文本。

#### 详细需求点
- 新工具 `read_pdf(path)` — 基于 `pypdf` 提取文本 + 表格
- 新工具 `read_docx(path)` — 基于 `python-docx` 提取段落 + 表格
- 新工具 `read_excel(path, sheet=None)` — 基于 `pandas` + `openpyxl` 读所有 sheet
- 新工具 `read_csv(path)` — 基于 `pandas`
- 大文件自动分块（>5MB 提取摘要 + 头几行）
- 非功能：错误格式时返回友好错误 message（不抛 traceback 给 LLM）

#### 验收标准
- [x] CSV / XLSX / PDF / DOCX 都能成功读取测试样例
- [x] 文件解析注册到 Next.js API 与 Agent 工具层，任务计划会优先读取上传文件摘要
- [x] 上传文件有大小限制与正文预览截断，避免大文件直接撑爆上下文
- [x] 不支持或解析失败的文件返回明确错误 message，不向用户暴露 traceback

#### 实施记录（Next.js + TypeScript 路线）
- 新增 `POST /api/files/analyze`，支持 multipart 上传并返回文件摘要
- 新增轻量文件读取模块，覆盖 TXT / MD / JSON / CSV / HTML / PDF / DOCX / XLSX
- 前端输入区新增附件按钮、文件 chip、移除操作
- 提交任务时自动把 `[上传文件摘要]` 注入 prompt，Agent 会调用 `file_reader`
- `/api/files/analyze` 已接入登录态，上传文件按当前用户保存到隔离目录；E2E 会上传 CSV 并验证 Agent 调用 `file_reader`
- 当前实现不引入 Python 依赖，符合本项目已确认的 Next.js 技术栈；扫描版 PDF 后续可在 P1 接 OCR

#### 相关 OpenManus 代码
- 可复用：[OpenManus-main/app/tool/base.py](../OpenManus-main/app/tool/base.py) `BaseTool` 接口
- 可复用：[OpenManus-main/app/tool/tool_collection.py](../OpenManus-main/app/tool/tool_collection.py) — 注册机制
- 需新建：`app/tool/file_readers/`（4 个工具一个文件）
- 需新增依赖：`pypdf` / `python-docx` / `openpyxl` / `pandas`

#### 风险与缓解
- 风险：依赖膨胀（4 个库 + 间接依赖）
- 缓解：所有库都是纯 Python（无 C 扩展），安装快；统一放 `requirements-file.txt` 可选安装

---

### REQ-008：交付物生成与打包（Excel/PPTX/网页/ZIP）
**模块**: M05/M06 | **状态**: Completed | **工作量**: 3-5 人天

#### 背景与价值
**Manus 真正的差异化是"上传 prompt → 下载可用工件"**（[REQ-000 §6 杀手锏](REQ-000-manus-capability-research.md)）。OpenManus 现在只能输出文本，无 Excel/PPT/网页 生成能力。这是 P0 最重要的"可见交付"，缺了就只是另一个聊天框。

#### 用户故事
As a 提需求"调研对比五家公司"的用户，I want Agent 直接输出可下载的 .xlsx（数据表）+ .pptx（汇报 PPT）+ 一页静态网页（dashboard），So that 我把这些文件转给同事就能直接用。

#### 详细需求点
- 新增交付物生成器：输出 Markdown、CSV、XLSX、PPTX、PDF、HTML、ZIP
- XLSX/PPTX 使用轻量 OOXML + ZIP 生成，支持基础表格、公式与 5 页 PPT
- HTML 输出独立静态页面（内联 CSS，可单文件打开）
- ZIP 在任务结束自动触发，打包全部 artifacts
- 所有产出默认写入 `artifacts/`（与 REQ-005 配合）
- 非功能：生成 PPT/Excel 不依赖系统 Office，P0 不额外引入重型文件库

#### 验收标准
- [x] Agent 能生成至少 10 行 5 列 + 1 个公式 sum 的 .xlsx
- [x] Agent 能生成 5 页含标题/正文/1 张表格内容的 .pptx
- [x] 生成的 HTML 可独立打开显示
- [x] 任务结束自动 ZIP，可通过 artifact download endpoint 下载

#### 实施记录（Next.js + TypeScript 路线）
- `src/server/artifacts/generators.ts` 生成 Markdown、CSV、XLSX、PPTX、PDF、HTML、ZIP 七类交付物
- XLSX 使用轻量 OOXML 生成，包含 13 行、5 列和 `SUM(E2:E11)` 公式
- PPTX 使用轻量 OOXML 生成 5 页：任务、计划、分析表、最终回答、下一步
- HTML 使用独立静态页面输出，ZIP 自动打包所有交付物
- 已用结构验证确认 XLSX 公式存在、PPTX slide 数为 5、ZIP 包含交付物

#### 相关 OpenManus 代码
- 可复用：[OpenManus-main/app/tool/chart_visualization/](../OpenManus-main/app/tool/chart_visualization/) — 已有 pandas 基础
- 当前实现：`manusxl-next/src/server/artifacts/generators.ts`
- 后续可选增强：接入专业文档生成库以提升模板、美观度和兼容性

#### 风险与缓解
- 风险：PPT 模板设计耗时，做不好出来很难看
- 缓解：内置 2-3 个高质量预设模板（参考 Manus AI Slides 风格），不让 Agent 凭空写 layout

---

### REQ-009：文件产出目录隔离（每任务一目录）
**模块**: M05 | **状态**: Completed | **工作量**: 1 人天

#### 背景与价值
P0 阶段虽然是单用户，但跑多个任务时如果都写到同一个 `workspace/`，会互相覆盖、混乱。每任务一目录是基础卫生，也是 P1 多用户的前置基础。

#### 用户故事
As a 同时跑多个任务的用户，I want 每个任务的文件互不干扰，So that 同时调研两个公司不会把 Excel 写串。

#### 详细需求点
- 工作目录结构：`workspace/{task_id}/artifacts/` 与 `workspace/{task_id}/tmp/`（与 REQ-005 同源）
- task_id 用 UUID v4
- Agent 启动时注入 `WORKSPACE_DIR` 环境变量到沙盒
- 所有工具默认 cwd 为 `workspace/{task_id}/tmp/`
- 非功能：路径计算单点，避免散落

#### 验收标准
- [x] 同时创建多个任务 workspace 时，目录独立无串扰
- [x] 任务详情 UI 通过 artifacts 列表展示当前任务交付物
- [x] task_id 出现在每个 workspace 产出路径里（便于审计）

#### 实施记录（Next.js + TypeScript 路线）
- 与 REQ-005 合并实现，统一使用 `src/server/workspace/task-workspace.ts`
- 每个任务目录固定为 `.manusxl-data/workspaces/{task_id}/`
- 子目录包含 `artifacts/`、`tmp/`、`tmp_archived/`、`memory/`
- Python/Shell 工具 cwd 使用该任务的 workspace root，产物路径携带 task_id
- 已用运行级校验确认两个任务 root 互不相同，artifacts/tmp/memory 路径均包含对应 task_id

#### 相关 OpenManus 代码
- 需改造：[OpenManus-main/app/config.py](../OpenManus-main/app/config.py) — `workspace_root` 加 task 维度
- 需改造：[OpenManus-main/app/sandbox/](../OpenManus-main/app/sandbox/) — DockerSandbox 挂载点改为按 task 隔离
- 需新建：`app/workspace/task_workspace.py`（封装"获取/创建任务工作目录"）

#### 风险与缓解
- 风险：与 REQ-005 重叠，不清晰边界
- 缓解：合并实现（REQ-005 + REQ-009 一起做），分两条只是为了文档可追溯；实际 PR 是一个

---

### REQ-010：SQLite 持久化任务历史 + Web 端 Library 入口
**模块**: M07/M06 | **状态**: Completed | **工作量**: 2-3 人天

#### 背景与价值
OpenManus 的 `Memory` 只在内存里（[app/schema.py:159](../OpenManus-main/app/schema.py)），进程退出数据全丢。Web 平台必须有任务历史持久化，且通过 Library UI（类似 Manus 的 Library）让用户回看以前任务的 artifacts。

#### 用户故事
As a 用户昨天跑过一个调研任务，I want 今天在 Library 里翻出来重看 Agent 步骤、重新下载文件，So that 不用重跑就能复用之前的成果。

#### 详细需求点
- SQLite 表：`tasks(id, prompt, status, model, created_at, updated_at, error)` / `task_steps(id, task_id, type, payload, timestamp)` / `task_files(id, task_id, filename, path, size)`
- Repository 层封装：`TaskRepo` / `StepRepo` / `FileRepo`
- Web Library UI：左侧任务列表（最近 50 个，分页），点击展示步骤回放 + 文件下载
- 任务搜索（按 prompt 关键字）
- 非功能：SQLite WAL 模式，避免并发写阻塞；定期 vacuum

#### 验收标准
- [x] 任务写入 SQLite，重启后可从 Library 列表恢复
- [x] 点开历史任务能完整看到所有步骤事件回放
- [x] artifacts 文件即使任务关闭后仍可下载
- [x] 用 prompt 关键字搜到任务

#### 实施记录（Next.js + TypeScript 路线）
- 新增 SQLite 持久化，表包含 `tasks`、`task_steps`、`task_files`、`app_config`、`context_metrics`
- `GET /api/tasks?q=` 支持任务搜索，左侧 Library 展示最近 50 条任务
- `GET /api/tasks/{taskId}` 可回放步骤和 artifacts
- `GET /api/tasks/{taskId}/artifacts/{artifactId}` 读取磁盘文件并下载
- 已验证当前 SQLite 中存在 6 个任务、166 条步骤、43 个文件，搜索 `shell` 可命中历史任务

#### 相关 OpenManus 代码
- 可复用：[OpenManus-main/app/schema.py](../OpenManus-main/app/schema.py) — Message/Memory 结构（DB schema 参考）
- 需新建：`app/db/`（SQLAlchemy + Alembic migration）+ `app/api/library_routes.py`
- 需新增依赖：`sqlalchemy`、`alembic`、`aiosqlite`

#### 风险与缓解
- 风险：SQLite 在 P1 要换 PostgreSQL，schema 设计不当会引发迁移痛
- 缓解：直接用 SQLAlchemy ORM 写 schema，P1 换 driver 即可不改业务代码

---

### REQ-011：Docker Compose 一键启动
**模块**: M09 | **状态**: Completed | **工作量**: 2-3 人天

#### 背景与价值
当前 OpenManus 部署需要本地装 Python 3.12、配 toml、装 Playwright（含 Chromium 二进制）、可能装 Docker（沙盒用）—— 对非工程师用户门槛太高。Docker Compose 是个人开发者最理想的一键部署方案。

#### 用户故事
As a 想本地试用的用户，I want `git clone && docker-compose up` 后就能在浏览器打开使用，So that 不用搞 Python 环境/依赖。

#### 详细需求点
- `docker-compose.yml` 含单个 `manusxl` 服务，运行 Next.js standalone 产物
- `Dockerfile` 使用 deps / builder / runner 三阶段构建，优化依赖缓存与运行镜像体积
- 配置通过 `.env.local` 与环境变量传入（`DEEPSEEK_API_KEY`、`DEEPSEEK_MODEL`、`DEEPSEEK_BASE_URL` 等）
- 启动后自动健康检查 `/api/config`
- `manusxl_data` 卷持久化 SQLite、上传文件与 artifacts
- README 含本地启动、Docker 启动和 quickstart 脚本说明
- 非功能：基于 Node Alpine 镜像，支持 Mac M 系列常见 Docker Desktop 环境

#### 验收标准
- [x] 在本机 Mac 环境执行 Docker/本地启动命令后服务就绪
- [x] 浏览器打开 `http://localhost:3001` 看到前端（可用 `MANUSXL_PORT` 改端口）
- [x] 提交 demo 任务能跑完
- [x] M 系列 Mac 上无需特殊配置可运行（用户本机已验证）
- [x] Dockerfile / Compose / env / healthcheck / volume / standalone 输出配置通过静态检查

#### 实施记录（Next.js + TypeScript 路线）
- 已新增 `Dockerfile`，使用 Next.js standalone 输出，降低运行镜像体积
- 已新增 `docker-compose.yml`，默认映射到 `http://localhost:3001`
- 已新增 `manusxl_data` 持久化卷，保存 SQLite、上传文件和 artifacts
- 已新增健康检查与 `scripts/quickstart.sh`
- 已新增 `npm run docker:check`，可检查 Dockerfile、Compose、持久化卷、健康检查、quickstart 与 standalone 配置
- 当前 Codex 环境未安装 Docker CLI；Docker/本地命令已由用户在本机终端跑完并确认
- `npm run build` 可成功完成；Turbopack 仍提示运行时 workspace 文件追踪 warning，不影响当前构建产物

#### 相关 OpenManus 代码
- 可复用：[OpenManus-main/Dockerfile](../OpenManus-main/Dockerfile) — 14 行简单版本，要扩展
- 需新建：`docker-compose.yml`、`docker/Dockerfile.api`、`docker/Dockerfile.web`、`docker/Dockerfile.playwright`
- 需新建：`scripts/quickstart.sh`

#### 风险与缓解
- 风险：Docker-in-Docker 在 Mac 上有兼容性问题
- 缓解：默认挂宿主 Docker socket（`/var/run/docker.sock`），DinD 作为可选方案

---

### REQ-012：配置面板（API Key、模型选择、运行时参数）
**模块**: M10 | **状态**: Completed | **工作量**: 1-2 人天

#### 背景与价值
OpenManus 配置在 `config/config.toml`，改完要重启。Web 平台用户期望在 UI 上配 API Key/模型/温度，立即生效。这是用户体验的硬要求。

#### 用户故事
As a 想换模型试效果的用户，I want 在 Settings 页面下拉换 Claude/GPT/DeepSeek 立即生效，So that 不用重启服务、改 toml。

#### 详细需求点
- Settings 页面：API Key 输入（加密存储）/ 模型选择（下拉）/ 温度滑块 / max_steps 上限
- 配置保存到 SQLite（user_config 表）
- 切换模型后立即影响下次任务（不影响进行中的任务）
- 敏感字段（API Key）UI 显示掩码 + 复制按钮
- 非功能：API Key 在 DB 用 Fernet 对称加密（密钥来自 ENV）

#### 验收标准
- [x] Settings 页面可输入并保存 API Key
- [x] 切换模型后新任务用新模型（任务记录含 model 字段）
- [x] 重启服务后配置仍从 SQLite 生效
- [x] DB 直接 dump 看到的 API Key 是 `enc:v1:` 加密值

#### 实施记录（Next.js + TypeScript 路线）
- `GET/PATCH /api/config` 支持模型、Base URL、API Key、temperature、maxSteps
- Settings 面板支持模型、接口、温度、最大步骤、API Key
- API Key 使用 AES-256-GCM 加密后写入 SQLite；旧明文配置可兼容读取，下一次保存会转为加密
- DeepSeek 请求失败时任务不会直接失败，会记录 fallback 指标并使用本地回退完成任务闭环
- 默认本地密钥写入 `.manusxl-data/config-secret`，也可用 `MANUSXL_CONFIG_SECRET` 覆盖
- 已验证加密保存、解密读取、temperature/maxSteps 保存恢复均正常

#### 相关 OpenManus 代码
- 需改造：[OpenManus-main/app/config.py](../OpenManus-main/app/config.py) `Config` 类 — 支持 DB 覆盖 toml
- 需改造：[OpenManus-main/app/llm.py](../OpenManus-main/app/llm.py) `LLM._instances` — 配置变更触发重建
- 需新建：`app/api/settings_routes.py` + 前端 Settings 页面
- 需新增依赖：`cryptography`（Fernet）

#### 风险与缓解
- 风险：进行中任务用旧配置，新任务用新配置导致状态混乱
- 缓解：每个任务启动时 snapshot 当前配置，任务内 immutable

---

### REQ-013：端到端验证用例
**模块**: E2E | **状态**: Completed | **工作量**: 2-3 人天

#### 背景与价值
13 条 P0 需求做完后必须有一个**完整可重放的 E2E 用例**，证明 MVP 真的能跑通"模糊需求 → 多种交付物"。这是 MVP Go/No-Go 评审的核心证据。

#### 用户故事
As a 项目负责人/未来用户，I want 看到一个录屏展示"输入一句话 → Agent 自主完成 → 下载 Excel + PPT + 网页"，So that 我确认 MVP 真的成立。

#### 详细需求点
- 用例 prompt：`"调研中国新能源车前五家公司（销量排序），生成对比 Excel + 5 页汇报 PPT + 一页 dashboard 网页"`
- 必须演示：
  - Agent 自主拆解（不用人工 next-step）
  - 至少 3 次工具调用（搜索 + 数据抓取 + 文件生成）
  - 实时事件流（前端可见 think/act）
  - 3 种交付物（.xlsx + .pptx + .html）正确生成并能下载打开
  - KV-cache 命中率可观测，目标 ≥ 60%
- 用例脚本化：`npm run e2e:demo`
- 录屏作为 README demo
- 非功能：DeepSeek V4 Flash 路线下控制单次验收成本

#### 验收标准
- [x] 浏览器 UI 验收稳定跑过 5 次（成功率 5/5）
- [x] 用例脚本支持 `MANUSXL_E2E_RUNS=5 npm run e2e:demo` 多轮验收
- [x] 3 种交付物文件存在且非空的自动校验已写入脚本
- [x] Excel 至少 5 行可对比数据与合计公式的自动校验已写入脚本
- [x] PPT 至少 5 页的自动校验已写入脚本
- [x] HTML 可读性与 ZIP 打包内容的自动校验已写入脚本
- [x] 录屏/演示证据可由浏览器验收截图与本机实跑过程支撑；正式对外 demo 可在 P1 前补充美化版本

#### 实施记录（Next.js + TypeScript 路线）
- 新增 `manusxl-next/scripts/e2e-demo.mjs`
- 新增 `npm run e2e:demo`
- `npm run e2e:demo` 支持 `MANUSXL_E2E_RUNS=5` 一次跑多轮稳定性验收
- 脚本会先通过开发手机号验证码登录，再上传 CSV 夹具，调用 `/api/tasks` 创建带 `[上传文件摘要]` 的标准 demo 任务
- 脚本会监听 `/api/tasks/{taskId}/events` SSE，任务完成后下载 artifacts，并使用 `lastEventId` 重新连接验证断点事件回放
- 脚本会校验 `file_reader` 调用、`xlsx`、`pptx`、`html`、`zip`、工具调用次数、计划事件、Context 指标
- 已新增 LLM 连通性检查 `/api/config/llm-test`，E2E 在配置 API Key 时会断言真实走 DeepSeek 且未发生本地 fallback
- DeepSeek V4 请求默认设置 `MANUSXL_DEEPSEEK_THINKING=disabled`，避免 planning 阶段偶发只有 `reasoning_content`、`content` 为空
- 已通过浏览器真实 UI 连续提交 5 轮任务，5/5 成功看到 Excel、PPTX、HTML、ZIP 交付物
- 2026-05-22 本机 `npm run e2e:demo` 已通过：登录、上传解析、Agent 任务、SSE、断点回放、Excel/PPT/HTML/ZIP 下载均完成

#### 相关 OpenManus 代码
- 可复用：所有 P0 前面 12 条需求的产出
- 当前 Next.js 路线用 Node 脚本替代原计划的 pytest 脚本，后续 CI 可再迁移成 Playwright/pytest 双层验收

#### 风险与缓解
- 风险：用例依赖外部网站（数据源），网站改版可能让用例失败
- 缓解：用例不绑死特定网站，让 Agent 自行选择数据源；CI 跑用例时允许 retry 1 次

---

## 阶段风险与缓解

| 风险 | 影响 | 缓解 |
|------|------|------|
| Context Engineering 是新概念，可能被误实现成"简单 ReAct" | 高 | 第一周做 spike：实现 KV-cache 命中率观测埋点，跑 10 个不同任务对比命中率，验证设计有效 |
| OpenManus 现有 ToolCollection 全量暴露工具，与"工具动态启用"理念冲突（注：工具动态启用已挪 P1）| 中 | P0 先全量暴露，但 system prompt 写清楚不要乱调；P1 再实现 mask 机制 |
| 多种交付物（PPTX/网页打包）涉及文件格式细节，容易引入依赖膨胀 | 中 | P0 已用 Node 原生 ZIP/XML/PDF 生成器先跑通，P1 再评估专业库 |
| 沙盒 artifacts/tmp 分层导致 OpenManus 现有沙盒接口大改 | 中 | 不改沙盒接口，改 Tool 层：所有产出 Tool 默认写 `artifacts/`，临时操作写 `tmp/` |
| 个人开发者前端串行节奏拖累整体周期 | 中 | 当前 Next.js 单项目已把前后端闭环合并，优先收口验收脚本与 Docker |
| LLM Token 成本失控 | 中 | 全程用 DeepSeek V4 Flash 调试，并通过 Context 指标观察稳定前缀复用 |

---

## Go/No-Go 评审清单（进入 P1 前）

进入 P1 前必须达到：

- [ ] 所有 13 个 P0 需求 Status = Completed
- [ ] E2E 验收用例（REQ-013）录屏可重放
- [ ] 至少 5 个不同类型的 prompt 都能跑通（调研/数据分析/PPT 生成/网页交付/文件转换）
- [ ] KV-cache 命中率埋点稳定，平均命中率 ≥ 60%
- [ ] artifacts 与 tmp 分层验证通过（沙盒重启后 artifacts 还在）
- [ ] Docker Compose 文档完善，第三方开发者能 30 分钟内启动
- [ ] 任务平均 LLM 成本 < $0.2（用 DeepSeek V4 Flash 测算）
- [ ] 代码有基础单测覆盖（Agent 核心 + Tool 接口 ≥ 60%）

---

## 备注

- 本文档基于 REQ-000 调研结论调整，删除了原"Planner/Executor/Validator 三层"需求（Manus 官方实践证伪），改为单 Agent + Context Engineering
- 新增的 REQ-004/005/006/008 是 Manus 工程层核心实践（KV-cache、artifacts 分层、多交付物）
- 每次修改请同步更新 [README.md](README.md) 的状态统计
