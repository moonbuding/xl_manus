# 需求池 - Manus 复刻项目

> 本目录是 Manus 复刻项目（基于 OpenManus Fork 改造的自主型 AI Agent 平台）的需求池。
> 按 **阶段（P0/P1/P2）合并文档**组织，便于个人独立开发者维护。

---

## 文档地图

| 文档 | 内容 | 需求数 | 状态 |
|-----|------|-------|------|
| [REQ-000-manus-capability-research.md](REQ-000-manus-capability-research.md) | Manus 真实产品能力调研（前置） | 1 | ✅ Completed |
| [P0-MVP-REQUIREMENTS.md](P0-MVP-REQUIREMENTS.md) | P0 阶段：MVP（6-8 周）—— 单 Agent + Context Engineering + 端到端 | 13 | 📋 Detailed |
| [nextjs-agent-mvp/](nextjs-agent-mvp/) | Next.js + TypeScript 路线：网页端 Agent 聊天 + 执行过程展示 + DeepSeek V4 Flash | 1 | ✅ Completed |
| [P1-V1-REQUIREMENTS.md](P1-V1-REQUIREMENTS.md) | P1 阶段：V1（10-14 周）—— 多用户 + 生产化 + 工具生态 + Manus 工程层差异化 | 16 | 📋 Detailed |
| [P2-V2-REQUIREMENTS.md](P2-V2-REQUIREMENTS.md) | P2 阶段：V2 —— My Computer + 云端弹性 + Manus 1.5+ 亮点 | 16 | 📋 Detailed |

**状态说明**：`Drafting`（仅骨架）→ `Detailed`（详细展开）→ `Approved`（用户批准可启动 DESIGN）→ `In Progress`（实施中）→ `Completed`

---

## 项目核心决策

| 项 | 决策 |
|---|------|
| 产品形态 | Web 平台为主（云端沙盒），桌面端作为 My Computer 入口（P2） |
| 范围 | 完整复刻 Manus 全部能力（分阶段交付） |
| 技术路线 | Next.js + TypeScript 全栈复刻核心体验，参考 OpenManus Agent 思路，主推理接 DeepSeek V4 Flash |
| 资源 | 个人独立开发 |
| MVP 灵魂 | **单 Agent + Context Engineering**（按 Manus 官方实践调整，不做叙事性三层架构）|
| 核心交付 | Excel / PDF / PPTX / 网页 / ZIP（多种 artifact）|

---

## 模块清单

| # | 模块 | 主要职责 | 复刻策略 |
|---|------|---------|---------|
| M01 | Agent 内核 | 单 Agent + Context Engineering（KV-cache 友好 + 工具动态启用 + 文件作 memory）；P2 加 Wide Research 并行子 Agent | 改造扩展 |
| M02 | 工具链系统 | Tool 注册、调用、错误处理、MCP | 直接复用 + 增强 |
| M03 | 浏览器自动化 | 网页操作、内容提取、截图 | 直接复用 |
| M04 | 代码执行 / 沙盒 | Python/Shell 隔离执行，多租户 | 改造 + K8s |
| M05 | 文件处理 | Excel/Word/PDF/CSV/图片读写 | 从零搭建 |
| M06 | Web 平台（前后端） | REST API + 实时流 + 任务面板 UI | 从零搭建 |
| M07 | 多用户/认证/会话 | OAuth/JWT + 租户隔离 + 持久化 | 从零搭建 |
| M08 | My Computer（桌面端） | 本机文件管理、软件调度 | 从零搭建（P2） |
| M09 | 部署与运维 | Docker Compose / K8s / 监控 | 从零搭建 |
| M10 | LLM 适配与成本控制 | 多模型切换、Token 管理、缓存 | 增强 |

---

## 路线图

```
                                                       ┌────────────────────────────┐
                                                       │  P2 / V2 (10 周+)           │
                                                       │  • My Computer 桌面端       │
                                                       │  • K8s 弹性沙盒              │
                                                       │  • 企业能力（团队/审计）     │
                                                       │  • 视觉浏览器                │
                                                       │  • Wide Research (100+)     │
                                                       │  • AI Slides + Web App      │
                                                       │  • Scheduled + Mail/Slack   │
                                                       │  • AI Design (图片)         │
                                                       └────────────────────────────┘
                                ┌─────────────────────────────────┐    ▲
                                │  P1 / V1 (10-14 周)              │    │
                                │  • PostgreSQL + OAuth + 多租户   │────┘
                                │  • Sandbox 资源配额               │
                                │  • MCP 市场 + Skills 包          │
                                │  • 本地浏览器（绕 paywall）       │
                                │  • 工具动态启用                   │
                                │  • 透明计费 UI                    │
                                │  • Dashboard 生成                 │
                                │  • Prompt Cache + 多模型路由      │
                                └─────────────────────────────────┘
       ┌──────────────────────────────────┐    ▲
       │  P0 / MVP (6-8 周)                │    │
       │  • Next.js + TypeScript + SSE 流式 │────┘
       │  • 单 Agent + Context Engineering │
       │  • KV-cache 优化                  │
       │  • artifacts/tmp 分层             │
       │  • Excel/PPTX/网页 多交付         │
       │  • SQLite + Library + Docker      │
       │  • 端到端验收用例                  │
       └──────────────────────────────────┘
                ▲
                │
       ┌──────────────────┐
       │  REQ-000 调研     │ ✅ 已完成
       │  (1-2 天，前置)   │
       └──────────────────┘
```

---

## 状态统计

> 需求池建立后每次状态变更时更新。

| 阶段 | 总数 | Planning | Approved | In Progress | Completed |
|------|-----|----------|----------|-------------|-----------|
| REQ-000 | 1 | 0 | 0 | 0 | 1 |
| P0 MVP | 13 | 0 | 0 | 0 | 13 |
| Next.js Agent MVP | 1 | 0 | 0 | 0 | 1 |
| P1 V1 | 16 | 0 | 0 | 0 | 16 |
| P2 V2 | 16 | 16 | 0 | 0 | 0 |
| **合计** | **47** | **16** | **0** | **0** | **31** |

最后更新：2026-05-23（P1 V1 16/16 已完成；REQ-102 已通过 Google/GitHub OAuth 开发回调与 Email/Password/JWT 验收，REQ-114 已通过本地 Chrome CDP 登录态沙盒验收）

---

## 全项目工作量汇总

| 阶段 | 工作量预估 | 周期（个人独立开发） | 累计 |
|------|----------|--------------------|------|
| P0 MVP | 30-46 人天 | 6-9 周 | 30-46 人天 |
| P1 V1 | 46-67 人天 | 9-14 周 | 76-113 人天 |
| P2 V2 | 70-98 人天 | 14-20 周 | 146-211 人天 |
| **全项目** | **146-211 人天** | **30-42 周（7-10 个月）** | — |

**只到 V1（多用户产品形态完整）**：76-113 人天，约 4-5 个月

---

## 当前 P0 收口顺序

P0 已切换到 Next.js + TypeScript 路线，目前 MVP 需求已完成：

1. **已完成**：REQ-001/002/003/004/005/006/007/008/009/010/011/012/013
2. **验证证据**：浏览器 UI 5/5 验收、`npm run docker:check`、`npm run build`、用户本机终端实跑 Docker/E2E
3. **下一阶段**：进入 P1 V1 的多用户、生产化、工具生态和更强 Agent 能力

下一步优先级：
1. 选定 P1 第一批需求
2. 为 P1 建 DESIGN.md
3. 继续实现多用户、工具生态、成本控制和更真实的浏览器/搜索能力

---

## 跨阶段"必须不做"清单

避免过度设计，明确不在该阶段做的事：

| ❌ 不做 | 原因 |
|--------|------|
| MVP 阶段做 OAuth | SQLite + 本地启动，单用户跑就行 |
| MVP 阶段做 K8s | Docker Compose 完全够用 |
| MVP 阶段做 My Computer | 桌面端是另一个项目体量，V2 再说 |
| 自研复杂 LLM Gateway | P0 直接接 DeepSeek V4 Flash，保留多模型配置入口 |
| 自研重型沙盒平台 | P0 用本机 workspace + Docker Compose，V2 再上 K8s |
| 自研复杂工具市场 | P0 固定内置工具集，P1 再做 MCP/Skills 市场 |
| 回切旧技术路线 | 当前已确认 Next.js + TypeScript 全栈路线，OpenManus 作为 Agent 思路与能力参考 |

---

## 工作流约定

### 需求状态流转

```
Planning  →  Approved  →  In Progress  →  Completed
                                       ↘  Deprecated
```

### 每次状态变更必须

1. 修改阶段文档中对应需求的 `Status` 字段
2. 同步更新本 README 的"状态统计"表
3. 写一行日期标注（如 `2026-05-21: REQ-001 Planning → Approved`）

### 加新需求时

- ID 规则：P0 用 REQ-0xx / P1 用 REQ-1xx / P2 用 REQ-2xx
- 同阶段文档内追加，按 ID 顺序排列
- 不开新文件，除非整阶段需求 > 30 个再拆细

---

## 参考

- OpenManus 源码：[../OpenManus-main/](../OpenManus-main/)
- Plan 文件（设计阶段产物）：`~/.claude/plans/openmanus-manus-manus-ai-refactored-pancake.md`
