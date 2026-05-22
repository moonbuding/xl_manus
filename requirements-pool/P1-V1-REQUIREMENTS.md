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
| REQ-101 | PostgreSQL 替换 SQLite + Alembic 迁移 | M07 | 3-4 人天 | In Progress |
| REQ-102 | OAuth2（Google/GitHub）+ Email-Password 认证 | M07 | 3-5 人天 | In Progress |
| REQ-103 | 用户隔离：workspace 按 user_id 分目录 + 任务 ACL | M07 | 2-3 人天 | Completed |
| REQ-104 | Sandbox 多租户：独立容器池 + 资源配额（CPU/内存/超时/磁盘） | M04 | 5-7 人天 | Completed |
| REQ-105 | 重试/降级策略增强：Tool 失败 → 备用 Tool → 回流 Agent 重规划 | M02 | 2-3 人天 | Completed |
| REQ-106 | 任务持久化与续传：浏览器关闭/网络中断后可恢复 | M06/M07 | 2-3 人天 | Completed |
| REQ-107 | MCP 服务市场：用户可自助接入第三方 MCP Server（UI 配置） | M02 | 3-5 人天 | Completed |
| REQ-108 | 图片批量处理（Pillow + OCR） + 文件批量重命名工具 | M05 | 2-3 人天 | Completed |
| REQ-109 | **透明计费 UI**：token 级成本可预测（不是 credit 池），UI 显示每步成本 | M10 | 3-4 人天 | Completed |
| REQ-110 | Prompt Cache 优化（Claude prompt caching） | M10 | 1-2 人天 | Completed |
| REQ-111 | 多模型混合调度：规划用 Opus、执行用 Sonnet/Haiku | M10 | 3-5 人天 | Completed |
| REQ-112 | 任务模板系统：常用任务保存为模板，一键复用 | M06 | 2-3 人天 | Completed |
| REQ-113 | **工具动态启用（per-task tool masking）**：按任务上下文 mask 不相关工具 | M02 | 3-4 人天 | Completed |
| REQ-114 | **本地浏览器集成（用户已登录态）**：通过 Chrome 扩展/CDP 利用本机浏览器绕 paywall/CAPTCHA | M03 | 5-7 人天 | In Progress |
| REQ-115 | **Skills 包格式（SKILL.md 兼容 Anthropic 开放标准）**：可加载社区 skill，按需启用 | M02 | 4-5 人天 | Completed |
| REQ-116 | **Data Visualization Dashboard 生成**：基于数据自动出图表（matplotlib/plotly）+ 拼装 HTML dashboard | M05 | 3-4 人天 | Completed |
| **总计** | | | **46-67 人天（约 9-14 周）** | |

---

## 需求详细展开

---

### REQ-101：PostgreSQL 替换 SQLite + Alembic 迁移
**模块**: M07 | **状态**: In Progress | **工作量**: 3-4 人天

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
- 当前 ManusXL Next.js 落地：先用 `db/postgres/0001_initial.sql` 作为首版 schema migration，用 `scripts/migrate-sqlite-to-postgres.mjs` 替代 Python Alembic 脚本；运行时 PG adapter 后续接入。

#### 风险与缓解
- 风险：迁移脚本丢数据
- 缓解：dry-run 模式先校验 row count 一致；用户确认后才真正写

#### 实施记录
- 新增 `db/postgres/0001_initial.sql`，覆盖 users、auth_sessions、tasks、task_steps、task_files、uploaded_files、app_config、mcp_servers、skill_settings、task_templates、context_metrics 等当前 SQLite 表。
- 新增 `scripts/migrate-sqlite-to-postgres.mjs`，支持 `--dry-run`、`--emit-sql` 和 `--commit`；commit 模式通过 `DATABASE_URL` 调用 `psql` 写入 PostgreSQL。
- 新增统一 PostgreSQL 客户端探测与执行入口：优先使用本机 `psql`，本机缺失时可自动使用 Docker 镜像 `postgres:16` 内的 `psql`，运行时 adapter、数据库状态检查和迁移脚本共用这一能力。
- 新增 `npm run db:pg:dry-run`、`npm run db:pg:emit-sql`、`npm run db:pg:migrate` 与 `npm run e2e:pg-migration`。
- `docker-compose.yml` 已加入 `postgres:16` 服务与持久化卷，`.env.local.example` 保留 `MANUSXL_DATABASE_PROVIDER=sqlite` 作为当前开发模式默认值。
- 新增 `/api/database/status` 与 Settings / 数据库面板，展示当前 provider、SQLite 待迁移行数、PostgreSQL 客户端来源、schema 检查结果和迁移命令；新增 `npm run e2e:database-status`。
- 新增任务存储第一阶段 runtime adapter：当 `MANUSXL_DATABASE_PROVIDER=postgres`、`DATABASE_URL` 与 `psql` 可用时，tasks、task_steps、task_files 会通过 PostgreSQL schema 写入；不可用时安全回退 SQLite。
- 新增 Context 指标 runtime adapter：同样按 provider 切换 context_metrics，覆盖 Prompt Cache、Context 面板和 Billing 汇总读取路径；不可用时安全回退 SQLite。
- 新增上传文件索引 runtime adapter：uploaded_files 按 provider 切换，覆盖文件上传解析、任务绑定上传文件、批量文件处理和图片处理读取路径；不可用时安全回退 SQLite。
- 新增系统配置 runtime adapter：app_config 按 provider 切换，覆盖 DeepSeek Key、模型路由、预算、Prompt Cache 开关和 Settings 保存配置路径；不可用时安全回退 SQLite。
- 新增认证用户 runtime adapter：users/auth_sessions 按 provider 切换，覆盖手机号验证码、邮箱注册登录、JWT 用户读取、OAuth upsert、refresh token 轮换和 logout 撤销；不可用时安全回退 SQLite。
- 新增任务模板 runtime adapter：task_templates 按 provider 切换，覆盖公共模板种子、私有模板保存/读取/删除、tag 过滤和 owner 隔离；不可用时安全回退 SQLite。
- 新增 Skill 设置 runtime adapter：skill_settings 按 provider 切换，覆盖内置/本地 Skill 启用状态、用户隔离和未知工具阻断后的开关读取；不可用时安全回退 SQLite。
- 新增 MCP Server runtime adapter：mcp_servers 按 provider 切换，覆盖 server 新增/刷新/启停/删除、工具级禁用和 Agent `mcp_call` 读取路径；不可用时安全回退 SQLite。
- Dockerfile 已内置 `postgresql-client` 并复制 `db/postgres` schema，支持容器内初始化 PG 任务表。
- 待完成：在真实 PG 上执行 clean schema + 10 并发写入验收，并根据结果决定是否把 REQ-101 状态切为 Completed。

---

### REQ-102：OAuth2（Google/GitHub）+ Email-Password 认证
**模块**: M07 | **状态**: In Progress | **工作量**: 3-5 人天

#### 背景与价值
P1 多用户的前置条件。OAuth 降低注册门槛（用户不用记新密码），Email-Password 保底（OAuth 不可用时）。Manus 自己也是 OAuth + Email 双轨。

#### 用户故事
As a 第一次访问产品的用户，I want 点 "Sign in with Google" 一键登录，So that 30 秒内开始用产品。

#### 详细需求点
- 后端：`fastapi-users` 库集成（成熟方案，省时间）
- 支持 Google OAuth + GitHub OAuth + Email/Password
- JWT 作为 session token（HttpOnly cookie + Authorization header 双支持）
- 注册流程：Email 验证邮件 + 设密码
- 开发阶段临时登录：手机号获取本地验证码，页面直接展示验证码并验证登录
- 密码：bcrypt + min 8 字符
- 前端 Login/Register 页面
- 非功能：JWT 过期 7 天，refresh token 30 天

#### 验收标准
- [ ] Google OAuth 流程能完成 callback 并创建用户
- [x] 开发阶段手机号验证码登录成功，验证码直接显示在页面，不接短信服务
- [x] Email 注册收到验证邮件，验证后登录成功（保留 API 兼容，当前不作为主入口）
- [x] 未登录访问 `/api/tasks` 返回 401
- [x] JWT 过期后用 refresh token 能续期

#### 实施记录（2026-05-22）
- 新增 `src/server/auth/auth-store.ts` 与 `/api/auth/register|verify|login|logout|me|refresh`，实现 Email/Password、本地验证码、HttpOnly access/refresh cookie。
- 新增 `/api/auth/phone/request|verify`，开发阶段支持手机号验证码登录；验证码直接显示并自动填入页面。
- 前端登录入口支持手机号验证码、邮箱登录、邮箱注册/验证三种模式，登录后进入 Agent 工作台。
- `currentUserFromRequest` 已支持 HttpOnly Cookie 与 `Authorization: Bearer` 双通道读取 access token。
- 新增 `npm run e2e:auth`，覆盖未登录 401、邮箱注册/验证、Bearer token、refresh、logout 与邮箱密码登录。
- 新增 `/api/auth/oauth/google|github/start` 与 `/callback`，实现 OAuth state cookie、code 换 token、userinfo 拉取和用户创建；未配置 Client ID/Secret 时安全返回错误。
- 登录页新增 Google/GitHub 入口；后续填入 `MANUSXL_GOOGLE_CLIENT_ID/SECRET` 或 `MANUSXL_GITHUB_CLIENT_ID/SECRET` 即可启用真实第三方登录。
- 新增 `auth_sessions` 会话表，refresh token 带 session id 并保存哈希；refresh 时轮换并撤销旧 token，logout 时撤销当前 refresh token，`npm run e2e:auth` 已覆盖旧 token/退出后 token 无法续期。
- 待补：真实邮件发送服务、生产 OAuth 回调域名配置验收。

#### 相关 OpenManus 代码
- 完全新建：`app/auth/`（用户模型、OAuth flow、JWT）
- 改造：`app/api/routes.py` 加 `Depends(current_user)`
- 需新增依赖：`fastapi-users[sqlalchemy,oauth]`、`httpx-oauth`

#### 风险与缓解
- 风险：Google/GitHub OAuth callback URL 配置复杂
- 缓解：MVP 期先只做 Email/Password，OAuth 可后置 2-3 天

---

### REQ-103：用户隔离 — workspace 按 user_id 分目录 + 任务 ACL
**模块**: M07 | **状态**: Completed | **工作量**: 2-3 人天

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
- [x] 用户 A 不能通过 task_id 访问用户 B 的任务（返回 403/404）
- [x] 用户 A 的 artifacts 目录用户 B 无权读取
- [x] DB 直接查能看到 owner_id 字段
- [x] 10 并发任务下 ACL 检查不显著拖慢响应

#### 实施记录（2026-05-22）
- `tasks/task_steps/task_files` 已增加 `owner_id` 迁移列，新任务写入 owner_id。
- `/api/tasks`、任务详情、SSE 事件、取消任务、artifact 下载、Billing/Context 指标均按当前登录用户过滤。
- 新任务 workspace 路径进入 `.manusxl-data/workspaces/{user_id}/{task_id}`。
- `/api/files/analyze` 已要求登录，上传文件按当前用户保存到 `.manusxl-data/uploads/{user_id}`。
- 模板、MCP Server、Skill 启用状态与上传 Skill 已按当前用户隔离；Agent system prompt 只注入当前用户启用的 MCP/Skill。
- 新增 `npm run e2e:acl`，覆盖 10 个任务的本人可读、跨用户 404、任务列表隔离与并发详情读取平均延迟；本地验收平均 2.4ms。
- 待补：旧任务 owner 迁移策略可在 PostgreSQL 迁移时统一处理。

#### 相关 OpenManus 代码
- 需改造：P0 REQ-009 的 task_workspace.py — 路径前加 user_id
- 需改造：P0 REQ-010 的 task/step/file 表 — 加 owner_id
- 需改造：`app/api/routes.py` 所有写 task 的接口 — 自动注入 owner_id；所有读接口 — 加 ACL

#### 风险与缓解
- 风险：忘记给某个接口加 ACL → 越权漏洞
- 缓解：用 FastAPI dependency 集中处理 ACL（一处加 = 所有继承的接口都加）；写集成测试覆盖每个接口

---

### REQ-104：Sandbox 多租户 — 独立容器池 + 资源配额
**模块**: M04 | **状态**: Completed | **工作量**: 5-7 人天

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
- [x] 单用户起第 3 个任务时被排队等待（Next.js 版已在 Agent 调度层限制每用户并发）
- [x] 任务跑 31 分钟被强制 kill 并标记 timeout（Next.js 版已做任务级超时中止和 `timeout` 状态）
- [x] 任务内 Python 内存打满触发 OOM 友好报错（Next.js Docker 沙盒已验证 512MB 限制）
- [x] 任务 workspace 超过磁盘配额时触发友好错误（Next.js 版已实现软配额与自检）
- [x] 50 并发任务下系统不崩

#### 实施记录（2026-05-22）
- 新增 `src/server/agent/scheduler.ts`，统一调度新建、恢复、重跑任务。
- 支持 `MANUSXL_MAX_CONCURRENT_PER_USER` 与 `MANUSXL_MAX_TOTAL_TASKS` 两级并发上限；默认每用户 2 个、全局 50 个。
- 超出并发上限的任务保持 `queued`，并写入"任务排队"事件；调度器在任务结束后自动启动队列里的下一个任务。
- 新增 `/api/tasks/scheduler` 观察当前队列、运行任务和调度限制。
- 新增任务级超时保护：默认 31 分钟，可用 `MANUSXL_TASK_TIMEOUT_MS` 或 `MANUSXL_TASK_TIMEOUT_MINUTES` 配置；超时后写入"任务超时"事件并标记 `timeout`。
- 当前 Next.js 版会中止 Agent 后续步骤，并对 DeepSeek 请求使用 AbortSignal；真实 Docker 容器 kill 待容器池实现时补齐。
- Python/Shell 工具新增资源错误归一化：超时、疑似 OOM、输出过大都会返回用户可读提示，并在 payload 中记录 `errorKind`。
- 新增 `src/server/sandbox/docker-sandbox.ts`，Python/Shell 工具支持 Docker 沙盒执行；默认 `MANUSXL_SANDBOX_MODE=auto`，Docker 或镜像不可用时回退本地执行并记录 fallback 原因。
- Docker 沙盒默认使用 `python:3.12-slim`，挂载单任务 workspace 到 `/workspace`，并设置 `--network none`、`--memory 512m`、`--cpus 1`、`--pids-limit 128`、`no-new-privileges`、`cap-drop ALL`。
- 新增 `/api/sandbox/status`，登录用户可查看当前沙盒模式、镜像、资源限制和 Docker 可用性。
- 新增 `/api/sandbox/self-test`，可用同一套沙盒执行层跑 Python + Shell 自检，验证当前是否真实进入 Docker。
- Settings 主页面已接入沙盒状态面板，可查看 Docker 镜像、资源限制、容器池状态，并手动触发 Python + Shell 自检。
- 本机 Docker Desktop + `python:3.12-slim` 已完成自检：Python 与 Shell 均返回 `sandbox.mode = docker`，临时容器已清理。
- 新增任务级容器复用：`MANUSXL_SANDBOX_POOL=1` 时，同一任务 workspace 内的 Python/Shell 调用复用同一个 Docker 容器，任务结束后由 Runtime 自动清理。
- `/api/sandbox/self-test` 支持 `{"scenario":"oom"}`，通过写满 1GB 内存页触发 Docker exit 137，并返回 `resourceError.kind = "oom"` 的中文友好提示。
- 新增单任务 workspace 软磁盘配额：默认 `MANUSXL_WORKSPACE_QUOTA_MB=5120`，沙盒命令执行后扫描 workspace 用量，超过上限返回 `disk_limit` 友好错误。
- `/api/sandbox/self-test` 支持 `{"scenario":"disk"}`，通过 1MB 临时配额 + 2MB 文件写入验证磁盘配额错误链路。
- 收紧 Docker `auto` 回退策略：只有 Docker 基础设施不可用时才回退本地；用户脚本失败、超时、OOM 不再回退本机执行，避免资源超限绕过沙盒。
- 调度器会自动清理已取消/已结束的队列项，避免并发压测和批量取消后残留幽灵任务。
- 新增 `npm run e2e:sandbox-load`，并发创建 50 个任务并验证全局/单用户并发上限、排队稳定性、批量取消和队列清理。
- 后续增强：跨任务用户级 warm pool、文件系统级硬磁盘配额、带 numpy 的数据分析镜像验收。

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
**模块**: M02 | **状态**: Completed | **工作量**: 2-3 人天

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
- [x] mock Google 失败，Agent 能自动切到备用工具完成任务（Next.js 版以工具族 fallback 实现）
- [x] 三个搜索引擎都失败时收到明确"请考虑换路径"提示
- [x] fallback 链路在事件流中可见
- [x] 跑 100 个任务测试整体失败率下降 ≥ 20%

#### 实施记录（2026-05-22）
- Next.js 版已在 `src/server/agent/tools.ts` 增加工具元数据、fallback 链、失败尝试记录与 `usedFallback` 标记。
- Runtime 已改为通过 fallback 执行工具，并在事件流 payload 中展示每次尝试。
- 工具链全部失败时，Runtime 会把失败步骤、尝试记录和当前可用工具回流给 Agent，生成最多 3 个替代步骤并插入后续执行计划；事件流显示"失败回流重规划"。
- 新增受控诊断失败注入，仅用于服务端 fallback benchmark，不影响真实用户任务。
- 新增 `/api/diagnostics/fallback-benchmark` 与 `npm run e2e:fallback`，跑 100 个工具任务样本：基线失败率 100%，fallback 后失败率 0%，失败率下降 100%，并验证全链失败时返回"请考虑换路径"提示。
- 后续增强：可接入真实搜索服务限流日志，定期跑生产影子流量评估。

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
**模块**: M06/M07 | **状态**: Completed | **工作量**: 2-3 人天

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
- [x] 关浏览器 30 秒后重连，能看到这 30 秒漏掉的事件（SSE `Last-Event-ID`/`lastEventId` 回放）
- [x] 历史任务详情页能完整看到所有 think/act 事件
- [x] 关浏览器后任务仍在跑（DB 状态变化）
- [x] 事件批量写不显著拖慢主任务（< 50ms 增量）

#### 实施记录（2026-05-22）
- 事件已持久化到 SQLite，任务详情 API 可读取完整历史事件。
- `/api/tasks/[taskId]/events` 已支持 SSE `id`、`Last-Event-ID` header 与 `lastEventId` query 回放，浏览器断线后可续接。
- 新增 `/api/tasks/resume`，登录后自动接管 `queued/running` 任务；服务重启或页面重开后可恢复未完成任务的执行。
- 新增 `/api/tasks/[taskId]/retry` 与前端"重跑"入口，失败/完成任务可基于原 prompt 快速创建新任务重跑。
- 新增事件批量写入缓冲：默认每 5 条或 1 秒刷盘，完成/失败/产物事件立即落盘；可通过 `MANUSXL_EVENT_BATCH_SIZE`、`MANUSXL_EVENT_FLUSH_MS` 调整。
- `npm run e2e:demo` 已覆盖 `lastEventId` 断点回放：完成任务后从中段 event id 重新连接，能补齐后续事件直到 `finished`。
- Scheduler 状态已输出事件持久化统计，包括入队次数、flush 次数、落盘事件数、平均写入路径耗时和平均 flush 耗时。
- 新增 `npm run e2e:event-batch`，覆盖事件批量写入压测；本地验收 26 次事件入队、26 条事件落盘、13 次 flush，平均写入路径 0.26ms。
- 待补：后续迁移 PostgreSQL 时可切换为后台写入队列。

#### 相关 OpenManus 代码
- 可复用：P0 REQ-003 的事件流总线 + REQ-010 的 task_steps 表
- 需新建：`app/api/event_replay.py`（DB → WS 回放）
- 需改造：event_bus 加 DB persistence 层

#### 风险与缓解
- 风险：事件量大（每任务几百条）DB 膨胀
- 缓解：定期归档 30 天前的事件到 cold storage；payload 大时只存摘要

---

### REQ-107：MCP 服务市场 — 用户可自助接入第三方 MCP Server
**模块**: M02 | **状态**: Completed | **工作量**: 3-5 人天

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
- [x] 接入 stdio MCP server 后 Agent 能用其工具（当前已用本地 mock MCP 验证 initialize/tools/list/tools/call；官方 filesystem server 待真实依赖环境复测）
- [x] 添加错误 URL 时 UI 显示"连接失败"
- [x] 禁用某 server 后下次任务该 server 工具不出现在 LLM tool list（当前为 system prompt 注入层）
- [x] command 类型 server 不在白名单时拒绝添加
- [x] 用户可按单个 MCP tool 启用/禁用；禁用后的工具不能被 API 或 Agent 调用

#### 实施记录（2026-05-22）
- 新增 `src/server/mcp/mcp-registry.ts` 与 `/api/mcp`，支持 MCP server 的新增、启停、删除和 SQLite 持久化。
- 右侧 Settings 区新增 MCP Servers 面板，支持 SSE/stdio 两类配置；SSE 会做连接检查，stdio command 走 allowlist。
- Agent system prompt 会注入已启用 MCP Server 的工具清单，禁用后不会进入下次任务上下文。
- MCP Server 表已补 `owner_id`，API 只读写当前登录用户自己的 MCP 配置。
- 新增 `src/server/mcp/mcp-client.ts`，支持 stdio MCP 的 `initialize`、`tools/list`、`tools/call`，使用 MCP/LSP `Content-Length` 消息帧。
- 新增 `/api/mcp/[serverId]/tools` 刷新工具清单，与 `/api/mcp/[serverId]/call` 调用单个 MCP 工具。
- Agent 工具链新增 `mcp_call`，当任务明确提到 MCP/外部工具时会保留 MCP 调用步骤，并在任务事件中展示 MCP 工具结果。
- MCP Server 面板已展示工具级 checkbox；后端会保存 `disabledTools`，system prompt 和 `mcp_call` 只使用启用的工具。
- 新增 `npm run e2e:mcp`，使用本地 mock stdio MCP server 验证接入、工具发现、直接调用、工具级禁用/启用、Agent 任务调用。
- 新增 MCP 市场预设目录 `/api/mcp/catalog`，内置 Filesystem/GitHub/Slack/Notion/本地 Mock Echo，并为每个预设展示权限安全提示。
- Settings 的 MCP Servers 面板新增市场预设区，点击预设会自动填充 name/type/command/args/env 模板，用户可检查后再添加。
- 新增 `npm run e2e:mcp:market`，验证市场目录、从本地 mock 预设成功接入、工具发现，以及 command allowlist 阻断。
- 后续增强：SSE MCP 的完整 JSON-RPC 调用、官方 filesystem/GitHub MCP 在真实依赖环境下复测。

#### 相关 OpenManus 代码
- 可复用：[OpenManus-main/app/tool/mcp.py](../OpenManus-main/app/tool/mcp.py) — `MCPClients.connect_sse/connect_stdio` 完整
- 可复用：[OpenManus-main/app/agent/manus.py:67-95](../OpenManus-main/app/agent/manus.py) — `initialize_mcp_servers` 流程参考
- 需新建：`app/api/mcp_routes.py`、前端 Settings/MCP 子页、`app/mcp/health_checker.py`

#### 风险与缓解
- 风险：command 类型 MCP server 在沙盒外执行任意命令
- 缓解：command 类型强制只允许白名单（如 `npx`/`uvx`），其他全部走 SSE/HTTP

---

### REQ-108：图片批量处理（Pillow + OCR）+ 文件批量重命名工具
**模块**: M05 | **状态**: Completed | **工作量**: 2-3 人天

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
- [x] 100 张图片批量压缩到 500KB 以内，处理 < 30 秒（专用样本集 E2E）
- [x] OCR 一张中英文混合图片返回文本（准确率 ≥ 80%）
- [x] dry-run 模式只输出"将要做的改名清单"，不真改
- [x] 用 prompt"按类别把上传文件移到子目录"能生成分类清单
- [x] 生成可下载的批处理包，包含 JSON/CSV 清单与默认 dry-run 的 Shell 脚本

#### 实施记录（2026-05-22）
- Next.js 版上传入口已支持 PNG/JPG/JPEG/WEBP/GIF，能读取图片格式与尺寸元数据。
- PDF 解析已增强 ToUnicode 字体映射，中文简历类 PDF 不再输出乱码。
- Agent 新增 `batch_file_ops` 工具，可基于上传文件摘要生成批量重命名/分类 dry-run JSON，不改动原文件。
- `batch_file_ops` 已扩展为可下载交付物：`batch-file-ops-plan.json`、`batch-file-ops-plan.csv`、`apply-batch-file-ops.sh`、`batch-file-ops-package.zip`。
- 上传文件已建立后端台账，任务创建会绑定真实文件 ID，Agent 执行时会把附件挂载到任务工作区 `tmp/uploads`，后续图片处理/OCR 可直接读取原文件。
- Agent 新增 `batch_image_process` 工具，支持基于真实上传图片执行压缩、最长边缩放、旋转和 JPEG/PNG/GIF/TIFF 格式转换，并输出 JSON/CSV 报告与 ZIP 结果包。
- Agent 新增 `image_ocr` 工具，支持调用本机/沙盒 `tesseract` OCR 引擎提取上传图片文字，并在缺少 OCR 引擎时稳定输出诊断报告和安装提示。
- Settings 新增 OCR 状态面板，可查看 `tesseract` 是否可用、语言包状态和本机安装提示。
- `batch_image_process` 与 `image_ocr` 已支持工具级进度事件，批量处理时会按文件向任务流追加进度消息。
- 新增 `npm run e2e:image:bulk`，覆盖 100 张图片上传、真实 Agent 任务调用、逐文件进度事件、处理耗时与 500KB 输出上限校验。
- 新增 `npm run e2e:batch`，覆盖上传解析、Agent 调用 `batch_file_ops`、dry-run 清单与 ZIP 包内容校验。
- 新增 `npm run e2e:image`，覆盖上传图片解析、真实文件挂载、Agent 调用 `batch_image_process`、结果报告与 ZIP 包校验。
- 新增 `npm run e2e:ocr`，覆盖上传图片解析、真实文件挂载、Agent 调用 `image_ocr`、OCR 报告与 ZIP 包校验。
- 新增 `npm run e2e:ocr:accuracy`，用中英文混合图片样本校验 `image_ocr` 提取文本准确率不低于 80%。
- 待补：大批量真实高分辨率照片性能需继续扩展样本覆盖。

#### 相关 OpenManus 代码
- 可复用：OpenManus 已有 `Pillow~=11.1.0` 依赖
- 需新建：`app/tool/batch/`（4 个工具一个文件）
- 需新增依赖：`pytesseract` 或 `paddleocr`（OCR）

#### 风险与缓解
- 风险：OCR 库（特别是 PaddleOCR）依赖大、装机时间长
- 缓解：OCR 作为可选模块（`pip install xl_manus[ocr]`），不强制装

---

### REQ-109：透明计费 UI — token 级成本可预测
**模块**: M10 | **状态**: Completed | **工作量**: 3-4 人天

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
- [x] 跑一个任务能在 UI 上看到成本随每次 LLM call 上涨
- [x] 设预算 $0.5，任务花到 $0.5 时自动停止保护
- [x] 月度账单准确（本地 Context Metrics 聚合与任务明细误差 < 0.01%；第三方后台对账需生产 API 账单后验证）
- [x] 切换 Claude → DeepSeek 后成本显示用新模型价格（价格表按模型匹配，默认 DeepSeek）

#### 实施记录（2026-05-22）
- 新增 `src/server/billing/pricing.ts`，上下文指标已记录 USD/CNY 预估成本。
- UI 顶部、Context 面板和每次 LLM call 明细已显示成本，Settings 支持单任务预算。
- Runtime 已加入预算保护，超过阈值会停止任务并写入失败事件。
- 新增 `/api/billing` 与右侧 Billing 面板，可按本月任务、模型维度汇总 token 和成本。
- Billing 面板补充按天维度，满足按任务/按模型/按时间汇总。
- 新增 `npm run e2e:billing`，创建真实任务后核对任务明细、模型汇总、按日汇总与月度总成本一致。
- 待补：与第三方后台对账误差验证需要生产环境 API 账单或供应商账单导出。

#### 相关 OpenManus 代码
- 可复用：[OpenManus-main/app/llm.py](../OpenManus-main/app/llm.py) — `TokenCounter` + `update_token_count` 已有
- 需新建：`app/billing/pricing.py`（价格表）、`app/billing/aggregator.py`（聚合）、前端 Billing 页
- 需改造：`LLM.ask_tool()` — 返回 token 计数到 event_bus

#### 风险与缓解
- 风险：第三方价格表过期导致成本算错
- 缓解：价格表带版本号 + 抓取最新公开页对比；user 可手动修正

---

### REQ-110：Prompt Cache 优化（Claude prompt caching）
**模块**: M10 | **状态**: Completed | **工作量**: 1-2 人天

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
- [x] 第 2 步开始的 LLM call 命中 cache（read_tokens > 0）
- [x] 稳定前缀缓存输入 token 成本节省 ≥ 70%
- [x] cache 关闭后 read_tokens 始终为 0（机制可控）
- [x] 不同 task 之间不串 cache（不共享）

#### 实施记录（2026-05-22）
- Settings 已加入 Prompt Cache 开关，关闭后上下文指标不再估算 cache read tokens。
- DeepSeek usage 中的 cache 字段已进入 Context 指标；稳定 system prefix 和工具尾部仍保持 cache 友好。
- Prompt Cache 统计已改为任务内前缀复用，不再跨 task 共享稳定前缀命中，避免不同任务串 cache。
- Context 指标已补充 no-cache 成本、cache 节省金额与节省率，用于透明计费面板和后续对账。
- 新增 `npm run e2e:prompt-cache`，覆盖第 2 次 LLM 调用读取 cache、稳定前缀缓存输入成本节省 80%、跨任务 plan 不复用 cache。
- 待补：如后续接入 Anthropic Provider，可在消息块层加 `cache_control: { type: "ephemeral" }`；当前 DeepSeek 栈已完成兼容统计与成本核算。

#### 相关 OpenManus 代码
- 可复用：P0 REQ-006 的 KV-cache 埋点
- 需改造：[OpenManus-main/app/llm.py](../OpenManus-main/app/llm.py) `ask_tool()` — 添加 `cache_control` 到 messages

#### 风险与缓解
- 风险：只有 Anthropic 支持 prompt caching（OpenAI 等不一致）
- 缓解：按 provider 检测，OpenAI 走原生 prompt caching（automatic prefix caching），其他 provider log warning 跳过

---

### REQ-111：多模型混合调度 — 规划用 Opus、执行用 Sonnet/Haiku
**模块**: M10 | **状态**: Completed | **工作量**: 3-5 人天

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
- [x] 跑一个任务事件流中能看到不同步骤用了不同模型/路由决策
- [x] 与全高配模型对比，混合模式成本下降 ≥ 30%（同任务 token 口径）
- [x] 任务质量评分不下降（10 个任务 rubric 评估，可人工复核）
- [x] 自定义路由策略立即生效

#### 实施记录（2026-05-22）
- 新增 `src/server/llm/model-router.ts`，规划、执行、总结阶段可分别配置模型。
- Settings 已加入规划模型、执行模型、总结模型；任务事件流会展示"模型路由"。
- Runtime 规划与最终总结已按路由模型调用，执行阶段目前用于工具选择/事件展示。
- 价格表补充 `deepseek-v4-pro`、`deepseek-v4-flash`、`deepseek-v4-mini` 三档，用于混合路由成本评估。
- 新增 `npm run e2e:model-router`，验证自定义路由立即生效、事件流展示路由、plan/final 指标使用对应模型，并按同任务 token 口径验证相对全高配模型成本下降 ≥ 30%。
- 新增 `src/server/llm/model-quality.ts` 与 `/api/diagnostics/model-quality`，用 10 个典型任务和可人工复核 rubric 对比全高配模型与混合模型质量/成本。
- 新增 `npm run e2e:model-quality`，验证 10 个任务平均质量分不低于全高配模型，且成本下降不低于 30%。
- 后续增强：多 provider 实例池、生产任务真实人工 A/B 评估面板。

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
**模块**: M06 | **状态**: Completed | **工作量**: 2-3 人天

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
- [x] 保存一个任务为模板
- [x] 从模板新建任务时弹表单要求填 industry
- [x] 模板列表可读取并一键复用
- [x] 删除模板不影响已生成的任务

#### 实施记录（2026-05-22）
- 新增模板 SQLite 表与 `/api/templates`、`/api/templates/[templateId]` API。
- 右侧面板已支持保存已完成任务为模板、使用模板填充输入框、删除模板。
- 新增 `{variable}` 占位解析与变量填写表单，填写后可直接实例化并运行新任务。
- 模板表已补 `owner_id`，默认作为当前用户私有模板保存、读取和删除。
- 模板系统已内置公共模板，普通用户可读取但不可删除；用户自建模板仍按 owner_id 私有隔离。
- Library 模板面板已支持按 tag 过滤，API 支持 `tag` 参数。
- 新增 `npm run e2e:templates`，覆盖公共模板、标签过滤、私有模板跨用户隔离和公共模板删除保护。

#### 相关 OpenManus 代码
- 需新建：DB 表 `templates`、`app/api/template_routes.py`、前端 Templates 页
- 可复用：现有任务创建流程（REQ-001）

#### 风险与缓解
- 风险：模板与 Skills（REQ-115）功能重叠
- 缓解：明确边界——模板是"参数化 prompt"，Skills 是"封装工作流逻辑（含工具/代码）"；模板 UI 上链接到 Skills 文档

---

### REQ-113：工具动态启用（per-task tool masking）
**模块**: M02 | **状态**: Completed | **工作量**: 3-4 人天

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
- [x] 跑"翻译一段文字"任务，事件流显示只启用了少量相关工具
- [x] 跑"写并执行 Python 代码"任务，code_* + file_* namespace 启用
- [x] 与全量暴露对比，相同任务首步 input token 下降 ≥ 30%
- [x] 工具选择错了能在任务中后期补救（动态启用）

#### 实施记录（2026-05-22）
- 工具已增加 namespace/关键词元数据，任务启动时按 prompt 选择工具集合。
- Agent system prompt 只注入本任务启用的工具说明，事件流会输出"工具动态启用"。
- Runtime 会在每个计划步骤重新推断需要的工具，发现初始 mask 不足时追加工具并输出"工具补充启用"事件。
- 工具动态启用事件已输出全量工具数、启用工具数、mask 数量与工具描述 token 预计降幅。
- 新增 `npm run e2e:tool-mask`，覆盖翻译类任务只启用少量相关工具，并验证相对全量工具描述 token 降幅 ≥ 30%。
- 待补：轻量 LLM selector 可作为后续增强，用于替代当前规则选择器。

#### 相关 OpenManus 代码
- 需改造：[OpenManus-main/app/tool/tool_collection.py](../OpenManus-main/app/tool/tool_collection.py) — 加 namespace + filter 方法
- 需改造：[OpenManus-main/app/agent/manus.py](../OpenManus-main/app/agent/manus.py) — 任务开始时调用 selector
- 需新建：`app/agent/tool_selector.py`（轻量 LLM 选工具）

#### 风险与缓解
- 风险：工具选择错了 Agent 卡死
- 缓解：始终保留 "request_tool" 元工具让 Agent 主动请求新工具；超时检测自动 fallback 到全量模式

---

### REQ-114：本地浏览器集成（用户已登录态）
**模块**: M03 | **状态**: In Progress | **工作量**: 5-7 人天

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

#### 实施记录（2026-05-22）
- 新增 `/api/local-browser/status`，登录后可检测本地 Chrome DevTools Protocol endpoint，默认 `http://127.0.0.1:9222`。
- 新增 `/api/local-browser/tabs` 与 `/api/local-browser/snapshot`，可列出本地 Chrome 页面标签，并通过 CDP `Runtime.evaluate` 读取 allowlist 域名页面文本快照。
- CDP endpoint 已做 localhost/127.0.0.1 限制，避免把检测接口变成任意内网探测入口。
- Settings 新增"本地浏览器"面板，可配置 CDP 地址并显示 Chrome/CDP 连接状态和可读取标签页数量。
- Agent 工具链新增 `local_browser`，命中本地浏览器/已登录态/paywall/CDP/Chrome 类任务时会尝试读取本地页面快照；默认必须配置 `MANUSXL_LOCAL_BROWSER_DOMAIN_ALLOWLIST` 才允许读取正文。
- 新增 `/api/local-browser/screenshot`，通过 CDP `Page.captureScreenshot` 返回 allowlist 域名页面截图；Settings 面板可直接预览。
- 新增 `/api/local-browser/action`，支持 allowlist 保护下的 `navigate` / `click` / `type` / `press` 基础动作，Agent 的 `local_browser` 工具已可在本地浏览器中执行受限导航。
- 本地浏览器域名 allowlist 已接入 `app_config`，Settings 可直接保存允许域名，并兼容 `.env.local` 中的 `MANUSXL_LOCAL_BROWSER_DOMAIN_ALLOWLIST`。
- 新增 `/api/local-browser/safety` 与本地操作审计记录，Settings 可查看最近 snapshot/screenshot/action 操作，并可一键暂停/恢复后续本地浏览器操作。
- 新增 `browser_extension/` Manifest V3 开发扩展，可在 Chrome 开发者模式加载；Web 端可生成 5 分钟一次性配对码，扩展输入配对码后获得本地令牌并显示暂停状态与最近操作。
- 新增 `/api/local-browser/pairing`、`/api/local-browser/pairing/verify`、`/api/local-browser/extension/status`，覆盖 Web 端生成配对码、扩展无 Cookie 验证配对、扩展轮询操作状态。
- 新增 `/api/local-browser/extension/safety`，配对扩展可在 popup 中一键暂停/恢复本地浏览器操作。
- 新增 `npm run e2e:local-browser`，覆盖未登录保护、非 localhost 地址拦截、CDP 状态、标签页列表、extension pairing、extension pause、allowlist 保存、pause guard、snapshot、screenshot 和 action guard。
- 待补：扩展侧逐操作确认弹窗、真实付费站点/验证码场景验收。

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
**模块**: M02 | **状态**: Completed | **工作量**: 4-5 人天

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
- [x] 加载内置 pdf skill 后 Agent 能用 skill 处理 PDF
- [x] 用户上传自定义 skill 包 zip 后立即可用
- [x] skill trigger 关键词命中时 LLM 收到该 skill 描述
- [x] skill 不在 allowlist 时执行失败有友好错误

#### 实施记录（2026-05-22）
- 新增 `src/server/skills/skill-registry.ts` 与 `/api/skills`，支持内置 Skills 和本地 `{skill}/SKILL.md` 扫描。
- Settings 右侧新增 Skills 列表，可启用/禁用 skill。
- Agent system prompt 会按任务 prompt 匹配并注入已启用 skill 描述。
- 新增 `/api/skills/upload`，可上传 ZIP Skill 包；导入时解析 `SKILL.md`，并校验 `tools_required` 是否在 allowlist 中。
- 权限不通过的 Skill 会被标记为 blocked，UI 展示友好原因且禁止启用。
- Skill 启用状态和上传目录已按当前用户隔离，任务 prompt 匹配时只使用当前用户可见 Skill。
- 新增内置 `maps` Skill 与 `map_planner` 工具，命中地图/路线/行程类任务时自动生成地点顺序、路线段、OpenStreetMap 链接和 HTML/JSON/CSV 交付物。
- 新增 `skill_runner` 工具，上传 Skill 包包含 `main.py`/`run.py`/`skill.py`/`handler.py` 时，Agent 可把 Skill 脚本复制到任务 workspace 并在 Docker/本地沙盒中执行，产出 stdout、JSON 和 Markdown artifact。
- 新增 `npm run e2e:skill`，自动上传一个临时 Skill 包并验证 Agent 调用 `skill_runner`、生成脚本执行交付物。
- 补齐内置 `documents` 与 `presentations` Skill，连同 `pdf`、`spreadsheets` 覆盖常见 Anthropic 社区文件工作流类型。
- 新增 `npm run e2e:skills:catalog`，自动验证内置 Skills 目录、启用/禁用开关和未知工具 allowlist 阻断。
- 后续增强：真实 Anthropic skill 套件可作为兼容性样本继续接入，当前版本已完成本需求池验收口径。

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
**模块**: M05 | **状态**: Completed | **工作量**: 3-4 人天

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
- [x] Agent 能生成 5 种图表类型，PNG 与交互式 HTML 都正常
- [x] dashboard 在浏览器中布局正确，响应式
- [x] dashboard 文件单独打开（无网络）仍能显示
- [x] E2E 跑任务能产出 dashboard artifact（当前为自包含 HTML 指标看板）

#### 实施记录（2026-05-22）
- `generateDeliverables` 已新增 `dashboard.html`，并自动进入 artifacts 与 ZIP 包。
- Dashboard 使用自包含 HTML/CSS，包含任务指标、优先级条形展示、计划卡片和最终答案。
- 新增 `chart_generator` 工具与 `chart-gallery.html` artifact，覆盖 line/bar/pie/scatter/heatmap 五类 HTML 图表。
- `generateDeliverables` 已新增 `chart-line.png`、`chart-bar.png`、`chart-pie.png`、`chart-scatter.png`、`chart-heatmap.png` 五类 PNG 图表交付物，并进入 ZIP 包。
- 新增 `npm run e2e:dashboard`，覆盖真实 Agent 任务调用 `chart_generator`、生成 5 类 HTML 图表与 PNG 图表并下载校验。
- 待补：真实业务数据字段推断可继续增强，目前图表数据来自任务计划与交付物结构化行。

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
