# ManusXL

ManusXL 是一个参考 Manus / OpenManus 思路开发的自主型 AI Agent 产品原型。项目目标不是做一个普通聊天机器人，而是构建一个可以接收自然语言任务、自动规划、调用工具、执行步骤、生成交付物，并逐步连接用户本机环境的 Agent 工作台。

当前实现以 `Next.js + TypeScript` 为主技术栈，前后端统一在 `manusxl-next` 中开发；桌面端 My Computer 使用 Electron，位于 `desktop`；`OpenManus-main` 作为源码参考，不直接作为运行主链路。

## 项目目标

1. 复刻 Manus 的核心体验：用户把任务交给 Agent，系统自动拆解、执行、展示进度并交付结果。
2. 建立可扩展的工具系统：网页搜索、文件读取、代码执行、沙盒、本地浏览器、MCP、Skills、My Computer。
3. 做出可验证的交付物能力：根据用户要求输出 PDF、Word、PPT、Markdown、Excel、HTML、ZIP 等，而不是固定生成无关文件。
4. 连接用户本机：通过 My Computer 桌面端实现本地文件、剪贴板、应用启动、终端命令等受控能力。
5. 为后续产品化打基础：账号、权限、组织、审计、计费、模板市场、通知、定时任务、指标监控。

## 当前已实现能力

### 1. Web Agent 工作台

- Next.js + TypeScript 前后端一体化项目。
- 首页即工作台，不是营销页。
- 支持新建任务、任务历史、任务详情、任务继续追问、任务中断。
- 支持 SSE 实时事件流，展示 Agent 的计划、执行状态、工具调用、最终结果。
- 支持右侧交付物面板下载任务产物。

核心代码：

- `manusxl-next/src/server/agent/runtime.ts`
- `manusxl-next/src/server/agent/tools.ts`
- `manusxl-next/src/components/agent-workspace/agent-workspace.tsx`

### 2. Agent Runtime 与工具调用

当前 Agent 执行链路包括：

1. 接收用户任务。
2. 选择可用工具。
3. 生成执行计划。
4. 按步骤调用工具。
5. 汇总工具观察。
6. 输出最终回答。
7. 按任务需求生成交付物。

已接入的主要工具类型：

- `web_research`：网页搜索与资料线索获取。
- `web_fetch`：读取 URL 页面内容。
- `file_reader`：读取上传文件摘要，支持 PDF、DOCX、XLSX、CSV 等。
- `python_execute` / `shell_execute`：执行 Python / Shell。
- `my_computer`：调用 My Computer 本机能力。
- `local_browser`：读取本地 Chrome / CDP 页面快照。
- `mcp_call`：调用已配置 MCP Server 工具。
- `skill_runner`：运行本地 Skill。
- `slide_deck_builder`：生成 PPT 类交付物。
- `web_app_builder`：生成 Web App 预览和源码包。
- `image_generator`：生成图片素材。
- `spawn_sub_agents`：Wide Research 并发子任务 MVP。

### 3. 智能交付物生成

已从“固定生成一堆文件”改为“根据用户任务判断交付物”。

示例：

- “做一个 PPT” -> 输出 PPTX、讲稿备注、来源说明。
- “写一份 Word 文档” -> 输出 DOCX、来源说明。
- “输出 PDF 演讲稿” -> 输出 PDF、来源说明。
- “输出 Markdown 报告” -> 输出 MD、来源说明。
- “整理成 Excel 表格” -> 输出表格类交付物。

这部分的意义是让 Agent 从“看起来在执行”变成“真的按用户要求交付”。

核心代码：

- `manusxl-next/src/server/agent/tools.ts`
- `manusxl-next/src/server/artifacts/generators.ts`
- `manusxl-next/src/server/agent/runtime.ts`

### 4. DeepSeek 大模型接入

- 默认使用 DeepSeek V4 Flash。
- 支持 `.env.local` 配置 API Key、模型名、Base URL。
- 未配置 API Key 时有本地 fallback，方便验证 UI 和流程。
- 记录 LLM 调用、Token、成本、Context 指标。
- 支持模型路由与路由优化面板。

注意：不要把真实 API Key 提交到 Git。

### 5. 文件上传与解析

- Web 端可上传文件。
- 支持上传文件进入 Library。
- Agent 可读取上传文件摘要并用于任务。
- 支持 PDF、DOCX、XLSX、CSV、图片等基础解析路径。
- 支持桌面端本地文件上传到云端 Library。

### 6. Docker 沙盒与代码执行

- Python / Shell 工具支持 Docker 沙盒。
- 支持本地 fallback。
- 支持超时、输出上限、OOM 识别、磁盘配额。
- 可在 Settings / 沙盒中查看状态并自检。

常用镜像：

```bash
docker pull python:3.12-slim
```

### 7. My Computer 桌面端

桌面端位于 `desktop`，当前基于 Electron。

已实现：

- Web 生成 5 分钟配对码。
- 桌面端输入配对码完成绑定。
- 桌面端心跳，Web 可看到在线设备。
- Web 可下发 My Computer 任务。
- 桌面端领取任务并回传执行结果。
- 本地文件扫描、分类 dry-run、确认移动、撤销。
- 文件查重 dry-run。
- 本机文件上传到云端 Library，上传前需要确认。
- AI 请求上传本机文件时，桌面端可批准或拒绝。
- 剪贴板读写。
- 受控 Terminal 命令。
- 应用启动 / 关闭。
- 动作级授权与暂停 My Computer。

核心代码：

- `desktop/src/agent-client.ts`
- `desktop/src/local-tools.ts`
- `desktop/src/system-tools.ts`
- `manusxl-next/src/server/my-computer/my-computer.ts`

### 8. MCP 与 Skills

- 支持配置 MCP Server。
- 支持 MCP initialize、tools/list、tools/call。
- 支持 Agent 任务中调用 `mcp_call`。
- 支持本地 Skill 注册、启用、执行。
- Settings 中可查看 Skills、MCP 和工具目录。

### 9. 本地浏览器能力

- 支持 Chrome CDP 接入。
- 支持读取本地浏览器标签页、页面 snapshot、截图。
- 支持域名 allowlist。
- 可用于利用用户本机已登录态读取页面内容。

### 10. Library、模板与市场

- Library 支持历史任务、上传文件、模板、模板市场、Billing。
- 历史任务支持删除、重命名、文件夹、移动等产品化操作。
- 模板支持保存、发布、下架、评分、Fork。
- 模板市场支持分类、翻页与跳转。

### 11. 账号、权限、组织与审计

- 支持手机号/邮箱验证码登录。
- 支持 OAuth 开发演练。
- 支持用户隔离和任务 ACL。
- 支持组织、成员、邀请、角色权限、共享任务。
- 支持审计日志、hash chain 校验和 CSV 导出。

### 12. 通知、定时任务与集成入口

- 支持任务完成/失败通知。
- 支持 Email、Webhook、Slack 偏好。
- 支持 interval / cron 定时任务。
- 支持 Mail Manus 入站 webhook。
- 支持 Slack Events webhook 触发任务。

### 13. Wide Research 与内容生成扩展

- 支持 `spawn_sub_agents` 本地虚拟子 Agent 并发池。
- 支持失败重试、跳过和结构化汇总。
- 支持 AI Slides、Web App Builder、AI Design 图片生成 MVP。

## 最重要的核心功能

### Agent 执行闭环

这是项目的地基。没有它，产品只是聊天框；有了它，用户可以把任务交给系统处理。

### 工具调用系统

Agent 真正能做事，是因为它可以调用工具。网页、文件、代码、本机、浏览器、MCP、Skills 都属于工具生态。

### 交付物契约

用户要什么格式，就应该交付什么格式。这个能力决定产品是否可信。

### My Computer

这是最接近 Manus 差异化的方向。它让 Agent 不只运行在云端，还能进入用户真实电脑环境。

### 沙盒、安全、审计

Agent 能力越强，越需要安全边界。执行命令、移动文件、读剪贴板、连本机都必须有授权、隔离和审计。

## 项目结构

```text
xl_manus/
├── manusxl-next/          # Next.js + TypeScript Web 主项目
├── desktop/               # Electron My Computer 桌面端
├── requirements-pool/     # 需求池与阶段规划
├── OpenManus-main/        # OpenManus 源码参考
└── manusxl/               # 早期前端/上传目录遗留资料
```

## 本地启动 Web

进入 Web 项目：

```bash
cd manusxl-next
npm install
cp .env.local.example .env.local
```

编辑 `.env.local`，至少配置：

```bash
DEEPSEEK_API_KEY=your_deepseek_api_key_here
DEEPSEEK_MODEL=deepseek-v4-flash
DEEPSEEK_BASE_URL=https://api.deepseek.com
MANUSXL_AUTH_SHOW_VERIFICATION_CODE=true
MANUSXL_DATABASE_PROVIDER=sqlite
MANUSXL_SANDBOX_MODE=auto
MANUSXL_SANDBOX_IMAGE=python:3.12-slim
```

启动：

```bash
npm run dev
```

浏览器打开：

```text
http://localhost:3000
```

如果 3000 被占用，Next.js 可能会自动切到 3001，以终端输出为准。

## 本地启动桌面端 My Computer

先确保 Web 已启动，然后新开一个终端：

```bash
cd desktop
npm install
MANUSXL_SERVER_URL=http://localhost:3000 npm run dev
```

配对流程：

1. 打开 Web。
2. 进入 Settings / My Computer。
3. 点击“桌面端配对”生成配对码。
4. 在桌面端输入配对码。
5. Web 中看到桌面端在线后即可测试本机能力。

## 常用验证方式

### Agent 基础任务

在工作台输入：

```text
调研中国新能源车前五，输出对比结论和建议
```

预期：

- 任务进入运行状态。
- 展示计划与执行摘要。
- 最终给出结构化结论。
- 右侧出现相关交付物。

### 指定交付格式

```text
为我做一个关于特朗普访华的演讲稿 pdf
```

预期：

- 输出 PDF 演讲稿。
- 输出来源说明。
- 不应误生成 PPT 或 Word。

```text
为我做一个关于特朗普访华的演讲稿 word
```

预期：

- 输出 Word 演讲稿。
- 输出来源说明。

```text
为我做一个关于特朗普访华的 ppt
```

预期：

- 输出 PPTX。
- 输出讲稿备注。
- 输出来源说明。

### My Computer 文件能力

1. Settings / My Computer 中配置允许目录。
2. 点击保存目录。
3. 扫描目标目录。
4. 生成分类 dry-run。
5. 确认执行移动。
6. 测试撤销。

### My Computer 系统能力

可测试：

- 写入剪贴板。
- 读取剪贴板。
- 启动应用。
- 关闭应用。
- 执行白名单 Terminal 命令。

危险命令会被阻止。

## 常用 E2E 命令

在 `manusxl-next` 目录下运行：

```bash
npm run typecheck
npm run lint
npm run e2e:demo
npm run e2e:my-computer
npm run e2e:mcp
npm run e2e:local-browser
npm run e2e:wide-research
npm run e2e:templates
npm run e2e:marketplace
```

如果服务不是默认端口，可以指定：

```bash
MANUSXL_E2E_BASE_URL=http://localhost:3000 npm run e2e:demo
```

## 当前局限

项目已经具备 Manus-like 产品骨架，但还不是完整 Manus。

主要差距：

- 深度研究质量仍需提升，尤其是事实核验、来源引用和多轮推理。
- 交付物内容质量还需要更强的质量评估器和自动重写机制。
- 桌面端目前主要验证 macOS，本机 Agent 还不是完整跨平台自动化产品。
- 浏览器自动化还偏 DOM / CDP 基础能力，复杂网页视觉操作仍待增强。
- Wide Research 当前是本地虚拟并发池，未达到真实 100+ LLM 子 Agent + K8s 弹性调度。
- 生产部署仍需完善密钥管理、队列、对象存储、云沙盒和权限治理。

## 开发原则

- 以需求池为准，优先完成核心链路，再做体验打磨。
- OpenManus 作为 Agent 思路参考，主实现保持 Next.js + TypeScript。
- 每个能力都要能在 Web 或 E2E 中验收，不只做界面样子。
- 涉及本机、文件、命令、浏览器的能力必须有授权、限制和审计。

## 相关文档

- Web 详细说明：`manusxl-next/README.md`
- 桌面端说明：`desktop/README.md`
- 需求池：`requirements-pool/README.md`
- P1 需求：`requirements-pool/P1-V1-REQUIREMENTS.md`
- P2 需求：`requirements-pool/P2-V2-REQUIREMENTS.md`
