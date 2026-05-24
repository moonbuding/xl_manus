import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function exists(path) {
  return Boolean(await stat(path).catch(() => undefined));
}

async function loadDesktopTools() {
  const repoRoot = join(process.cwd(), "..");
  const sourcePath = join(repoRoot, "desktop/src/local-tools.ts");
  const source = await readFile(sourcePath, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      moduleResolution: ts.ModuleResolutionKind.Node16,
      target: ts.ScriptTarget.ES2022,
      strict: true
    }
  });
  const outputDir = join(tmpdir(), "manusxl-e2e-desktop-local-module");
  await mkdir(outputDir, { recursive: true });
  const outputPath = join(outputDir, `local-tools-${Date.now()}.mjs`);
  await writeFile(outputPath, compiled.outputText, "utf8");
  return import(pathToFileURL(outputPath).href);
}

async function seedFiles(root) {
  await mkdir(root, { recursive: true });
  await writeFile(join(root, "invoice.pdf"), "fake pdf", "utf8");
  await writeFile(join(root, "photo.jpg"), "fake image", "utf8");
  await writeFile(join(root, "notes.md"), "# Notes", "utf8");
  await writeFile(join(root, "copy-a.txt"), "same content", "utf8");
  await writeFile(join(root, "copy-b.txt"), "same content", "utf8");
}

async function main() {
  const { runDesktopLocalTask } = await loadDesktopTools();
  assert(typeof runDesktopLocalTask === "function", "桌面端本地工具没有导出 runDesktopLocalTask");

  const root = join(process.cwd(), ".manusxl-data", `e2e-desktop-local-${Date.now()}`);
  await rm(root, { recursive: true, force: true });
  await seedFiles(root);

  const scanned = await runDesktopLocalTask(`扫描 ${root}`, [root]);
  assert(scanned.finalAnswer.includes("目录扫描"), "扫描任务没有返回目录扫描结果");
  assert(
    scanned.artifacts.some((artifact) => artifact.name === "desktop-local-files.json"),
    "扫描任务没有输出文件清单 JSON"
  );

  const duplicated = await runDesktopLocalTask(`查重 ${root}`, [root]);
  assert(duplicated.finalAnswer.includes("查重预览"), "查重任务没有返回查重预览");
  assert(
    duplicated.artifacts.some((artifact) => artifact.content.includes("copy-a.txt") && artifact.content.includes("copy-b.txt")),
    "查重报告没有识别重复内容文件"
  );

  const preview = await runDesktopLocalTask(`分类整理 ${root}`, [root]);
  assert(preview.finalAnswer.includes("分类预览"), "分类任务默认应是 dry-run 预览");
  assert(await exists(join(root, "photo.jpg")), "dry-run 分类不应移动原文件");
  assert(!(await exists(join(root, "ManusXL Organized", "Images", "photo.jpg"))), "dry-run 分类不应创建目标移动结果");

  const executed = await runDesktopLocalTask(`确认执行 分类整理 ${root}`, [root]);
  assert(executed.finalAnswer.includes("真实分类整理"), "确认执行分类没有进入真实执行模式");
  assert(await exists(join(root, "ManusXL Organized", "Images", "photo.jpg")), "确认执行分类没有移动图片文件");
  assert(await exists(join(root, "ManusXL Organized", "Documents", "invoice.pdf")), "确认执行分类没有移动文档文件");
  assert(await exists(join(root, ".manusxl-desktop-undo.json")), "确认执行分类没有写入 undo 日志");

  const undone = await runDesktopLocalTask(`撤销 ${root}`, [root]);
  assert(undone.finalAnswer.includes("撤销操作"), "撤销任务没有进入 undo 模式");
  assert(await exists(join(root, "photo.jpg")), "撤销没有恢复图片文件");
  assert(await exists(join(root, "invoice.pdf")), "撤销没有恢复文档文件");

  console.log(JSON.stringify({
    ok: true,
    root,
    checks: [
      "desktop local scan",
      "desktop duplicate preview",
      "classification dry-run is non-mutating",
      "explicit classification execution moves files",
      "desktop undo restores moved files"
    ]
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
