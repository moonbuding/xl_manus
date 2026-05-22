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
MANUSXL_DATABASE_PROVIDER=sqlite
DATABASE_URL=postgresql://manusxl:manusxl@localhost:5432/manusxl
MANUSXL_SANDBOX_MODE=auto
MANUSXL_SANDBOX_IMAGE=python:3.12-slim
MANUSXL_SANDBOX_MEMORY=512m
MANUSXL_SANDBOX_CPUS=1
MANUSXL_SANDBOX_NETWORK=0
MANUSXL_SANDBOX_POOL=1
MANUSXL_WORKSPACE_QUOTA_MB=5120
```

没有配置 `DEEPSEEK_API_KEY` 时，系统会使用本地回退文案，仍可验证任务流、SSE 和交付物下载。DeepSeek V4 默认用 `MANUSXL_DEEPSEEK_THINKING=disabled`，让规划和最终回答稳定返回 `message.content`；需要研究 `reasoning_content` 时再改成 `enabled`。

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

任务运行时已支持第一阶段 PostgreSQL adapter：当 `MANUSXL_DATABASE_PROVIDER=postgres`、`DATABASE_URL` 和 `psql` CLI 都可用时，任务、步骤流、交付物元数据、上传文件索引和 Context 指标会写入 PostgreSQL；认证、配置、MCP/Skill/模板等表仍按 P1 计划继续分阶段迁移。Docker 镜像已内置 `postgresql-client`，用于生产容器内执行 schema 初始化和任务写入。

检查 Docker 配置文件：

```bash
npm run docker:check
```

登录后也可以在 Web 界面的 Settings / 沙盒面板查看 Docker 镜像、资源限制、容器池状态，并运行 Python + Shell 沙盒自检。
Settings / 数据库面板会显示当前运行 provider、SQLite 待迁移行数、PostgreSQL CLI/schema 检查结果和迁移命令。

检查 DeepSeek 连通性可在登录后调用 `POST /api/config/llm-test`。该接口只返回模型、耗时和脱敏错误原因，不返回 API Key。

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
- 批量文件重命名/分类 dry-run 清单与可下载批处理包
- stdio MCP Server 接入、工具发现、工具调用和 Agent `mcp_call`
- Docker Compose 一键启动
- E2E 演示验收脚本
