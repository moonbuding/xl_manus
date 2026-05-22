// shell.jsx — design tokens + shared UI atoms
// Exposes everything to window so other Babel scripts can share scope.

const THEMES = {
  warm: {
    label: "暖白",
    bg: "#f6f3ed",
    bgElev: "#fdfaf3",
    bgDeep: "#ede8dc",
    bgRail: "#eee8dc",
    ink: "#1f1d1a",
    inkSoft: "#4a463f",
    mute: "#8a7e6a",
    muteSoft: "#b6ac98",
    divider: "#dcd2bf",
    dividerSoft: "#e7decd",
    sage: "#5b6b5a",
    clay: "#b8714d",
    indigo: "#3b5266",
    err: "#a04a40",
    paperShadow: "0 1px 0 #fff inset, 0 1px 2px rgba(60,45,20,.04)",
    seal: "#b8714d",
  },
  cool: {
    // 淡一点的暖白 — 更接近纸张本色，对比柔，但不偏蓝
    label: "淡白",
    bg: "#faf8f3",
    bgElev: "#ffffff",
    bgDeep: "#f1eee6",
    bgRail: "#f3f0e9",
    ink: "#26241f",
    inkSoft: "#55514a",
    mute: "#948c7c",
    muteSoft: "#bbb3a1",
    divider: "#e6e0d1",
    dividerSoft: "#efeadd",
    sage: "#6a7868",
    clay: "#b87a55",
    indigo: "#4a5e72",
    err: "#a85048",
    paperShadow: "0 1px 0 #fff inset, 0 1px 2px rgba(60,45,20,.03)",
    seal: "#b87a55",
  },
  dusk: {
    // 夜晚模式 — 整体黑，右侧栏 / 卡片比主区更深，文字暖白
    label: "暮色",
    bg: "#15130f",
    bgElev: "#0a0907",
    bgDeep: "#050504",
    bgRail: "#060604",
    ink: "#f3ecd9",
    inkSoft: "#cdc5b1",
    mute: "#8a8170",
    muteSoft: "#5d5648",
    divider: "#25221c",
    dividerSoft: "#1a1814",
    sage: "#a3b59c",
    clay: "#d49770",
    indigo: "#8aa6c0",
    err: "#d97b6d",
    paperShadow: "0 1px 0 rgba(255,250,240,.03) inset, 0 1px 0 rgba(0,0,0,.6)",
    seal: "#d49770",
  },
};

const T = THEMES.warm; // default; theme is provided via context in App

const ThemeCtx = React.createContext(THEMES.warm);
// Named-theme context (set by App.jsx). useT resolves to a theme object from
// this so screen components don't need to wait for <Screen>'s inner Provider.
const ThemeNameCtx = React.createContext("warm");
const useT = () => {
  const name = React.useContext(ThemeNameCtx);
  return THEMES[name] || THEMES.warm;
};

// ─── tiny iconography (1.5px stroke, square caps, hand-feeling) ──────────────
const Icon = ({ d, size = 16, stroke = "currentColor", fill = "none", style }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={fill} stroke={stroke}
       strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={style}>
    {typeof d === "string" ? <path d={d} /> : d}
  </svg>
);
const I = {
  home:    "M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z",
  lib:     "M4 5h4v14H4zM10 5h4v14h-4zM16 5h4v14h-4z",
  cog:     <g><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></g>,
  plus:    "M12 5v14M5 12h14",
  send:    "M5 12l14-7-5 16-3-7z",
  attach:  "M21.4 11.05L12.3 20.15a5.5 5.5 0 0 1-7.78-7.78l9.19-9.19a3.67 3.67 0 0 1 5.19 5.19l-9.2 9.19a1.83 1.83 0 0 1-2.59-2.59l8.49-8.48",
  search:  <g><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.35-4.35" /></g>,
  chev:    "M9 6l6 6-6 6",
  chevD:   "M6 9l6 6 6-6",
  dot:     <circle cx="12" cy="12" r="3" />,
  folder:  "M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z",
  file:    "M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9zM14 3v6h6",
  download:"M12 3v12m0 0l-4-4m4 4l4-4M5 21h14",
  zip:     "M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9zM14 3v6h6M10 9v1m0 2v1m0 2v1m0 2h.01",
  check:   "M4 12l5 5L20 6",
  spark:   "M12 2l1.5 5L19 8.5 13.5 10 12 15l-1.5-5L5 8.5 10.5 7zM19 14l.8 2.5 2.5.8-2.5.8-.8 2.5-.8-2.5L15.7 17l2.5-.5z",
  globe:   <g><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" /></g>,
  cpu:     "M9 3v3M15 3v3M9 18v3M15 18v3M3 9h3M3 15h3M18 9h3M18 15h3M6 6h12v12H6z",
  layers:  "M12 3l9 5-9 5-9-5zM3 13l9 5 9-5M3 18l9 5 9-5",
  bolt:    "M13 2L4 14h7l-1 8 9-12h-7z",
  excel:   "M4 3h10l6 6v12a1 1 0 0 1-1 1H4zM14 3v6h6M8 12l6 6M14 12l-6 6",
  pptx:    "M4 3h10l6 6v12a1 1 0 0 1-1 1H4zM14 3v6h6M8 18v-7h3a2 2 0 1 1 0 4H8",
  html:    "M4 3h10l6 6v12a1 1 0 0 1-1 1H4zM14 3v6h6M8 18l-1-7M16 18l1-7M10 12l4 0M9 16h6",
  pdf:     "M4 3h10l6 6v12a1 1 0 0 1-1 1H4zM14 3v6h6M8 18v-7h2a2 2 0 1 1 0 4H8M14 11v7M14 11h3",
  csv:     "M4 3h10l6 6v12a1 1 0 0 1-1 1H4zM14 3v6h6M8 13v3M11 11v7M14 13v3",
  img:     "M4 3h10l6 6v12a1 1 0 0 1-1 1H4zM14 3v6h6M9 13a1 1 0 1 1-2 0 1 1 0 0 1 2 0zM7 18l3-3 3 3 3-4 2 2",
  copy:    "M9 3h8a2 2 0 0 1 2 2v12M5 7h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2z",
  pause:   "M9 4v16M15 4v16",
  play:    "M6 4l14 8-14 8z",
  stop:    "M5 5h14v14H5z",
  refresh: "M4 4v6h6M20 20v-6h-6M4 10a8 8 0 0 1 14-3M20 14a8 8 0 0 1-14 3",
  more:    <g><circle cx="6" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="18" cy="12" r="1.2"/></g>,
  arrowR:  "M5 12h14M13 6l6 6-6 6",
  brain:   "M9 4a3 3 0 0 0-3 3v1a3 3 0 0 0-1 5 3 3 0 0 0 1 5v1a3 3 0 0 0 3 3 3 3 0 0 0 3-3V4a3 3 0 0 0-3 0zM15 4a3 3 0 0 1 3 3v1a3 3 0 0 1 1 5 3 3 0 0 1-1 5v1a3 3 0 0 1-3 3",
  terminal:"M4 6h16v12H4zM7 10l3 2-3 2M12 14h5",
  page:    "M6 3h9l4 4v14H6zM14 3v5h5",
  link:    "M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1",
  key:     <g><circle cx="8" cy="15" r="4" /><path d="M11 12l9-9M16 7l3 3M14 9l3 3" /></g>,
  hash:    "M4 9h16M4 15h16M10 4l-2 16M16 4l-2 16",
  eye:     <g><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7z" /><circle cx="12" cy="12" r="3" /></g>,
};

// ─── Brand mark — abstract "stacked folio" icon (no kanji) ────────────────────
const BrandMark = ({ size = 24, color, accent }) => {
  const t = useT();
  const c = color || t.ink;
  const a = accent || t.sage;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
      {/* back page (sage tinted) */}
      <path d="M8 4h7l4 4v12H8z" fill={a} fillOpacity="0.22"/>
      {/* front page (ink) */}
      <path d="M4 7h7l4 4v12H4z" fill={c}/>
      {/* corner fold notch on front */}
      <path d="M11 7v4h4" fill="none" stroke={t.bg} strokeWidth="1.2" strokeLinejoin="round"/>
    </svg>
  );
};

// ─── Seal stamp (印章) — small square accent ─────────────────────────────────
const Seal = ({ char = "卷", size = 22, color }) => {
  const c = color || useT().seal;
  return (
    <span style={{
      display: "inline-flex", width: size, height: size, alignItems: "center",
      justifyContent: "center", border: `1.5px solid ${c}`, color: c,
      fontFamily: 'Inter, "Noto Sans SC", system-ui, sans-serif', fontSize: size * 0.55,
      fontWeight: 500, borderRadius: 2, letterSpacing: 0,
      transform: "rotate(-2deg)", flexShrink: 0,
    }}>{char}</span>
  );
};

// ─── Section header (with rule line and small label) ─────────────────────────
const RuleHeader = ({ index, title, en, action }) => {
  const t = useT();
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 14 }}>
      <span style={{ color: t.mute, fontFamily: '"JetBrains Mono", monospace',
        fontSize: 11, letterSpacing: ".08em" }}>{String(index).padStart(2, "0")}</span>
      <h3 style={{ margin: 0, color: t.ink, fontFamily: 'Inter, "Noto Sans SC", system-ui, sans-serif',
        fontWeight: 600, fontSize: 14, letterSpacing: ".01em" }}>{title}</h3>
      <div style={{ flex: 1, borderTop: `0.5px solid ${t.divider}`, marginBottom: 4 }} />
      {action}
    </div>
  );
};

// ─── Paper card ──────────────────────────────────────────────────────────────
const Paper = ({ children, style, pad = 16, deep = false }) => {
  const t = useT();
  return (
    <div style={{
      background: deep ? t.bgDeep : t.bgElev,
      border: `0.5px solid ${t.divider}`,
      borderRadius: 4, padding: pad, boxShadow: t.paperShadow,
      ...style,
    }}>{children}</div>
  );
};

// ─── Pill chip / tag ─────────────────────────────────────────────────────────
const Chip = ({ children, tone = "default", onClick, style }) => {
  const t = useT();
  const tones = {
    default: { bg: t.bgDeep, fg: t.inkSoft, bd: t.divider },
    soft:    { bg: "transparent", fg: t.mute,  bd: t.divider },
    sage:    { bg: "transparent", fg: t.sage,  bd: t.sage },
    clay:    { bg: "transparent", fg: t.clay,  bd: t.clay },
    done:    { bg: t.bgDeep,  fg: t.sage,  bd: t.divider },
    run:     { bg: t.bgDeep,  fg: t.clay,  bd: t.divider },
  };
  const s = tones[tone] || tones.default;
  return (
    <span onClick={onClick} style={{
      display: "inline-flex", alignItems: "center", gap: 5,
      padding: "2px 9px", border: `0.5px solid ${s.bd}`,
      background: s.bg, color: s.fg, borderRadius: 999,
      fontSize: 11, fontFamily: 'Inter, "Noto Sans SC", system-ui, sans-serif', fontWeight: 400,
      letterSpacing: ".02em", lineHeight: 1.6, whiteSpace: "nowrap",
      cursor: onClick ? "pointer" : "default", ...style,
    }}>{children}</span>
  );
};

// ─── Button ──────────────────────────────────────────────────────────────────
const Btn = ({ children, kind = "ghost", icon, style, onClick, size = "md" }) => {
  const t = useT();
  const kinds = {
    primary: { bg: t.ink, fg: t.bgElev, bd: t.ink },
    sage:    { bg: t.sage, fg: t.bgElev, bd: t.sage },
    outline: { bg: "transparent", fg: t.ink, bd: t.divider },
    ghost:   { bg: "transparent", fg: t.inkSoft, bd: "transparent" },
  };
  const k = kinds[kind] || kinds.ghost;
  const sizes = {
    sm: { pad: "5px 10px", fs: 11.5 },
    md: { pad: "7px 14px", fs: 12.5 },
    lg: { pad: "11px 22px", fs: 13.5 },
  }[size];
  return (
    <button onClick={onClick} style={{
      display: "inline-flex", alignItems: "center", gap: 6,
      padding: sizes.pad, fontSize: sizes.fs, fontFamily: 'Inter, "Noto Sans SC", system-ui, sans-serif',
      fontWeight: 500, letterSpacing: ".02em",
      background: k.bg, color: k.fg, border: `0.5px solid ${k.bd}`,
      borderRadius: 3, cursor: "pointer", lineHeight: 1.4, ...style,
    }}>
      {icon && <Icon d={icon} size={14} />}
      {children}
    </button>
  );
};

// ─── Pencil hatching pattern for image placeholders ──────────────────────────
const Hatch = ({ id = "hatch", color }) => {
  const t = useT();
  return (
    <pattern id={id} patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(-30)">
      <line x1="0" y1="0" x2="0" y2="6" stroke={color || t.divider} strokeWidth="0.6"/>
    </pattern>
  );
};

// ─── Artboard frame — common chrome around each screen ──────────────────────
const Screen = ({ children, theme, w = 1320, h = 840 }) => {
  const fallback = React.useContext(ThemeNameCtx);
  const t = THEMES[theme || fallback] || THEMES.warm;
  return (
    <ThemeCtx.Provider value={t}>
      <div style={{
        width: w, height: h, background: t.bg, color: t.ink,
        fontFamily: 'Inter, "Noto Sans SC", -apple-system, sans-serif',
        fontSize: 13, lineHeight: 1.5, overflow: "hidden",
        display: "flex",
      }}>{children}</div>
    </ThemeCtx.Provider>
  );
};

Object.assign(window, {
  THEMES, T, ThemeCtx, ThemeNameCtx, useT, Icon, I, Seal, BrandMark, RuleHeader, Paper, Chip, Btn, Hatch, Screen,
});
