# P0 - MVP 需求文档

> **状态**：📝 Drafting（骨架已根据 REQ-000 调研结论调整，待批量填充详细内容）
> **阶段周期**：6-8 周
> **目标**：跑通端到端单用户闭环（按 Manus 真实工程实践，不是叙事性多 Agent）

---

## 阶段目标

在 Web 页面输入「调研行业前五并生成对比 Excel」这类模糊需求，**单 Agent + Context Engineering 框架**驱动，调用工具完成任务，最终产出可下载的 Excel/PDF/Word/PPTX/网页打包。

**关键特性**：
- ✅ 单用户、单机部署（Docker Compose 一键启动）
- ✅ **单 Agent + Context Engineering**（按 Manus 官方实践，不做叙事性三层）
- ✅ 实时流式 UI
- ✅ 多种交付物：Excel / PDF / Word / PPTX / 网页 / 代码 ZIP
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
- LLM API Key（Claude / OpenAI / DeepSeek 任选）
- Node.js 20+（前端构建）

### 阶段内顺序

```
REQ-011 (Docker Compose) ──┐
                            │
REQ-001 (FastAPI 骨架) ─────┼──→ REQ-002 (前端骨架) ──→ REQ-003 (WS 流式)
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
| REQ-001 | 改造 OpenManus 为 FastAPI 服务，包装 Agent 为 REST/WS 接口 | M06 | 2-3 人天 | Planning |
| REQ-002 | Web 前端：任务输入 + 步骤面板 + 日志流 + 文件下载 | M06 | 5-7 人天 | Planning |
| REQ-003 | WebSocket/SSE 实时推送 Agent 的 think/act/observe 步骤 | M06 | 1-2 人天 | Planning |
| REQ-004 | **单 Agent + Context Engineering 框架**：稳定 system prompt + 历史追加不重排 + 工具描述放尾部 + 文件作持久 memory | M01 | 5-7 人天 | Planning |
| REQ-005 | **沙盒 artifacts/tmp 文件分层**：交付物（artifacts/）永久保留，中间产物（tmp/）可清理 | M04 | 2-3 人天 | Planning |
| REQ-006 | **KV-cache 友好 context 设计**：监控埋点 + 命中率指标 + 避免 invalidation 模式（用 append-only history、稳定 prefix） | M01/M10 | 3-4 人天 | Planning |
| REQ-007 | 文件读取工具集：PDF（pypdf）+ Word（python-docx）+ Excel/CSV（pandas+openpyxl） | M05 | 1-2 人天 | Planning |
| REQ-008 | **交付物生成与打包**：Excel（openpyxl）+ PPTX（python-pptx）+ 静态网页（jinja2 模板）+ 任务结束自动 ZIP | M05/M06 | 3-5 人天 | Planning |
| REQ-009 | 文件产出目录隔离（每任务一目录，含 artifacts/ 和 tmp/ 子目录） | M05 | 1 人天 | Planning |
| REQ-010 | SQLite 持久化任务历史（task_id/prompt/steps/files）+ Web 端 Library 入口浏览 artifacts | M07/M06 | 2-3 人天 | Planning |
| REQ-011 | Docker Compose 一键启动（FastAPI + 前端 + Browser headless + Docker-in-Docker Sandbox） | M09 | 2-3 人天 | Planning |
| REQ-012 | 配置面板：API Key、模型选择、运行时参数（前端可配） | M10 | 1-2 人天 | Planning |
| **总计** | | | **30-46 人天（约 6-9 周）** | |
| REQ-013 | 端到端验证用例：「调研新能源车前五 → 生成对比 Excel + 分析 PPT + 一页静态网页」 | E2E | 2-3 人天 | Planning |

---

## 需求详细展开

---

### REQ-001：改造 OpenManus 为 FastAPI 服务，包装 Agent 为 REST/WS 接口
**模块**: M06 | **状态**: Planning | **工作量**: 2-3 人天

#### 背景与价值
OpenManus 当前只有 CLI 入口（[main.py](../OpenManus-main/main.py)），用户必须本地终端运行。要做 Web 平台，必须先把 `Manus` Agent 用 FastAPI 包装出 HTTP/WebSocket 接口，这是后续所有 Web 功能的基石。

#### 用户故事
As a 想用 Web 界面调用 Agent 的开发者，I want 通过 HTTP POST 提交任务、WebSocket 订阅进度，So that 不依赖本地终端就能完成完整任务交付。

#### 详细需求点
- 提供 `POST /api/tasks` 创建任务，返回 `task_id`；接受 `{prompt, model, config}`
- 提供 `GET /api/tasks/{task_id}` 查询任务状态与产出文件清单
- 提供 `GET /api/tasks/{task_id}/files/{filename}` 下载产出文件
- 提供 `WS /api/tasks/{task_id}/stream` 推送 Agent 实时事件（REQ-003 详述）
- 任务异步执行（FastAPI BackgroundTasks 或独立任务队列），不阻塞 HTTP
- 非功能：API 设计 RESTful + OpenAPI schema 自动生成（FastAPI 默认即可）

#### 验收标准
- [ ] `curl POST /api/tasks` 提交一个 prompt 能返回 task_id
- [ ] `curl GET /api/tasks/{id}` 能看到任务从 RUNNING → FINISHED 状态变化
- [ ] OpenAPI docs（`/docs`）可访问，所有 endpoint 可见
- [ ] 至少 3 个并发任务可同时执行不互相影响

#### 相关 OpenManus 代码
- 可复用：[OpenManus-main/app/agent/manus.py](../OpenManus-main/app/agent/manus.py) — `Manus.create()` + `agent.run(prompt)` 直接调用
- 可复用：[OpenManus-main/app/schema.py](../OpenManus-main/app/schema.py) — `Message`/`Memory`/`AgentState` 数据模型
- 需改造：[OpenManus-main/main.py](../OpenManus-main/main.py) — 从 CLI 改为 FastAPI app（或新建 `server.py`）
- 需新建：`app/api/routes.py`（路由）、`app/api/task_manager.py`(任务存储 + 状态机)、`requirements.txt` 加 `fastapi`/`uvicorn`（已有 `~=0.115.11`）

#### 风险与缓解
- 风险：`Manus.run()` 是同步阻塞调用，长任务会卡住 worker
- 缓解：包成 `asyncio.create_task()` + 用 task_manager 跟踪生命周期；或上 Celery（P1 再说）

---

### REQ-002：Web 前端：任务输入 + 步骤面板 + 日志流 + 文件下载
**模块**: M06 | **状态**: Planning | **工作量**: 5-7 人天

#### 背景与价值
没有 UI 用户就只能用 curl/Postman，与"Manus 复刻"目标不符。前端是用户感知产品价值的唯一界面，必须做到能让用户"输入 prompt → 看 Agent 工作 → 下载结果"的极简体验。

#### 用户故事
As a 普通用户，I want 在浏览器输入 prompt 后实时看到 Agent 的思考与行动步骤，并在任务完成后一键下载所有产出文件，So that 我不用学命令行就能用 AI 完成复杂工作。

#### 详细需求点
- 顶层布局：左侧任务列表（Library），右侧任务详情（步骤面板 + 输入框 + 下载区）
- 任务输入框：多行 textarea + 提交按钮 + 模型选择下拉
- 步骤面板：流式展示 Agent 的 `think`/`act`/`observe`，按时间倒序，可折叠
- 工具调用块：高亮显示工具名、参数、结果（折叠/展开切换）
- 文件下载区：任务完成后展示 artifacts/ 下所有文件 + 一键下载 ZIP
- 错误状态：任务失败时高亮显示错误信息
- 非功能：移动端友好（≥ tablet 宽度可用），dark mode

#### 验收标准
- [ ] 输入"调研中国新能源车前五"提交后能在 5 秒内看到第一条 Agent 事件
- [ ] 任务完成后 artifacts 区域可见至少 1 个可下载文件
- [ ] 历史任务列表可点击查看（Library 入口）
- [ ] 在 Chrome/Safari/Firefox 渲染一致

#### 相关 OpenManus 代码
- 需新建：`web/`（前端项目目录）— React + Vite + Tailwind 技术栈
- 参考：OpenManus 无前端代码可复用
- 集成：通过 REQ-001 的 REST/WS API 与后端通信

#### 风险与缓解
- 风险：个人开发者前端开发拖累整体节奏
- 缓解：第 1-3 周做后端时前端只搭最简 HTML 测试；第 4 周再用 React + shadcn/ui（预设组件，加速开发）

---

### REQ-003：WebSocket/SSE 实时推送 Agent 的 think/act/observe 步骤
**模块**: M06 | **状态**: Planning | **工作量**: 1-2 人天

#### 背景与价值
OpenManus 的 `Manus.run()` 内部已经会产生大量中间事件（think → tool_call → tool_result → ...），但当前只 print 到终端。要让 Web 前端实时显示进度，必须把这些事件流式推送出去。这是"用户感知 Agent 工作"的关键体验。

#### 用户故事
As a 用户在 Web 界面提交任务后，I want 看到 Agent 每一步思考与工具调用的实时流（而不是等几分钟看到一个最终结果），So that 我能信任产品并及早发现走偏。

#### 详细需求点
- WebSocket 通道：`WS /api/tasks/{task_id}/stream`
- 事件类型：`thinking_start` / `thinking_text` / `tool_call` / `tool_result` / `agent_message` / `task_finished` / `task_failed`
- 每个事件 JSON 含：`type`/`timestamp`/`step_index`/`payload`
- 支持断线重连（client 提供 `last_event_id`，server 回放未接收事件）
- 非功能：单连接吞吐 ≥ 100 events/sec，延迟 ≤ 500ms

#### 验收标准
- [ ] 提交任务后能在 2 秒内收到第一个 `thinking_start` 事件
- [ ] 工具调用与返回都能正确推送
- [ ] 断线重连后能接续接收事件不丢失
- [ ] 任务完成后收到 `task_finished` 自动关闭连接

#### 相关 OpenManus 代码
- 可复用：[OpenManus-main/app/agent/base.py](../OpenManus-main/app/agent/base.py) — `run()` 循环已有结构化日志
- 可复用：[OpenManus-main/app/agent/toolcall.py](../OpenManus-main/app/agent/toolcall.py) — `think()`/`act()` 中可埋点
- 需改造：在 `ToolCallAgent` 加事件 hook（callback），由 task_manager 把事件 push 到 WS
- 需新建：`app/api/event_bus.py`（每 task_id 一个事件队列，WS 订阅消费）

#### 风险与缓解
- 风险：事件埋点散落各处难维护
- 缓解：用 Python 的 `contextvars` 或显式 `event_emitter` 参数注入，统一在 `BaseAgent.run()` 入口装配

---

### REQ-004：单 Agent + Context Engineering 框架
**模块**: M01 | **状态**: Planning | **工作量**: 5-7 人天

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
- 非功能：每步 think 平均延迟 < 5 秒（Claude Sonnet）；任务上下文不超过 32K tokens 时不触发 KV miss

#### 验收标准
- [ ] System prompt 在 task 全程不变（hash 校验）
- [ ] 跑 10 步以上的任务，历史 message 严格 append-only
- [ ] Agent 能主动写文件到 `workspace/notes.md` 并在后续步骤读出
- [ ] 与现有 OpenManus 单 Agent 相比，相同任务的 KV-cache 命中率提升 ≥ 30%（REQ-006 提供观测）

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
**模块**: M04 | **状态**: Planning | **工作量**: 2-3 人天

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
- [ ] 跑一个完整任务后，`workspace/{task_id}/artifacts/` 只含最终交付物（无 .tmp/.log）
- [ ] `workspace/{task_id}/tmp/` 含 Agent 中间生成的文件
- [ ] 配置 `RETENTION_DAYS=0` 时任务结束立即清理 tmp
- [ ] Library UI（REQ-010）只展示 artifacts 不展示 tmp

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
**模块**: M01/M10 | **状态**: Planning | **工作量**: 3-4 人天

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
- [ ] LLM 响应日志含 `cache_creation_tokens` / `cache_read_tokens`
- [ ] Web 前端步骤面板每条 LLM call 显示命中率 %（提示信息）
- [ ] 跑 10 步任务，平均命中率 ≥ 60%（第 2 步开始命中前一步的 prefix）
- [ ] 关闭 cache（配置开关）后命中率为 0%（验证机制）

#### 相关 OpenManus 代码
- 需改造：[OpenManus-main/app/llm.py](../OpenManus-main/app/llm.py) `ask_tool()` — 添加 `cache_control` 参数支持
- 需改造：`format_messages()` — 在 system + 稳定 prefix 上加 cache 标记
- 需新建：`app/llm/cache_metrics.py`（聚合命中率）+ `app/api/metrics_routes.py`

#### 风险与缓解
- 风险：不同 LLM provider 的 cache API 不一致（Anthropic ≠ OpenAI）
- 缓解：先只支持 Claude（项目主推），其他 provider 留接口 + log warning

---

### REQ-007：文件读取工具集（PDF/Word/Excel/CSV）
**模块**: M05 | **状态**: Planning | **工作量**: 1-2 人天

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
- [ ] 4 种工具都能成功读取测试样例
- [ ] 工具注册到 `Manus.available_tools` 并能被 Agent 调用
- [ ] 大 PDF（>50 页）读取不 OOM
- [ ] 加密 PDF 返回明确错误

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
**模块**: M05/M06 | **状态**: Planning | **工作量**: 3-5 人天

#### 背景与价值
**Manus 真正的差异化是"上传 prompt → 下载可用工件"**（[REQ-000 §6 杀手锏](REQ-000-manus-capability-research.md)）。OpenManus 现在只能输出文本，无 Excel/PPT/网页 生成能力。这是 P0 最重要的"可见交付"，缺了就只是另一个聊天框。

#### 用户故事
As a 提需求"调研对比五家公司"的用户，I want Agent 直接输出可下载的 .xlsx（数据表）+ .pptx（汇报 PPT）+ 一页静态网页（dashboard），So that 我把这些文件转给同事就能直接用。

#### 详细需求点
- 新工具 `generate_excel(path, sheets={name: rows})` — 基于 `openpyxl`，支持多 sheet、基础样式、公式
- 新工具 `generate_pptx(path, slides=[{title, content, layout}])` — 基于 `python-pptx`，支持模板、标题/正文/图片/表格
- 新工具 `generate_html_page(path, title, body_html, css)` — 基于 jinja2 模板，输出独立 HTML（含内联 CSS/JS）
- 新工具 `package_artifacts(zip_name)` — 把 `artifacts/` 目录打成 ZIP（任务结束自动触发）
- 所有产出默认写入 `artifacts/`（与 REQ-005 配合）
- 非功能：生成 PPT/Excel 不依赖系统 Office，纯 Python 实现

#### 验收标准
- [ ] Agent 能生成至少 10 行 5 列 + 1 个公式 sum 的 .xlsx
- [ ] Agent 能生成 5 页含标题/正文/1 张表格的 .pptx
- [ ] 生成的 HTML 双击打开在浏览器中显示正常
- [ ] 任务结束自动 ZIP，可通过 REQ-001 的 download endpoint 下载

#### 相关 OpenManus 代码
- 可复用：[OpenManus-main/app/tool/chart_visualization/](../OpenManus-main/app/tool/chart_visualization/) — 已有 pandas 基础
- 需新建：`app/tool/artifacts/`（含 4 个工具）
- 需新增依赖：`openpyxl`、`python-pptx`、`jinja2`（FastAPI 已带）

#### 风险与缓解
- 风险：PPT 模板设计耗时，做不好出来很难看
- 缓解：内置 2-3 个高质量预设模板（参考 Manus AI Slides 风格），不让 Agent 凭空写 layout

---

### REQ-009：文件产出目录隔离（每任务一目录）
**模块**: M05 | **状态**: Planning | **工作量**: 1 人天

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
- [ ] 同时跑 3 个任务，3 个目录独立无串扰
- [ ] 任务详情 UI 能列出该目录所有文件
- [ ] task_id 出现在每个产出文件的路径里（便于审计）

#### 相关 OpenManus 代码
- 需改造：[OpenManus-main/app/config.py](../OpenManus-main/app/config.py) — `workspace_root` 加 task 维度
- 需改造：[OpenManus-main/app/sandbox/](../OpenManus-main/app/sandbox/) — DockerSandbox 挂载点改为按 task 隔离
- 需新建：`app/workspace/task_workspace.py`（封装"获取/创建任务工作目录"）

#### 风险与缓解
- 风险：与 REQ-005 重叠，不清晰边界
- 缓解：合并实现（REQ-005 + REQ-009 一起做），分两条只是为了文档可追溯；实际 PR 是一个

---

### REQ-010：SQLite 持久化任务历史 + Web 端 Library 入口
**模块**: M07/M06 | **状态**: Planning | **工作量**: 2-3 人天

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
- [ ] 跑 10 个任务后重启服务，全部能从 Library 列表看到
- [ ] 点开历史任务能完整看到所有步骤事件回放
- [ ] artifacts 文件即使任务关闭后仍可下载
- [ ] 用 prompt 关键字搜到任务

#### 相关 OpenManus 代码
- 可复用：[OpenManus-main/app/schema.py](../OpenManus-main/app/schema.py) — Message/Memory 结构（DB schema 参考）
- 需新建：`app/db/`（SQLAlchemy + Alembic migration）+ `app/api/library_routes.py`
- 需新增依赖：`sqlalchemy`、`alembic`、`aiosqlite`

#### 风险与缓解
- 风险：SQLite 在 P1 要换 PostgreSQL，schema 设计不当会引发迁移痛
- 缓解：直接用 SQLAlchemy ORM 写 schema，P1 换 driver 即可不改业务代码

---

### REQ-011：Docker Compose 一键启动
**模块**: M09 | **状态**: Planning | **工作量**: 2-3 人天

#### 背景与价值
当前 OpenManus 部署需要本地装 Python 3.12、配 toml、装 Playwright（含 Chromium 二进制）、可能装 Docker（沙盒用）—— 对非工程师用户门槛太高。Docker Compose 是个人开发者最理想的一键部署方案。

#### 用户故事
As a 想本地试用的用户，I want `git clone && docker-compose up` 后就能在浏览器打开使用，So that 不用搞 Python 环境/依赖。

#### 详细需求点
- `docker-compose.yml` 含服务：`api`（FastAPI）/ `web`（前端 Nginx）/ `sandbox`（Docker-in-Docker 或宿主 socket 挂载）/ `playwright`（headless Chromium）
- `Dockerfile` 优化：分层缓存、apt 包合并、最终镜像 < 1GB
- 配置通过环境变量传入（`API_KEY` 等），不需要改文件
- 启动后自动健康检查（API 可访问、前端可访问）
- README 含 30 秒 quickstart 截图
- 非功能：支持 amd64 + arm64 双架构（Mac M 系列）

#### 验收标准
- [ ] 在干净的 Mac/Linux 上 `docker-compose up` 后 3 分钟内服务就绪
- [ ] 浏览器打开 `http://localhost:3000` 看到前端
- [ ] 提交一个 demo 任务能跑完
- [ ] M1/M2 Mac 上无需特殊配置可运行

#### 相关 OpenManus 代码
- 可复用：[OpenManus-main/Dockerfile](../OpenManus-main/Dockerfile) — 14 行简单版本，要扩展
- 需新建：`docker-compose.yml`、`docker/Dockerfile.api`、`docker/Dockerfile.web`、`docker/Dockerfile.playwright`
- 需新建：`scripts/quickstart.sh`

#### 风险与缓解
- 风险：Docker-in-Docker 在 Mac 上有兼容性问题
- 缓解：默认挂宿主 Docker socket（`/var/run/docker.sock`），DinD 作为可选方案

---

### REQ-012：配置面板（API Key、模型选择、运行时参数）
**模块**: M10 | **状态**: Planning | **工作量**: 1-2 人天

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
- [ ] Settings 页面可输入并保存 API Key
- [ ] 切换模型后新任务用新模型（在事件流里能看到 model 字段变化）
- [ ] 重启服务后配置仍生效
- [ ] DB 直接 dump 看到的 API Key 是加密的

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
**模块**: E2E | **状态**: Planning | **工作量**: 2-3 人天

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
  - KV-cache 命中率 ≥ 60%
- 用例脚本化：`tests/e2e/test_research_to_artifacts.py`（pytest）
- 录屏作为 README demo
- 非功能：用例跑完成本 < $1（用 Sonnet）/ < $0.2（用 Haiku）

#### 验收标准
- [ ] 用例脚本能稳定跑过 5 次（成功率 ≥ 4/5）
- [ ] 3 种交付物文件存在且非空
- [ ] Excel 中至少有 5 家公司的可对比数据
- [ ] PPT 至少 5 页可正常打开
- [ ] HTML 双击打开可见 dashboard
- [ ] 录屏 ≤ 5 分钟（部分加速）

#### 相关 OpenManus 代码
- 可复用：所有 P0 前面 12 条需求的产出
- 需新建：`tests/e2e/test_research_to_artifacts.py` + `scripts/demo_record.sh`

#### 风险与缓解
- 风险：用例依赖外部网站（数据源），网站改版可能让用例失败
- 缓解：用例不绑死特定网站，让 Agent 自行选择数据源；CI 跑用例时允许 retry 1 次

---

## 阶段风险与缓解

| 风险 | 影响 | 缓解 |
|------|------|------|
| Context Engineering 是新概念，可能被误实现成"简单 ReAct" | 高 | 第一周做 spike：实现 KV-cache 命中率观测埋点，跑 10 个不同任务对比命中率，验证设计有效 |
| OpenManus 现有 ToolCollection 全量暴露工具，与"工具动态启用"理念冲突（注：工具动态启用已挪 P1）| 中 | P0 先全量暴露，但 system prompt 写清楚不要乱调；P1 再实现 mask 机制 |
| 多种交付物（PPTX/网页打包）涉及多个 Python 库，依赖膨胀 | 中 | 把所有交付物相关库统一一个 `app/tool/artifact/` 子模块，集中管理 |
| 沙盒 artifacts/tmp 分层导致 OpenManus 现有沙盒接口大改 | 中 | 不改沙盒接口，改 Tool 层：所有产出 Tool 默认写 `artifacts/`，临时操作写 `tmp/` |
| 个人开发者前端串行节奏拖累整体周期 | 中 | 第 1-3 周先做 FastAPI + CLI 测试模式跑通核心，第 4 周开始 React 前端 |
| LLM Token 成本失控 | 中 | 全程用 Haiku/DeepSeek 调试，Claude Sonnet 只在 E2E 用例跑 |

---

## Go/No-Go 评审清单（进入 P1 前）

进入 P1 前必须达到：

- [ ] 所有 13 个 P0 需求 Status = Completed
- [ ] E2E 验收用例（REQ-013）录屏可重放
- [ ] 至少 5 个不同类型的 prompt 都能跑通（调研/数据分析/PPT 生成/网页交付/文件转换）
- [ ] KV-cache 命中率埋点稳定，平均命中率 ≥ 60%
- [ ] artifacts 与 tmp 分层验证通过（沙盒重启后 artifacts 还在）
- [ ] Docker Compose 文档完善，第三方开发者能 30 分钟内启动
- [ ] 任务平均 LLM 成本 < $0.5（用 Haiku/DeepSeek 测算）
- [ ] 代码有基础单测覆盖（Agent 核心 + Tool 接口 ≥ 60%）

---

## 备注

- 本文档基于 REQ-000 调研结论调整，删除了原"Planner/Executor/Validator 三层"需求（Manus 官方实践证伪），改为单 Agent + Context Engineering
- 新增的 REQ-004/005/006/008 是 Manus 工程层核心实践（KV-cache、artifacts 分层、多交付物）
- 每次修改请同步更新 [README.md](README.md) 的状态统计
