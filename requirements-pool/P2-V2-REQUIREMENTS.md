# P2 - V2 需求文档

> **状态**：📝 Drafting（骨架已根据 REQ-000 调研结论调整，待批量填充详细内容）
> **阶段周期**：10 周+（紧接 P1）
> **目标**：My Computer + 云端弹性 + 企业能力 + Manus 1.5+ 差异化亮点

---

## 阶段目标

补齐 Manus 真正的差异化能力 + 1.5+ 版本的亮点功能：
- **My Computer 桌面端**（macOS / Windows）
- **K8s 弹性沙盒**
- **企业能力**（团队/审计/工作流模板市场）
- **视觉浏览器**
- **Wide Research**（100+ 并行子 agent 横向调研）
- **AI Slides + Web App Builder**（Manus 1.5 主推卖点）
- **Scheduled Tasks + Mail/Slack 集成**
- **AI Design**（图片/视频/3D 资产生成）

---

## 验收基线（Definition of Done）

| # | 验收项 | 方式 |
|---|-------|------|
| 1 | 桌面端 Agent 可下载安装（macOS / Windows） | 各平台实测 |
| 2 | 云端任务可调度到桌面端执行 | E2E |
| 3 | K8s 部署可弹性扩缩（高并发时自动加 Pod） | 压测 |
| 4 | Prometheus + Grafana 监控面板可用 | UI 实测 |
| 5 | 团队/组织功能：多人共享任务、权限矩阵 | UI 实测 |
| 6 | 审计日志可导出，所有 Agent 操作可追溯 | 合规验证 |
| 7 | 视觉浏览器能完成 80% 的网页操作（vs DOM 驱动） | A/B 测试 |
| 8 | **Wide Research 能起 ≥ 50 个并行子 agent 完成"调研 100 双球鞋"类任务** | E2E |
| 9 | **AI Slides 能一句 prompt 生成完整 PPTX**；Web App Builder 能一句 prompt 出可部署的全栈 demo | E2E |
| 10 | **Scheduled Tasks 可设置 cron；Mail 转发到 Manus 邮箱可自动处理；Slack @manus 可在频道工作** | E2E |
| 11 | **AI Design 可生成图片（必）/ 视频 / 3D 资产（可选）** | UI 实测 |

---

## 依赖矩阵

### 前置（P1 完成）
- P1 所有 16 个需求 Status = Completed
- 至少 100 个真实任务历史数据可用于训练/验证

### 阶段内分组（可并行）

```
[桌面端组]                          [云端弹性组]
REQ-201 (桌面端 Agent)             REQ-205 (K8s 部署)
  └→ REQ-202 (文件操作)             REQ-206 (监控告警)
  └→ REQ-203 (应用调度)             REQ-211 (后台长任务)
  └→ REQ-204 (云端同步)

[企业能力组]                        [体验升级组]
REQ-207 (审计日志)                 REQ-209 (模板市场)
REQ-208 (团队/组织)                REQ-210 (视觉浏览器)
                                  REQ-212 (多模型路由优化)

[Manus 1.5+ 亮点组]
REQ-213 (Wide Research)
REQ-214 (AI Slides + Web App Builder)
REQ-215 (Scheduled + Mail/Slack)
REQ-216 (AI Design)
```

---

## 需求清单（16 项）

| ID | 标题 | 模块 | 工作量预估 | 状态 |
|----|------|------|-----------|------|
| REQ-201 | My Computer 桌面端 Agent（Electron 或 Tauri）+ WS 调度 | M08 | 10-14 人天 | In Progress |
| REQ-202 | 桌面端文件系统操作工具：批量重命名/分类/移动/查重 | M08 | 3-5 人天 | In Progress |
| REQ-203 | 桌面端应用调度：启动/关闭软件、剪贴板、模拟键鼠（**每动作授权**） | M08 | 5-7 人天 | In Progress |
| REQ-204 | 桌面端 → 云端文件同步（选择性上传，隐私可控） | M08 | 3-5 人天 | Planning |
| REQ-205 | Kubernetes 部署，Sandbox 改为 K8s Job/Pod 弹性调度 | M09 | 5-7 人天 | Planning |
| REQ-206 | 监控告警：Prometheus + Grafana + 任务失败告警 | M09 | 2-3 人天 | In Progress |
| REQ-207 | 审计日志：所有 Agent 操作可追溯（合规需求） | M07 | 3-4 人天 | Completed |
| REQ-208 | 团队/组织功能：多人共享任务、权限矩阵 | M07 | 5-7 人天 | Planning |
| REQ-209 | 工作流模板市场：用户保存常用任务模板，社区分享 | M06 | 4-5 人天 | In Progress |
| REQ-210 | Browser-Use 升级到视觉模型（截图驱动，无需 DOM 索引） | M03 | 4-5 人天 | Planning |
| REQ-211 | 长时任务后台运行 + Email/Webhook 通知 | M06 | 3-4 人天 | In Progress |
| REQ-212 | 多模型路由优化：动态成本/质量平衡 | M10 | 2-3 人天 | In Progress |
| REQ-213 | **Wide Research：spawn 100+ 并行子 Agent 横向调研 + 主 Agent 汇总** | M01 | 5-7 人天 | In Progress |
| REQ-214 | **AI Slides（PPTX 生成）+ Web App Builder（一句 prompt 出全栈应用 + 部署）** | M05/M06 | 8-10 人天 | Planning |
| REQ-215 | **Scheduled Tasks（cron 定时任务）+ Mail Manus（转发邮件自动处理）+ Manus for Slack** | M06 | 5-7 人天 | In Progress |
| REQ-216 | **AI Design：图片生成（必）+ 视频生成（可选）+ 3D 资产（可选）** | M05 | 3-5 人天 | Planning |
| **总计** | | | **70-98 人天（约 14-20 周）** | |

---

## 需求详细展开

> 💡 **P2 详细展开补充说明**：桌面端 + Manus 1.5+ 亮点是本阶段技术复杂度最高的部分。强烈建议在阶段启动前做 1-2 周 spike（如桌面端框架选型、Web App Builder 部署集成 PoC），再正式分解任务。

---

### REQ-201：My Computer 桌面端 Agent（Electron 或 Tauri）+ WS 调度
**模块**: M08 | **状态**: In Progress | **工作量**: 10-14 人天

#### 背景与价值
Manus 的 My Computer 是产品故事的下一章——**让 AI 真正进入用户的本机**，处理云端碰不到的本地文件、应用与凭证。这是与"另一个聊天框"的根本性差异化。技术上 Manus 自己也是 2026-03 才发的桌面版（[REQ-000 §4](REQ-000-manus-capability-research.md)），属于产品成熟后的延伸。

#### 用户故事
As a 想让 AI 整理我本机 Downloads 文件夹的用户，I want 装一个桌面客户端，登录账号后云端任务可调度到本机执行，So that 本地文件不必上传也能被 AI 处理。

#### 详细需求点
- 框架选型：**Electron**（生态成熟）或 **Tauri**（包小但 webview 兼容性差），spike 后定
- macOS + Windows 双平台（Linux 后置）
- 桌面端启动后通过 WebSocket 连云端，注册为"My Computer agent"
- 云端 Web UI 选"使用我的 My Computer"时，任务由桌面端实际执行
- 任务执行结果（文件清单、操作日志）实时同步回云端
- 桌面端有 tray 图标 + 简单 UI 显示"正在执行的任务"
- 每次操作前云端发"授权请求"，桌面端弹窗确认（除非用户标记 Always Allow）
- 自动更新（Electron auto-updater / Tauri updater）
- 非功能：桌面端体积 < 100MB（Electron 难达到，Tauri 可达 10MB）

#### 验收标准
- [x] 本地 Next.js 进程已作为 My Computer MVP bridge 暴露 `/api/my-computer/status`，Web UI 可检测连接与能力清单
- [x] Web UI 已提供 My Computer 设置面板、允许目录、安全暂停、最近操作与待授权操作
- [ ] macOS 上能 dmg 安装、登录账号、与云端建立 WS
- [ ] Windows 上能 .exe 安装、同上
- [ ] 云端 Web 上选 "Use My Computer" 后任务跑在桌面端
- [ ] tray 图标显示任务进度，可一键停止
- [ ] 自动更新机制能下载新版

#### 实现记录
- 2026-05-23：先实现 My Computer MVP 桥接层，当前运行在本地 Next.js 进程中；后续再抽到 Electron/Tauri 客户端与 WS 调度。

#### 相关 OpenManus 代码
- 完全新建：`desktop/`（Electron 或 Tauri 项目目录）
- 可复用：现有 FastAPI 协议（任务/事件流）
- 需新建：`app/api/my_computer_routes.py`（云端→桌面调度路由）

#### 风险与缓解
- 风险：Electron 包体积大、内存高
- 缓解：spike 阶段对比 Electron vs Tauri；Manus 自己未公开框架，可自由选型
- 风险：双平台签名/公证流程复杂（macOS notarization）
- 缓解：用 `electron-builder`/`tauri-action` GitHub Actions 模板，省手工

---

### REQ-202：桌面端文件系统操作工具 — 批量重命名/分类/移动/查重
**模块**: M08 | **状态**: In Progress | **工作量**: 3-5 人天

#### 背景与价值
Manus demo 中频繁出现的"自动分类上千张照片"、"批量重命名几百张发票"等场景，本质需要在用户本机直接做。云端可以做但要先上传一遍，慢且有隐私顾虑。桌面端原生支持是 My Computer 的核心价值。

#### 用户故事
As a Downloads 文件夹堆了几百个文件的用户，I want 一句话让 AI 按类型/日期分到不同文件夹，So that 5 分钟内清空 Downloads。

#### 详细需求点
- 桌面端 Tool：`local_batch_rename` / `local_classify` / `local_move` / `local_find_duplicates`
- 与云端 Tool 接口签名一致（同一 Tool 可在云沙盒或桌面执行，路由层决定）
- 操作前全部支持 dry-run 模式（输出"将要做的事"清单）
- 文件级 undo（最近 N 个操作可撤销，移到 trash 而非真删）
- 与 REQ-108（云端图片处理）配合：决策"本地直跑 or 上传到云沙盒跑"
- 非功能：100+ 文件操作 < 30 秒；操作进度实时回传云端

#### 验收标准
- [x] dry-run "按文件类型分类 Downloads/允许目录" 显示分类预览，用户确认后才移动文件
- [x] 查重按文件内容 hash 识别重复项，不依赖文件名
- [x] undo 能恢复最近一次批量移动/重命名
- [x] 操作日志进入审计日志，Settings 可查看 recent operations

#### 实现记录
- 2026-05-23：新增 `/api/my-computer/files/scan`、`/api/my-computer/files/plan`、`/api/my-computer/approvals`；支持允许目录校验、分类/重命名/查重 dry-run、Allow Once/Always/Deny 授权和执行。
- 2026-05-23：新增 `/api/my-computer/undo` 和 Settings / My Computer 撤销入口；最近一次已完成的批量移动/重命名可按反向文件动作恢复。

#### 相关 OpenManus 代码
- 可复用：REQ-108 的批量处理逻辑（移植到桌面端 IPC）
- 需新建：`desktop/src/tools/file_tools.ts`（桌面端 Tool 实现）
- 可复用：[OpenManus-main/app/tool/file_operators.py](../OpenManus-main/app/tool/file_operators.py) — `LocalFileOperator` 设计参考

#### 风险与缓解
- 风险：用户授权某目录后 AI 误删
- 缓解：危险操作（删除/移出工作区）强制每次确认；trash 而非真删
- 风险：macOS 沙箱限制（如默认无 Documents 权限）
- 缓解：首次访问目录时触发系统授权弹窗，并在 README 明确文档

---

### REQ-203：桌面端应用调度 — 启动/关闭软件、剪贴板、模拟键鼠
**模块**: M08 | **状态**: In Progress | **工作量**: 5-7 人天

#### 背景与价值
Manus 的 [CNBC demo](https://www.cnbc.com/2026/03/18/metas-manus-launches-desktop-app-to-bring-its-ai-agent-onto-personal-devices.html) 中"20 分钟用 terminal 命令做出实时翻译 app"展示了桌面端可控制应用与执行命令的能力。这部分技术难度高、涉及隐私敏感能力，必须有严格的授权模型（参考 Manus 的 Allow Once / Always Allow）。

#### 用户故事
As a 想让 AI 用 Excel 处理一份本地表格的用户，I want AI 能启动 Excel + 模拟点击/输入完成操作，So that 不用我手动操作。

#### 详细需求点
- 应用启动/关闭工具（macOS：`open -a` / Windows：`Start-Process`）
- 剪贴板读写（含富文本/图片）
- 模拟键鼠（基于 `nut.js` 或类似库）
- terminal 命令执行（与本机 shell 集成，不在沙盒）
- 每个动作必须用户授权（弹窗 + Allow Once / Always Allow / Deny）
- 授权配置：按 (action_type, target) 维度记忆（如"Always Allow: 启动 Excel"）
- 危险操作（删文件/改系统配置/sudo）永远要 Once 授权，不能 Always
- 非功能：授权检查 < 100ms（用户不感觉卡）

#### 验收标准
- [x] 应用启动/关闭动作已接入授权模型；macOS 启动执行层使用 `open -a`，关闭执行层使用 `osascript`
- [x] 剪贴板写入动作已接入授权模型；macOS 执行层使用 `pbcopy`
- [x] 模拟点击已接入动作级授权与 dry-run，真实点击待接入 nut.js/cliclick
- [x] macOS 上 AI 能启动 Calculator 应用
- [x] AI 写文本到剪贴板，用户能粘贴；剪贴板读取也走动作授权
- [ ] 模拟点击在指定坐标生效
- [x] terminal 命令执行结果回传云端；当前 MVP 仅允许短时白名单命令并固定在 My Computer 允许目录内执行
- [x] 首次操作进入待授权列表，支持 Allow Once / Always Allow / Deny；Always Allow 规则持久化后同类动作免二次确认

#### 实现记录
- 2026-05-23：新增 `/api/my-computer/actions`，支持应用启动、剪贴板、键盘快捷键、鼠标点击的授权请求；真实鼠标点击和 terminal 执行默认关闭，待接入更细权限与底层库。
- 2026-05-23：剪贴板写入/读取已支持真实执行验收；Always Allow 按 `(action_type, target)` 持久化，后续同类动作可免确认执行。
- 2026-05-23：参考 OpenManus `bash.py` 的命令工具边界，新增受控 terminal 命令执行；使用白名单、短超时、固定 cwd 和非 shell 执行，结果回传到操作记录。
- 2026-05-23：参考 OpenManus `computer_use_tool.py` 的动作级工具形态，补齐 macOS Calculator 真实启动验收；应用启动仍必须先进入 My Computer 授权队列。
- 2026-05-23：新增 `app_quit` 授权动作，Calculator 关闭也走 My Computer 授权队列，E2E 覆盖启动后关闭清理。

#### 相关 OpenManus 代码
- 完全新建：`desktop/src/tools/system_tools.ts`
- 可复用：[OpenManus-main/app/tool/bash.py](../OpenManus-main/app/tool/bash.py) — `_BashSession` 设计参考

#### 风险与缓解
- 风险：macOS Accessibility 权限难拿（系统设置手动开启）
- 缓解：首次使用时引导用户开启 + 一键打开"系统设置 > 隐私 > 辅助功能"
- 风险：AI 滥用模拟键鼠（误操作其他应用）
- 缓解：模拟键鼠默认必须指定目标应用窗口，不允许全屏自由控制；每次操作前截图 + 用户预览

---

### REQ-204：桌面端 → 云端文件同步（选择性上传，隐私可控）
**模块**: M08 | **状态**: Planning | **工作量**: 3-5 人天

#### 背景与价值
桌面端处理过的文件经常需要让云端进一步加工（如本地 OCR 后让云端 LLM 总结）。需要明确的"选择性上传"机制：默认本地处理本地，必要时用户主动允许上传。

#### 用户故事
As a 担心隐私的用户，I want 本机文件默认不上传云端，但我能主动选某些文件上传供云端 Agent 用，So that 我掌控数据边界。

#### 详细需求点
- 桌面端 UI 增"上传到云端"操作（右键文件/拖到 tray）
- 上传文件加密传输 + 云端存储加密（AES-256）
- 上传文件在云端有明确生命周期（默认 7 天后清理，可延长）
- AI 主动请求上传时弹用户确认（"AI 想上传 abc.pdf 到云端进行 OCR，允许？"）
- 上传/下载进度条
- 非功能：100MB 文件上传 < 30 秒（千兆网）

#### 验收标准
- [ ] 右键文件选"Send to Cloud"后云端 Library 可见
- [ ] AI 请求上传时用户能 Approve/Deny
- [ ] 上传文件 7 天后自动从云端删除
- [ ] 加密传输（HTTPS）+ 加密存储

#### 相关 OpenManus 代码
- 需新建：`app/api/file_sync_routes.py`、`desktop/src/sync/`
- 可复用：P1 REQ-103 的 workspace 隔离 + REQ-009 ZIP 打包

#### 风险与缓解
- 风险：用户上传后忘记，长期占用云端存储
- 缓解：默认 7 天 TTL + 邮件提醒"X 文件即将过期"

---

### REQ-205：Kubernetes 部署 — Sandbox 改为 K8s Job/Pod 弹性调度
**模块**: M09 | **状态**: Planning | **工作量**: 5-7 人天

#### 背景与价值
P1 的 Docker SDK 多租户方案在单机上跑 50 容器是上限，再加用户就需要分布式。K8s 是事实标准，且 Sandbox 容器特别适合用 Job/Pod 模型：每任务一个 Pod，跑完自动回收，节点不够自动扩。

#### 用户故事
As a 平台运维者面对 500 并发用户，I want 系统自动起更多节点跑沙盒，So that 不用手动加机器。

#### 详细需求点
- Helm chart：API/前端/PG/Redis/MinIO（artifacts 对象存储）
- Sandbox 改为 K8s Job 模式：每任务创建 Pod，跑完 TTL 1 小时后回收
- 节点弹性：cluster-autoscaler 配合，CPU 利用率 > 70% 加节点
- 镜像统一推到私有 registry（ECR/GCR/Harbor）
- 保留 Docker Compose 部署模式作为"轻量自托管"选项
- 非功能：单 Pod 启动 < 10 秒（用 image 预拉 + initContainer 优化）

#### 验收标准
- [ ] `helm install` 一次能起完整栈
- [ ] 50 并发任务能自动起 50 Pod
- [ ] 节点 CPU > 70% 时新节点自动加入
- [ ] Docker Compose 模式仍可用（向后兼容）

#### 相关 OpenManus 代码
- 需改造：P1 REQ-104 的 `SandboxPool` — 后端可插拔（DockerSDK / K8sClient）
- 需新建：`deploy/helm/`（chart）、`deploy/k8s/`（manifests）

#### 风险与缓解
- 风险：K8s 学习曲线陡，个人开发者难维护
- 缓解：提供 docker-compose 作为兜底；K8s 文档详细 + 提供 minikube 测试脚本

---

### REQ-206：监控告警 — Prometheus + Grafana + 任务失败告警
**模块**: M09 | **状态**: In Progress | **工作量**: 2-3 人天

#### 背景与价值
P1 之前没有系统监控（只有 loguru 日志）。到 P2 进入生产化阶段，必须有可观测性：任务成功率/延迟/成本/容器健康都要图表化，关键指标要告警。

#### 用户故事
As a 运维者，I want 任务失败率超 10% 时立即收到通知，So that 半夜也能第一时间发现问题。

#### 详细需求点
- API 暴露 `/metrics` Prometheus 端点（FastAPI Prometheus middleware）
- 关键指标：任务总数/成功率/平均延迟/p99 延迟/每分钟成本/活跃容器数/LLM 调用错误率
- Grafana dashboard 模板（启动即可用）
- AlertManager 规则：任务失败率 > 10%/容器 OOM 率 > 5%/LLM 错误 > 20% 等
- 告警通道：Email + Slack webhook
- 非功能：指标采集不增加 API 延迟 > 5ms

#### 验收标准
- [x] `/metrics` 暴露 Prometheus text/plain 指标，覆盖任务总数/状态/成功率/平均延迟/p99/LLM 成本/审计/沙盒健康
- [x] Prometheus 指标不包含 `user_id`、`task_id`、`prompt` 等高基数 label
- [x] Prometheus / Grafana / AlertManager 配置已加入 Docker Compose observability profile
- [x] dashboard 模板开箱即用（自动 provisioning）
- [ ] Grafana 上能看到所有关键指标的实时图
- [ ] 故意触发失败任务后能在 5 分钟内收到告警邮件

#### 实现记录
- 2026-05-23：参考 OpenManus `logger.py` 的日志入口，先在 Next.js 侧补齐 `/metrics` Prometheus exporter；当前覆盖任务、LLM 成本、审计和 Docker 沙盒健康基础指标，Grafana/AlertManager 模板待后续补齐。
- 2026-05-23：新增 Docker Compose observability profile、Prometheus scrape/alert rules、AlertManager 配置骨架、Grafana datasource/dashboard provisioning 和 ManusXL Overview dashboard；真实 Email/Slack 告警通道待生产密钥接入后实测。

#### 相关 OpenManus 代码
- 可复用：[OpenManus-main/app/logger.py](../OpenManus-main/app/logger.py) — loguru 已有，加 metrics
- 需新建：`app/metrics/`、`deploy/grafana/dashboards/`、`deploy/alertmanager/rules.yml`
- 需新增依赖：`prometheus-fastapi-instrumentator`

#### 风险与缓解
- 风险：高基数 label 导致 Prometheus 内存爆炸（如把 user_id 当 label）
- 缓解：user_id 等高基数维度只放 logs，不放 metrics

---

### REQ-207：审计日志 — 所有 Agent 操作可追溯
**模块**: M07 | **状态**: Completed | **工作量**: 3-4 人天

#### 背景与价值
企业用户必需。当一个任务"做错事"时（如改了不该改的文件），必须能追溯到"哪个 user、哪个 task、哪个 step、用了哪个 tool、动了哪些资源"。合规要求（GDPR/SOC2）也需要审计日志。

#### 用户故事
As a 企业 admin，I want 能查谁在何时通过 Agent 做了什么操作，So that 出问题能定位 + 满足合规检查。

#### 详细需求点
- 单独表 `audit_logs(id, user_id, task_id, step_id, action, resource, status, timestamp, ip)`
- 记录粒度：工具调用 / 文件读写 / 数据库变更 / 配置变更 / 登录登出
- 字段加密：敏感字段（如文件内容摘要）AES 加密存储
- 可导出（CSV/JSON）
- 保留期 90 天（可配，企业版可延长）
- 不可修改（append-only，加 hash chain 防篡改）
- 非功能：写日志异步批量，不影响主路径

#### 验收标准
- [x] 跑 1 个任务后审计表能查到所有 tool 调用记录
- [x] 导出 CSV 可读，含所有字段
- [x] 尝试 UPDATE/DELETE 审计表被数据库 trigger 拒绝
- [x] hash chain 校验脚本能验证连续性

#### 实施记录（2026-05-23）
- 新增 `audit_logs` 表，字段覆盖 user/task/step/action/resource/status/ip/user_agent/metadata_hash/previous_hash/entry_hash/created_at，并接入 SQLite 与 PostgreSQL schema。
- 审计日志以 per-user hash chain 方式追加写入；SQLite/PG 均创建 append-only trigger，阻止 UPDATE/DELETE。
- 新增 `/api/audit/logs` 与 `/api/audit/verify`，支持登录态隔离查询、CSV 导出和 hash chain 连续性校验。
- Settings 新增"审计日志"面板，展示最近操作、链路校验状态、记录数和 CSV 导出入口。
- 已接入认证登录/登出/refresh/OAuth、配置更新、任务创建、Agent tool_call/tool_result、artifact、finished/failed、本地浏览器操作等关键事件。
- 新增 `npm run e2e:audit`，覆盖未登录保护、登录审计、配置审计、任务创建审计、工具调用审计、hash chain 校验和 CSV 导出。

#### 相关 OpenManus 代码
- 可复用：P1 REQ-106 的事件流持久化（部分重叠）
- 需新建：`app/audit/`、DB migration 加 audit_logs 表 + trigger

#### 风险与缓解
- 风险：审计日志含敏感数据（如文件内容）泄露风险
- 缓解：默认只记 metadata + 摘要（hash），不记原文；企业模式可选启用全文

---

### REQ-208：团队/组织功能 — 多人共享任务、权限矩阵
**模块**: M07 | **状态**: Planning | **工作量**: 5-7 人天

#### 背景与价值
P1 是单用户产品（一个账号一个 workspace）。P2 进入团队场景：多人协作同一项目、共享任务历史、按角色分权限。这是从个人订阅升级到团队订阅的关键能力（参考 Manus 1.5+ Collaboration 功能）。

#### 用户故事
As a 5 人小团队的负责人，I want 邀请同事加入组织，按角色（admin/member/viewer）分权限，共享任务和 Skills，So that 大家用同一份知识库工作。

#### 详细需求点
- 三层数据模型：`Organization` → `Team` → `User`
- 角色：Owner / Admin / Member / Viewer
- 任务可设可见性：private / team / org
- 共享资源：Skills / Templates / MCP Servers
- 邀请流程：邮件邀请 + 链接接受
- 计费按 org 维度（不再按个人）
- 非功能：org 内 10 人并发跑任务不互相影响

#### 验收标准
- [ ] 邀请同事加入 org 后能在 UI 看到共享任务
- [ ] Viewer 角色不能新建任务（只读）
- [ ] org 配额到上限时新任务被拒
- [ ] 用户可同时加入多个 org，UI 顶部可切换

#### 相关 OpenManus 代码
- 需改造：P1 REQ-103 的用户隔离 — 路径加 org_id 一层 `workspace/{org_id}/{user_id}/{task_id}/`
- 需改造：所有 ACL 检查 — 加 org 维度
- 需新建：`app/org/`、`app/api/org_routes.py`

#### 风险与缓解
- 风险：从"个人"到"org"数据迁移痛苦（已存在用户的所有任务要归到默认 personal org）
- 缓解：迁移脚本自动给每个用户创建 `{username}'s personal` org 并把任务全归入

---

### REQ-209：工作流模板市场 — 用户保存常用任务模板，社区分享
**模块**: M06 | **状态**: In Progress | **工作量**: 4-5 人天

#### 背景与价值
P1 REQ-112 是"私有任务模板"，P2 升级为"公开市场"：用户可发布优质模板供他人使用，平台获得 UGC 内容生态。Manus 的 Playbook 已经有市场雏形。

#### 用户故事
As a 想做"行业调研"任务的新用户，I want 在市场里找现成模板用，So that 不用自己写 prompt 从零起步。

#### 详细需求点
- 模板市场 UI（公开页 + 用户中心）：分类/搜索/热门/最新
- 一键 fork 到个人空间
- 评分 + 评论
- 模板审核（防恶意 prompt 注入 / 不当内容）
- 创作者排行榜 / 收益分成（可选，复杂场景）
- 非功能：市场页加载 < 2 秒；模板执行隔离（基础 fork 走个人 sandbox）

#### 验收标准
- [x] Library / 模板市场能看到至少 10 个示例模板
- [x] fork 后模板出现在个人 Library
- [x] 评分能改变模板排序
- [x] 含恶意 prompt 的模板被审核拒绝

#### 实现记录
- 2026-05-23：参考 OpenManus `planning.py` / `prompt/planning.py` 的结构化计划模板思路，在现有 P1 模板系统上扩展模板市场；新增 `/api/marketplace/templates`、Fork、评分、私有模板发布审核和 10+ 官方示例模板。
- 2026-05-23：Library 新增“模板市场”面板，支持精选/热门/高分/最新排序、Fork 到个人模板、快速评分；新增 `npm run e2e:marketplace` 覆盖公开模板、fork、评分排序和恶意 prompt 审核。

#### 相关 OpenManus 代码
- 可复用：P1 REQ-112 的模板系统（DB 表加 `is_public` 字段）
- 需新建：`app/marketplace/`、`app/api/marketplace_routes.py`、前端市场页

#### 风险与缓解
- 风险：用户上传含敏感数据的模板（如内含 API key）
- 缓解：发布前自动扫描敏感字段（regex + LLM）+ 用户二次确认

---

### REQ-210：Browser-Use 升级到视觉模型（截图驱动，无需 DOM 索引）
**模块**: M03 | **状态**: Planning | **工作量**: 4-5 人天

#### 背景与价值
OpenManus 当前 browser_use 是 DOM 索引方案（[browser_use_tool.py](../OpenManus-main/app/tool/browser_use_tool.py)），在复杂网页（Canvas、动态 DOM、SPA）上失效率高。升级到视觉模型方案（直接看截图 + 多模态 LLM 决策点击坐标）能突破这些限制。Claude/GPT-4 的 vision 能力已成熟。

#### 用户故事
As a 让 Agent 操作复杂 SPA（如 Notion/Figma）的用户，I want Agent 用视觉理解页面而不是依赖 DOM，So that 复杂前端也能自动化。

#### 详细需求点
- 新工具 `browser_visual`：基于截图 + 多模态 LLM，输出点击/输入坐标
- 与 DOM 方案共存：默认 DOM 优先，DOM 失败/复杂页面 fallback 视觉
- 路由策略：用户可配/Agent 可自选/平台学习偏好
- 视觉操作精度优化：截图前自动滚动到目标 + 高亮反馈
- 非功能：单次视觉操作延迟 < 5 秒（含 LLM 调用）

#### 验收标准
- [ ] 跑 Canvas 网页（如简单画图工具）能完成点击
- [ ] DOM 失败时自动 fallback 视觉成功率 ≥ 60%
- [ ] 视觉模式成本明显高于 DOM（成本透明 UI 提示）
- [ ] 截图带高亮预览，用户能 review 决策

#### 相关 OpenManus 代码
- 可复用：[OpenManus-main/app/tool/browser_use_tool.py:479-539](../OpenManus-main/app/tool/browser_use_tool.py) — `get_current_state()` 已返回 base64 截图
- 可复用：[OpenManus-main/app/llm.py:267-352](../OpenManus-main/app/llm.py) — `format_messages` 支持多模态
- 需新建：`app/tool/browser_visual.py`

#### 风险与缓解
- 风险：视觉决策成本高（每次 LLM 多模态调用）
- 缓解：默认 DOM 优先，视觉仅作 fallback；用户在 UI 看到成本警告

---

### REQ-211：长时任务后台运行 + Email/Webhook 通知
**模块**: M06 | **状态**: In Progress | **工作量**: 3-4 人天

#### 背景与价值
P1 REQ-106 解决了"断线重连看进度"，但还需要"任务完成主动通知用户"。长任务（如 Wide Research）可能跑几十分钟到几小时，用户不可能挂着浏览器等。Email/Webhook 通知是基本需求。

#### 用户故事
As a 跑 1 小时任务的用户，I want 任务完成时收到邮件，So that 我可以去做别的事，不用刷新页面。

#### 详细需求点
- 用户在 Settings 配置通知偏好（Email/Slack webhook/无）
- 任务完成/失败时按偏好发送
- 邮件含任务摘要 + 直达 Library 链接
- Slack webhook 含富文本卡片
- 通知模板可自定义（高级用户）
- 非功能：通知发送异步队列（不阻塞任务完成事件）

#### 验收标准
- [x] Settings 可配置 Email/Webhook/Slack 通知偏好，并能发送开发环境测试通知
- [x] 任务进入 completed/failed/cancelled/timeout 后会异步触发通知，不阻塞任务完成事件
- [x] 通知正文含任务摘要 + `taskId` 直达链接，Web UI 可按 `?taskId=` 打开任务详情
- [x] Slack webhook 使用 blocks 格式化卡片 payload
- [x] 关闭完成通知后不再发送 completed 通知

#### 相关 OpenManus 代码
- 需新建：`app/notifications/`（providers：email/slack/webhook）
- 可复用：P1 REQ-106 的任务状态变更事件
- 需新增依赖：`aiosmtplib`（邮件）

#### 实现记录
- 2026-05-23：新增通知设置与日志存储、`/api/notifications/settings`、`/api/notifications/logs`、`/api/notifications/test`；任务 terminal 状态变更时异步发送 Email/Webhook/Slack 通知。
- 2026-05-23：Settings 新增“通知”面板，支持保存偏好、测试完成通知、查看最近通知日志；新增 `npm run e2e:notifications` 覆盖开启、测试发送、关闭后不发送和失败通知标题。

#### 风险与缓解
- 风险：通知失败导致用户错过任务结果
- 缓解：失败重试 3 次 + 通知日志可查 + UI 上显示发送状态

---

### REQ-212：多模型路由优化 — 动态成本/质量平衡
**模块**: M10 | **状态**: In Progress | **工作量**: 2-3 人天

#### 背景与价值
P1 REQ-111 实现了基础"按 step type 分模型"路由，但是静态规则。P2 升级为动态优化：基于历史数据学习"什么任务用什么模型最 cost-effective"，自动推荐路由策略。

#### 用户故事
As a 平台用户，I want 系统自动选最划算的模型组合而不是死规则，So that 我的成本下降还不掉质量。

#### 详细需求点
- 收集每次 LLM 调用的 (task_type, step_type, model, cost, quality_signal) 数据
- quality_signal：任务成功率 / 用户满意度 / Validator 通过率
- 基于历史数据训练简单决策树（per task_type 推荐 model 组合）
- 用户可手动 override
- A/B 测试框架：自动对比新旧路由策略
- 非功能：路由决策 < 50ms

#### 验收标准
- [x] 系统能基于历史/规则推荐"调研类任务用强规划 + 轻执行 + 稳定总结"组合
- [x] A/B 测试结果可视化对比
- [x] 用户 override 立即生效
- [x] 数据不足时 fallback 到 REQ-111 静态规则

#### 当前实现记录
- 2026-05-23：新增 `router-optimizer`，基于 `context_metrics` + 任务终态聚合 `(task_type, step_type, model, cost, quality_signal)`；样本不足时使用保守决策树。
- 2026-05-23：新增 `/api/model-router/optimizer`，返回任务类型识别、推荐模型组合、A/B 历史 token 回放、置信度与 fallback 原因，目标接口耗时 < 50ms。
- 2026-05-23：运行时 `routeModel` 在无手动覆盖时接入动态推荐；Settings 新增“模型路由优化”面板，可查看推荐、A/B 回放并一键应用为手动 override。

#### 相关 OpenManus 代码
- 可复用：P1 REQ-111 的 `model_router.py`（扩展）
- 可复用：P1 REQ-109 的成本统计
- 需新建：`app/agent/router_optimizer.py`

#### 风险与缓解
- 风险：自动学习"翻车"（推荐了更贵或更差的模型）
- 缓解：上线策略保守（先做推荐不强制）；A/B 数据明显劣化时回滚

---

### REQ-213：Wide Research — 100+ 并行子 Agent 横向调研
**模块**: M01 | **状态**: In Progress | **工作量**: 5-7 人天

#### 背景与价值
Manus 的明星功能（[REQ-000 §1 Wide Research](REQ-000-manus-capability-research.md)）：单任务可起 100+ 个 sub-agent 独立处理子任务（如"调研 100 双球鞋"），主 agent 汇总。这是与"传统单 agent"产品的根本性差异化。

#### 用户故事
As a 想调研 50 家供应商的用户，I want 系统并行起 50 个 sub-agent 各自调研 1 家，几分钟出汇总报告，So that 不用串行等几小时。

#### 详细需求点
- 新工具 `spawn_sub_agents(task_template, items=[], merge_strategy)` — 起 N 个子 agent
- 子 agent 共享主 agent 的 context 头（system + 任务背景），各自处理 1 个 item
- 并发控制：单任务 max_sub_agents = 100（可配）；总并发受 P1 REQ-104 sandbox 配额限制
- 汇总策略：concat / summarize / structured_merge（指定 schema）
- 子 agent 失败重试 + skip 策略
- 用 P2 REQ-205 K8s Job 模式跑（弹性扩容支撑高并发）
- 非功能：100 子 agent 5 分钟内出结果（依赖 LLM 速度）

#### 验收标准
- [x] 跑"调研 50 家公司"任务能起 50 个 sub-agent（MVP：本地虚拟子 Agent 并发池）
- [x] 主 agent 等所有 sub 完成后汇总
- [x] 单个 sub 失败不影响其他
- [x] LLM rate limit 触发时自动 throttle 不报错（MVP：并发池排队节流；真实 provider 动态限流待接）
- [ ] 100+ 子 Agent 使用 K8s Job / Pod 弹性调度跑真实 LLM 调研

#### 实施记录
- 2026-05-23：参考 OpenManus `PlanningFlow` 的“主计划 + executor 执行”模式和 `BaseAgent.run()` 的 step loop，新增 ManusXL TS 工具 `spawn_sub_agents`。当前 MVP 在单任务内启动本地虚拟子 Agent 并发池，支持 `MANUSXL_MAX_SUB_AGENTS` / `MANUSXL_SUB_AGENT_CONCURRENCY`、失败重试 2 次后 skip、structured_merge 汇总。
- 2026-05-23：规划器遇到“Wide Research / 横向调研 / 调研 50 家公司 / 100 双球鞋”等任务会自动插入 `spawn_sub_agents` 步骤；工具输出 `wide-research-report.md`、`wide-research-results.json`、`wide-research-results.csv`、`wide-research-package.zip`。新增 `npm run e2e:wide-research` 覆盖 50 子 Agent、失败跳过、并发池和交付物。

#### 相关 OpenManus 代码
- 可复用：[OpenManus-main/app/agent/](../OpenManus-main/app/agent/) — 现有 Agent 框架可作为 sub-agent
- 可复用：P2 REQ-205 K8s Job
- 需新建：`app/agent/wide_research.py`（spawner + merger）+ `app/tool/spawn_sub_agents.py`

#### 风险与缓解
- 风险：100 sub agent 瞬间打爆 LLM rate limit
- 缓解：内部 rate limiter（按 provider 配额）+ 排队队列；用户 UI 显示"已起 X/Y 个，等待 LLM 配额"

---

### REQ-214：AI Slides + Web App Builder
**模块**: M05/M06 | **状态**: Planning | **工作量**: 8-10 人天

#### 背景与价值
Manus 1.5 的两大主推卖点（[REQ-000 §1](REQ-000-manus-capability-research.md)）：(1) **AI Slides** 一句 prompt 生成完整 PPT（已在 P0 REQ-008 有基础版，P2 升级到 Manus 级别）；(2) **Web App Builder** 一句 prompt 出**可部署**的全栈应用（含前端 + API + DB + auth + 部署）。这是把 Agent 从"做调研"扩展到"造产品"的关键能力。

#### 用户故事
As a 想做一个内部小工具的用户，I want 一句"帮我做一个简单的 CRM 应用，含登录、客户列表、备注"就能得到可访问的网址，So that 不用学编程也能做内部工具。

#### 详细需求点
**AI Slides 升级**：
- 模板库扩展（≥ 10 个高质量模板，覆盖商业/学术/创意场景）
- 自动配图（接图片生成或 Unsplash API）
- 数据图表 + 表格自动布局
- 主题色一致性（从 prompt 中的关键词学）

**Web App Builder**：
- 后端：FastAPI + SQLAlchemy + JWT 模板
- 前端：React + Tailwind 模板
- 数据库：PostgreSQL（schema 由 Agent 生成 + Alembic migration）
- 部署：集成 Vercel/Cloudflare Pages/Render 任选一个
- 用户能 Preview + 一键 Deploy

#### 验收标准
- [ ] "做 5 页投资人 BP" 输出可用 PPTX，含配图
- [ ] "做一个 todo 应用带登录" 输出可访问 URL
- [ ] Deploy 失败时有清晰错误信息 + 一键重试
- [ ] 生成应用源码可下载（用户掌握所有权）

#### 相关 OpenManus 代码
- 可复用：P0 REQ-008 的 PPTX 生成（升级模板库）
- 完全新建：`app/tool/app_builder/`（含 backend/frontend/db/deploy 4 个生成器）

#### 风险与缓解
- 风险：Web App Builder 生成的应用"看起来对但有 bug"
- 缓解：模板高度成熟（限制可生成的应用形态），不允许从零写架构；生成后跑基础单测验证
- 风险：部署平台 API 变更
- 缓解：抽象部署接口，多 provider 适配；至少有 2 个 provider 备选

---

### REQ-215：Scheduled Tasks + Mail Manus + Manus for Slack
**模块**: M06 | **状态**: In Progress | **工作量**: 5-7 人天

#### 背景与价值
Manus 三个"被动触发"能力（[REQ-000 §1](REQ-000-manus-capability-research.md)）：定时任务（cron）/ 邮件转发 / Slack @manus。这些让 Agent 从"用户主动启动"升级到"事件驱动"，是从工具到工作流的关键跃迁。

#### 用户故事
As a 每周需要新闻简报的用户，I want 设置"每周一 9 点跑这个 prompt 并发我邮箱"，So that 不用每周手动启动。

#### 详细需求点
**Scheduled Tasks**：
- UI 任务详情页"设为定时任务"按钮，可配 cron 表达式
- 后端 APScheduler 或 cron 实现
- 触发时新建子任务，按用户偏好通知

**Mail Manus**：
- 每个用户分配独立邮箱（`{user_id}@mail.xl-manus.com`）
- 用户转发邮件到该地址自动触发任务（prompt = 邮件主题 + 正文 + 附件）
- 任务完成后回复邮件

**Manus for Slack**：
- Slack App 安装到 workspace
- `@xl-manus` 在频道里被 @ 时触发任务
- 任务结果 thread 回复
- DM 也支持

#### 验收标准
- [x] cron/interval 设置后真的按时跑，并创建新 Agent 任务进入队列
- [x] 转发邮件到 user 邮箱能触发任务（MVP：入站 webhook，回复邮件待接真实邮箱服务）
- [x] Slack 频道 @ 能触发任务（MVP：Slack Events webhook，thread 回复待接 Slack Bot token）

#### 当前实现记录
- 2026-05-23：新增 `scheduled_tasks` / `scheduled_task_runs` SQLite 存储，支持 interval 与 5-field cron，自动计算 `nextRunAt`，本地进程内 runner 每 5 秒扫描到期任务。
- 2026-05-23：新增 `/api/scheduled-tasks`、`/api/scheduled-tasks/:id/run`、`/api/scheduled-tasks/tick`；Settings 新增 Scheduled / Mail / Slack 面板，任务详情页新增“设为定时任务”入口。
- 2026-05-23：新增 `/api/integrations/mail/inbound` 与 `/api/integrations/slack/events`，实现 Mail Manus / Manus for Slack 的入站 webhook 触发任务；触发后复用现有 Agent 队列与完成通知链路。

#### 相关 OpenManus 代码
- 需新建：`app/scheduler/`、`app/integrations/mail/`、`app/integrations/slack/`
- 需新增依赖：`apscheduler`、`aiosmtplib`（已有）、`slack-sdk`

#### 风险与缓解
- 风险：邮箱被滥用作为垃圾邮件中转
- 缓解：邮箱只接受用户已 verify 的发件人地址；rate limit 每用户每天 N 封
- 风险：Slack App 上架审核
- 缓解：内部 Workspace App 模式可绕过审核（用户在自己 workspace 安装）

---

### REQ-216：AI Design — 图片生成（必）+ 视频/3D 资产（可选）
**模块**: M05 | **状态**: Planning | **工作量**: 3-5 人天

#### 背景与价值
Manus 1.5+ 的 AI Design 能力（[REQ-000 §1](REQ-000-manus-capability-research.md)）：在 Agent 工作流里直接生成图片/视频/3D 资产，作为 PPT/网页/dashboard 的素材，避免去外部工具切换。MVP 阶段只做图片，视频/3D 是可选。

#### 用户故事
As a 用 AI 做 PPT 的用户，I want PPT 里需要的插图直接生成（不去 Midjourney），So that 工作流一气呵成。

#### 详细需求点
- 图片生成工具：`generate_image(prompt, style, size)` — 多 provider 适配（DALL-E 3 / Stable Diffusion / 通义万相 / 文心一格）
- 用户可在 Settings 选默认 provider + 自带 API key
- 生成图片自动存到当前任务 artifacts/
- PPT/网页生成工具能消费这些图片（拼装到对应位置）
- 视频生成（可选，接 Runway/Pika API）
- 3D 资产生成（可选，接 Meshy/Spline API）
- 非功能：单图生成 < 30 秒；支持队列防止 rate limit

#### 验收标准
- [ ] 生成一张"商务风格的咖啡店外观"图片
- [ ] 切换 provider 仍能工作
- [ ] PPT 工具能用生成的图作为插图
- [ ] 失败时不阻塞 PPT 生成（用占位图）

#### 相关 OpenManus 代码
- 可复用：[OpenManus-main/app/tool/base.py](../OpenManus-main/app/tool/base.py) — `BaseTool` 接口
- 需新建：`app/tool/design/`（image/video/3d 三个子模块，video/3d 为 stub）
- 需新增依赖：`openai`（DALL-E）/ Provider-specific SDK

#### 风险与缓解
- 风险：图片 API 成本高（DALL-E 3 一张 $0.04+）
- 缓解：透明计费（REQ-109）显示图片成本；用户可在 Settings 设单任务图片上限

---

## 阶段风险与缓解

| 风险 | 影响 | 缓解 |
|------|------|------|
| My Computer 涉及 macOS/Windows 双平台 | 高 | 第一版只做 macOS，验证产品价值后再扩展 Windows |
| 桌面端"模拟键鼠"在不同 OS 有不同权限模型 | 高 | 给用户透明的授权流程；参考 Manus 的 Allow Once / Always Allow 模式 |
| K8s 部署门槛高 | 中 | 保留 Docker Compose 部署作为"轻量模式"，K8s 作为"企业模式" |
| 视觉浏览器成本高（多模态 LLM 调用） | 中 | 默认 DOM 优先，仅复杂页面 fallback 到视觉模式 |
| 审计日志暴露用户敏感数据 | 高 | 默认脱敏，关键字段加密存储 |
| **Wide Research 100+ 并行子 agent 可能瞬间打爆 LLM rate limit** | 高 | 实现并发池 + 自动节流；按 LLM provider 配额动态调整 |
| **Web App Builder 生成的应用要能"真正部署"** | 高 | 集成至少一个部署平台（Vercel/Netlify/Cloudflare Pages）；不要做"代码生成不部署" |
| **AI Design 图片生成需要接入第三方模型（DALL-E/Stable Diffusion/Midjourney）** | 中 | 模型可插拔，UI 上让用户选择；视频/3D 是可选项不要硬上 |
| **Mail/Slack 集成涉及多个第三方 OAuth 与 webhook 协议** | 中 | 优先 Slack（生态成熟），Mail 用 IMAP/SMTP 通用方案 |

---

## Go/No-Go 评审清单（V2 发布前）

- [ ] 所有 16 个 P2 需求 Status = Completed
- [ ] 桌面端 Agent 在 macOS 至少有 1 个完整跑通的用例
- [ ] K8s 部署文档完善，可一键 helm install
- [ ] 100 用户量级稳定运行 ≥ 1 个月
- [ ] 视觉浏览器 A/B 测试结果可接受
- [x] Wide Research 至少跑通"100 双球鞋调研"或等价用例（当前等价 E2E：50 家公司；100+ 真实 LLM/K8s 待 REQ-205）
- [ ] AI Slides + Web App Builder 各有 ≥ 3 个公开 demo
- [ ] Mail/Slack 各跑通至少 1 个用户的真实使用场景
- [ ] AI Design 图片生成可用，视频/3D 至少有 PoC
- [ ] 安全审计通过（认证、授权、日志、数据加密）

---

## 备注

- 本文档基于 REQ-000 调研新增了 4 个 Manus 1.5+ 亮点能力（REQ-213/214/215/216）
- 本阶段是与 Manus 真实产品差异化竞争的关键阶段
- 如果时间紧张，建议优先桌面端组 + Manus 1.5+ 亮点组，云端弹性组可推迟
- AI Design 的视频和 3D 是可选项，如果模型成本/技术成熟度不够可推到 V3
