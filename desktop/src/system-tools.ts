import { execFile } from "node:child_process";
import { platform } from "node:os";
import { promisify } from "node:util";

export interface DesktopSystemTaskArtifact {
  name: string;
  type: "txt" | "md" | "json";
  mimeType: string;
  content: string;
}

export interface DesktopSystemTaskResult {
  finalAnswer: string;
  artifacts: DesktopSystemTaskArtifact[];
}

interface SystemAction {
  kind: "app_launch" | "app_quit" | "clipboard_write" | "clipboard_read" | "terminal_command";
  title: string;
  description: string;
  run?: () => Promise<string>;
}

const execFileAsync = promisify(execFile);
const allowedApps = new Map([
  ["calculator", "Calculator"],
  ["计算器", "Calculator"],
  ["textedit", "TextEdit"],
  ["文本编辑", "TextEdit"]
]);

function isConfirmed(prompt: string) {
  return /确认执行|允许执行|执行操作|execute|apply|run now/i.test(prompt);
}

function pickCwd(allowedRoots: string[]) {
  return allowedRoots.map((root) => root.trim()).find(Boolean) ?? process.cwd();
}

function detectApp(prompt: string) {
  const normalized = prompt.toLowerCase();
  for (const [hint, appName] of allowedApps.entries()) {
    if (normalized.includes(hint.toLowerCase())) return appName;
  }
  return undefined;
}

function extractClipboardText(prompt: string) {
  const match =
    prompt.match(/(?:剪贴板|clipboard)\s*[:：]\s*([\s\S]+)/i) ??
    prompt.match(/(?:写入剪贴板|复制到剪贴板)\s+([\s\S]+)/i);
  return match?.[1]?.trim();
}

function extractCommand(prompt: string) {
  const fenced = prompt.match(/`([^`]+)`/);
  if (fenced?.[1]) return fenced[1].trim();
  const labelled = prompt.match(/(?:terminal|终端|命令|command)\s*[:：]\s*([^\n]+)/i);
  return labelled?.[1]?.trim();
}

function parseAllowedCommand(command: string, cwd: string) {
  const normalized = command.trim().replace(/\s+/g, " ");
  const safeCommands: Record<string, { file: string; args: string[] }> = {
    pwd: { file: "pwd", args: [] },
    ls: { file: "ls", args: [] },
    "ls -la": { file: "ls", args: ["-la"] },
    "node --version": { file: "node", args: ["--version"] },
    "python3 --version": { file: "python3", args: ["--version"] },
    "git --version": { file: "git", args: ["--version"] }
  };
  const known = safeCommands[normalized];
  if (!known) return undefined;
  return {
    ...known,
    cwd
  };
}

async function runCommand(file: string, args: string[], cwd: string) {
  const { stdout, stderr } = await execFileAsync(file, args, {
    cwd,
    timeout: 5000,
    maxBuffer: 128 * 1024,
    shell: false
  });
  return [stdout.trim(), stderr.trim()].filter(Boolean).join("\n") || "(no output)";
}

async function writeClipboard(text: string) {
  if (platform() !== "darwin") {
    return "Clipboard write is currently implemented for macOS only.";
  }
  await new Promise<void>((resolvePromise, reject) => {
    const child = execFile("pbcopy", [], (error) => {
      if (error) reject(error);
      else resolvePromise();
    });
    child.stdin?.end(text);
  });
  return `Wrote ${text.length} characters to clipboard.`;
}

async function readClipboard() {
  if (platform() !== "darwin") {
    return "Clipboard read is currently implemented for macOS only.";
  }
  const { stdout } = await execFileAsync("pbpaste", [], {
    timeout: 3000,
    maxBuffer: 64 * 1024,
    shell: false
  });
  return stdout.trim() || "(clipboard is empty)";
}

function buildAction(prompt: string, allowedRoots: string[]): SystemAction | undefined {
  const normalized = prompt.toLowerCase();
  const cwd = pickCwd(allowedRoots);
  const appName = detectApp(prompt);

  if (appName && /启动|打开|launch|open/i.test(prompt)) {
    return {
      kind: "app_launch",
      title: `Launch ${appName}`,
      description: `启动应用 ${appName}`,
      run: async () => {
        if (platform() !== "darwin") return "App launch execution is currently implemented for macOS only.";
        await execFileAsync("open", ["-a", appName], { timeout: 5000, shell: false });
        return `Launched ${appName}.`;
      }
    };
  }

  if (appName && /关闭|退出|quit|close/i.test(prompt)) {
    return {
      kind: "app_quit",
      title: `Quit ${appName}`,
      description: `关闭应用 ${appName}`,
      run: async () => {
        if (platform() !== "darwin") return "App quit execution is currently implemented for macOS only.";
        await execFileAsync("osascript", ["-e", `tell application "${appName}" to quit`], {
          timeout: 5000,
          shell: false
        });
        return `Requested ${appName} to quit.`;
      }
    };
  }

  if (/写入剪贴板|复制到剪贴板|clipboard write|write clipboard/i.test(prompt)) {
    const text = extractClipboardText(prompt);
    return {
      kind: "clipboard_write",
      title: "Write Clipboard",
      description: text ? `写入剪贴板：${text.slice(0, 80)}` : "写入剪贴板，但未提供内容",
      run: text ? () => writeClipboard(text) : undefined
    };
  }

  if (/读取剪贴板|clipboard read|read clipboard/i.test(prompt)) {
    return {
      kind: "clipboard_read",
      title: "Read Clipboard",
      description: "读取当前系统剪贴板文本",
      run: readClipboard
    };
  }

  if (/terminal|终端|命令|command/i.test(prompt)) {
    const command = extractCommand(prompt);
    const parsed = command ? parseAllowedCommand(command, cwd) : undefined;
    return {
      kind: "terminal_command",
      title: "Run Terminal Command",
      description: command
        ? `在 ${cwd} 执行白名单命令：${command}`
        : "需要通过 `terminal: pwd` 或 `命令: pwd` 指定命令",
      run: parsed
        ? () => runCommand(parsed.file, parsed.args, parsed.cwd)
        : undefined
    };
  }

  if (/keyboard|mouse|点击|键鼠|快捷键/i.test(normalized)) {
    return {
      kind: "terminal_command",
      title: "Keyboard/Mouse Preview",
      description: "键鼠模拟仍处于 dry-run 阶段，后续接入 nut.js/cliclick 后执行。"
    };
  }

  return undefined;
}

function resultFromAction(action: SystemAction, mode: "preview" | "executed" | "blocked", output?: string) {
  const report = [
    "# Desktop System Tool",
    "",
    `Action: ${action.kind}`,
    `Title: ${action.title}`,
    `Mode: ${mode}`,
    "",
    "## Description",
    action.description,
    "",
    "## Output",
    output ?? (mode === "preview" ? "Dry-run only. Add 确认执行 / execute to run this action." : "No output.")
  ].join("\n");
  const finalAnswer =
    mode === "executed"
      ? `ManusXL Desktop 已执行系统动作：${action.title}`
      : mode === "blocked"
        ? `ManusXL Desktop 已阻止系统动作：${action.title}`
        : `ManusXL Desktop 已生成系统动作预览：${action.title}`;

  return {
    finalAnswer,
    artifacts: [
      {
        name: "desktop-system-report.md",
        type: "md" as const,
        mimeType: "text/markdown",
        content: report
      }
    ]
  };
}

export function isDesktopSystemTask(prompt: string) {
  return Boolean(buildAction(prompt, []));
}

export async function runDesktopSystemTask(
  prompt: string,
  allowedRoots: string[]
): Promise<DesktopSystemTaskResult | undefined> {
  const action = buildAction(prompt, allowedRoots);
  if (!action) return undefined;
  if (!isConfirmed(prompt)) return resultFromAction(action, "preview");
  if (!action.run) return resultFromAction(action, "blocked", "Action is unsupported or missing required arguments.");

  try {
    const output = await action.run();
    return resultFromAction(action, "executed", output);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return resultFromAction(action, "blocked", message);
  }
}
