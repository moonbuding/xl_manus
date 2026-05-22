// meta.jsx — Library + Settings screens

// ════════════════════════════════════════════════════════════════════════════
// SCREEN E — Library (task history)
// ════════════════════════════════════════════════════════════════════════════
const TASKS = [
  { id: "tsk_8f2a1c", ja: "新能源车前五调研 → 对比 Excel + 汇报 PPT + dashboard", date: "今天 14:31",
    status: "running", artifacts: 3, kinds: ["xlsx","pptx","html"], steps: 12, cost: "$0.18" },
  { id: "tsk_3e9f01", ja: "Q3 财报关键数字提成 Excel（六家电池公司）", date: "今天 11:08",
    status: "done", artifacts: 2, kinds: ["xlsx","md"], steps: 8, cost: "$0.21" },
  { id: "tsk_b71d4a", ja: "竞品定价方案对比 PPT", date: "昨天 18:42",
    status: "done", artifacts: 1, kinds: ["pptx"], steps: 6, cost: "$0.14" },
  { id: "tsk_c0a8e2", ja: "招聘 JD 整理：把 12 份 docx 合并并按职级分类", date: "昨天 16:05",
    status: "done", artifacts: 1, kinds: ["xlsx"], steps: 5, cost: "$0.09" },
  { id: "tsk_44b8d9", ja: "把这份 PDF 财报里的图表全部识别并重新画", date: "昨天 09:20",
    status: "failed", artifacts: 0, kinds: [], steps: 3, cost: "$0.03",
    err: "browser_tool: chromium 启动超时" },
  { id: "tsk_19c0fe", ja: "周报模板 → 单页静态网页", date: "3 天前", 
    status: "done", artifacts: 2, kinds: ["html","md"], steps: 7, cost: "$0.16" },
  { id: "tsk_72ad11", ja: "整理本周读过的 8 篇论文 → 摘要 Markdown", date: "3 天前",
    status: "done", artifacts: 1, kinds: ["md"], steps: 5, cost: "$0.11" },
  { id: "tsk_55ee07", ja: "Shopify 店铺销售数据 → 多 sheet Excel + 图表", date: "上周",
    status: "done", artifacts: 1, kinds: ["xlsx"], steps: 9, cost: "$0.27" },
];

const ScreenE_Library = () => {
  const t = useT();
  const iconFor = (k) => ({ xlsx: I.excel, pptx: I.pptx, html: I.html, md: I.page,
    pdf: I.pdf, csv: I.csv, img: I.img }[k] || I.file);
  const statusOf = (s) => ({
    done:    { ja: "完成", color: t.sage },
    running: { ja: "进行中", color: t.clay },
    failed:  { ja: "失败", color: t.err },
  })[s];

  return (
    <Screen>
      <LeftRail active="lib" />
      <main style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        <TopBar crumbs={["Library", "全部任务"]} right={
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6,
              background: t.bgDeep, border: `0.5px solid ${t.divider}`,
              padding: "5px 10px", borderRadius: 3, width: 220 }}>
              <Icon d={I.search} size={13} stroke={t.mute}/>
              <input placeholder="搜任务名 / prompt 关键字"
                style={{ flex: 1, border: 0, background: "transparent", outline: "none",
                  fontSize: 11.5, color: t.inkSoft }}/>
              <span style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: 9,
                color: t.muteSoft }}>⌘K</span>
            </div>
          </div>
        } />

        {/* header band */}
        <div style={{ padding: "26px 32px 18px", borderBottom: `0.5px solid ${t.dividerSoft}` }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 14, marginBottom: 14 }}>
            <BrandMark size={22} />
            <h1 style={{ margin: 0, fontFamily: 'Inter, "Noto Sans SC", system-ui, sans-serif', fontSize: 24,
              fontWeight: 600, color: t.ink, letterSpacing: "-.01em" }}>Library</h1>
            <span style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: 11,
              color: t.mute }}>178 个任务 · sqlite · 8.4 MB</span>
            <div style={{ flex: 1 }} />
            <Btn kind="outline" icon={I.download} size="sm">导出归档</Btn>
          </div>
          {/* filter bar */}
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {[
              { ja: "全部", n: 178, on: true },
              { ja: "进行中", n: 1 },
              { ja: "已完成", n: 165 },
              { ja: "失败", n: 12 },
            ].map((f, i) => (
              <div key={i} style={{
                display: "flex", alignItems: "center", gap: 6,
                padding: "5px 11px", borderRadius: 3,
                background: f.on ? t.ink : "transparent",
                color: f.on ? t.bgElev : t.inkSoft,
                border: `0.5px solid ${f.on ? t.ink : t.divider}`,
                fontSize: 12, cursor: "pointer",
              }}>
                <span>{f.ja}</span>
                <span style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: 10,
                  color: f.on ? "rgba(255,255,255,.6)" : t.muteSoft }}>{f.n}</span>
              </div>
            ))}
            <div style={{ width: 0.5, height: 16, background: t.divider, margin: "0 4px" }} />
            <Chip tone="soft">类型 · xlsx</Chip>
            <Chip tone="soft">最近 7 天</Chip>
            <Chip tone="soft">+ 添加筛选</Chip>
            <div style={{ flex: 1 }} />
            <span style={{ fontSize: 11, color: t.mute }}>排序</span>
            <Btn kind="ghost" size="sm" icon={I.chevD}>最新</Btn>
          </div>
        </div>

        {/* task list */}
        <div style={{ flex: 1, overflow: "auto", padding: "0 32px 30px" }}>
          {(() => {
            const groups = [
              { ja: "今天 · 05/21", tasks: TASKS.filter(x => x.date.startsWith("今天")) },
              { ja: "昨天 · 05/20", tasks: TASKS.filter(x => x.date.startsWith("昨天")) },
              { ja: "本周早些时候",   tasks: TASKS.filter(x => !x.date.startsWith("今天") && !x.date.startsWith("昨天")) },
            ];
            return groups.map((g, gi) => (
              <div key={gi} style={{ marginTop: 22 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10,
                  marginBottom: 8, fontSize: 10, color: t.mute,
                  fontFamily: '"JetBrains Mono", monospace', letterSpacing: ".12em",
                  textTransform: "uppercase" }}>
                  <span>{g.ja}</span>
                  <div style={{ flex: 1, borderTop: `0.5px solid ${t.divider}` }}/>
                </div>
                <div style={{ display: "flex", flexDirection: "column" }}>
                  {g.tasks.map((task, ti) => {
                    const st = statusOf(task.status);
                    return (
                      <div key={ti} style={{
                        display: "grid",
                        gridTemplateColumns: "16px 1fr 130px 100px 100px 30px",
                        gap: 14, alignItems: "center",
                        padding: "13px 6px",
                        borderBottom: `0.5px solid ${t.dividerSoft}`, cursor: "pointer",
                      }}>
                        <span style={{ width: 7, height: 7, borderRadius: "50%",
                          background: st.color,
                          boxShadow: task.status === "running" ? `0 0 0 4px ${st.color}1c` : "none" }}/>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: 13, color: t.ink, fontWeight: 500,
                            overflow: "hidden", textOverflow: "ellipsis",
                            whiteSpace: "nowrap" }}>{task.ja}</div>
                          <div style={{ display: "flex", alignItems: "center", gap: 8,
                            marginTop: 3, fontFamily: '"JetBrains Mono", monospace',
                            fontSize: 10, color: t.muteSoft }}>
                            <span>{task.id}</span>
                            <span>· {task.date}</span>
                            <span>· {task.steps} step</span>
                            {task.err && <span style={{ color: t.err }}>· {task.err}</span>}
                          </div>
                        </div>
                        <div style={{ display: "flex", gap: 4 }}>
                          {task.kinds.length === 0 ? (
                            <span style={{ color: t.muteSoft, fontSize: 10,
                              fontFamily: '"JetBrains Mono", monospace' }}>—</span>
                          ) : task.kinds.map((k, ki) => (
                            <div key={ki} style={{
                              width: 24, height: 24, border: `0.5px solid ${t.divider}`,
                              borderRadius: 2, display: "flex", alignItems: "center",
                              justifyContent: "center", background: t.bgElev,
                            }}>
                              <Icon d={iconFor(k)} size={12} stroke={t.inkSoft}/>
                            </div>
                          ))}
                        </div>
                        <span style={{ fontSize: 11, color: st.color, fontWeight: 500 }}>{st.ja}</span>
                        <span style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: 11,
                          color: t.inkSoft, textAlign: "right" }}>{task.cost}</span>
                        <Icon d={I.chev} size={13} stroke={t.mute}/>
                      </div>
                    );
                  })}
                </div>
              </div>
            ));
          })()}
        </div>
      </main>

      {/* RightRail — calendar heat + stats */}
      <aside style={{ width: 320, flexShrink: 0, borderLeft: `0.5px solid ${t.divider}`,
        background: t.bgElev, padding: "22px 22px 18px", overflow: "auto",
        display: "flex", flexDirection: "column", gap: 22 }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12,
            fontSize: 10, color: t.mute, fontFamily: '"JetBrains Mono", monospace',
            letterSpacing: ".12em", textTransform: "uppercase" }}>
            <span>本月活动</span>
            <div style={{ flex: 1, borderTop: `0.5px solid ${t.divider}` }} />
            <span style={{ color: t.muteSoft }}>2026.05</span>
          </div>
          {/* calendar heatmap */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 3 }}>
            {Array.from({ length: 31 }, (_, i) => {
              const v = Math.floor(Math.abs(Math.sin(i * 1.7)) * 5);
              const today = i === 20;
              return (
                <div key={i} style={{
                  aspectRatio: "1", borderRadius: 1.5,
                  background: today ? t.clay :
                    v === 0 ? t.bgDeep :
                    v === 1 ? `${t.sage}40` :
                    v === 2 ? `${t.sage}70` :
                    v === 3 ? `${t.sage}aa` : t.sage,
                  border: today ? `1px solid ${t.clay}` : "none",
                }} title={`5/${i+1}`} />
              );
            })}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 10,
            fontSize: 9, color: t.muteSoft, fontFamily: '"JetBrains Mono", monospace' }}>
            <span>少</span>
            {[t.bgDeep, `${t.sage}40`, `${t.sage}70`, `${t.sage}aa`, t.sage].map((c, i) => (
              <div key={i} style={{ width: 10, height: 10, background: c, borderRadius: 1.5 }} />
            ))}
            <span>多</span>
          </div>
        </div>

        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12,
            fontSize: 10, color: t.mute, fontFamily: '"JetBrains Mono", monospace',
            letterSpacing: ".12em", textTransform: "uppercase" }}>
            <span>交付物分布</span>
            <div style={{ flex: 1, borderTop: `0.5px solid ${t.divider}` }} />
          </div>
          {[
            { kind: "xlsx", ja: "Excel 表",  n: 68, pct: 38 },
            { kind: "pptx", ja: "PPT 汇报",  n: 42, pct: 24 },
            { kind: "html", ja: "网页",      n: 28, pct: 16 },
            { kind: "md",   ja: "Markdown",  n: 24, pct: 14 },
            { kind: "csv",  ja: "CSV / 数据",n: 16, pct: 8 },
          ].map((row, i) => (
            <div key={i} style={{ marginBottom: 10 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8,
                fontSize: 11.5, color: t.inkSoft, marginBottom: 4 }}>
                <Icon d={({xlsx:I.excel,pptx:I.pptx,html:I.html,md:I.page,csv:I.csv})[row.kind]}
                  size={12} stroke={t.mute}/>
                <span>{row.ja}</span>
                <div style={{ flex: 1 }}/>
                <span style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: 10,
                  color: t.muteSoft }}>{row.n}</span>
              </div>
              <div style={{ height: 4, background: t.bgDeep, borderRadius: 2, overflow: "hidden" }}>
                <div style={{ width: `${row.pct * 2}%`, height: "100%",
                  background: t.sage, opacity: 0.7 }}/>
              </div>
            </div>
          ))}
        </div>

        <div style={{ flex: 1 }} />

        <Paper pad={12} deep>
          <div style={{ display: "flex", alignItems: "center", gap: 6,
            fontSize: 10, color: t.mute, fontFamily: '"JetBrains Mono", monospace',
            letterSpacing: ".08em", marginBottom: 6 }}>
            <span>本月成本</span>
            <div style={{ flex: 1, borderTop: `0.5px solid ${t.divider}` }}/>
          </div>
          <div style={{ fontFamily: 'Inter, "Noto Sans SC", system-ui, sans-serif', fontSize: 26, color: t.ink,
            lineHeight: 1 }}>$12.84</div>
          <div style={{ fontSize: 10.5, color: t.muteSoft, fontFamily: '"JetBrains Mono", monospace',
            marginTop: 6 }}>预算 $20 · 已用 64%</div>
        </Paper>
      </aside>
    </Screen>
  );
};

// ════════════════════════════════════════════════════════════════════════════
// SCREEN F — Settings
// ════════════════════════════════════════════════════════════════════════════
const SettingRow = ({ label, hint, children }) => {
  const t = useT();
  return (
    <div style={{ display: "grid", gridTemplateColumns: "200px 1fr", gap: 26,
      padding: "16px 0", borderBottom: `0.5px solid ${t.dividerSoft}` }}>
      <div>
        <div style={{ fontSize: 12.5, color: t.ink, fontWeight: 500, marginBottom: 3 }}>{label}</div>
        {hint && <div style={{ fontSize: 11, color: t.mute, lineHeight: 1.5 }}>{hint}</div>}
      </div>
      <div style={{ minWidth: 0 }}>{children}</div>
    </div>
  );
};

const TextField = ({ value, mono = false, mask, right, placeholder }) => {
  const t = useT();
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8,
      background: t.bgElev, border: `0.5px solid ${t.divider}`, borderRadius: 3,
      padding: "8px 12px" }}>
      <input value={mask ? value.replace(/./g, "•").slice(0, 22) + value.slice(22) : value}
        placeholder={placeholder} readOnly
        style={{ flex: 1, border: 0, background: "transparent", outline: "none",
          fontSize: 12, color: t.inkSoft,
          fontFamily: mono ? '"JetBrains Mono", monospace' : 'Inter, "Noto Sans SC", system-ui, sans-serif' }}/>
      {right}
    </div>
  );
};

const Radio = ({ options, value }) => {
  const t = useT();
  return (
    <div style={{ display: "inline-flex", border: `0.5px solid ${t.divider}`, borderRadius: 3,
      background: t.bgElev, overflow: "hidden" }}>
      {options.map((o, i) => {
        const on = o.id === value;
        return (
          <div key={i} style={{
            padding: "7px 14px", fontSize: 12, cursor: "pointer",
            background: on ? t.ink : "transparent",
            color: on ? t.bgElev : t.inkSoft, fontWeight: on ? 500 : 400,
            borderLeft: i > 0 ? `0.5px solid ${t.divider}` : "none",
          }}>{o.ja}</div>
        );
      })}
    </div>
  );
};

const Slider = ({ value, min, max, unit }) => {
  const t = useT();
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, maxWidth: 320 }}>
      <div style={{ flex: 1, position: "relative", height: 4, background: t.bgDeep,
        borderRadius: 2 }}>
        <div style={{ position: "absolute", left: 0, top: 0, height: 4, width: `${pct}%`,
          background: t.ink, borderRadius: 2 }}/>
        <div style={{ position: "absolute", left: `calc(${pct}% - 6px)`, top: -4,
          width: 12, height: 12, borderRadius: "50%", background: t.bgElev,
          border: `1.5px solid ${t.ink}` }}/>
      </div>
      <span style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: 12,
        color: t.ink, width: 40, textAlign: "right" }}>{value}{unit}</span>
    </div>
  );
};

const ScreenF_Settings = () => {
  const t = useT();
  return (
    <Screen>
      <LeftRail active="cog" />
      <main style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        <TopBar crumbs={["设定", "LLM 与运行时"]} right={
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <Chip tone="soft">已保存 · 14:32</Chip>
            <Btn kind="ghost" size="sm">恢复默认</Btn>
          </div>
        } />

        <div style={{ flex: 1, overflow: "auto", padding: "32px 64px 40px", maxWidth: 880,
          width: "100%", margin: "0 auto" }}>

          {/* hero */}
          <div style={{ display: "flex", alignItems: "baseline", gap: 14, marginBottom: 22 }}>
            <BrandMark size={22} />
            <h1 style={{ margin: 0, fontFamily: 'Inter, "Noto Sans SC", system-ui, sans-serif', fontSize: 24,
              fontWeight: 600, color: t.ink, letterSpacing: "-.01em" }}>设置</h1>
            <span style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: 11,
              color: t.mute }}>改完即生效</span>
          </div>

          {/* tab nav */}
          <div style={{ display: "flex", gap: 4, marginBottom: 8,
            borderBottom: `0.5px solid ${t.divider}` }}>
            {[
              { ja: "LLM", en: "model", on: true },
              { ja: "运行时", en: "runtime" },
              { ja: "沙盒", en: "sandbox" },
              { ja: "外观", en: "theme" },
              { ja: "关于", en: "about" },
            ].map((tab, i) => (
              <div key={i} style={{
                padding: "9px 14px", cursor: "pointer", display: "flex",
                alignItems: "center", gap: 6,
                borderBottom: `2px solid ${tab.on ? t.ink : "transparent"}`,
                marginBottom: -0.5,
              }}>
                <span style={{ fontSize: 12.5, color: tab.on ? t.ink : t.mute,
                  fontWeight: tab.on ? 500 : 400 }}>{tab.ja}</span>
              </div>
            ))}
          </div>

          {/* sections */}
          <div style={{ marginTop: 30 }}>
            <RuleHeader index={1} title="API Key" en="credentials" />
            <SettingRow label="Anthropic" hint="主推理模型，存储时用 Fernet 加密">
              <TextField value="sk-ant-api03-Lh82xCq...Zk9p" mono mask
                right={
                  <>
                    <Icon d={I.eye} size={13} stroke={t.mute} />
                    <Icon d={I.copy} size={13} stroke={t.mute} />
                  </>
                }/>
            </SettingRow>
            <SettingRow label="OpenAI" hint="备用，用于 GPT 系列回退">
              <TextField value="" placeholder="未设置 · 留空将禁用 OpenAI 模型" mono/>
            </SettingRow>
            <SettingRow label="DeepSeek" hint="国内调试用，便宜">
              <TextField value="sk-9d3a...8e21" mono mask
                right={<Icon d={I.eye} size={13} stroke={t.mute} />}/>
            </SettingRow>
          </div>

          <div style={{ marginTop: 36 }}>
            <RuleHeader index={2} title="模型与温度" en="model & params" />
            <SettingRow label="主模型" hint="任务推理的核心模型">
              <div style={{ display: "flex", alignItems: "center", gap: 10,
                background: t.bgElev, border: `0.5px solid ${t.divider}`, borderRadius: 3,
                padding: "8px 14px", maxWidth: 360, cursor: "pointer" }}>
                <span style={{ width: 20, height: 20, borderRadius: 3, background: t.indigo,
                  color: t.bgElev, display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 11, fontWeight: 600,
                  fontFamily: 'Inter, system-ui, sans-serif' }}>A</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, color: t.ink }}>Claude 4.5 Sonnet</div>
                  <div style={{ fontSize: 10, color: t.muteSoft,
                    fontFamily: '"JetBrains Mono", monospace' }}>200k ctx · $3 / 1M · cache 友好</div>
                </div>
                <Icon d={I.chevD} size={14} stroke={t.mute}/>
              </div>
            </SettingRow>
            <SettingRow label="温度" hint="0 严谨 · 1 自由 · 调研建议 0.3-0.6">
              <Slider value={0.4} min={0} max={1} unit=""/>
            </SettingRow>
            <SettingRow label="最大步数" hint="超过则中断任务（防失控）">
              <Slider value={32} min={4} max={64} unit=""/>
            </SettingRow>
          </div>

          <div style={{ marginTop: 36 }}>
            <RuleHeader index={3} title="运行时" en="runtime" />
            <SettingRow label="并发任务数" hint="同时跑的任务上限">
              <Radio value={3} options={[{id:1,ja:"1"},{id:3,ja:"3"},{id:5,ja:"5"},{id:8,ja:"8"}]}/>
            </SettingRow>
            <SettingRow label="tmp 文件保留" hint="任务结束后中间产物保留天数">
              <Radio value={7} options={[{id:0,ja:"立即清"},{id:1,ja:"1 天"},{id:7,ja:"7 天"},{id:30,ja:"30 天"}]}/>
            </SettingRow>
            <SettingRow label="自动联网" hint="允许 Agent 在任务开始时联网（不许时只能用沙盒）">
              <Radio value="on" options={[{id:"on",ja:"开"},{id:"off",ja:"关"}]}/>
            </SettingRow>
          </div>

          <div style={{ marginTop: 36, marginBottom: 30 }}>
            <RuleHeader index={4} title="缓存与监控" en="kv-cache" />
            <Paper pad={16}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 18 }}>
                {[
                  { ja: "近 7 日命中率", val: "78%", sub: "目标 ≥ 60%", color: t.sage },
                  { ja: "近 7 日省下", val: "$8.20", sub: "vs 全量重算", color: t.ink },
                  { ja: "平均首步延迟", val: "1.4s", sub: "无 cache 时 3.2s", color: t.ink },
                ].map((s, i) => (
                  <div key={i}>
                    <div style={{ fontSize: 10, color: t.mute,
                      fontFamily: '"JetBrains Mono", monospace', letterSpacing: ".08em",
                      textTransform: "uppercase", marginBottom: 5 }}>{s.ja}</div>
                    <div style={{ fontFamily: 'Inter, "Noto Sans SC", system-ui, sans-serif', fontSize: 22,
                      color: s.color, lineHeight: 1, marginBottom: 4 }}>{s.val}</div>
                    <div style={{ fontSize: 10.5, color: t.muteSoft,
                      fontFamily: '"JetBrains Mono", monospace' }}>{s.sub}</div>
                  </div>
                ))}
              </div>
            </Paper>
          </div>
        </div>
      </main>
    </Screen>
  );
};

Object.assign(window, { ScreenE_Library, ScreenF_Settings });
