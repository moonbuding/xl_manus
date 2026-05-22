# REQ-000：Manus 真实产品能力调研

> 调研时间：2026-05-21
> 调研目的：在写本项目（基于 OpenManus Fork 改造的 Web + 云端沙盒 + My Computer 桌面端复刻品）需求池前，把 Manus 真实能力查清，避免"基于想象"做需求。
> 资料来源：以官方文档/博客（manus.im）、MIT Technology Review、Wikipedia、Anthropic、CNBC、VentureBeat 等可追溯公开资料为主，标注链接。
> 关于"Manus" / "Manus AI" 的歧义说明放在第 1 章开头。

---

## 0. 关于命名歧义（必读）

公开网络中能搜到至少 3 个名字带 "Manus" 的实体，本调研只覆盖**第一个**（也是本项目要复刻的对象）：

| 实体 | 域名 | 是什么 | 与本项目关系 |
|---|---|---|---|
| Manus（autonomous AI agent） | manus.im | Butterfly Effect 公司的通用 AI Agent，2025-03-06 invite-only beta | **本项目复刻目标** |
| Manus.ai（医疗手套技术） | manus.ai 等 | 触觉手套、动捕硬件，与 AI agent 无关 | 无关，忽略 |
| OpenManus | github.com/FoundationAgents/OpenManus | MetaGPT 团队 3 小时复刻的开源版（本项目 Fork 自此） | **本项目代码基座** |

下文"Manus"一律指 manus.im 那个产品。Butterfly Effect 在 2025 年中把总部从武汉/北京搬到新加坡（[SCMP](https://www.scmp.com/tech/tech-trends/article/3301864/chinese-ai-agent-manus-transcends-chatbots-founder-start-butterfly-effect-says)、[Asia Times](https://asiatimes.com/2026/05/chinas-manus-ai-case-sets-red-lines-to-bar-singapore-washing/)），新加坡实体运营海外市场，国内仍叫"蝴蝶效应"。2025-12 Meta 宣布以约 20 亿美元收购 Manus 海外业务，2026-04 中国官方禁止该收购海外资产带 Manus 中国部分（[The Standard](https://www.thestandard.com.hk/innovation/article/330401/China-blocks-US2-billion-foreign-acquisition-of-AI-startup-Manus)）——意味着海外版与国内版正在分叉，复刻时应优先盯 **海外版（manus.im）** 当前形态。

---

## 1. Manus 官方产品能力清单

按官方文档与博客枚举（截至 2026-05）。"付费"列只标是否需要付费方案，具体配额见第 5 章。

| 能力 | 一句话描述 | 证据 | 付费 |
|---|---|---|---|
| Autonomous Task Execution | 把复杂任务拆子任务并自主执行到交付 | [Manus Docs Welcome](https://manus.im/docs/introduction/welcome) | 免费可试 |
| Cloud Sandbox（云端沙盒） | 每个会话有独立持久的 Ubuntu Docker 虚机，含浏览器、Python、shell、文件系统 | [Manus Sandbox 博客](https://manus.im/blog/manus-sandbox) | 免费可试 |
| Browser Operator | 云端 + 本地双模式自动化浏览器，含 Chrome 扩展可操控用户已登录的 Web 应用 | [Browser Operator 博客](https://manus.im/blog/manus-browser-operator) | 付费 |
| Wide Research | 单任务可并行起 100+ 个子 agent，每个独立上下文 | [Wide Research 博客](https://manus.im/blog/manus-wide-research-solve-context-problem)、[VentureBeat](https://venturebeat.com/ai/youve-heard-of-ai-deep-research-tools-now-manus-is-launching-wide-research-that-spins-up-100-agents-to-scour-the-web-for-you) | Pro+ |
| Web App Builder（1.5） | 一句 prompt 出全栈应用：前端 + 后端 + 数据库 + 登录 + Stripe + SEO | [Manus 1.5 发布](https://manus.im/blog/manus-1.5-release)、[webapp 功能页](https://manus.im/features/webapp) | 付费 |
| Data Analysis & Visualization | 读 CSV/Excel/PDF 跑分析、生成图表/dashboard/slides | [Data Visualization 文档](https://manus.im/docs/features/data-visualization) | 免费可试 |
| AI Slides | 自动生成 PPT，可由 Slack 消息、邮件、对话直接转化 | [Slides Generator](https://manus.im/playbook/slide-generator) | 免费可试 |
| AI Design / Image | 文本/视频/3D 资产生成，交互式画布 | [AI Design](https://manus.im/tools/ai-design) | 付费 |
| Agent Skills（SKILL.md） | 用户/Manus 自身可"封装一次成功流程"为可复用 skill；兼容 Anthropic skills 开放标准 | [Agent Skills 功能页](https://manus.im/features/agent-skills)、[官方博客](https://manus.im/blog/manus-skills) | 免费可试 |
| Scheduled Tasks | 类似 cron 的定时任务（每周报表、每日新闻等） | [MindStudio 教程](https://www.mindstudio.ai/blog/manus-ai-scheduled-tasks-daily-news-briefing) | Pro+ |
| Mail Manus | 转发邮件给个人 Manus 邮箱，自动处理附件并产出文档/PPT | [Manus 主页](https://manus.im/) | 付费 |
| Manus for Slack | 在 Slack 频道 @manus 即可对线程内容执行任务并回帖 | [Manus for Slack 博客](https://manus.im/blog/manus-your-partner-on-slack) | 付费 |
| Collaboration（1.5+） | 多人共享会话，邀请队友一起和 Manus 协作 | [Manus 1.5 发布](https://manus.im/blog/manus-1.5-release) | Team 版 |
| Library | 集中管理生成的文件和 artifacts | 同上 | 免费可试 |
| Manus Desktop / My Computer | macOS+Windows 客户端，直接操作本机文件/应用，每步需用户授权 | [CNBC 2026-03-18](https://www.cnbc.com/2026/03/18/metas-manus-launches-desktop-app-to-bring-its-ai-agent-onto-personal-devices.html)、[Manus Desktop 页](https://manus.im/desktop) | 免费可试，复杂任务付费 |
| Connectors | 接外部 SaaS（Nylas 邮件日历样例存在） | [Nylas Manus CLI](https://cli.nylas.com/guides/manus-ai-skills) | Pro+ |

### 小结

Manus 的能力面已经从"通用 agent"扩展为"通用 agent 平台"：底层是云端 VM（沙盒）+ Browser Operator，业务面有 Slides/Webapp/Data Analysis/Image 四条交付线，工程面有 Skills/Scheduled/Library/Collaboration/Connectors。**对复刻项目意味着**：必须先有"通用 agent + 沙盒 + 浏览器 + 文件交付"这条主线打通，才有资格谈 Skills/定时/协作这些上层能力。

---

## 2. Manus 演示用例与真实产出示例

来自 2025-03 发布时的官方 demo、用户实测和 MIT Tech Review 测试。

| # | Prompt 类型 | 产出物 | 中间步骤摘要 | 来源 |
|---|---|---|---|---|
| 1 | 简历筛选：从 15 份简历挑出 RL 算法工程师候选并排序 | 排序后的候选名单+理由 | 解压 zip → 逐份读 PDF → 抽特征 → 评分 → 输出报告 | [Wikipedia](https://en.wikipedia.org/wiki/Manus_(AI_agent))、[Maginative](https://www.maginative.com/article/manus-a-new-ai-agent-from-china-is-going-viral-and-raising-big-questions/) |
| 2 | Tesla 深度股票分析 | 可视化 dashboard 网页（可下载/可分享） | 抓财报/新闻/技术指标 → Python 画图 → 拼 HTML dashboard | 同上 |
| 3 | 4 月日本行程规划 | 定制旅行手册（PDF/网页） | 查机票/天气/景点 → 排日程 → 排版交付 | 同上 |
| 4 | 找列出"30 位某领域记者"并附其代表作 | 含 30 行的表格 + 注解 | 多源搜索 → 去重 → 验证文章链接 → 列表 | [MIT Tech Review 实测](https://www.technologyreview.com/2025/03/11/1113133/manus-ai-review/) |
| 5 | 在 X 城市找 X 预算公寓推荐 | 分层级 + bullet 推荐清单 | 浏览中介站 → 抓筛选结果 → 整理 → 反馈 | 同上 |
| 6 | 100 双球鞋多维评估 | 可排序矩阵（spreadsheet+网页） | Wide Research 起 100 子 agent → 每只鞋独立调研 → 汇总 | [Wide Research demo](https://manus.im/blog/manus-wide-research-solve-context-problem) |
| 7 | 上传咖啡店销售数据，分析热销品 | 表格 + 可视化 + 洞察文字 | 读 Excel → pandas 处理 → 出图 → 解读 | [DataCamp 教程](https://www.datacamp.com/tutorial/manus-ai) |
| 8 | 上传 spreadsheet → 生成 live dashboard 网站 | 可访问的网页 | 数据转后端 → 生成前端 → 部署预览 | [Skywork 1.5 教程](https://skywork.ai/blog/ai-agent/how-to-generate-crud-web-app-login-analytics-manus-1-5/) |

**关于"是否能产出 Excel / Word / PDF / 网站"**：明确**能**。官方主页和文档直接列了"Word doc、Excel、PDF、PPTX、website"为可下载交付物（[Manus 主页](https://manus.im/)），用户实测也佐证这一点。

### 小结

Manus 的杀手锏不是"问答"而是**端到端可下载的工件**——这是它对 ChatGPT 形态最大的差异化。本项目复刻必须把"文件交付 + 网页交付 + 可执行 artifacts"当作 P0，否则就是另一个聊天框。

---

## 3. 多 Agent 架构（公开技术资料）

### 3.1 是否真的有 Planner / Executor / Validator？

**公开资料口径不一**。第三方拆解（[arXiv 论文](https://arxiv.org/html/2505.02024v3)、[Rediminds 分析](https://rediminds.com/future-edge/manus-ai-redefining-ai-agents-with-existing-models-and-brilliant-tooling/)）描述 Manus 是 **Planner / Executor / Verifier** 三模块的多 agent 架构；**但官方自己的工程博客**（[Context Engineering for AI Agents](https://manus.im/blog/Context-Engineering-for-AI-Agents-Lessons-from-Building-Manus)，作者联合创始人 Yichao "Peak" Ji）则强调 Manus 把工程重心放在"**context engineering**"——也就是用单个 agent + 精心管理上下文，而不是叙事性多 agent 编排。

**结论（推测但可控）**：

- 用户面感知到的"Manus"是一个 executor agent，规划/知识/子任务在不同 context window 隔离
- "Wide Research" 是显式多 agent（100+ 并行 sub-agents），但属于子任务并行，不是 Planner/Executor/Validator 那种角色分工
- "Planner/Executor/Verifier" 更像第三方的叙事重构而不是官方架构图

### 3.2 用什么 LLM

- 主推理：**Anthropic Claude 3.5 Sonnet v1**（官方在 [the-decoder 采访](https://the-decoder.com/chinese-ai-agent-manus-uses-claude-sonnet-and-open-source-technology/) 承认）
- 辅助：**Alibaba Qwen 的 fine-tuned 版本**（同上）
- 选 Sonnet 的核心原因：Yichao Ji 在 context engineering 博客里说，"五个月内测过几乎所有可用模型，只有 Claude 3.5 Sonnet 能真正识别到自己处在一个延长的 action→observation 循环里"

### 3.3 上下文管理（这是 Manus 的真正核心 know-how）

来自官方 [Context Engineering 博客](https://manus.im/blog/Context-Engineering-for-AI-Agents-Lessons-from-Building-Manus)（2025-07-18）的几条干货：

1. **KV-cache 命中率是生产环境第一指标**——直接决定成本和延时
2. **工具爆炸是反模式**——工具越多 agent 反而更蠢。Manus 不是把工具全暴露，而是**按当前任务动态屏蔽/启用工具**
3. **few-shot 在多步 agent 里有害**——LLM 是 pattern matcher，重复结构会让它陷入节奏性重复
4. agent 框架本身他们已经**重写 4 次**

### 3.4 1.5 之后的"无限上下文"叙事

Manus 1.5（2025-10）宣称"unlimited context for single task"（[发布博客](https://manus.im/blog/manus-1.5-release)），实现方式没完全公开，但结合 Wide Research 的 spawn-sub-agent 模式，**很可能是用 sub-agent + 文件系统当持久 memory，避开单 context 上限**。

### 小结

Manus 的"多 agent"叙事**部分为真**：Wide Research 是真并行多 agent；但单任务主流程更像"单 agent + 高质量上下文工程 + 工具动态启用 + 文件系统持久化"。本项目复刻**不要被"Planner/Executor/Validator 三层"这种叙事带跑**，应该优先实现 context engineering 框架 + 工具动态启用 + 跨步骤文件持久化。

---

## 4. My Computer 桌面端

### 4.1 基本信息

- 产品名：Manus Desktop，核心功能叫 **My Computer**
- 发布日期：**2026-03-16**（[CNBC 2026-03-18 报道](https://www.cnbc.com/2026/03/18/metas-manus-launches-desktop-app-to-bring-its-ai-agent-onto-personal-devices.html)、[TestingCatalog X 帖](https://x.com/testingcatalog/status/2033562290218267045)）
- 支持 OS：**macOS + Windows**（无 Linux 公开版）
- 背景：Meta 在 2025-12 收购 Manus 海外业务后由 Meta 主推

### 4.2 技术原理

**官方未公开 Electron / Tauri / 原生选型**。第三方分析（[Digital Applied](https://www.digitalapplied.com/blog/manus-desktop-meta-ai-agent-local-machine-guide)、[Aihola](https://aihola.com/article/manus-my-computer-desktop-launch)）只能描述功能：

- 混合架构：本机做"轻量任务编排 + 文件 I/O"，复杂 LLM 推理仍走 Manus 云端
- 简单/敏感任务（本地文档摘要、写邮件、整理日历）可以"全在本机"——即数据不出端
- 与本机 Python / Node.js / Swift / Xcode 等开发环境集成（CNBC demo：20 分钟用 terminal 命令在 macOS 上做出一个实时翻译字幕 app）

**信息不足**：未找到对其桌面框架（Electron vs Tauri vs Swift/WinUI）的可靠确认。考虑到 Meta 的工程取向 + 跨双平台需求，**最可能是 Electron 或 React Native Desktop**，但无证据，复刻可自行选型。

### 4.3 能做什么具体操作

- 读/分析/编辑本地文件
- 启动并控制已安装应用
- 执行 terminal 命令（含多步编码任务）
- 跨多步骤工作流自动化

### 4.4 隐私与授权模型

- **每个动作都需用户授权**
- 两种授权模式：
  - **Allow Once**（一次性批准）
  - **Always Allow**（永久信任，适合重复操作）
- 用户可配置哪些路径/应用可访问
- 有 **local-only 模式**，敏感数据完全本地处理；连云端模式时只把必要 context 上传

### 小结

My Computer **晚于 Web 版**整整一年才推出，并且是 **Meta 收购后**的产物，说明：

1. 桌面端不是 P0，是云端产品打磨成熟后的延伸
2. 复刻路线"Web + 云端沙盒 → 后期 My Computer"这条路是对的（与原版顺序一致）
3. 桌面端关键设计点是**每动作授权 + local-only 模式**，不是"全自动控制电脑"

---

## 5. 云端沙盒

### 5.1 技术形态

- **底层**：Ubuntu 容器（Docker），不是 Firecracker / 自研 microVM（[Manus Sandbox 博客](https://manus.im/blog/manus-sandbox)）
- 沙盒内预装：Chrome、Python、Node.js、shell、文件系统、网络协议栈
- 用户对 sandbox 有**完全权限**（root、改系统文件、甚至格式化磁盘）——与买一台云 VM 一样
- 沙盒里跑 Manus 自己的 API 服务（File/Shell tools）+ Chrome browser

### 5.2 生命周期

来自 [Manus Help](https://help.manus.im/en/articles/11711144-what-can-i-do-if-i-encounter-a-sandbox-issue-in-the-task) + [Sandbox 博客](https://manus.im/blog/manus-sandbox)：

| 状态 | 触发 | 文件 |
|---|---|---|
| 创建 | 新会话 | 空 |
| 活动 | 用户在用 | 持久 |
| 休眠（Sleep） | 用户离开 | 持久 |
| 唤醒（Wake） | 用户回来 | 不变 |
| 回收（Recycle） | 持续休眠 **7 天**（Free）/ **21 天**（Pro） | 自动重建新 sandbox，Manus 自动恢复部分文件（artifacts、上传附件、Slides/WebDev 重要文件），中间产物和临时文件**不保留** |

### 5.3 持久化

- **临时 sandbox**（标准任务）：关闭后工作文件删除，但**最终交付物**（报告、表格等）留在 chat history
- **Cloud Computer**（[Cloud Computer 博客](https://manus.im/blog/manus-cloud-computer)）：是 Manus 后来推出的**持久云电脑**，24/7 在线，可跑 bot/scraper/scheduled job，文件系统可搜索——这相当于把沙盒从"会话级"升级到"账号级常驻"

### 5.4 GPU

**信息不足**：公开资料没有提到沙盒带 GPU。考虑到 Manus 的推理走 Anthropic/Qwen API、沙盒主要跑工具，**大概率无 GPU**。

### 小结

复刻方案选型建议：

- **MVP**：Docker container per session 就够，不必上 Firecracker
- **持久化策略**：会话级容器 + 文件系统持久层（artifacts 单独存储，临时文件可丢）
- **冷启动 vs 唤醒**：要做 sleep/wake 机制减少长尾任务的成本
- **回收策略**：参考 7 天 Free / 21 天 Pro 这套实践，是经过用户验证的合理值

---

## 6. 用户实测：强项 + 短板

### 6.1 强项

| 强项 | 出处 |
|---|---|
| 端到端交付**可下载工件**（PPT/Excel/PDF/网站），不只是聊天 | [Manus 主页](https://manus.im/)、[allaboutai 评测](https://www.allaboutai.com/ai-reviews/manus-ai/) |
| 像"高智能 + 高效率的实习生"——会解释推理过程，听指令能改 | [MIT Tech Review](https://www.technologyreview.com/2025/03/11/1113133/manus-ai-review/) |
| GAIA benchmark 三档（86.5% / 70.1% / 57.7%）当时超过 OpenAI Deep Research | [Future AGI 对比](https://futureagi.com/blog/manus-ai-comparison-2025/) |
| Wide Research 真的能 100 子 agent 并行做 horizontal task | [VentureBeat](https://venturebeat.com/ai/youve-heard-of-ai-deep-research-tools-now-manus-is-launching-wide-research-that-spins-up-100-agents-to-scour-the-web-for-you) |
| 1.5 速度 4× 提升（15 分钟 → 4 分钟），质量 +15% | [Manus 1.5 发布](https://manus.im/blog/manus-1.5-release) |

### 6.2 短板

| 短板 | 出处 |
|---|---|
| App builder 仍 buggy，**不能上生产**，只适合 prototype/内部工具 | [eesel AI 评测](https://www.eesel.ai/blog/manus-ai-reviews) |
| 下载代码出现**空 ZIP** | 同上 |
| Agent 会**陷入死循环**（一直刷某页啥也不干） | 同上 |
| 被 **paywall + CAPTCHA** 卡住——"深度调研"被现实墙阻挡 | [MIT Tech Review](https://www.technologyreview.com/2025/03/11/1113133/manus-ai-review/)、[NxCode 评测](https://www.nxcode.io/resources/news/manus-ai-review-2026) |
| **Context 上限**还是会爆，强制人为拆任务 | [eesel AI](https://www.eesel.ai/blog/manus-ai-reviews) |
| **Credit 黑洞**——Agent Mode 几分钟烧光月配额；用户最多吐槽点 | 同上 |
| beta 期间一个任务约 $2 起 | [Future AGI](https://futureagi.com/blog/manus-ai-comparison-2025/) |

### 6.3 适用场景 vs 不适用场景

| 适用 | 不适用 |
|---|---|
| 横向调研（找 100 个 X）、汇总报告、做 deck/dashboard | 生产级 Web 应用 |
| 数据分析与可视化（CSV → 图表） | 长会话 / 大上下文严格任务 |
| 单次完结的"实习生级"工作流 | 需要绕过 paywall / 强人机校验的爬取 |
| 内部工具 prototype | 严格按 cost 预算的工作流（credit 不可预测） |

### 小结

**真实用户的两大痛点是"卡墙"和"烧钱"**。复刻项目可以借此差异化：(1) paywall/CAPTCHA 卡点用本地浏览器（My Computer + 用户已登录态）绕过；(2) 用本地 LLM 选项或按 token 计费而非 credit 池来给用户成本可预测性。

---

## 7. 竞品对照矩阵

维度评分：✓ 支持 / ✗ 不支持 / ◐ 部分或受限 / — 不适用

| 维度 | Manus | AutoGPT | Devin（Cognition） | AgentGPT | Cursor Background Agent | Claude Computer Use | OpenManus |
|---|---|---|---|---|---|---|---|
| 自主规划 | ✓ | ✓ | ✓ | ✓ | ◐（IDE 内任务） | ◐（无内建 planner） | ✓ |
| 工具调用 | ✓（~29 个） | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| 浏览器自动化 | ✓（云 + 本地） | ◐ | ✓ | ◐ | ✗ | ✓（直接控屏） | ✓（browser-use） |
| 代码执行 | ✓（沙盒） | ✓ | ✓（VM） | ◐ | ✓（IDE） | ✓ | ✓ |
| 文件交付（Excel/PDF/PPT/Site） | ✓（核心卖点） | ✗ | ◐（产 PR/code） | ✗ | ✗（IDE 内） | ◐（要自己拼 prompt） | ◐（要自配 tool） |
| 桌面控制 | ✓（My Computer 2026-03） | ✗ | ✗ | ✗ | ✗ | ✓（核心卖点） | ✗ |
| 多 Agent | ✓（Wide Research 100+） | ◐ | ✓（sub-agents） | ✓ | ◐（2026 起多 agent 并行） | ✗ | ✓（run_flow 多 agent） |
| 开源 | ✗ | ✓（MIT） | ✗ | ✓（GPL-3） | ✗ | ✗（SDK 开源，模型闭源） | ✓（MIT） |
| 商业模式 | 订阅 + credit 池 | 自托管免费 / Cloud 付费 | $500/月企业级 | 自托管免费 | Cursor 订阅内含 | 按 API token 计费 | 自托管，自付模型 API |
| 主推 LLM | Claude 3.5 Sonnet + Qwen ft | 任选（用户配） | 自家 + Claude/GPT | 任选 | Anthropic + 用户配 | Claude | 任选（OpenAI/Azure/Bedrock）|

来源汇总：[Future AGI 对比](https://futureagi.com/blog/manus-ai-comparison-2025/)、[MCPlato 2026 对比](https://mcplato.com/en/blog/ai-agent-2026-comparison/)、[Anthropic Computer Use 发布](https://www.anthropic.com/news/3-5-models-and-computer-use)、[Cursor Background Agents 指南](https://ameany.io/cursor-background-agents/)、[OpenManus README](https://github.com/FoundationAgents/OpenManus)、[Usecarly 8 Best Manus Alternatives](https://www.usecarly.com/blog/manus-alternatives/)

### 小结

Manus 的差异化竞争位是"**文件交付 + 通用域 + 云沙盒**"，三条同时具备的对手只有 Manus 自己——Devin 更强但只做 code、Claude Computer Use 更通用但要用户自己拼 prompt、Cursor 是 IDE 内、AutoGPT/AgentGPT 是早期形态。复刻项目要保住这个差异点，**而不是去打"通用对话"或"纯 coding"赛道**。

---

## 8. 调整建议清单（给本项目需求池用）

由于本项目尚未给出现有需求池文件（`requirements-pool/` 目录是空的），下列建议按"如果你按主流 Manus 复刻直觉来列需求，常见的盲点和误判"展开。

### 8.1 必须做、容易漏列的能力（P0/P1）

| # | 能力 | 优先级 | 原因 |
|---|---|---|---|
| A | **可下载文件交付层**（Excel/PDF/PPT/网页打包） | P0 | Manus 的核心差异化。OpenManus 默认没有这层完整 pipeline，必须补 |
| B | **沙盒文件系统持久化 + artifacts 与 tmp 分离** | P0 | Manus 7/21 天回收时**保留 artifacts**这个行为是关键体验，纯容器是不够的 |
| C | **工具动态启用机制（per-task tool masking）** | P0 | Yichao Ji 明说"工具越多 agent 越蠢"，要按任务上下文动态屏蔽工具 |
| D | **KV-cache 友好的 context 设计** | P0 | 直接决定成本/延迟，是 Manus 工程实践第一指标 |
| E | **本地浏览器 + 用户已登录态利用**（绕 paywall/CAPTCHA） | P1 | Manus 用户痛点，本项目可借 My Computer 路线天然解决 |
| F | **token / credit 透明计费 UI** | P1 | Manus 用户最大吐槽点。复刻品如果在这点上透明就是差异化 |
| G | **Skill 包（SKILL.md）格式直接兼容 Anthropic 开放标准** | P1 | Manus 自己已经在跟 Anthropic skills 兼容，生态不要再造一套 |
| H | **Wide Research（并行子 agent + 主 agent 汇总）** | P2 | 是亮点功能但非主路径，可以放到 P1 主流程稳定后 |

### 8.2 容易高估、其实可以暂缓的能力

| # | 能力 | 理由 |
|---|---|---|
| I | "Planner / Executor / Validator" 三层显式架构 | 第三方叙事 ≠ Manus 真实做法。盲目复刻这个反而把简单事情复杂化。先做"单 agent + 强 context engineering"，效果不行再分层 |
| J | 桌面端 My Computer | Manus 自己也是 Web 上线**一年后**才出桌面版。**不要倒序**——先把 Web + 云沙盒稳了再做桌面 |
| K | 自研 Firecracker / microVM | Docker 容器够用了，Manus 自己就是 Ubuntu Docker |
| L | 训练自家 end-to-end agent 模型 | Yichao Ji 明确说他们最早就否决了这条路，押了 in-context engineering |
| M | 全自动"无人介入"桌面控制 | Manus 桌面版每动作都要授权——这是隐私和信任的必然要求 |

### 8.3 应该重新排序的优先级

按 Manus 实际产品演化路径，给本项目建议路线图：

1. **Phase 1（MVP 0→1）**：Web + 云端 Ubuntu 容器沙盒 + 单 agent（Claude/通过 OpenManus 的 LLM 抽象层接入）+ 浏览器自动化（browser-use 已具备）+ 基础文件交付（PDF/Excel/PPT/网页打包）
2. **Phase 2（差异化）**：KV-cache 优化 + 工具动态启用 + Skills/SKILL.md + 透明计费 UI
3. **Phase 3（规模化）**：Wide Research（并行子 agent）+ Scheduled tasks + Collaboration
4. **Phase 4（场景延伸）**：My Computer 桌面端（Electron 或 Tauri 均可，**关键是动作级授权 UI**）+ Slack / Mail / Connectors

### 8.4 技术选型借鉴

| 项 | Manus 做法 | 本项目建议 |
|---|---|---|
| 主推理模型 | Claude 3.5 Sonnet | 同步选 Claude Sonnet 系作为默认，但**保留 OpenManus 原本的多 provider 抽象** |
| 辅助模型 | Qwen 的 ft 版本 | 国内场景可选；轻量任务（路由/分类）单独用便宜模型 |
| 沙盒 | Ubuntu Docker | 同。OpenManus 已支持 Daytona / 自托管 Docker |
| 浏览器层 | Chrome + 自家 Browser Operator + Chrome 扩展（本地） | 沿用 browser-use；本地浏览器走 Chrome 扩展或 CDP |
| 上下文管理 | "Context Engineering"（KV-cache 友好、工具动态 mask、文件作 memory） | **直接照搬这套理念**，作为框架核心约束 |
| Skills 格式 | 兼容 Anthropic 开放标准 | 同 |
| 多 agent | Wide Research（同质子 agent + 文件系统通信） | 不要先做"角色分工型"多 agent，先做"同质并行 + 汇总" |
| 桌面端 | 未公开（推测 Electron） | 跨平台优先选 Electron（生态成熟）；动作级授权 UI 是 P0 |

### 8.5 不要做（明确反模式）

- **不要写假的 Props 文档/能力清单**（参考 bug-patterns #7：文档错就 AI 必错）
- **不要叙事性堆"多 agent 层级"**——Manus 自己都只在 Wide Research 真用并行 agent
- **不要照搬 credit 池模式**——用户最痛的点，复刻就重复犯错
- **不要先做桌面端**——Manus 自己等了一年才出，技术风险和产品风险都很高

---

## 总结

Manus 不是某个魔法新模型，**是一套被 Yichao Ji 团队磨了 5 个月的 context engineering + 沙盒 + 文件交付的工程组合**，底座是 Claude Sonnet。它真正难复刻的是"小细节都对了"——KV-cache 命中率、工具动态启用、临时/持久文件分层、Wide Research 并行汇总、Skills 标准化。本项目基于 OpenManus 已经有了 60% 的代码骨架（agent + tool + sandbox + browser），缺的是**交付层（文件）+ 工程层（context/cache/skills）+ 商业层（透明计费）**。这三件事做好，复刻就成立。

桌面端 My Computer 是产品故事的下一章，但不是 Phase 1 的事——Manus 自己也是这个顺序。

---

> 报告完。若需对某节深挖（如某个 demo 的细节、某个评测原文复盘、某项技术选型的详细对比表），可基于本文继续展开。
