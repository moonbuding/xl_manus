// workspace.jsx — 4 workspace screens (A empty / B timeline / C cards / D done)

// ─── LeftRail — primary navigation ───────────────────────────────────────────
const LeftRail = ({ active = "home" }) => {
  const t = useT();
  const items = [
    { id: "home",  icon: I.plus,    label: "新任务" },
    { id: "agent", icon: I.brain,   label: "Agent" },
    { id: "skill", icon: I.layers,  label: "插件",    badge: "P1" },
    { id: "sched", icon: I.bolt,    label: "定时任务", badge: "P2" },
    { id: "lib",   icon: I.lib,     label: "Library" },
  ];
  const projects = [
    { ja: "新能源车研究", n: 3, on: true },
    { ja: "周报自动化",   n: 2 },
  ];
  const recents = [
    { ja: "新能源车前五调研", time: "12 分钟前", running: true },
    { ja: "Q3 财报对比 Excel", time: "昨天" },
    { ja: "竞品定价方案 PPT",  time: "昨天" },
    { ja: "周报模板",          time: "上周" },
  ];
  return (
    <aside style={{
      width: 220, flexShrink: 0, background: t.bgRail,
      borderRight: `0.5px solid ${t.divider}`,
      display: "flex", flexDirection: "column", padding: "18px 14px 12px",
    }}>
      {/* brand */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "0 4px 22px" }}>
        <BrandMark size={24} />
        <span style={{ fontFamily: 'Inter, "Noto Sans SC", system-ui, sans-serif',
          fontSize: 16, fontWeight: 600, color: t.ink, letterSpacing: ".06em" }}>FOLIO</span>
        <div style={{ flex: 1 }} />
        <div style={{ width: 24, height: 24, display: "flex", alignItems: "center",
          justifyContent: "center", color: t.mute, cursor: "pointer" }}>
          <Icon d={I.search} size={14} />
        </div>
      </div>

      {/* new task button */}
      <button style={{
        display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
        background: t.ink, color: t.bgElev, border: 0, borderRadius: 4,
        padding: "10px 14px", fontSize: 12.5,
        fontFamily: 'Inter, "Noto Sans SC", system-ui, sans-serif',
        fontWeight: 500, cursor: "pointer", letterSpacing: ".02em", marginBottom: 18,
      }}>
        <Icon d={I.plus} size={14} /> 新任务
        <span style={{ flex: 1 }} />
        <span style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: 9.5,
          color: "rgba(255,255,255,.5)" }}>⌘N</span>
      </button>

      {/* nav */}
      <nav style={{ display: "flex", flexDirection: "column", gap: 1 }}>
        {items.map((it) => {
          const on = it.id === active;
          return (
            <div key={it.id} style={{
              display: "flex", alignItems: "center", gap: 11,
              padding: "7px 10px", borderRadius: 3,
              background: on ? t.bgDeep : "transparent",
              color: on ? t.ink : t.inkSoft, fontSize: 12.5, fontWeight: on ? 500 : 400,
              cursor: "pointer", position: "relative",
            }}>
              {on && <span style={{
                position: "absolute", left: -14, top: 4, bottom: 4, width: 2,
                background: t.sage,
              }} />}
              <Icon d={it.icon} size={15} stroke={on ? t.ink : t.mute} />
              <span style={{ flex: 1 }}>{it.label}</span>
              {it.badge && (
                <span style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: 8.5,
                  color: t.muteSoft, letterSpacing: ".08em",
                  border: `0.5px solid ${t.divider}`, padding: "1px 4px", borderRadius: 2 }}>
                  {it.badge}
                </span>
              )}
            </div>
          );
        })}
      </nav>

      {/* projects */}
      <div style={{ marginTop: 22 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 10px 8px",
          color: t.mute, fontSize: 10, letterSpacing: ".12em", textTransform: "uppercase",
          fontWeight: 500 }}>
          <span>项目</span>
          <div style={{ flex: 1, borderTop: `0.5px solid ${t.divider}` }} />
          <Icon d={I.plus} size={11} stroke={t.mute} />
        </div>
        {projects.map((p, i) => (
          <div key={i} style={{
            display: "flex", alignItems: "center", gap: 8,
            padding: "6px 10px", borderRadius: 3, cursor: "pointer",
            color: p.on ? t.ink : t.inkSoft, fontSize: 12,
            background: p.on ? t.bgDeep : "transparent",
          }}>
            <Icon d={I.folder} size={13} stroke={p.on ? t.sage : t.mute} />
            <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis",
              whiteSpace: "nowrap" }}>{p.ja}</span>
            <span style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: 9.5,
              color: t.muteSoft }}>{p.n}</span>
          </div>
        ))}
      </div>

      {/* recent tasks */}
      <div style={{ marginTop: 18 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 10px 8px",
          color: t.mute, fontSize: 10, letterSpacing: ".12em", textTransform: "uppercase",
          fontWeight: 500 }}>
          <span>最近</span>
          <div style={{ flex: 1, borderTop: `0.5px solid ${t.divider}` }} />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
          {recents.map((r, i) => (
            <div key={i} style={{
              display: "flex", alignItems: "center", gap: 8,
              padding: "6px 10px", borderRadius: 3, cursor: "pointer",
              background: i === 0 ? t.bgDeep : "transparent",
            }}>
              <span style={{ width: 5, height: 5, borderRadius: "50%",
                background: r.running ? t.clay : "transparent",
                border: r.running ? "none" : `1px solid ${t.muteSoft}`, flexShrink: 0,
                boxShadow: r.running ? `0 0 0 3px ${t.clay}22` : "none" }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 11.5, color: t.inkSoft, overflow: "hidden",
                  textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.ja}</div>
                <div style={{ fontSize: 9.5, color: t.muteSoft,
                  fontFamily: '"JetBrains Mono", monospace', marginTop: 1 }}>{r.time}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ flex: 1 }} />

      {/* tip card */}
      <div style={{
        background: t.bgDeep, border: `0.5px solid ${t.divider}`,
        borderRadius: 4, padding: "10px 12px", marginBottom: 10, cursor: "pointer",
        display: "flex", alignItems: "center", gap: 8,
      }}>
        <div style={{ width: 26, height: 26, borderRadius: 3,
          background: t.bgElev, border: `0.5px solid ${t.divider}`,
          display: "flex", alignItems: "center", justifyContent: "center",
          color: t.indigo, flexShrink: 0 }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="1.5"><rect x="3" y="4" width="18" height="12" rx="1"/>
            <path d="M2 20h20M8 16l-1 4M16 16l1 4"/></svg>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 11.5, color: t.ink, fontWeight: 500 }}>桌面端 · 即将上线</div>
          <div style={{ fontSize: 10, color: t.muteSoft,
            fontFamily: '"JetBrains Mono", monospace', marginTop: 1 }}>
            macOS / Windows
          </div>
        </div>
        <Icon d={I.chev} size={12} stroke={t.mute} />
      </div>

      {/* user + footer icons */}
      <div style={{ display: "flex", alignItems: "center", gap: 8,
        padding: "10px 4px 2px", borderTop: `0.5px solid ${t.divider}` }}>
        <div style={{ width: 24, height: 24, borderRadius: "50%",
          background: t.sage, color: t.bgElev, display: "flex",
          alignItems: "center", justifyContent: "center", fontSize: 10.5,
          fontFamily: 'Inter, system-ui, sans-serif', fontWeight: 600 }}>Y</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 11, color: t.inkSoft }}>本地用户</div>
          <div style={{ fontSize: 9, color: t.muteSoft,
            fontFamily: '"JetBrains Mono", monospace' }}>sqlite · local</div>
        </div>
        <div style={{ display: "flex", gap: 2, color: t.mute }}>
          <div style={{ width: 22, height: 22, display: "flex", alignItems: "center",
            justifyContent: "center", cursor: "pointer", borderRadius: 3 }}>
            <Icon d={I.cog} size={13} />
          </div>
        </div>
      </div>
    </aside>
  );
};

// ─── TopBar (in main column) ─────────────────────────────────────────────────
const TopBar = ({ crumbs = [], right }) => {
  const t = useT();
  return (
    <div style={{
      height: 44, flexShrink: 0, display: "flex", alignItems: "center",
      padding: "0 24px", borderBottom: `0.5px solid ${t.dividerSoft}`,
      gap: 10,
    }}>
      {crumbs.map((c, i) => (
        <React.Fragment key={i}>
          {i > 0 && <span style={{ color: t.muteSoft, fontFamily: '"JetBrains Mono", monospace',
            fontSize: 11 }}>/</span>}
          <span style={{ fontSize: 12, color: i === crumbs.length - 1 ? t.ink : t.mute,
            fontWeight: i === crumbs.length - 1 ? 500 : 400 }}>{c}</span>
        </React.Fragment>
      ))}
      <div style={{ flex: 1 }} />
      {right}
    </div>
  );
};

// ════════════════════════════════════════════════════════════════════════════
// SCREEN A — Empty workspace (welcome / new task) — prompt-first, centered
// ════════════════════════════════════════════════════════════════════════════
const ScreenA_Empty = () => {
  const t = useT();
  const reco = [
    { ja: "零代码做一份个人网站或作品集",      tag: "网页" },
    { ja: "把任何话题或竞品自动设为每日监控",  tag: "调研", soon: true },
    { ja: "用 dashboard 跟踪你的健康与健身",  tag: "数据" },
  ];
  const chips = [
    { ja: "制作幻灯片", icon: I.pptx },
    { ja: "创建网页",   icon: I.html },
    { ja: "调研 + Excel", icon: I.excel },
    { ja: "写代码",     icon: I.terminal },
    { ja: "分析文档",   icon: I.file },
    { ja: "更多",       icon: I.more },
  ];
  return (
    <Screen>
      <LeftRail active="home" />
      <main style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0,
        background: t.bg }}>
        {/* Header bar — model selector left, credits & avatar right */}
        <div style={{ height: 52, flexShrink: 0, display: "flex", alignItems: "center",
          padding: "0 24px", borderBottom: `0.5px solid ${t.dividerSoft}`, gap: 12 }}>
          {/* Model selector */}
          <div style={{ display: "flex", alignItems: "center", gap: 8,
            padding: "6px 10px 6px 8px", border: `0.5px solid ${t.divider}`,
            borderRadius: 4, background: t.bgElev, cursor: "pointer" }}>
            <span style={{ width: 18, height: 18, borderRadius: 3, background: t.indigo,
              color: t.bgElev, display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 10, fontWeight: 600, letterSpacing: 0,
              fontFamily: 'Inter, system-ui, sans-serif' }}>A</span>
            <span style={{ fontFamily: 'Inter, "Noto Sans SC", system-ui, sans-serif', fontSize: 13.5,
              color: t.ink, fontWeight: 500 }}>Claude 4.5 Sonnet</span>
            <span style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: 9.5,
              color: t.sage, border: `0.5px solid ${t.sage}`, padding: "1px 5px",
              borderRadius: 2, letterSpacing: ".08em" }}>FAST</span>
            <Icon d={I.chevD} size={13} stroke={t.mute} />
          </div>
          <div style={{ flex: 1 }} />
          {/* Plan + credits */}
          <div style={{ display: "flex", alignItems: "center", gap: 14,
            fontFamily: '"JetBrains Mono", monospace', fontSize: 11, color: t.mute }}>
            <span>免费计划</span>
            <span style={{ width: 0.5, height: 12, background: t.divider }} />
            <span style={{ color: t.ink, cursor: "pointer", letterSpacing: ".02em",
              borderBottom: `0.5px solid ${t.ink}` }}>开始免费试用</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6,
            padding: "5px 10px", border: `0.5px solid ${t.divider}`, borderRadius: 999,
            background: t.bgElev }}>
            <Icon d={I.spark} size={12} stroke={t.clay} fill={t.clay} />
            <span style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: 11,
              color: t.ink, fontWeight: 500 }}>1,300</span>
          </div>
          <div style={{ width: 28, height: 28, color: t.mute, display: "flex",
            alignItems: "center", justifyContent: "center", position: "relative", cursor: "pointer" }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="1.5"><path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/>
              <path d="M10 21a2 2 0 0 0 4 0"/></svg>
            <span style={{ position: "absolute", top: 4, right: 5, width: 5, height: 5,
              borderRadius: "50%", background: t.clay }} />
          </div>
          <div style={{ width: 28, height: 28, borderRadius: "50%",
            background: t.sage, color: t.bgElev, display: "flex",
            alignItems: "center", justifyContent: "center", fontSize: 12,
            fontFamily: 'Inter, "Noto Sans SC", system-ui, sans-serif' }}>洋</div>
        </div>

        {/* Body — centered prompt-first */}
        <div style={{ flex: 1, overflow: "auto", display: "flex", justifyContent: "center" }}>
          <div style={{ width: "100%", maxWidth: 820, padding: "76px 40px 40px",
            display: "flex", flexDirection: "column" }}>

            {/* small line above */}
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 22,
              justifyContent: "center" }}>
              <BrandMark size={20} />
              <span style={{ fontFamily: 'Inter, system-ui, sans-serif', fontSize: 12,
                color: t.mute, letterSpacing: ".04em", fontWeight: 500 }}>FOLIO</span>
              <span style={{ width: 0.5, height: 10, background: t.divider, margin: "0 2px" }} />
              <span style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: 11,
                color: t.muteSoft, letterSpacing: ".05em" }}>TUE · 14:32</span>
            </div>

            {/* big greeting */}
            <h1 style={{ margin: "0 0 44px", fontFamily: 'Inter, "Noto Sans SC", system-ui, sans-serif',
              fontWeight: 600, fontSize: 38, color: t.ink, letterSpacing: "-.01em",
              lineHeight: 1.2, textAlign: "center" }}>
              我能为你做什么？
            </h1>

            {/* Prompt input — big and spacious */}
            <div style={{
              background: t.bgElev, border: `0.5px solid ${t.divider}`,
              borderRadius: 8, padding: "16px 18px",
              boxShadow: "0 1px 0 #fff inset, 0 12px 32px rgba(60,45,20,.06)",
              marginBottom: 16,
            }}>
              <div style={{
                minHeight: 80, color: t.inkSoft, fontSize: 14.5, lineHeight: 1.7,
              }}>
                <span style={{ color: t.muteSoft }}>说一句话，FOLIO 会替你拆解、调研、动手——产出可下载的 Excel／PPT／网页／代码。</span>
                <span style={{
                  display: "inline-block", width: 1, height: 16, background: t.ink,
                  verticalAlign: "text-bottom", marginLeft: 1,
                }} />
              </div>
              <div style={{
                display: "flex", alignItems: "center", gap: 6, marginTop: 14,
                paddingTop: 12, borderTop: `0.5px dashed ${t.divider}`,
              }}>
                <button style={{
                  width: 32, height: 32, borderRadius: "50%", border: `0.5px solid ${t.divider}`,
                  background: t.bgElev, color: t.inkSoft, display: "flex", alignItems: "center",
                  justifyContent: "center", cursor: "pointer",
                }}><Icon d={I.plus} size={14} /></button>
                <button style={{
                  width: 32, height: 32, borderRadius: "50%", border: `0.5px solid ${t.divider}`,
                  background: t.bgElev, color: t.inkSoft, display: "flex", alignItems: "center",
                  justifyContent: "center", cursor: "pointer",
                }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                    strokeWidth="1.5"><circle cx="6" cy="8" r="2"/><circle cx="18" cy="16" r="2"/>
                    <path d="M8 8h10M6 16h10"/></svg>
                </button>
                <div style={{ display: "inline-flex", alignItems: "center", gap: 7,
                  padding: "6px 12px 6px 10px", border: `0.5px solid ${t.divider}`,
                  borderRadius: 999, color: t.inkSoft, fontSize: 11.5, cursor: "pointer" }}>
                  <Icon d={I.terminal} size={13} stroke={t.mute} />
                  <span>沙盒</span>
                  <span style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: 9,
                    color: t.clay, background: `${t.clay}18`, padding: "1px 5px", borderRadius: 2,
                    letterSpacing: ".08em" }}>NEW</span>
                </div>
                <div style={{ flex: 1 }} />
                <span style={{ color: t.muteSoft, fontFamily: '"JetBrains Mono", monospace',
                  fontSize: 10, marginRight: 4 }}>⏎ 发送</span>
                <button style={{
                  width: 32, height: 32, borderRadius: "50%", border: 0,
                  background: t.ink, color: t.bgElev, display: "flex", alignItems: "center",
                  justifyContent: "center", cursor: "pointer",
                }}><Icon d={I.send} size={14} stroke={t.bgElev} /></button>
              </div>
            </div>

            {/* For you — 3 suggestion cards */}
            <div style={{ marginTop: 30, marginBottom: 22 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10,
                marginBottom: 12 }}>
                <span style={{ fontFamily: 'Inter, "Noto Sans SC", system-ui, sans-serif',
                  fontSize: 12.5, color: t.ink, fontWeight: 600 }}>为你推荐</span>
                <div style={{ flex: 1, borderTop: `0.5px solid ${t.divider}` }} />
                <Icon d={I.refresh} size={12} stroke={t.mute} />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                {reco.map((r, i) => (
                  <div key={i} style={{
                    background: t.bgElev, border: `0.5px solid ${t.divider}`,
                    borderRadius: 6, padding: "14px 14px 12px", cursor: "pointer",
                    display: "flex", flexDirection: "column", gap: 14,
                    minHeight: 92,
                  }}>
                    <div style={{ fontSize: 12.5, color: t.inkSoft, lineHeight: 1.55 }}>
                      {r.ja}
                    </div>
                    <div style={{ marginTop: "auto", display: "flex", alignItems: "center",
                      justifyContent: "space-between" }}>
                      <span style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: 9.5,
                        color: r.soon ? t.clay : t.mute, letterSpacing: ".08em" }}>
                        {r.tag.toUpperCase()}{r.soon && " · SOON"}
                      </span>
                      <Icon d={I.arrowR} size={12} stroke={t.mute} />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Action chips row */}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8,
              justifyContent: "center", marginBottom: 30 }}>
              {chips.map((c, i) => (
                <div key={i} style={{
                  display: "inline-flex", alignItems: "center", gap: 7,
                  padding: "8px 14px", borderRadius: 999,
                  border: `0.5px solid ${t.divider}`, background: t.bgElev,
                  fontSize: 12, color: t.inkSoft, cursor: "pointer",
                }}>
                  <Icon d={c.icon} size={13} stroke={t.mute} />
                  <span>{c.ja}</span>
                </div>
              ))}
            </div>

            {/* Bottom promo carousel */}
            <div style={{
              background: t.bgDeep, border: `0.5px solid ${t.divider}`,
              borderRadius: 6, padding: 16, display: "flex", alignItems: "center",
              gap: 18, marginTop: "auto",
            }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontFamily: 'Inter, "Noto Sans SC", system-ui, sans-serif', fontSize: 14,
                  color: t.ink, fontWeight: 600, marginBottom: 4 }}>
                  桌面端 · for macOS / Windows
                </div>
                <div style={{ fontSize: 11.5, color: t.inkSoft, lineHeight: 1.55 }}>
                  访问本地文件，与桌面无缝协作。<span style={{ color: t.mute }}>v2 即将上线</span>
                </div>
              </div>
              {/* mini preview frame */}
              <div style={{ width: 140, height: 84, background: t.bgElev,
                border: `0.5px solid ${t.divider}`, borderRadius: 3, padding: 6,
                display: "flex", flexDirection: "column", gap: 4, flexShrink: 0 }}>
                <div style={{ display: "flex", gap: 3 }}>
                  {["#e08274","#e8c374","#7ab27a"].map((c, i) => (
                    <span key={i} style={{ width: 6, height: 6, borderRadius: "50%",
                      background: c, opacity: 0.6 }} />
                  ))}
                </div>
                <div style={{ flex: 1, background: t.bgDeep, borderRadius: 2,
                  padding: 6, display: "flex", flexDirection: "column", gap: 3 }}>
                  <div style={{ height: 4, width: "70%", background: t.divider, borderRadius: 1 }} />
                  <div style={{ height: 3, width: "90%", background: t.dividerSoft, borderRadius: 1 }} />
                  <div style={{ height: 3, width: "85%", background: t.dividerSoft, borderRadius: 1 }} />
                  <div style={{ height: 3, width: "60%", background: t.dividerSoft, borderRadius: 1 }} />
                </div>
              </div>
              <Icon d={I.download} size={16} stroke={t.mute} />
              {/* dots */}
              <div style={{ position: "absolute" }} />
            </div>
            <div style={{ display: "flex", justifyContent: "center", gap: 5, marginTop: 12 }}>
              {[0,1,2,3].map(i => (
                <span key={i} style={{ width: i === 0 ? 14 : 5, height: 5, borderRadius: 999,
                  background: i === 0 ? t.ink : t.divider, transition: "all .2s" }} />
              ))}
            </div>
          </div>
        </div>
      </main>
    </Screen>
  );
};

Object.assign(window, { LeftRail, TopBar, ScreenA_Empty });

// ════════════════════════════════════════════════════════════════════════════
// Shared running-task data
// ════════════════════════════════════════════════════════════════════════════
const SAMPLE_PROMPT = "调研中国新能源车前五家公司（销量排序），生成对比 Excel + 5 页汇报 PPT + 一页 dashboard 网页";
const SAMPLE_TASK_ID = "tsk_8f2a1c";

const STEPS = [
  { kind: "think",   ja: "拆解任务",    en: "decompose",      tool: null,            done: true,
    body: "需要：① 找出 2024 销量前五品牌 ② 抓官网+财报关键指标 ③ 写多表 Excel ④ 出汇报 PPT ⑤ 静态 dashboard。先建产物目录，再串行执行。",
    meta: "1.2s · 612 tok · cache 84%" },
  { kind: "act",     ja: "建产物目录",  en: "shell",          tool: "shell.exec",    done: true,
    body: "mkdir -p workspace/tsk_8f2a1c/{artifacts,tmp}",
    meta: "0.3s · stdout 2 行" },
  { kind: "act",     ja: "联网搜索",    en: "web_search",     tool: "web_search",    done: true,
    body: 'q = "2024 中国新能源车 销量 前五 排名"',
    meta: "1.8s · 12 条结果" },
  { kind: "obs",     ja: "整理候选",    en: "observe",        tool: null,            done: true,
    body: "比亚迪 / 特斯拉中国 / 吉利 / 长安 / 上汽通用五菱 — 三处来源交叉验证，命中。",
    meta: "0.9s · cache 91%" },
  { kind: "act",     ja: "浏览器抓取",  en: "browser",        tool: "browser.fetch", done: true,
    body: "goto https://www.cnautonews.com/...\nextract: brand, monthly_sales, yoy, model_count",
    meta: "5 个页面 · 3.4s" },
  { kind: "act",     ja: "写中间笔记",  en: "file_write",     tool: "file.write",    done: true,
    body: "tmp/notes.md · 写入 1.2k 字结构化摘要（KV-cache 友好 · 不入 system prompt）",
    meta: "0.1s" },
  { kind: "act",     ja: "生成 Excel",  en: "artifacts",      tool: "generate_excel",done: false, active: true,
    body: "artifacts/对比表.xlsx · 3 sheet（销量 / 车型 / 财务） · 含 SUM 公式",
    meta: "写入中…" },
  { kind: "act",     ja: "渲染 PPT",    en: "artifacts",      tool: "generate_pptx", done: false, pending: true,
    body: "5 页 · 封面／市场总览／销量／车型对比／结论",
    meta: "待开始" },
  { kind: "act",     ja: "打 dashboard",en: "artifacts",      tool: "generate_html", done: false, pending: true,
    body: "单页静态网页 · 内联 CSS+ECharts",
    meta: "待开始" },
];

// ─── Right rail — live sandbox view (file tree + browser preview) ────────────
const LiveSandbox = () => {
  const t = useT();
  const tree = [
    { d: 0, name: "workspace/", kind: "folder", soft: true },
    { d: 1, name: "tsk_8f2a1c/", kind: "folder" },
    { d: 2, name: "artifacts/", kind: "folder", accent: true },
    { d: 3, name: "对比表.xlsx", kind: "xlsx", writing: true },
    { d: 3, name: "汇报.pptx",    kind: "pptx", soft: true },
    { d: 3, name: "dashboard.html", kind: "html", soft: true },
    { d: 2, name: "tmp/", kind: "folder" },
    { d: 3, name: "notes.md", kind: "md" },
    { d: 3, name: "raw_byd.json", kind: "json" },
    { d: 3, name: "raw_tesla.json", kind: "json" },
    { d: 3, name: "screenshot_01.png", kind: "img" },
    { d: 3, name: "screenshot_02.png", kind: "img" },
  ];
  const iconFor = (k) => ({ folder: I.folder, xlsx: I.excel, pptx: I.pptx, html: I.html,
    json: I.file, md: I.page, img: I.img }[k] || I.file);
  return (
    <aside style={{
      width: 340, flexShrink: 0, borderLeft: `0.5px solid ${t.divider}`,
      background: t.bgElev, display: "flex", flexDirection: "column",
      overflow: "hidden",
    }}>
      {/* tabs */}
      <div style={{ display: "flex", borderBottom: `0.5px solid ${t.divider}`,
        padding: "0 14px", gap: 18, flexShrink: 0 }}>
        {[
          { ja: "沙盒文件", en: "files", on: true },
          { ja: "浏览器", en: "browser" },
          { ja: "终端", en: "term" },
        ].map((tab, i) => (
          <div key={i} style={{
            padding: "12px 0", borderBottom: `1.5px solid ${tab.on ? t.ink : "transparent"}`,
            display: "flex", alignItems: "center", gap: 6, cursor: "pointer",
          }}>
            <span style={{ fontSize: 12, color: tab.on ? t.ink : t.mute,
              fontWeight: tab.on ? 500 : 400 }}>{tab.ja}</span>
          </div>
        ))}
        <div style={{ flex: 1 }} />
        <div style={{ padding: "12px 0", color: t.mute, fontSize: 12 }}>
          <Icon d={I.refresh} size={13} />
        </div>
      </div>

      {/* file tree */}
      <div style={{ flex: 1, overflow: "auto", padding: "10px 8px",
        fontFamily: '"JetBrains Mono", monospace', fontSize: 11 }}>
        {tree.map((n, i) => (
          <div key={i} style={{
            display: "flex", alignItems: "center", gap: 6,
            padding: "3px 8px", paddingLeft: 8 + n.d * 14, borderRadius: 2,
            background: n.writing ? `${t.clay}12` : "transparent",
            color: n.soft ? t.muteSoft : t.inkSoft,
          }}>
            <Icon d={iconFor(n.kind)} size={12}
              stroke={n.kind === "folder" && n.accent ? t.sage :
                (n.soft ? t.muteSoft : (n.kind === "folder" ? t.mute : t.inkSoft))} />
            <span>{n.name}</span>
            {n.writing && <span style={{ marginLeft: "auto", color: t.clay, fontSize: 9,
              letterSpacing: ".08em" }}>WRITING…</span>}
          </div>
        ))}
      </div>

      {/* preview: current browser shot — pencil-hatch placeholder */}
      <div style={{ borderTop: `0.5px solid ${t.divider}`, padding: 14,
        background: t.bgDeep, flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8,
          fontSize: 10, color: t.mute, fontFamily: '"JetBrains Mono", monospace',
          letterSpacing: ".1em", textTransform: "uppercase" }}>
          <span>当前浏览器</span>
          <span style={{ marginLeft: "auto", color: t.muteSoft }}>03/05</span>
        </div>
        <div style={{ background: t.bgElev, border: `0.5px solid ${t.divider}`,
          borderRadius: 3, padding: 8 }}>
          <div style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: 9,
            color: t.muteSoft, marginBottom: 6, overflow: "hidden", textOverflow: "ellipsis",
            whiteSpace: "nowrap" }}>
            cnautonews.com/2024/q4-rankings
          </div>
          <svg viewBox="0 0 280 140" style={{ width: "100%", display: "block" }}>
            <defs><Hatch id="hp" color={t.divider} /></defs>
            <rect width="280" height="140" fill={t.bgDeep} />
            <rect x="0" y="0" width="280" height="22" fill={t.bgRail} />
            <rect x="8" y="8" width="60" height="6" fill={t.divider} />
            <rect x="14" y="36" width="100" height="6" fill={t.ink} opacity=".7" />
            <rect x="14" y="48" width="180" height="3" fill={t.divider} />
            <rect x="14" y="56" width="160" height="3" fill={t.divider} />
            <rect x="14" y="72" width="252" height="50" fill="url(#hp)" />
            <text x="140" y="100" textAnchor="middle" fontFamily="JetBrains Mono" fontSize="9"
              fill={t.mute}>chart · sales by brand</text>
          </svg>
        </div>
      </div>
    </aside>
  );
};

Object.assign(window, { LiveSandbox, STEPS, SAMPLE_PROMPT, SAMPLE_TASK_ID });

// ─── Task header (shared) ────────────────────────────────────────────────────
const TaskHeader = ({ status = "running" }) => {
  const t = useT();
  const tones = {
    running:  { ja: "进行中", en: "running",  color: t.clay, dot: true },
    done:     { ja: "已完成", en: "finished", color: t.sage, dot: false },
    failed:   { ja: "失败",   en: "failed",   color: t.err,  dot: false },
  }[status];
  return (
    <div style={{ padding: "24px 32px 18px", borderBottom: `0.5px solid ${t.dividerSoft}` }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
        <span style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: 10,
          color: t.muteSoft, letterSpacing: ".08em" }}>{SAMPLE_TASK_ID} · started 14:31:08</span>
        <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center",
          gap: 6, color: tones.color, fontSize: 11, fontWeight: 500 }}>
          {tones.dot && <span style={{ width: 7, height: 7, borderRadius: "50%",
            background: tones.color, boxShadow: `0 0 0 4px ${tones.color}1a`,
            animation: "p 1.4s infinite" }} />}
          <span>{tones.ja}</span>
        </span>
      </div>
      <div style={{ fontFamily: 'Inter, "Noto Sans SC", system-ui, sans-serif', fontSize: 19, color: t.ink,
        lineHeight: 1.5, fontWeight: 500, letterSpacing: "-.005em" }}>
        {SAMPLE_PROMPT}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 14,
        fontSize: 11, color: t.mute, fontFamily: '"JetBrains Mono", monospace',
        letterSpacing: ".03em" }}>
        <span>step <b style={{ color: t.ink }}>07</b>/12</span>
        <span style={{ color: t.muteSoft }}>·</span>
        <span>elapsed <b style={{ color: t.ink }}>4m 21s</b></span>
        <span style={{ color: t.muteSoft }}>·</span>
        <span>tok in <b style={{ color: t.ink }}>11.2k</b></span>
        <span style={{ color: t.muteSoft }}>·</span>
        <span>cache hit <b style={{ color: t.sage }}>78%</b></span>
        <span style={{ color: t.muteSoft }}>·</span>
        <span>cost <b style={{ color: t.ink }}>$0.18</b></span>
        <div style={{ flex: 1 }} />
        <Btn kind="ghost" icon={I.pause} size="sm">暂停</Btn>
        <Btn kind="outline" icon={I.stop} size="sm">中止</Btn>
      </div>
      <style>{`@keyframes p { 0%,100%{opacity:1} 50%{opacity:.4} }`}</style>
    </div>
  );
};

// ════════════════════════════════════════════════════════════════════════════
// SCREEN B — Running task, timeline variant
// ════════════════════════════════════════════════════════════════════════════
const ScreenB_Timeline = () => {
  const t = useT();
  const kindMeta = {
    think: { ja: "思", color: t.indigo, bg: `${t.indigo}14` },
    act:   { ja: "动", color: t.clay,   bg: `${t.clay}14` },
    obs:   { ja: "观", color: t.sage,   bg: `${t.sage}14` },
  };
  return (
    <Screen>
      <LeftRail active="home" />
      <main style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        <TopBar crumbs={["主页", "新能源车前五调研"]} right={
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <Chip tone="soft">timeline</Chip>
            <Btn kind="ghost" icon={I.layers} size="sm">切卡片视图</Btn>
            <Btn kind="ghost" icon={I.copy} size="sm">分享</Btn>
          </div>
        } />
        <TaskHeader status="running" />

        {/* timeline */}
        <div style={{ flex: 1, overflow: "auto", padding: "20px 32px 40px" }}>
          <div style={{ position: "relative", paddingLeft: 38 }}>
            <div style={{ position: "absolute", left: 12, top: 6, bottom: 6, width: 0.5,
              background: `linear-gradient(${t.divider}, ${t.divider} 75%, ${t.dividerSoft})` }} />
            {STEPS.map((s, i) => {
              const km = kindMeta[s.kind];
              const isActive = s.active;
              const isPending = s.pending;
              return (
                <div key={i} style={{
                  position: "relative", marginBottom: 22,
                  opacity: isPending ? 0.4 : 1,
                }}>
                  {/* node */}
                  <div style={{
                    position: "absolute", left: -33, top: 2,
                    width: 22, height: 22, borderRadius: "50%",
                    background: t.bg, border: `0.5px solid ${km.color}`,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    color: km.color, fontSize: 10, fontFamily: 'Inter, "Noto Sans SC", system-ui, sans-serif',
                    boxShadow: isActive ? `0 0 0 5px ${km.color}1c` : "none",
                  }}>{km.ja}</div>
                  {/* row 1 */}
                  <div style={{ display: "flex", alignItems: "baseline", gap: 10,
                    marginBottom: 5 }}>
                    <span style={{ fontFamily: 'Inter, "Noto Sans SC", system-ui, sans-serif', fontSize: 14,
                      color: t.ink, fontWeight: 500 }}>{s.ja}</span>
                    {s.tool && <span style={{ fontFamily: '"JetBrains Mono", monospace',
                      fontSize: 10, color: t.mute, background: t.bgDeep,
                      padding: "2px 6px", borderRadius: 2 }}>{s.tool}</span>}
                    <div style={{ flex: 1 }} />
                    <span style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: 10,
                      color: isActive ? t.clay : t.muteSoft }}>{s.meta}</span>
                  </div>
                  {/* body */}
                  <div style={{
                    background: km.bg, border: `0.5px solid ${km.color}25`,
                    borderRadius: 3, padding: "10px 12px", color: t.inkSoft,
                    fontSize: 12.5, lineHeight: 1.65,
                    fontFamily: s.kind === "act" && s.tool && s.tool !== "browser.fetch"
                      ? '"JetBrains Mono", monospace' : 'Inter, "Noto Sans SC", system-ui, sans-serif',
                  }}>{s.body}</div>
                </div>
              );
            })}
            {/* current cursor */}
            <div style={{ position: "relative", paddingTop: 4, color: t.mute,
              fontSize: 11, fontFamily: '"JetBrains Mono", monospace' }}>
              <div style={{ position: "absolute", left: -33, top: 6,
                width: 22, height: 22, borderRadius: "50%",
                border: `0.5px dashed ${t.divider}`, display: "flex",
                alignItems: "center", justifyContent: "center", color: t.muteSoft, fontSize: 10 }}>…</div>
              <span>等待下一步思考</span>
            </div>
          </div>
        </div>

        {/* bottom input — interjection */}
        <div style={{ padding: "12px 32px 16px", borderTop: `0.5px solid ${t.dividerSoft}`,
          display: "flex", alignItems: "center", gap: 10 }}>
          <Icon d={I.send} size={14} stroke={t.mute} />
          <input placeholder="插一句话给 FOLIO（不会重启任务）"
            style={{ flex: 1, border: 0, background: "transparent",
              fontSize: 12.5, color: t.inkSoft, outline: "none",
              fontFamily: 'Inter, "Noto Sans SC", system-ui, sans-serif' }} />
          <Chip tone="soft">⏎ 追加</Chip>
        </div>
      </main>
      <LiveSandbox />
    </Screen>
  );
};

// ════════════════════════════════════════════════════════════════════════════
// SCREEN C — Running task, card stack variant
// ════════════════════════════════════════════════════════════════════════════
const ScreenC_Cards = () => {
  const t = useT();
  const kindMeta = {
    think: { ja: "思考",  en: "think",   color: t.indigo },
    act:   { ja: "动作",  en: "act",     color: t.clay },
    obs:   { ja: "观察",  en: "observe", color: t.sage },
  };
  return (
    <Screen>
      <LeftRail active="home" />
      <main style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        <TopBar crumbs={["主页", "新能源车前五调研"]} right={
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <Chip tone="soft">cards</Chip>
            <Btn kind="ghost" icon={I.layers} size="sm">切时间线</Btn>
            <Btn kind="ghost" icon={I.copy} size="sm">分享</Btn>
          </div>
        } />
        <TaskHeader status="running" />

        <div style={{ flex: 1, overflow: "auto", padding: "20px 32px 40px",
          display: "flex", flexDirection: "column", gap: 12 }}>
          {STEPS.map((s, i) => {
            const km = kindMeta[s.kind];
            const isActive = s.active;
            const isPending = s.pending;
            return (
              <div key={i} style={{
                background: t.bgElev, border: `0.5px solid ${isActive ? km.color : t.divider}`,
                borderLeft: `2px solid ${km.color}`,
                borderRadius: 3, padding: "12px 16px",
                opacity: isPending ? 0.45 : 1,
                boxShadow: isActive ? `0 4px 16px ${km.color}18` : t.paperShadow,
                position: "relative",
              }}>
                {/* corner step number */}
                <div style={{ position: "absolute", top: -8, right: 14,
                  background: t.bg, padding: "0 6px", color: t.mute,
                  fontFamily: '"JetBrains Mono", monospace', fontSize: 10,
                  letterSpacing: ".08em" }}>
                  step · {String(i + 1).padStart(2, "0")}
                </div>
                <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 6 }}>
                  <span style={{
                    color: km.color, fontFamily: 'Inter, "Noto Sans SC", system-ui, sans-serif',
                    fontSize: 12, fontWeight: 600, letterSpacing: ".02em",
                  }}>{km.ja}</span>
                  <span style={{ fontFamily: 'Inter, "Noto Sans SC", system-ui, sans-serif', fontSize: 14,
                    color: t.ink, fontWeight: 500 }}>{s.ja}</span>
                  {s.tool && (
                    <span style={{ fontFamily: '"JetBrains Mono", monospace',
                      fontSize: 10, color: t.inkSoft, background: t.bgDeep,
                      padding: "2px 6px", borderRadius: 2 }}>{s.tool}</span>
                  )}
                  <div style={{ flex: 1 }} />
                  <span style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: 10,
                    color: isActive ? t.clay : t.muteSoft }}>{s.meta}</span>
                </div>
                <div style={{
                  color: t.inkSoft, fontSize: 12.5, lineHeight: 1.65,
                  fontFamily: s.kind === "act" && s.tool && s.tool !== "browser.fetch"
                    ? '"JetBrains Mono", monospace' : 'Inter, "Noto Sans SC", system-ui, sans-serif',
                  whiteSpace: "pre-wrap",
                }}>{s.body}</div>
              </div>
            );
          })}
        </div>

        <div style={{ padding: "12px 32px 16px", borderTop: `0.5px solid ${t.dividerSoft}`,
          display: "flex", alignItems: "center", gap: 10 }}>
          <Icon d={I.send} size={14} stroke={t.mute} />
          <input placeholder="插一句话给 FOLIO"
            style={{ flex: 1, border: 0, background: "transparent",
              fontSize: 12.5, color: t.inkSoft, outline: "none",
              fontFamily: 'Inter, "Noto Sans SC", system-ui, sans-serif' }} />
          <Chip tone="soft">⏎ 追加</Chip>
        </div>
      </main>
      <LiveSandbox />
    </Screen>
  );
};

// ════════════════════════════════════════════════════════════════════════════
// SCREEN D — Completed task with deliverables grid
// ════════════════════════════════════════════════════════════════════════════
const ScreenD_Done = () => {
  const t = useT();
  const artifacts = [
    {
      kind: "xlsx", ja: "新能源车对比表", filename: "对比表.xlsx",
      size: "84 KB", note: "3 sheet · 含 SUM/AVG 公式 · 可二次编辑",
      preview: "table",
    },
    {
      kind: "pptx", ja: "市场汇报 PPT", filename: "汇报.pptx",
      size: "1.2 MB", note: "5 页 · 16:9 · 内嵌图表",
      preview: "slides",
    },
    {
      kind: "html", ja: "Dashboard 网页", filename: "dashboard.html",
      size: "62 KB", note: "单文件 · 内联 CSS+ECharts · 双击可开",
      preview: "dash",
    },
  ];

  const previews = {
    table: (
      <svg viewBox="0 0 280 130" style={{ width: "100%", display: "block" }}>
        <rect width="280" height="130" fill={t.bgDeep} />
        {[0,1,2,3,4,5].map((r) => (
          <rect key={r} x="10" y={10 + r * 18} width="260" height="14"
            fill={r === 0 ? t.divider : t.bgElev} stroke={t.dividerSoft} strokeWidth="0.5"/>
        ))}
        {[0,1,2,3,4].map((c) => (
          <line key={c} x1={10 + c * 52} y1="10" x2={10 + c * 52} y2="118"
            stroke={t.dividerSoft} strokeWidth="0.5"/>
        ))}
        <text x="32" y="22" fontSize="7" fill={t.ink} fontFamily="JetBrains Mono">brand</text>
        <text x="84" y="22" fontSize="7" fill={t.ink} fontFamily="JetBrains Mono">sales</text>
        <text x="136" y="22" fontSize="7" fill={t.ink} fontFamily="JetBrains Mono">yoy</text>
        <text x="188" y="22" fontSize="7" fill={t.ink} fontFamily="JetBrains Mono">models</text>
        <text x="240" y="22" fontSize="7" fill={t.ink} fontFamily="JetBrains Mono">share</text>
      </svg>
    ),
    slides: (
      <svg viewBox="0 0 280 130" style={{ width: "100%", display: "block" }}>
        <rect width="280" height="130" fill={t.bgDeep} />
        {[0,1,2,3,4].map((i) => (
          <g key={i} transform={`translate(${14 + i * 52}, 14)`}>
            <rect width="48" height="34" fill={t.bgElev} stroke={t.divider} strokeWidth="0.5"/>
            <rect x="4" y="4" width="20" height="2.5" fill={t.ink}/>
            <rect x="4" y="9" width="40" height="1.5" fill={t.divider}/>
            <rect x="4" y="12" width="36" height="1.5" fill={t.divider}/>
            <rect x="4" y="18" width="40" height="12" fill={i % 2 ? `${t.sage}55` : `${t.clay}55`}/>
            <text x="24" y="48" textAnchor="middle" fontSize="6" fill={t.mute}
              fontFamily="JetBrains Mono">P{i+1}</text>
          </g>
        ))}
        <rect x="14" y="68" width="252" height="50" fill={t.bgElev} stroke={t.divider} strokeWidth="0.5"/>
        <text x="22" y="82" fontSize="8" fill={t.ink} fontFamily="Noto Serif JP">市场总览</text>
        <rect x="22" y="88" width="80" height="22" fill={`${t.sage}55`} />
        <rect x="106" y="88" width="50" height="22" fill={`${t.clay}55`} />
        <rect x="160" y="98" width="100" height="2" fill={t.divider}/>
        <rect x="160" y="103" width="80" height="2" fill={t.divider}/>
        <rect x="160" y="108" width="90" height="2" fill={t.divider}/>
      </svg>
    ),
    dash: (
      <svg viewBox="0 0 280 130" style={{ width: "100%", display: "block" }}>
        <rect width="280" height="130" fill={t.bgDeep} />
        <rect x="10" y="10" width="80" height="34" fill={t.bgElev} stroke={t.divider} strokeWidth="0.5"/>
        <rect x="94" y="10" width="80" height="34" fill={t.bgElev} stroke={t.divider} strokeWidth="0.5"/>
        <rect x="178" y="10" width="92" height="34" fill={t.bgElev} stroke={t.divider} strokeWidth="0.5"/>
        <text x="16" y="22" fontSize="6" fill={t.mute} fontFamily="JetBrains Mono">YTD SALES</text>
        <text x="16" y="38" fontSize="14" fill={t.ink} fontFamily="Noto Serif JP">2.4M</text>
        <text x="100" y="22" fontSize="6" fill={t.mute} fontFamily="JetBrains Mono">YoY</text>
        <text x="100" y="38" fontSize="14" fill={t.sage} fontFamily="Noto Serif JP">+38%</text>
        <text x="184" y="22" fontSize="6" fill={t.mute} fontFamily="JetBrains Mono">MARKET SHARE</text>
        <text x="184" y="38" fontSize="14" fill={t.ink} fontFamily="Noto Serif JP">31.4%</text>
        <rect x="10" y="50" width="260" height="68" fill={t.bgElev} stroke={t.divider} strokeWidth="0.5"/>
        {[20,38,28,52,46,68,58].map((h, i) => (
          <rect key={i} x={20 + i * 34} y={112 - h} width="22" height={h}
            fill={i === 0 ? t.sage : `${t.sage}88`}/>
        ))}
      </svg>
    ),
  };
  const iconFor = (k) => ({ xlsx: I.excel, pptx: I.pptx, html: I.html }[k]);

  return (
    <Screen>
      <LeftRail active="home" />
      <main style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        <TopBar crumbs={["主页", "新能源车前五调研"]} right={
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <Btn kind="ghost" icon={I.layers} size="sm">查看步骤回放</Btn>
            <Btn kind="ghost" icon={I.copy} size="sm">分享</Btn>
            <Btn kind="primary" icon={I.refresh} size="sm">再跑一次</Btn>
          </div>
        } />
        <TaskHeader status="done" />

        <div style={{ flex: 1, overflow: "auto", padding: "24px 32px 40px" }}>
          {/* summary */}
          <Paper pad={18} style={{ marginBottom: 24, display: "flex", gap: 18, alignItems: "flex-start" }}>
            <div style={{ width: 40, height: 40, borderRadius: 4, background: `${t.sage}18`,
              border: `0.5px solid ${t.sage}40`, display: "flex", alignItems: "center",
              justifyContent: "center", color: t.sage, flexShrink: 0 }}>
              <Icon d={I.check} size={20} stroke={t.sage} />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontFamily: 'Inter, "Noto Sans SC", system-ui, sans-serif', fontSize: 16, color: t.ink,
                marginBottom: 6, fontWeight: 600 }}>任务已完成 · 三件交付物就绪</div>
              <div style={{ color: t.inkSoft, fontSize: 13, lineHeight: 1.7 }}>
                FOLIO 整理了五家品牌的 2024 销量、车型与市场份额，写入对比表；汇报 PPT 含市场总览与结论页；
                dashboard 网页可直接双击打开浏览器查看。
                <span style={{ color: t.mute }}>所有中间过程文件在 <code style={{
                  fontFamily: '"JetBrains Mono", monospace', fontSize: 11.5, color: t.inkSoft,
                  background: t.bgDeep, padding: "1px 5px", borderRadius: 2,
                }}>tmp/</code> 中，7 天后自动清理。</span>
              </div>
            </div>
            <Btn kind="sage" icon={I.zip} size="md">下载全部 (1.4 MB)</Btn>
          </Paper>

          <RuleHeader index={1} title="交付物" en="artifacts" action={
            <span style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: 10,
              color: t.mute }}>3 个文件</span>
          } />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14, marginBottom: 28 }}>
            {artifacts.map((a, i) => (
              <Paper key={i} pad={0} style={{ overflow: "hidden" }}>
                <div style={{ borderBottom: `0.5px solid ${t.divider}` }}>
                  {previews[a.preview]}
                </div>
                <div style={{ padding: 14 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                    <Icon d={iconFor(a.kind)} size={14} stroke={t.sage}/>
                    <span style={{ fontFamily: 'Inter, "Noto Sans SC", system-ui, sans-serif', fontSize: 14,
                      color: t.ink, fontWeight: 500 }}>{a.ja}</span>
                  </div>
                  <div style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: 10.5,
                    color: t.mute, marginBottom: 6 }}>
                    {a.filename} · {a.size}
                  </div>
                  <div style={{ fontSize: 11.5, color: t.inkSoft, lineHeight: 1.6,
                    marginBottom: 12 }}>{a.note}</div>
                  <div style={{ display: "flex", gap: 6 }}>
                    <Btn kind="outline" icon={I.eye} size="sm">预览</Btn>
                    <Btn kind="ghost" icon={I.download} size="sm">下载</Btn>
                  </div>
                </div>
              </Paper>
            ))}
          </div>

          <RuleHeader index={2} title="过程留档" en="run summary" />
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12,
            marginBottom: 20 }}>
            {[
              { ja: "总步骤", val: "12", sub: "think 4 / act 6 / obs 2" },
              { ja: "耗时",   val: "8m 02s", sub: "browser 3.4s · llm 4.1m" },
              { ja: "Token", val: "23.4k", sub: "in 18k · out 5.4k" },
              { ja: "成本",   val: "$0.38", sub: "cache 命中省 $0.42" },
            ].map((s, i) => (
              <Paper key={i} pad={14}>
                <div style={{ fontSize: 10, color: t.mute, fontFamily: '"JetBrains Mono", monospace',
                  letterSpacing: ".08em", textTransform: "uppercase", marginBottom: 6 }}>{s.ja}</div>
                <div style={{ fontFamily: 'Inter, "Noto Sans SC", system-ui, sans-serif', fontSize: 22,
                  color: t.ink, lineHeight: 1, marginBottom: 4 }}>{s.val}</div>
                <div style={{ fontSize: 10.5, color: t.muteSoft, fontFamily: '"JetBrains Mono", monospace' }}>
                  {s.sub}
                </div>
              </Paper>
            ))}
          </div>
        </div>
      </main>
      <LiveSandbox />
    </Screen>
  );
};

Object.assign(window, { TaskHeader, ScreenB_Timeline, ScreenC_Cards, ScreenD_Done });


