# P1 - V1 需求文档

> **状态**：📝 Drafting（骨架已根据 REQ-000 调研结论调整，待批量填充详细内容）
> **阶段周期**：10-14 周（紧接 P0 MVP）
> **目标**：多用户 + 生产化 + 工具生态 + Manus 工程层差异化

---

## 阶段目标

MVP 验证可行后，把"个人玩具"升级为"可对外服务的产品"，同时补齐 Manus 工程层差异化：
- 多用户：OAuth + PostgreSQL + 多租户沙盒
- 生态：MCP 市场 + Skills 包格式（兼容 Anthropic 开放标准）
- **差异化亮点**：本地浏览器（绕 paywall）+ 工具动态启用 + 透明 token 计费 + Dashboard 生成
- 成本：Prompt Cache + 多模型路由

---

## 验收基线（Definition of Done）

| # | 验收项 | 方式 |
|---|-------|------|
| 1 | 支持 Google/GitHub OAuth + 邮箱注册 | UI 实测 |
| 2 | 多用户并发跑任务（≥ 10 并发）数据互不污染 | 压测脚本 |
| 3 | 用户超过 Token 限额时被正确拦截，UI 上有透明的 token 计费视图（不是 credit 池）| UI + 限流测试 |
| 4 | 沙盒资源超限能正确隔离不影响其他用户 | 故障注入测试 |
| 5 | 用户可在 UI 配置接入自己的 MCP Server | UI 实测 |
| 6 | 任务中断后续传可恢复 | E2E 测试 |
| 7 | LLM 成本相比 P0 下降 ≥ 30%（通过 Prompt Cache + 多模型路由） | 数据对比 |
| 8 | 本地浏览器可绕 paywall/CAPTCHA（用户已登录态）| 实测对比"云浏览器 vs 本地浏览器"成功率 |
| 9 | 工具动态启用：相同任务在 mask 不相关工具后准确率提升 ≥ 15% | A/B 测试 |
| 10 | 可加载社区已有 SKILL.md 包并正常使用 | 兼容性测试 |
| 11 | Dashboard 生成工具可一句 prompt 产出可交互的 HTML dashboard | UI 实测 |

---

## 依赖矩阵

### 前置（P0 完成）
- P0 所有 13 个需求 Status = Completed
- E2E 验收用例稳定可重放

### 阶段内顺序

```
[基础组]                          [生态组]                       [差异化组]
REQ-101 (PostgreSQL) ──┐         REQ-107 (MCP 市场) ──┐         REQ-114 (本地浏览器)
REQ-102 (OAuth) ───────┤         REQ-115 (Skills) ───┤         REQ-113 (工具动态启用)
REQ-103 (用户隔离) ────┤         REQ-108 (图片/重命名)┤         REQ-109 (透明计费)
REQ-104 (Sandbox 多租户)┤         REQ-112 (任务模板) ─┤         REQ-116 (Dashboard 生成)
REQ-106 (任务续传) ────┤
                       │         [成本组]
REQ-105 (重试增强) ────┤         REQ-110 (Prompt Cache)
                       ▼         REQ-111 (多模型混合)
                  （集成验证）           ▼
                                  （P1 Go/No-Go 评审）
```

---

## 需求清单（16 项）

| ID | 标题 | 模块 | 工作量预估 | 状态 |
|----|------|------|-----------|------|
| REQ-101 | PostgreSQL 替换 SQLite + Alembic 迁移 | M07 | 3-4 人天 | Planning |
| REQ-102 | OAuth2（Google/GitHub）+ Email-Password 认证 | M07 | 3-5 人天 | Planning |
| REQ-103 | 用户隔离：workspace 按 user_id 分目录 + 任务 ACL | M07 | 2-3 人天 | Planning |
| REQ-104 | Sandbox 多租户：独立容器池 + 资源配额（CPU/内存/超时/磁盘） | M04 | 5-7 人天 | Planning |
| REQ-105 | 重试/降级策略增强：Tool 失败 → 备用 Tool → 回流 Agent 重规划 | M02 | 2-3 人天 | Planning |
| REQ-106 | 任务持久化与续传：浏览器关闭/网络中断后可恢复 | M06/M07 | 2-3 人天 | Planning |
| REQ-107 | MCP 服务市场：用户可自助接入第三方 MCP Server（UI 配置） | M02 | 3-5 人天 | Planning |
| REQ-108 | 图片批量处理（Pillow + OCR） + 文件批量重命名工具 | M05 | 2-3 人天 | Planning |
| REQ-109 | **透明计费 UI**：token 级成本可预测（不是 credit 池），UI 显示每步成本 | M10 | 3-4 人天 | Planning |
| REQ-110 | Prompt Cache 优化（Claude prompt caching） | M10 | 1-2 人天 | Planning |
| REQ-111 | 多模型混合调度：规划用 Opus、执行用 Sonnet/Haiku | M10 | 3-5 人天 | Planning |
| REQ-112 | 任务模板系统：常用任务保存为模板，一键复用 | M06 | 2-3 人天 | Planning |
| REQ-113 | **工具动态启用（per-task tool masking）**：按任务上下文 mask 不相关工具 | M02 | 3-4 人天 | Planning |
| REQ-114 | **本地浏览器集成（用户已登录态）**：通过 Chrome 扩展/CDP 利用本机浏览器绕 paywall/CAPTCHA | M03 | 5-7 人天 | Planning |
| REQ-115 | **Skills 包格式（SKILL.md 兼容 Anthropic 开放标准）**：可加载社区 skill，按需启用 | M02 | 4-5 人天 | Planning |
| REQ-116 | **Data Visualization Dashboard 生成**：基于数据自动出图表（matplotlib/plotly）+ 拼装 HTML dashboard | M05 | 3-4 人天 | Planning |
| **总计** | | | **46-67 人天（约 9-14 周）** | |

---

## 需求详细展开

---

### REQ-101：PostgreSQL 替换 SQLite + Alembic 迁移
**模块**: M07 | **状态**: Planning | **工作量**: 3-4 人天

#### 背景与价值
P0 用 SQLite 单文件够用，但 P1 多用户并发时 SQLite 写锁会成为瓶颈（即使 WAL 模式也只能单写）。PostgreSQL 是事实标准的多用户后端，且与 SQLAlchemy 完美兼容。Alembic 提供 schema 演进的安全方案。

#### 用户故事
As a 想让多个用户同时跑任务的运维者，I want 数据库不会因为并发写阻塞，So that 10 个用户并发不卡顿。

#### 详细需求点
- 切换 SQLAlchemy driver：`aiosqlite` → `asyncpg`
- 把 P0 的 schema 通过 Alembic 生成首个 migration
- 写"SQLite → PG 数据迁移脚本"（dry-run 模式 + commit 模式）
- Docker Compose 加 `postgres:16` 服务
- 保留"开发模式用 SQLite"开关（环境变量）
- 非功能：连接池 20-50；prepared statements 缓存

#### 验收标准
- [ ] Alembic upgrade head 在干净 PG 上能建表
- [ ] 数据迁移脚本能把 P0 的 SQLite 数据完整搬过去
- [ ] 10 并发任务写 task_steps 不报锁错
- [ ] 切回 SQLite（环境变量）开发模式仍可用

#### 相关 OpenManus 代码
- 可复用：P0 REQ-010 的 SQLAlchemy models 不改
- 需新建：`alembic/`（migration 目录）、`scripts/migrate_sqlite_to_pg.py`
- 需新增依赖：`asyncpg`、`alembic`

#### 风险与缓解
- 风险：迁移脚本丢数据
- 缓解：dry-run 模式先校验 row count 一致；用户确认后才真正写

---

### REQ-102：OAuth2（Google/GitHub）+ Email-Password 认证
**模块**: M07 | **状态**: Planning | **工作量**: 3-5 人天

#### 背景与价值
P1 多用户的前置条件。OAuth 降低注册门槛（用户不用记新密码），Email-Password 保底（OAuth 不可用时）。Manus 自己也是 OAuth + Email 双轨。

#### 用户故事
As a 第一次访问产品的用户，I want 点 "Sign in with Google" 一键登录，So that 30 秒内开始用产品。

#### 详细需求点
- 后端：`fastapi-users` 库集成（成熟方案，省时间）
- 支持 Google OAuth + GitHub OAuth + Email/Password
- JWT 作为 session token（HttpOnly cookie + Authorization header 双支持）
- 注册流程：Email 验证邮件 + 设密码
- 密码：bcrypt + min 8 字符
- 前端 Login/Register 页面
- 非功能：JWT 过期 7 天，refresh token 30 天

#### 验收标准
- [ ] Google OAuth 流程能完成 callback 并创建用户
- [ ] Email 注册收到验证邮件，验证后登录成功
- [ ] 未登录访问 `/api/tasks` 返回 401
- [ ] JWT 过期后用 refresh token 能续期

#### 相关 OpenManus 代码
- 完全新建：`app/auth/`（用户模型、OAuth flow、JWT）
- 改造：`app/api/routes.py` 加 `Depends(current_user)`
- 需新增依赖：`fastapi-users[sqlalchemy,oauth]`、`httpx-oauth`

#### 风险与缓解
- 风险：Google/GitHub OAuth callback URL 配置复杂
- 缓解：MVP 期先只做 Email/Password，OAuth 可后置 2-3 天

---

### REQ-103：用户隔离 — workspace 按 user_id 分目录 + 任务 ACL
**模块**: M07 | **状态**: Planning | **工作量**: 2-3 人天

#### 背景与价值
有了认证（REQ-102），必须确保用户 A 看不到/动不了用户 B 的任务和文件。这是多用户产品的底线。

#### 用户故事
As a 用户 A，I want 我的任务和文件只有我能看到，So that 同事的敏感数据不会被我意外访问。

#### 详细需求点
- workspace 路径加 user_id 一层：`workspace/{user_id}/{task_id}/artifacts|tmp/`
- DB 所有"任务/步骤/文件"表加 `owner_id` 外键
- 所有 GET/DELETE /api/tasks/{id} 接口加 ACL 检查：`if task.owner_id != current_user.id: raise 403`
- 文件下载也带 ACL（即使有直接 URL，也校验 owner）
- 非功能：每个 ACL 检查 < 5ms（DB 查询）

#### 验收标准
- [ ] 用户 A 不能通过 task_id 访问用户 B 的任务（返回 403/404）
- [ ] 用户 A 的 artifacts 目录用户 B 无权读取
- [ ] DB 直接查能看到 owner_id 字段
- [ ] 10 并发任务下 ACL 检查不显著拖慢响应

#### 相关 OpenManus 代码
- 需改造：P0 REQ-009 的 task_workspace.py — 路径前加 user_id
- 需改造：P0 REQ-010 的 task/step/file 表 — 加 owner_id
- 需改造：`app/api/routes.py` 所有写 task 的接口 — 自动注入 owner_id；所有读接口 — 加 ACL

#### 风险与缓解
- 风险：忘记给某个接口加 ACL → 越权漏洞
- 缓解：用 FastAPI dependency 集中处理 ACL（一处加 = 所有继承的接口都加）；写集成测试覆盖每个接口

---

### REQ-104：Sandbox 多租户 — 独立容器池 + 资源配额
**模块**: M04 | **状态**: Planning | **工作量**: 5-7 人天

#### 背景与价值
P0 的 sandbox 是"按 task 起一个 Docker 容器，跑完销毁"。多用户场景下需要：(1) 不同用户不能共享容器（数据隔离），(2) 单用户不能起无限容器（拒绝服务防护），(3) 每容器有资源上限（防止单任务跑爆主机）。

#### 用户故事
As a 平台运维者，I want 用户 A 的爬虫任务占满 CPU 不影响用户 B 的任务，So that 100 用户共享一台 4 核 16G 机器仍可用。

#### 详细需求点
- 每用户独立容器池（max_concurrent_per_user = 2，可配）
- 每容器资源上限：CPU 1 核、内存 1G、磁盘 5G、超时 30 分钟
- 总容器数上限（max_total_containers = 50），超出时排队
- 容器复用：同用户的下个任务尽量用空闲容器（warm start）
- 资源超限时友好错误（"任务已超时" / "内存不足"），不静默崩
- 非功能：容器启动 < 3 秒（用预热池）

#### 验收标准
- [ ] 单用户起第 3 个任务时被排队等待
- [ ] 任务跑 31 分钟被强制 kill 并标记 timeout
- [ ] 任务内 `python -c "import numpy; numpy.zeros((10000,10000))"` 触发 OOM 友好报错
- [ ] 50 并发任务下系统不崩

#### 相关 OpenManus 代码
- 可复用：[OpenManus-main/app/sandbox/core/sandbox.py](../OpenManus-main/app/sandbox/core/sandbox.py) — Docker SDK 调用已有
- 可复用：`SandboxSettings` — CPU/内存/网络配置已有
- 需新建：`app/sandbox/pool.py`（容器池管理）、`app/sandbox/quota.py`（用户配额）
- 需改造：`SANDBOX_CLIENT` 单例 → 改为 `SandboxPool` 实例

#### 风险与缓解
- 风险：Docker SDK 在高并发下不稳定（race condition）
- 缓解：所有容器操作走单个 worker 线程，用 asyncio queue 串行化；不直接 SDK 并发

---

### REQ-105：重试/降级策略增强 — Tool 失败 → 备用 Tool → 回流 Agent
**模块**: M02 | **状态**: Planning | **工作量**: 2-3 人天

#### 背景与价值
OpenManus 现状：Tool 失败只是 LLM 拿到 error message 继续 think，没有"换备用 tool"的策略。这导致 Agent 卡在某个不可用工具上反复重试（[REQ-000 §6.2 死循环短板](REQ-000-manus-capability-research.md)）。需要给关键工具加备用方案 + 失败回流。

#### 用户故事
As a 用户，I want Google 搜索被限流时 Agent 自动用 Bing 或 DuckDuckGo，So that 我的任务不会因为一个工具临时不可用就完全失败。

#### 详细需求点
- 工具元数据加 `fallback_tools: List[str]` 字段（如 `web_search` → `bing_search` → `ddg_search`）
- 工具调用失败时框架自动尝试 fallback（最多 N 次）
- N 次都失败后，给 Agent 注入一条系统消息"该工具链全部失败，请考虑换路径"
- 关键工具（搜索 / 文件 / 沙盒）至少 1 个 fallback
- 非功能：fallback 不破坏 KV-cache（追加到 history，不重写）

#### 验收标准
- [ ] mock Google 失败，Agent 能自动切到 Bing 完成任务
- [ ] 三个搜索引擎都失败时收到明确"请考虑换路径"提示
- [ ] fallback 链路在事件流中可见
- [ ] 跑 100 个任务测试整体失败率下降 ≥ 20%

#### 相关 OpenManus 代码
- 可复用：[OpenManus-main/app/tool/search/](../OpenManus-main/app/tool/search/) — 4 个搜索引擎已实现
- 可复用：[OpenManus-main/app/config.py](../OpenManus-main/app/config.py) — `fallback_engines` 已配置但未真正用上
- 需改造：[OpenManus-main/app/tool/tool_collection.py](../OpenManus-main/app/tool/tool_collection.py) `execute()` — 加 fallback 链
- 需改造：每个工具的 `BaseTool` 子类加 `fallback_tools` 类属性

#### 风险与缓解
- 风险：fallback 链导致 Agent 看不到原始错误（debugging 难）
- 缓解：事件流里完整保留每次尝试的 error，UI 上可展开

---

### REQ-106：任务持久化与续传
**模块**: M06/M07 | **状态**: Planning | **工作量**: 2-3 人天

#### 背景与价值
长任务（10 分钟以上）很常见。如果用户中途关浏览器或断网，回来必须能看到任务进度并继续监听事件。P0 把任务存了 DB，但事件流只在内存。P1 需要把事件也持久化 + 支持重连续传。

#### 用户故事
As a 跑长任务的用户，I want 关电脑出去吃饭回来能看到任务跑到哪了，So that 不用一直挂着浏览器。

#### 详细需求点
- 所有 stream 事件写 DB（REQ-101 的 task_steps 表加 type/payload）
- WebSocket 重连时 client 提供 `last_event_id`，server 从 DB 回放未接收
- 任务运行不依赖 WebSocket 连接（即使无 client 连接，任务也持续跑）
- 任务详情 API 返回完整事件列表（用于"打开历史任务看回放"）
- 非功能：事件写 DB 异步批量（每 5 个或 1 秒一批），避免阻塞主路径

#### 验收标准
- [ ] 关浏览器 30 秒后重连，能看到这 30 秒漏掉的事件
- [ ] 历史任务详情页能完整看到所有 think/act 事件
- [ ] 关浏览器后任务仍在跑（DB 状态变化）
- [ ] 事件批量写不显著拖慢主任务（< 50ms 增量）

#### 相关 OpenManus 代码
- 可复用：P0 REQ-003 的事件流总线 + REQ-010 的 task_steps 表
- 需新建：`app/api/event_replay.py`（DB → WS 回放）
- 需改造：event_bus 加 DB persistence 层

#### 风险与缓解
- 风险：事件量大（每任务几百条）DB 膨胀
- 缓解：定期归档 30 天前的事件到 cold storage；payload 大时只存摘要

---

### REQ-107：MCP 服务市场 — 用户可自助接入第三方 MCP Server
**模块**: M02 | **状态**: Planning | **工作量**: 3-5 人天

#### 背景与价值
MCP（Model Context Protocol）是 Anthropic 推出的开放标准，社区已有大量 MCP Server（GitHub/Slack/Notion/数据库/...）。让用户在 UI 上一键接入这些 Server，Agent 立即多出几十个工具能力，是用最小成本扩展工具生态的正确路径。OpenManus 已实现 MCP 客户端，缺的是面向用户的管理 UI 与安全审核。

#### 用户故事
As a 想让 Agent 操作我的 GitHub 仓库的用户，I want 在 Settings 里输入 GitHub MCP Server URL/Token 一键接入，So that 下次任务 Agent 就能用 GitHub 工具。

#### 详细需求点
- Settings 页"MCP Servers" tab：列出已接入 server、添加按钮
- 添加表单：name / type（SSE/stdio）/ URL or command / args / env vars
- 接入后自动调 `list_tools` 拉取该 server 工具清单，UI 展示
- 工具可勾选启用/禁用（per-user 偏好）
- DB 表 `mcp_servers(id, user_id, name, type, config, enabled)`
- 安全：command 类型 server 加白名单（避免任意命令执行）
- 非功能：MCP server 健康检查（每 5 分钟 ping 一次，挂了 UI 标红）

#### 验收标准
- [ ] 接入官方 [filesystem MCP server](https://github.com/modelcontextprotocol/servers) 后 Agent 能用其工具
- [ ] 添加错误 URL 时 UI 显示"连接失败"
- [ ] 禁用某 server 后下次任务该 server 工具不出现在 LLM tool list
- [ ] command 类型 server 不在白名单时拒绝添加

#### 相关 OpenManus 代码
- 可复用：[OpenManus-main/app/tool/mcp.py](../OpenManus-main/app/tool/mcp.py) — `MCPClients.connect_sse/connect_stdio` 完整
- 可复用：[OpenManus-main/app/agent/manus.py:67-95](../OpenManus-main/app/agent/manus.py) — `initialize_mcp_servers` 流程参考
- 需新建：`app/api/mcp_routes.py`、前端 Settings/MCP 子页、`app/mcp/health_checker.py`

#### 风险与缓解
- 风险：command 类型 MCP server 在沙盒外执行任意命令
- 缓解：command 类型强制只允许白名单（如 `npx`/`uvx`），其他全部走 SSE/HTTP

---

### REQ-108：图片批量处理（Pillow + OCR）+ 文件批量重命名工具
**模块**: M05 | **状态**: Planning | **工作量**: 2-3 人天

#### 背景与价值
Manus 公开 demo 中"自动分类上千张照片"、"批量重命名几百张发票"是高频办公场景。OpenManus 已有 Pillow 依赖（基础图像处理），但缺批量化的工具封装，也缺 OCR 能力（发票/名片识别必需）。

#### 用户故事
As a 有 500 张发票需要按"日期-供应商-金额"重命名的财务，I want Agent 自动 OCR 出关键字段并重命名所有文件，So that 不用手动一张张改。

#### 详细需求点
- `batch_image_process` 工具：批量缩放/压缩/旋转/格式转换
- `image_ocr` 工具：基于 `pytesseract`（开源）或 PaddleOCR（中文好）提取文本
- `batch_rename` 工具：按规则（如 `{date}_{vendor}_{amount}.pdf`）批量重命名，dry-run 模式
- `classify_files` 工具：按 prompt 描述的规则把文件移到不同子目录
- 所有工具支持 glob 模式（`*.jpg`）+ 进度回调
- 非功能：处理 100+ 文件时分块流式返回，不一次性占用内存

#### 验收标准
- [ ] 100 张图片批量压缩到 500KB 以内，处理 < 30 秒
- [ ] OCR 一张中英文混合图片返回文本（准确率 ≥ 80%）
- [ ] dry-run 模式只输出"将要做的改名清单"，不真改
- [ ] 用 prompt"按日期把照片移到 YYYY-MM 子目录"能正确分类

#### 相关 OpenManus 代码
- 可复用：OpenManus 已有 `Pillow~=11.1.0` 依赖
- 需新建：`app/tool/batch/`（4 个工具一个文件）
- 需新增依赖：`pytesseract` 或 `paddleocr`（OCR）

#### 风险与缓解
- 风险：OCR 库（特别是 PaddleOCR）依赖大、装机时间长
- 缓解：OCR 作为可选模块（`pip install xl_manus[ocr]`），不强制装

---

### REQ-109：透明计费 UI — token 级成本可预测
**模块**: M10 | **状态**: Planning | **工作量**: 3-4 人天

#### 背景与价值
Manus 用户最大吐槽点是"**credit 黑洞——Agent Mode 几分钟烧光月配额**"（[REQ-000 §6.2](REQ-000-manus-capability-research.md)）。复刻品采用 token 级透明计费（非 credit 池）就是直接差异化。用户能在任务运行时实时看到成本，结束时看到明细，可以提前停。

#### 用户故事
As a 个人付费用户，I want 任务运行时实时看到累计成本（"已花 $0.32 / 预算 $1.00"），So that 我能在烧太多前手动停止。

#### 详细需求点
- 任务卡片实时显示：累计 token 数（input/output 分开）+ 预估成本（USD/CNY）
- 任务详情页显示每步成本明细（哪次 LLM call 花了多少）
- 预算保护：用户可设单任务预算上限，超过自动 pause 并询问是否继续
- 月度账单页：按任务/按模型/按时间维度汇总
- 模型价格表内置（Claude/GPT/DeepSeek 等），定期更新
- 非功能：成本计算 < 5ms（不阻塞主路径）

#### 验收标准
- [ ] 跑一个任务能在 UI 上看到成本随每次 LLM call 上涨
- [ ] 设预算 $0.5，任务花到 $0.5 时自动暂停
- [ ] 月度账单准确（与 Anthropic 后台数字误差 < 5%）
- [ ] 切换 Claude → DeepSeek 后成本显示用新模型价格

#### 相关 OpenManus 代码
- 可复用：[OpenManus-main/app/llm.py](../OpenManus-main/app/llm.py) — `TokenCounter` + `update_token_count` 已有
- 需新建：`app/billing/pricing.py`（价格表）、`app/billing/aggregator.py`（聚合）、前端 Billing 页
- 需改造：`LLM.ask_tool()` — 返回 token 计数到 event_bus

#### 风险与缓解
- 风险：第三方价格表过期导致成本算错
- 缓解：价格表带版本号 + 抓取最新公开页对比；user 可手动修正

---

### REQ-110：Prompt Cache 优化（Claude prompt caching）
**模块**: M10 | **状态**: Planning | **工作量**: 1-2 人天

#### 背景与价值
P0 REQ-006 做了 KV-cache 命中率观测，本需求是真正"用上"Anthropic 的 prompt caching 功能（cache_control 参数）。命中后输入 token 价格便宜 90%（Anthropic 文档），是 P1 成本下降 ≥ 30% 目标的主力。

#### 用户故事
As a 平台付费用户，I want 长 system prompt + 工具描述不每次都全价计费，So that 10 步任务的成本接近 1 步任务的 2 倍而不是 10 倍。

#### 详细需求点
- system prompt + 稳定 prefix 加 `cache_control: {type: "ephemeral"}` 标记
- 工具描述位置固化在 system 末尾（与 P0 REQ-004 配套）
- LLM 响应解析 `cache_creation_input_tokens` / `cache_read_input_tokens` 写入计费（REQ-109）
- cache 命中率指标在 Library/Settings 可看
- 非功能：cache 启停可配（debug 用）

#### 验收标准
- [ ] 第 2 步开始的 LLM call 命中 cache（read_tokens > 0）
- [ ] 跑 10 步任务，平均节省输入 token 成本 ≥ 70%
- [ ] cache 关闭后 read_tokens 始终为 0（机制可控）
- [ ] 不同 task 之间不串 cache（不共享）

#### 相关 OpenManus 代码
- 可复用：P0 REQ-006 的 KV-cache 埋点
- 需改造：[OpenManus-main/app/llm.py](../OpenManus-main/app/llm.py) `ask_tool()` — 添加 `cache_control` 到 messages

#### 风险与缓解
- 风险：只有 Anthropic 支持 prompt caching（OpenAI 等不一致）
- 缓解：按 provider 检测，OpenAI 走原生 prompt caching（automatic prefix caching），其他 provider log warning 跳过

---

### REQ-111：多模型混合调度 — 规划用 Opus、执行用 Sonnet/Haiku
**模块**: M10 | **状态**: Planning | **工作量**: 3-5 人天

#### 背景与价值
任务里的不同步骤对模型能力要求差异很大：高层规划/复杂推理需要 Opus，执行步骤/工具选择 Sonnet/Haiku 就够。一刀切用 Opus 浪费钱、一刀切用 Haiku 又"不够聪明"。多模型混合调度是降本增效的关键手段。

#### 用户故事
As a 关注成本的用户，I want 平台自动给重思考的步骤用 Opus、简单步骤用 Haiku，So that 任务质量不降但成本下降 50%+。

#### 详细需求点
- 配置：每个 step type 默认模型（如 `planning: opus` / `execution: sonnet` / `tool_selection: haiku`）
- Agent 内部根据当前 step type 切换 LLM 实例（复用 `LLM._instances` 单例池）
- 提供 `route_model()` hook，允许根据上下文动态选择
- 模型切换不破坏 KV-cache（同一 LLM 内才会命中）
- 用户可在 Settings 自定义路由策略
- 非功能：切换模型 < 50ms（只是查 dict）

#### 验收标准
- [ ] 跑一个任务事件流中能看到不同步骤用了不同模型
- [ ] 与全 Sonnet 对比，混合模式成本下降 ≥ 30%（同任务）
- [ ] 任务质量评分不下降（人工评估 10 个任务）
- [ ] 自定义路由策略立即生效

#### 相关 OpenManus 代码
- 可复用：[OpenManus-main/app/llm.py:LLM._instances](../OpenManus-main/app/llm.py) — 多模型已支持
- 可复用：[OpenManus-main/app/config.py](../OpenManus-main/app/config.py) — `llm.vision` 多配置先例
- 需新建：`app/agent/model_router.py`（路由策略）
- 需改造：[OpenManus-main/app/agent/toolcall.py](../OpenManus-main/app/agent/toolcall.py) — `think()` 加 step type 标识

#### 风险与缓解
- 风险：模型切换破坏 KV-cache，反而成本上升
- 缓解：同 step type 内坚持同一模型；KV-cache 按 (model, prefix) 分桶

---

### REQ-112：任务模板系统 — 常用任务保存为模板，一键复用
**模块**: M06 | **状态**: Planning | **工作量**: 2-3 人天

#### 背景与价值
用户经常做重复性任务（每周公司调研、每月数据汇总），每次重新写 prompt 又麻烦又不一致。把成功任务保存为模板，下次填几个参数就能跑，是大幅提升复用价值的能力。Manus 也有 Playbook（模板）功能。

#### 用户故事
As a 每周都要"调研行业前五公司"的用户，I want 把成功的任务保存为模板，下次输入"行业名"就能一键跑，So that 不用每次重新写 prompt。

#### 详细需求点
- 任务成功后"保存为模板"按钮
- 模板表单：name / description / prompt_template（含 `{variable}` 占位）/ default_model / tags
- Library 加"模板"tab，可浏览/编辑/删除
- 跑模板时弹表单填变量，提交后实例化为新任务
- 公共模板（admin 标记）vs 私有模板
- 非功能：模板渲染 < 100ms

#### 验收标准
- [ ] 保存一个含 `{industry}` 变量的模板
- [ ] 从模板新建任务时弹表单要求填 industry
- [ ] 模板列表按 tag 过滤
- [ ] 删除模板不影响已生成的任务

#### 相关 OpenManus 代码
- 需新建：DB 表 `templates`、`app/api/template_routes.py`、前端 Templates 页
- 可复用：现有任务创建流程（REQ-001）

#### 风险与缓解
- 风险：模板与 Skills（REQ-115）功能重叠
- 缓解：明确边界——模板是"参数化 prompt"，Skills 是"封装工作流逻辑（含工具/代码）"；模板 UI 上链接到 Skills 文档

---

### REQ-113：工具动态启用（per-task tool masking）
**模块**: M02 | **状态**: Planning | **工作量**: 3-4 人天

#### 背景与价值
Yichao Ji 明说"**工具越多 Agent 越蠢**"（[REQ-000 §3.3](REQ-000-manus-capability-research.md)）。OpenManus 当前全量暴露所有工具给 LLM，工具描述加起来几千 token，且会干扰 LLM 决策。按任务动态启用相关工具是 Manus 核心工程实践。

#### 用户故事
As a 平台开发者，I want Agent 在做"网页调研"时不暴露"shell 执行"工具，So that LLM 不会乱用不相关工具 + 节省 token。

#### 详细需求点
- 工具按 namespace 分类：`browser_*` / `file_*` / `code_*` / `mcp_*` / 等
- 任务开始时由 LLM（用一个轻量模型）做"工具选择"：根据 prompt 选出本任务需要的 namespace
- 选中的 namespace 工具放进 system prompt 末尾（KV-cache 友好）
- 任务进行中也可动态调整（用户/Agent 触发）
- 默认策略：始终启用基础工具（file/shell），其他按需
- 非功能：工具选择决策 < 2 秒；不影响主任务 KV-cache（独立 LLM 实例）

#### 验收标准
- [ ] 跑"翻译一段文字"任务，事件流显示只启用了 1-2 个工具
- [ ] 跑"写并执行 Python 代码"任务，code_* + file_* namespace 启用
- [ ] 与全量暴露对比，相同任务首步 input token 下降 ≥ 30%
- [ ] 工具选择错了能在任务中后期补救（动态启用）

#### 相关 OpenManus 代码
- 需改造：[OpenManus-main/app/tool/tool_collection.py](../OpenManus-main/app/tool/tool_collection.py) — 加 namespace + filter 方法
- 需改造：[OpenManus-main/app/agent/manus.py](../OpenManus-main/app/agent/manus.py) — 任务开始时调用 selector
- 需新建：`app/agent/tool_selector.py`（轻量 LLM 选工具）

#### 风险与缓解
- 风险：工具选择错了 Agent 卡死
- 缓解：始终保留 "request_tool" 元工具让 Agent 主动请求新工具；超时检测自动 fallback 到全量模式

---

### REQ-114：本地浏览器集成（用户已登录态）
**模块**: M03 | **状态**: Planning | **工作量**: 5-7 人天

#### 背景与价值
Manus 用户最大痛点之一是"**被 paywall + CAPTCHA 卡住——深度调研被现实墙阻挡**"（[REQ-000 §6.2](REQ-000-manus-capability-research.md)）。利用用户本地浏览器的已登录态（cookies/session）就能绕开 99% 的人机校验。这是复刻品对 Manus 的直接差异化优势。

#### 用户故事
As a 已经登录了 The Information / Bloomberg / 知网的用户，I want Agent 用我的本地浏览器访问这些付费内容，So that 我的订阅价值被 Agent 利用而不是被 paywall 挡住。

#### 详细需求点
- 桌面 helper 程序（Chrome 扩展 或 本地 CDP 代理）
- Web 端配置"本地浏览器"连接（生成配对码 → 扩展输入）
- Browser tool 增加 `use_local_browser: bool` 参数
- 选择本地浏览器时通过 CDP（Chrome DevTools Protocol）远程操作用户的 Chrome
- 数据流：截图/DOM 提取传回云端 Agent，操作指令传到本地浏览器
- 安全：用户在扩展 UI 看到每个操作 + 一键中止；按域名 allowlist
- 非功能：操作延迟 < 1 秒（本地→云端→本地）

#### 验收标准
- [ ] Chrome 扩展可安装，与 Web 端配对成功
- [ ] Agent 能通过本地浏览器登录态访问付费文章
- [ ] 用户在扩展 UI 看到 Agent 当前操作
- [ ] 域名不在 allowlist 时操作被拦截

#### 相关 OpenManus 代码
- 可复用：[OpenManus-main/app/tool/browser_use_tool.py](../OpenManus-main/app/tool/browser_use_tool.py) — `wss_url`/`cdp_url` 已支持远程浏览器
- 需新建：`browser_extension/`（Chrome 扩展项目）+ `app/api/local_browser_routes.py`（配对/中转）

#### 风险与缓解
- 风险：Chrome 扩展跨浏览器适配（Firefox/Edge）成本高
- 缓解：MVP 只做 Chrome；扩展用 Manifest V3 标准便于将来适配 Edge
- 风险：扩展上架审核
- 缓解：提供 sideload 安装方式（开发者模式）+ 同时申请上架

---

### REQ-115：Skills 包格式（SKILL.md 兼容 Anthropic 开放标准）
**模块**: M02 | **状态**: Planning | **工作量**: 4-5 人天

#### 背景与价值
Manus 自己已经在跟 Anthropic Skills 开放标准兼容（[REQ-000 §1 Agent Skills](REQ-000-manus-capability-research.md)）。复刻品如果也兼容，可以直接用 Anthropic 社区现有 skills（如 [anthropics/skills](https://github.com/anthropics/skills) 仓库的 pdf/docx/pptx/xlsx 等）。这是用最小成本获得海量工作流封装的路径。

#### 用户故事
As a 想给 Agent 加自定义工作流的用户，I want 写一个 SKILL.md 文件（描述触发条件 + 步骤），Agent 就能学会，So that 不用改 Agent 代码。

#### 详细需求点
- Skill 包目录结构：`{skill_name}/SKILL.md`（描述）+ `*.py`（可选脚本）+ `assets/`
- SKILL.md frontmatter：`name`/`description`/`triggers`/`tools_required`（与 Anthropic 标准一致）
- Skill 加载器扫描 skills 目录，按 trigger 描述匹配
- Settings 页"Skills" tab：浏览/启用/上传 skill
- 内置常用 skills：pdf 处理、docx 编辑、pptx 生成、xlsx 操作（直接用 Anthropic 仓库的）
- 非功能：skill 执行在沙盒内（继承 P0 REQ-005 隔离）

#### 验收标准
- [ ] 加载 `anthropics/skills/pdf` skill 后 Agent 能用 skill 处理 PDF
- [ ] 用户上传自定义 skill 包 zip 后立即可用
- [ ] skill trigger 关键词命中时 LLM 收到该 skill 描述
- [ ] skill 不在 allowlist 时执行失败有友好错误

#### 相关 OpenManus 代码
- 可复用：[OpenManus-main/app/tool/tool_collection.py](../OpenManus-main/app/tool/tool_collection.py) — 注册机制可借鉴
- 可复用：P0 REQ-005 沙盒隔离
- 需新建：`app/skills/`（loader、registry、validator）+ `app/api/skills_routes.py`

#### 风险与缓解
- 风险：Skill 执行未知 Python 代码，安全风险
- 缓解：强制沙盒执行 + 限制 import；社区 skill 接入前 UI 显示"需要的权限清单"让用户确认
- 风险：Anthropic 标准可能变化
- 缓解：内部用 adapter 层，标准变只改 adapter

---

### REQ-116：Data Visualization Dashboard 生成
**模块**: M05 | **状态**: Planning | **工作量**: 3-4 人天

#### 背景与价值
Manus demo 中"Tesla 深度股票分析"、"日本旅行手册"等高频用例都产出"**可视化 dashboard 网页**"，是远比纯 Excel 表格更有交付感的产物（[REQ-000 §2 用例 2/3](REQ-000-manus-capability-research.md)）。P0 REQ-008 做了基础网页交付，本需求是升级到"自动出图表 + 拼装 dashboard"。

#### 用户故事
As a 提"分析 2024 年新能源车销量趋势"需求的用户，I want Agent 自动出折线图 + 柱状图 + 饼图，拼成一页响应式 dashboard 网页，So that 我能直接发给老板看。

#### 详细需求点
- 图表生成工具：`generate_chart(type, data, options)` 支持 line/bar/pie/scatter/heatmap（基于 `plotly`，输出 HTML/PNG 二选一）
- Dashboard 拼装工具：`compose_dashboard(title, charts=[], texts=[])` 用预设布局（grid/tabs）生成单页 HTML
- 内置 3-5 个 dashboard 模板（finance/research/comparison/...）
- 输出文件存到 artifacts/（与 REQ-005 配合）
- 非功能：dashboard 文件自包含（内联 CSS + 数据），可离线打开

#### 验收标准
- [ ] Agent 能生成 5 种图表类型，PNG 与交互式 HTML 都正常
- [ ] dashboard 在浏览器中布局正确，响应式
- [ ] dashboard 文件单独打开（无网络）仍能显示
- [ ] E2E 跑"分析销量趋势"任务能产出含 3 图的 dashboard

#### 相关 OpenManus 代码
- 可复用：[OpenManus-main/app/tool/chart_visualization/](../OpenManus-main/app/tool/chart_visualization/) — 已有 pandas 数据处理
- 可复用：P0 REQ-008 的 jinja2 模板基础
- 需新建：`app/tool/dashboard/`（chart_generator + composer + templates）
- 需新增依赖：`plotly`

#### 风险与缓解
- 风险：Plotly HTML 文件体积大（含 JS 库，~3MB）
- 缓解：默认离线模式自带 plotly.min.js；可配置改为 CDN 加载减小体积

---

## 阶段风险与缓解

| 风险 | 影响 | 缓解 |
|------|------|------|
| OAuth 集成涉及多个第三方，调试成本高 | 中 | 第一版只支持 Email-Password，OAuth 后置 |
| PostgreSQL 数据迁移可能丢任务历史 | 高 | 迁移脚本充分测试，提供 dry-run 模式 |
| Sandbox 多租户的容器编排复杂度被低估 | 高 | 不上 K8s（留到 P2），用 Docker SDK 自管理容器池 |
| MCP 服务市场可能引入恶意服务器（安全风险） | 高 | 强制审核/白名单制，UI 配置时给出明确风险提示 |
| **本地浏览器集成涉及 Chrome 扩展，跨 OS 适配复杂** | 高 | 优先 CDP（Chrome DevTools Protocol）方案，跨 OS 一致；扩展作为可选增强 |
| **工具动态启用可能导致 Agent 困惑（找不到工具）** | 中 | mask 策略保守，只在 system prompt 末尾"隐藏"工具描述，工具本身仍可调用 |
| **Skills 包加载存在执行未知代码的安全风险** | 高 | Skills 默认在沙盒内执行，禁止访问敏感目录；UI 上明确显示 skill 权限范围 |

---

## Go/No-Go 评审清单（进入 P2 前）

- [ ] 所有 16 个 P1 需求 Status = Completed
- [ ] 至少 50 个真实任务跑过
- [ ] 至少 10 个用户并发无故障
- [ ] 平均每任务成本下降 ≥ 30%
- [ ] 本地浏览器实测可绕过至少 3 个常见 paywall 网站
- [ ] 至少加载 3 个 Anthropic 社区 skill 包正常使用
- [ ] 有完整的部署文档 + 监控基础（即使没上 Prometheus，至少有结构化日志）

---

## 备注

- 本文档基于 REQ-000 调研新增了 4 个差异化能力（REQ-113/114/115/116）
- 原 REQ-109（Token 成本统计）被升级为"透明计费 UI"，是对 Manus 用户最大痛点的差异化回应
- MCP 服务市场（REQ-107）与 Skills 包（REQ-115）功能上有部分重叠，详细设计阶段需明确边界（一种选择：MCP 是工具协议，Skills 是工作流封装）
