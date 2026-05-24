# ManusXL Next

Next.js + TypeScript 版本的 ManusXL 工作台。

## 本地启动

```bash
npm install
cp .env.local.example .env.local
npm run dev
```

`.env.local` 中配置：

```bash
DEEPSEEK_API_KEY=your_deepseek_api_key_here
DEEPSEEK_MODEL=deepseek-v4-flash
DEEPSEEK_BASE_URL=https://api.deepseek.com
MANUSXL_DEEPSEEK_THINKING=disabled
MANUSXL_AUTH_SHOW_VERIFICATION_CODE=true
MANUSXL_DATABASE_PROVIDER=sqlite
DATABASE_URL=postgresql://manusxl:manusxl@localhost:5432/manusxl
MANUSXL_SANDBOX_MODE=auto
MANUSXL_SANDBOX_IMAGE=python:3.12-slim
MANUSXL_SANDBOX_MEMORY=512m
MANUSXL_SANDBOX_CPUS=1
MANUSXL_SANDBOX_NETWORK=0
MANUSXL_SANDBOX_POOL=1
MANUSXL_WORKSPACE_QUOTA_MB=5120
MANUSXL_MY_COMPUTER_ALLOWED_ROOTS=/Users/you/Downloads
MANUSXL_MY_COMPUTER_PAUSED=false
MANUSXL_METRICS_TOKEN=
```

没有配置 `DEEPSEEK_API_KEY` 时，系统会使用本地回退文案，仍可验证任务流、SSE 和交付物下载。DeepSeek V4 默认用 `MANUSXL_DEEPSEEK_THINKING=disabled`，让规划和最终回答稳定返回 `message.content`；需要研究 `reasoning_content` 时再改成 `enabled`。

本地开发默认会在登录页直接显示手机号/邮箱验证码。要切到真实邮箱验证，可以配置 SMTP：

```bash
MANUSXL_AUTH_SHOW_VERIFICATION_CODE=false
MANUSXL_EMAIL_FROM=no-reply@example.com
MANUSXL_SMTP_HOST=smtp.example.com
MANUSXL_SMTP_PORT=465
MANUSXL_SMTP_SECURE=true
MANUSXL_SMTP_USER=your_smtp_user
MANUSXL_SMTP_PASSWORD=your_smtp_password
```

未配置 SMTP 时，邮箱注册仍走开发模式并返回本地验证码；配置 SMTP 后会发送验证邮件，生产环境建议关闭 `MANUSXL_AUTH_SHOW_VERIFICATION_CODE`。

本地开发也支持 OAuth 回调演练，不访问 Google/GitHub 网络，但会完整走 state cookie、callback、创建用户和写入 session：

```bash
open http://localhost:3001/api/auth/oauth/google/start?dev=1
open http://localhost:3001/api/auth/oauth/github/start?dev=1
```

真实 OAuth 上线时，在第三方后台把回调地址配置为 Settings / 认证面板展示的 `/api/auth/oauth/{provider}/callback`，并填入 `MANUSXL_GOOGLE_CLIENT_ID/SECRET` 或 `MANUSXL_GITHUB_CLIENT_ID/SECRET`。

`MANUSXL_SANDBOX_MODE=auto` 会优先用 Docker 执行 Python/Shell 工具；如果 Docker 基础设施不可用，会回退到本地执行并在工具 payload 中记录原因。用户脚本失败、超时、OOM 或磁盘配额超限不会回退本机。要强制只用 Docker，可设为 `docker`；要禁用沙盒，可设为 `local`。`MANUSXL_SANDBOX_POOL=1` 会在同一个任务内复用容器，任务结束后自动清理。`MANUSXL_WORKSPACE_QUOTA_MB` 用于限制单任务 workspace 的软磁盘配额。首次启用 Docker 沙盒前建议先拉取镜像：

```bash
docker pull python:3.12-slim
```

## Docker 启动

```bash
cp .env.local.example .env.local
# 填入 DEEPSEEK_API_KEY 后运行：
docker compose up --build
```

启动后打开 `http://localhost:3001`。如需改端口：

```bash
MANUSXL_PORT=3000 docker compose up --build
```

也可以使用：

```bash
./scripts/quickstart.sh
```

容器会把任务历史、上传文件和 artifacts 保存在 `manusxl_data` 卷里，重启后仍可在 Library 查看。

Docker Compose 已包含 `postgres:16` 服务。当前本地运行时默认仍使用 SQLite，P1 迁移可以先 dry-run 并生成可审阅 SQL：

```bash
npm run db:pg:dry-run
npm run db:pg:emit-sql
```

确认 SQL 后，设置 `DATABASE_URL` 并执行：

```bash
npm run db:pg:migrate
```

任务运行时已支持第一阶段 PostgreSQL adapter：当 `MANUSXL_DATABASE_PROVIDER=postgres`、`DATABASE_URL` 和 `psql` 客户端可用时，任务、步骤流、交付物元数据、上传文件索引、系统配置、认证用户、MCP Server 配置、任务模板、Skill 启用状态和 Context 指标会写入 PostgreSQL。系统会优先使用本机 `psql`；如果本机未安装但已有 Docker 镜像 `postgres:16`，会自动用 Docker 内的 `psql`。Docker 镜像已内置 `postgresql-client`，用于生产容器内执行 schema 初始化和任务写入。

检查 Docker 配置文件：

```bash
npm run docker:check
```

登录后也可以在 Web 界面的 Settings / 沙盒面板查看 Docker 镜像、资源限制、容器池状态，并运行 Python + Shell 沙盒自检。
Settings / 数据库面板会显示当前运行 provider、SQLite 待迁移行数、PostgreSQL 客户端来源、schema 检查结果和迁移命令。

检查 DeepSeek 连通性可在登录后调用 `POST /api/config/llm-test`。该接口只返回模型、耗时和脱敏错误原因，不返回 API Key。

Prometheus 可以抓取根路径 `/metrics`，当前暴露任务总数、状态分布、成功率、平均/p99 延迟、LLM 调用/Token/成本、最近一小时成本速率、审计日志与沙盒健康指标。默认本地开发不需要鉴权；生产环境可设置 `MANUSXL_METRICS_TOKEN`，然后用 `Authorization: Bearer <token>` 抓取。

Docker Compose 提供可选的 observability profile，会启动 Prometheus、AlertManager 和 Grafana，并自动 provision 数据源与 ManusXL Overview dashboard：

```bash
docker compose --profile observability up --build
```

默认端口：Prometheus `http://localhost:9090`，AlertManager `http://localhost:9093`，Grafana `http://localhost:3002`（默认账号 `admin` / `manusxl`）。生产环境建议修改 `GRAFANA_ADMIN_PASSWORD`，并在 `deploy/alertmanager/alertmanager.yml` 中接入真实 Email / Slack 通道。

## E2E 演示验收

先启动本地服务，然后运行：

```bash
npm run e2e:demo
```

脚本会提交「调研中国新能源车前五」标准任务，监听 SSE 实时事件，并检查 Excel、PPTX、HTML、ZIP 交付物与 Context 指标。默认检查 `http://localhost:3001`，如需换地址：

```bash
MANUSXL_E2E_BASE_URL=http://localhost:3000 npm run e2e:demo
```

连续跑 5 轮稳定性验收：

```bash
MANUSXL_E2E_RUNS=5 npm run e2e:demo
```

MCP 接入验收：

```bash
npm run e2e:mcp
```

该脚本会使用本地 mock stdio MCP server 验证 `initialize`、`tools/list`、`tools/call`、工具级启停，并确认 Agent 任务中会调用 `mcp_call`。

数据库迁移状态验收：

```bash
npm run e2e:database-status
```

该脚本会验证数据库状态接口的登录保护、SQLite 行数统计、PostgreSQL CLI/schema 检查字段和迁移命令提示。

审计日志验收：

```bash
npm run e2e:audit
```

该脚本会验证审计接口登录保护、登录/配置/任务/工具调用审计记录、per-user hash chain 连续性校验和 CSV 导出。Settings / 审计日志面板可查看最近记录并导出。

Prometheus 指标验收：

```bash
npm run e2e:metrics
npm run e2e:observability
```

这些脚本会验证 `/metrics` 返回 Prometheus text/plain、关键指标齐全、没有把 `user_id`、`task_id`、`prompt` 放入高基数 label，并校验 Prometheus/Grafana/AlertManager 配置和 dashboard 模板。

真实 PostgreSQL 并发写入验收：

```bash
docker pull postgres:16
npm run e2e:pg-docker
```

`e2e:pg-docker` 会启动临时 `postgres:16` 容器，在独立 schema 中初始化表结构，并调用 `npm run e2e:pg-concurrency` 执行 10 个并发 writer 写入 `task_steps`，结束后自动清理容器。若你已有外部 PostgreSQL，也可以直接运行：

```bash
MANUSXL_PG_E2E_DATABASE_URL=postgresql://manusxl:manusxl@localhost:5432/manusxl npm run e2e:pg-concurrency
```

本地浏览器 CDP 接入验收：

```bash
npm run e2e:local-browser
npm run e2e:local-browser:rehearsal
```

该脚本会验证本地浏览器状态接口的登录保护、localhost 安全限制、CDP 状态、标签页列表和 snapshot 返回。读取页面正文默认需要配置 `MANUSXL_LOCAL_BROWSER_DOMAIN_ALLOWLIST`。

Settings / 本地浏览器面板提供“登录态演练”入口：`/local-browser/rehearsal`。它会用当前 ManusXL 登录 Cookie 模拟付费文章正文，适合在 Chrome 远程调试模式下验证 local_browser 是否读到了用户本机浏览器的已登录态。`e2e:local-browser:rehearsal` 会自动启动本机 Chrome CDP、注入登录 Cookie、设置 `localhost` allowlist，并通过后端 snapshot 读回登录态正文标记。

My Computer MVP 验收：

```bash
npm run e2e:my-computer
```

该脚本会验证 My Computer 本地桥接、允许目录、文件扫描、分类 dry-run + 授权执行、文件操作撤销、内容查重 dry-run、应用启动/关闭授权、macOS Calculator 真实启动与关闭、剪贴板真实读写、Always Allow 免确认、鼠标动作授权、安全 terminal 命令、路径越权拦截和审计日志。Settings / My Computer 面板可配置允许目录、暂停本机动作、撤销最近文件操作，并查看最近操作。

模板市场验收：

```bash
npm run e2e:marketplace
```

该脚本会验证 Library / 模板市场至少 10 个公开模板、Fork 到个人 Library、评分改变排序、私有模板发布审核，以及恶意 prompt 模板被拒绝。

通知链路验收：

```bash
npm run e2e:notifications
```

该脚本会验证 Settings 通知偏好、开发环境 Email 通知日志、关闭完成通知后不再发送，以及失败通知标题。任务进入 `completed` / `failed` / `cancelled` / `timeout` 后会异步触发通知；通知链接使用 `?taskId=` 直达任务详情。

模型路由优化验收：

```bash
npm run e2e:router-optimizer
```

该脚本会验证 `/api/model-router/optimizer` 的登录保护后推荐、调研类任务类型识别、强规划模型 fallback、A/B 成本回放，以及推荐策略写入 Settings 后立即生效。Settings / 模型路由优化面板可查看每阶段模型推荐、置信度和最近任务回放结果。

Scheduled / Mail / Slack 验收：

```bash
npm run e2e:scheduled
```

该脚本会创建一个短间隔计划任务，等待到期后触发新 Agent 任务，并通过 Mail Manus 入站 webhook 与 Slack Events webhook 各触发一个任务，最后检查三类触发日志。Settings / Scheduled / Mail / Slack 面板可创建 interval/cron 计划，任务详情页可把历史任务设为定时任务。

Wide Research 验收：

```bash
npm run e2e:wide-research
```

该脚本会创建“并行调研 50 家公司”任务，验证 `spawn_sub_agents` 工具调用、子 Agent 并发池、失败重试后跳过、主 Agent 汇总，以及 Markdown / JSON / CSV / ZIP 交付物。

AI Slides + Web App Builder 验收：

```bash
npm run e2e:app-builder
```

该脚本会分别创建“5 页投资人 BP”和“todo 应用带登录”任务，验证 `slide_deck_builder` 生成含配图的 PPTX、讲稿和 manifest，以及 `web_app_builder` 生成可访问 HTML 预览、Next.js + TypeScript 源码包、PostgreSQL schema 和部署失败重试说明。

AI Design 验收：

```bash
npm run e2e:design
```

该脚本会验证 Settings 图片 provider 配置、`image_generator` 工具调用、本地 PNG/SVG/manifest/ZIP 交付物，以及外部 provider 未配置 API Key 时自动回退本地生成，确保 PPT/网页素材生成不会阻塞主任务。

团队/组织验收：

```bash
npm run e2e:org
```

该脚本会验证创建多个组织、邀请同事加入、Viewer 只读权限、组织共享任务可见，以及组织任务配额满后拒绝新任务。

批量文件处理验收：

```bash
npm run e2e:batch
```

该脚本会上传 TXT/CSV 示例文件，提交批量重命名与分类任务，并检查 dry-run JSON、CSV、Shell 脚本和 ZIP 批处理包。

## 已实现

- Next.js App Router + TypeScript
- 网页端 Agent 工作台
- 任务创建、查询、取消
- SSE 实时步骤流
- DeepSeek V4 Flash 服务端调用
- SQLite 持久化任务历史，已准备 PostgreSQL schema 与 SQLite→PG 迁移脚本
- 上传解析 TXT / MD / JSON / CSV / HTML / PDF / DOCX / XLSX
- Markdown / CSV / XLSX / PPTX / PDF / HTML / ZIP 交付物下载
- Python / Shell 工具支持 Docker 沙盒执行、CPU/内存/PID/网络限制、本地 fallback 和 workspace 磁盘配额
- Settings 沙盒状态面板与一键自检
- `/metrics` Prometheus 指标端点，覆盖任务、LLM 成本、审计与沙盒健康基础指标
- Prometheus / Grafana / AlertManager observability profile 与 dashboard provisioning 模板
- 审计日志、CSV 导出和 hash chain 校验
- 批量文件重命名/分类 dry-run 清单与可下载批处理包
- 模板市场：公开模板、Fork 到个人 Library、评分排序和基础 prompt 注入审核
- 团队/组织 MVP：组织创建、成员邀请、owner/admin/member/viewer 角色、组织任务共享和任务配额拦截
- 任务完成/失败通知：Email、Webhook、Slack 偏好、通知日志和开发环境测试发送
- 动态模型路由优化：基于历史 Context 指标推荐规划/执行/总结模型，展示 A/B 回放并支持一键应用覆盖
- Scheduled Tasks + Mail Manus + Manus for Slack MVP：interval/cron 触发、入站邮件 webhook、Slack Events webhook 统一创建 Agent 任务
- Wide Research MVP：`spawn_sub_agents` 并行拆分横向调研对象、并发池节流、失败重试/跳过、主 Agent structured_merge 汇总和多格式结果包
- AI Slides + Web App Builder MVP：5 页 PPTX、配图素材、讲稿、可访问 Web App 预览、Next.js + TypeScript 源码包、PostgreSQL schema 和部署重试清单
- AI Design MVP：Settings 图片 provider/API Key/单任务上限配置、`image_generator` 本地 PNG/SVG/manifest/ZIP 生成，以及外部 provider 无 key 自动回退
- stdio MCP Server 接入、工具发现、工具调用和 Agent `mcp_call`
- Docker Compose 一键启动
- E2E 演示验收脚本
