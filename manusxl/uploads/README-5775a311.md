# 需求池 - Manus 复刻项目

> 本目录是 Manus 复刻项目（基于 OpenManus Fork 改造的自主型 AI Agent 平台）的需求池。
> 按 **阶段（P0/P1/P2）合并文档**组织，便于个人独立开发者维护。

---

## 文档地图

| 文档 | 内容 | 需求数 | 状态 |
|-----|------|-------|------|
| [REQ-000-manus-capability-research.md](REQ-000-manus-capability-research.md) | Manus 真实产品能力调研（前置） | 1 | ✅ Completed |
| [P0-MVP-REQUIREMENTS.md](P0-MVP-REQUIREMENTS.md) | P0 阶段：MVP（6-8 周）—— 单 Agent + Context Engineering + 端到端 | 13 | 📋 Detailed |
| [P1-V1-REQUIREMENTS.md](P1-V1-REQUIREMENTS.md) | P1 阶段：V1（10-14 周）—— 多用户 + 生产化 + 工具生态 + Manus 工程层差异化 | 16 | 📋 Detailed |
| [P2-V2-REQUIREMENTS.md](P2-V2-REQUIREMENTS.md) | P2 阶段：V2 —— My Computer + 云端弹性 + Manus 1.5+ 亮点 | 16 | 📋 Detailed |

**状态说明**：`Drafting`（仅骨架）→ `Detailed`（详细展开）→ `Approved`（用户批准可启动 DESIGN）→ `In Progress`（实施中）→ `Completed`

---

## 项目核心决策

| 项 | 决策 |
|---|------|
| 产品形态 | Web 平台为主（云端沙盒），桌面端作为 My Computer 入口（P2） |
| 范围 | 完整复刻 Manus 全部能力（分阶段交付） |
| 技术路线 | Fork OpenManus（Python 技术栈） + 主推理用 Claude Sonnet（Manus 同款） |
| 资源 | 个人独立开发 |
| MVP 灵魂 | **单 Agent + Context Engineering**（按 Manus 官方实践调整，不做叙事性三层架构）|
| 核心交付 | Excel / PDF / Word / PPTX / 网页打包 / 代码 ZIP（多种 artifact）|

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
       │  • FastAPI + React 前端 + WS 流式 │────┘
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
| P0 MVP | 13 | 13 | 0 | 0 | 0 |
| P1 V1 | 16 | 16 | 0 | 0 | 0 |
| P2 V2 | 16 | 16 | 0 | 0 | 0 |
| **合计** | **46** | **45** | **0** | **0** | **1** |

最后更新：2026-05-21（**Phase A + B + C + D 全部完成**：45 条 P0/P1/P2 需求已全部详细化，需求池就绪。可启动 DESIGN.md 阶段）

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

## 建议第一个进 DESIGN 的需求（启动顺序）

需求池就绪后，进入 DESIGN.md 阶段。P0 内的推荐启动顺序如下（基于依赖关系 + 风险优先）：

### Week 1-2：环境与骨架（并行 3 条）
1. **REQ-011 Docker Compose** — 先把开发环境搭起来，后面所有需求都基于此
2. **REQ-001 FastAPI 服务包装** — Web 入口骨架
3. **REQ-002 Web 前端骨架** — 最简任务输入页（先不接 WS）

### Week 3-4：Agent 内核（核心，串行）
4. **REQ-004 单 Agent + Context Engineering** ⭐ MVP 灵魂，必须先做对
5. **REQ-006 KV-cache 友好 context 设计** ⭐ 与 REQ-004 强耦合，建议同周做
6. **REQ-005 沙盒 artifacts/tmp 分层**（与 REQ-009 合并实施）

### Week 5-6：交付能力（关键差异化）
7. **REQ-003 WS/SSE 流式** — 让 UI 看到 Agent 工作
8. **REQ-007 文件读取工具集** — 解析用户上传
9. **REQ-008 交付物生成与打包** ⭐ Manus 核心差异化（Excel/PPT/网页）

### Week 7-8：闭环与持久化
10. **REQ-010 SQLite + Library** — 任务历史
11. **REQ-012 配置面板** — 用户体验
12. **REQ-013 E2E 验收用例** — MVP 验收基线

**建议立即启动 DESIGN 的需求：REQ-011 + REQ-001 + REQ-004**（这三条决定后续所有工作）

启动方式：
- 对每条选定的需求，重新进入 Plan Mode
- 引用本需求文档对应的章节作为 Context
- 用 Plan agent 设计 DESIGN.md（含数据结构 / API 签名 / 实施步骤 / 测试计划）
- 用户审核 DESIGN.md → 真正开始 Coding

---

## 跨阶段"必须不做"清单

避免过度设计，明确不在该阶段做的事：

| ❌ 不做 | 原因 |
|--------|------|
| MVP 阶段做 OAuth | SQLite + 本地启动，单用户跑就行 |
| MVP 阶段做 K8s | Docker Compose 完全够用 |
| MVP 阶段做 My Computer | 桌面端是另一个项目体量，V2 再说 |
| 自研 LLM Gateway | 直接用 OpenManus 现成的 `app/llm.py` 多厂商适配 |
| 自研沙盒 | 直接复用 OpenManus `app/sandbox/`，V2 再上 K8s |
| 自研工具系统 | OpenManus `BaseTool + ToolCollection` 已经很优秀，只加新工具不改架构 |
| 替换 Python 技术栈 | Fork OpenManus 就是为了复用，不要中途切栈 |

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
