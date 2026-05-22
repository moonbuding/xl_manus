// app.jsx — Mount the DesignCanvas with all artboards + Tweaks panel

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "theme": "warm"
}/*EDITMODE-END*/;

function App() {
  const [tw, setTw] = useTweaks(TWEAK_DEFAULTS);
  const theme = tw.theme || "warm";

  return (
    <ThemeNameCtx.Provider value={theme}>
      <DesignCanvas>
        <DCSection id="workspace" title="主工作台"
          subtitle="新建任务 → 进行中（两种步骤视图）→ 完成交付">
          <DCArtboard id="a" label="A · 空状态 · welcome" width={1320} height={840}>
            <ScreenA_Empty />
          </DCArtboard>
          <DCArtboard id="b" label="B · 进行中 · 时间线" width={1320} height={840}>
            <ScreenB_Timeline />
          </DCArtboard>
          <DCArtboard id="c" label="C · 进行中 · 卡片堆" width={1320} height={840}>
            <ScreenC_Cards />
          </DCArtboard>
          <DCArtboard id="d" label="D · 完成 · 交付物" width={1320} height={840}>
            <ScreenD_Done />
          </DCArtboard>
        </DCSection>

        <DCSection id="meta" title="周边" subtitle="历史与设置">
          <DCArtboard id="e" label="E · Library" width={1320} height={840}>
            <ScreenE_Library />
          </DCArtboard>
          <DCArtboard id="f" label="F · 设定 · Settings" width={1320} height={840}>
            <ScreenF_Settings />
          </DCArtboard>
        </DCSection>
      </DesignCanvas>

      <TweaksPanel title="Tweaks · 调整">
        <TweakSection label="主题模式" />
        <TweakRadio
          label="模式"
          value={theme}
          options={[
            { value: "warm", label: "暖白" },
            { value: "cool", label: "淡白" },
            { value: "dusk", label: "暮色" },
          ]}
          onChange={(v) => setTw("theme", v)}
        />
        <TweakSection label="说明" />
        <div style={{ fontSize: 10.5, color: "rgba(41,38,27,.6)", lineHeight: 1.55,
          padding: "2px 0" }}>
          四套主题覆盖白天到傍晚。每张画板都是一屏，拖动顶部把手可重排，点击 ⌞⌝ 可全屏看任一屏。
        </div>
      </TweaksPanel>
    </ThemeNameCtx.Provider>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
