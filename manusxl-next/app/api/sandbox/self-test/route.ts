import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createId } from "@/lib/id";
import { currentUserFromRequest, unauthorized } from "@/server/auth/http";
import { dataPath } from "@/server/data-root";
import { cleanupSandboxForWorkspace, runSandboxedCommand } from "@/server/sandbox/docker-sandbox";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ProcessLikeError extends Error {
  code?: number | string;
  killed?: boolean;
  signal?: string;
  stdout?: string | Buffer;
  stderr?: string | Buffer;
}

function textFromProcessField(value: unknown) {
  if (Buffer.isBuffer(value)) return value.toString("utf-8");
  return typeof value === "string" ? value : "";
}

function classifySandboxSelfTestError(error: unknown) {
  const processError = error as ProcessLikeError;
  const raw = [
    processError.message,
    textFromProcessField(processError.stderr),
    textFromProcessField(processError.stdout)
  ]
    .filter(Boolean)
    .join("\n")
    .toLowerCase();

  if (
    processError.code === 137 ||
    processError.code === "137" ||
    processError.signal === "SIGKILL" ||
    /out of memory|cannot allocate memory|memoryerror|oom|allocation failed|bad_alloc|killed/.test(raw)
  ) {
    return {
      kind: "oom",
      message: "沙盒进程触发内存限制，已被 Docker 停止。"
    };
  }

  if (processError.killed || /timed out|timeout|etimedout/.test(raw)) {
    return {
      kind: "timeout",
      message: "沙盒命令执行超时，已被停止。"
    };
  }

  if (/workspace .*磁盘配额|disk quota|no space left|enospc|disk_limit/.test(raw)) {
    return {
      kind: "disk_limit",
      message: "任务工作区触发磁盘配额限制，已停止继续写入。"
    };
  }

  return {
    kind: "execution_error",
    message: processError.message ?? String(error)
  };
}

export async function POST(request: Request) {
  const user = currentUserFromRequest(request);
  if (!user) return unauthorized();
  const body = (await request.json().catch(() => ({}))) as { scenario?: string };

  const workspaceRoot = resolve(dataPath("sandbox-self-test", user.id, createId("run")));
  await mkdir(workspaceRoot, { recursive: true });
  await writeFile(join(workspaceRoot, "input.txt"), "ManusXL sandbox self test\n", "utf8");

  try {
    if (body.scenario === "disk") {
      const diskProbe = [
        "from pathlib import Path",
        "Path('big.bin').write_bytes(b'0' * (2 * 1024 * 1024))",
        "print('wrote big.bin')"
      ].join("; ");

      try {
        await runSandboxedCommand({
          workspaceRoot,
          dockerCommand: "python3",
          dockerArgs: ["-c", diskProbe],
          localCommand: "python3",
          localArgs: ["-c", diskProbe],
          localCwd: workspaceRoot,
          requireDocker: true,
          workspaceQuotaBytes: 1024 * 1024,
          timeoutMs: 10_000,
          maxBufferBytes: 1024 * 1024
        });
      } catch (error) {
        const resourceError = classifySandboxSelfTestError(error);
        return NextResponse.json({
          ok: resourceError.kind === "disk_limit",
          scenario: "disk",
          expectedFailure: true,
          workspaceRoot,
          resourceError
        });
      }

      return NextResponse.json(
        {
          ok: false,
          scenario: "disk",
          expectedFailure: false,
          workspaceRoot,
          error: "Disk self-test unexpectedly completed without hitting the workspace quota."
        },
        { status: 500 }
      );
    }

    if (body.scenario === "oom") {
      const oomProbe = [
        "data = bytearray(1024 * 1024 * 1024)",
        "step = 4096",
        "for index in range(0, len(data), step):",
        "    data[index] = 1",
        "print(len(data))"
      ].join("\n");

      try {
        await runSandboxedCommand({
          workspaceRoot,
          dockerCommand: "python3",
          dockerArgs: ["-c", oomProbe],
          localCommand: "python3",
          localArgs: ["-c", oomProbe],
          localCwd: workspaceRoot,
          requireDocker: true,
          timeoutMs: 20_000,
          maxBufferBytes: 1024 * 1024
        });
      } catch (error) {
        const resourceError = classifySandboxSelfTestError(error);
        return NextResponse.json({
          ok: resourceError.kind === "oom",
          scenario: "oom",
          expectedFailure: true,
          workspaceRoot,
          resourceError
        });
      }

      return NextResponse.json(
        {
          ok: false,
          scenario: "oom",
          expectedFailure: false,
          workspaceRoot,
          error: "OOM self-test unexpectedly completed without hitting the memory limit."
        },
        { status: 500 }
      );
    }

    const python = await runSandboxedCommand({
      workspaceRoot,
      dockerCommand: "python3",
      dockerArgs: [
        "-c",
        [
          "import json, pathlib, os",
          "pathlib.Path('python-output.json').write_text(json.dumps({'ok': True, 'cwd': os.getcwd()}, ensure_ascii=False), encoding='utf-8')",
          "print(json.dumps({'python': True, 'cwd': os.getcwd()}, ensure_ascii=False))"
        ].join("; ")
      ],
      localCommand: "python3",
      localArgs: [
        "-c",
        [
          "import json, pathlib, os",
          "pathlib.Path('python-output.json').write_text(json.dumps({'ok': True, 'cwd': os.getcwd()}, ensure_ascii=False), encoding='utf-8')",
          "print(json.dumps({'python': True, 'cwd': os.getcwd()}, ensure_ascii=False))"
        ].join("; ")
      ],
      localCwd: workspaceRoot,
      timeoutMs: 10_000,
      maxBufferBytes: 1024 * 1024
    });

    const shell = await runSandboxedCommand({
      workspaceRoot,
      dockerCommand: "sh",
      dockerArgs: ["-c", "pwd && ls -la && test -f input.txt && test -f python-output.json"],
      localCommand: "sh",
      localArgs: ["-c", "pwd && ls -la && test -f input.txt && test -f python-output.json"],
      localCwd: workspaceRoot,
      timeoutMs: 10_000,
      maxBufferBytes: 1024 * 1024
    });

    return NextResponse.json({
      ok: true,
      workspaceRoot,
      python: {
        stdout: python.stdout.trim(),
        stderr: python.stderr.trim(),
        sandbox: python.sandbox
      },
      shell: {
        stdout: shell.stdout.trim(),
        stderr: shell.stderr.trim(),
        sandbox: shell.sandbox
      }
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        workspaceRoot,
        error: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    );
  } finally {
    await cleanupSandboxForWorkspace(workspaceRoot);
  }
}
