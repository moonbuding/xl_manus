import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function loadDesktopSystemTools() {
  const repoRoot = join(process.cwd(), "..");
  const sourcePath = join(repoRoot, "desktop/src/system-tools.ts");
  const source = await readFile(sourcePath, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      moduleResolution: ts.ModuleResolutionKind.Node16,
      target: ts.ScriptTarget.ES2022,
      strict: true
    }
  });
  const outputDir = join(tmpdir(), "manusxl-e2e-desktop-system-module");
  await mkdir(outputDir, { recursive: true });
  const outputPath = join(outputDir, `system-tools-${Date.now()}.mjs`);
  await writeFile(outputPath, compiled.outputText, "utf8");
  return import(pathToFileURL(outputPath).href);
}

async function main() {
  const { isDesktopSystemTask, runDesktopSystemTask } = await loadDesktopSystemTools();
  assert(typeof runDesktopSystemTask === "function", "桌面端系统工具没有导出 runDesktopSystemTask");
  assert(isDesktopSystemTask("启动 Calculator"), "系统工具没有识别应用启动任务");

  const root = join(process.cwd(), ".manusxl-data", `e2e-desktop-system-${Date.now()}`);
  await rm(root, { recursive: true, force: true });
  await mkdir(root, { recursive: true });

  const preview = await runDesktopSystemTask("启动 Calculator", [root]);
  assert(preview.finalAnswer.includes("系统动作预览"), "未确认的应用启动应只生成预览");
  assert(preview.artifacts.some((artifact) => artifact.content.includes("Dry-run only")), "预览报告没有标明 dry-run");

  const command = await runDesktopSystemTask("确认执行 terminal: pwd", [root]);
  assert(command.finalAnswer.includes("已执行系统动作"), "白名单终端命令没有执行");
  assert(command.artifacts.some((artifact) => artifact.content.includes(root)), "终端命令输出没有固定在 allowed root");

  const unsafe = await runDesktopSystemTask("确认执行 terminal: rm -rf /", [root]);
  assert(unsafe.finalAnswer.includes("已阻止系统动作"), "非白名单终端命令应被阻止");
  assert(unsafe.artifacts.some((artifact) => artifact.content.includes("unsupported")), "阻止报告没有说明动作不支持");

  const mouse = await runDesktopSystemTask("确认执行 鼠标点击 100,100", [root]);
  assert(mouse.finalAnswer.includes("已阻止系统动作"), "键鼠模拟当前应保持阻止/dry-run");

  console.log(JSON.stringify({
    ok: true,
    root,
    checks: [
      "system task detection",
      "app launch dry-run requires explicit confirmation",
      "safe terminal command executes in allowed root",
      "unsafe terminal command is blocked",
      "keyboard/mouse execution remains blocked"
    ]
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
