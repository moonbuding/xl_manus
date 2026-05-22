import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { assertWorkspaceQuota, workspaceQuotaBytes } from "@/server/workspace/task-workspace";

const execFileAsync = promisify(execFile);

export type SandboxMode = "auto" | "docker" | "local";

export interface SandboxCommandResult {
  stdout: string;
  stderr: string;
  sandbox: {
    mode: "docker" | "local";
    requestedMode: SandboxMode;
    image: string;
    memoryLimit: string;
    cpuLimit: string;
    networkEnabled: boolean;
    containerName?: string;
    pooled?: boolean;
    fallbackReason?: string;
  };
}

export interface SandboxedCommandOptions {
  workspaceRoot: string;
  dockerCommand: string;
  dockerArgs: string[];
  localCommand: string;
  localArgs: string[];
  localCwd?: string;
  requireDocker?: boolean;
  workspaceQuotaBytes?: number;
  timeoutMs: number;
  maxBufferBytes: number;
}

interface DockerCheck {
  available: boolean;
  imageAvailable: boolean;
  reason?: string;
}

interface SandboxPoolContainer {
  containerName: string;
  workspaceRoot: string;
  image: string;
  createdAt: string;
  lastUsedAt: string;
  chain: Promise<unknown>;
}

interface ProcessLikeError extends Error {
  code?: number | string;
  killed?: boolean;
  signal?: string;
  stdout?: string | Buffer;
  stderr?: string | Buffer;
}

const globalForSandbox = globalThis as unknown as {
  manusxlSandboxPool?: Map<string, SandboxPoolContainer>;
};

function sandboxMode(): SandboxMode {
  const value = (process.env.MANUSXL_SANDBOX_MODE ?? "auto").trim().toLowerCase();
  if (value === "docker" || value === "local" || value === "auto") return value;
  return "auto";
}

function sandboxImage() {
  return process.env.MANUSXL_SANDBOX_IMAGE?.trim() || "python:3.12-slim";
}

function sandboxMemoryLimit() {
  return process.env.MANUSXL_SANDBOX_MEMORY?.trim() || "512m";
}

function sandboxCpuLimit() {
  return process.env.MANUSXL_SANDBOX_CPUS?.trim() || "1";
}

function sandboxPidsLimit() {
  return process.env.MANUSXL_SANDBOX_PIDS?.trim() || "128";
}

function sandboxNetworkEnabled() {
  return process.env.MANUSXL_SANDBOX_NETWORK === "1";
}

function sandboxPoolEnabled() {
  return process.env.MANUSXL_SANDBOX_POOL !== "0";
}

function textFromProcessField(value: unknown) {
  if (Buffer.isBuffer(value)) return value.toString("utf-8");
  return typeof value === "string" ? value : "";
}

function errorText(error: unknown) {
  const candidate = error as { message?: string; stderr?: string | Buffer; stdout?: string | Buffer };
  return [candidate.message, textFromProcessField(candidate.stderr), textFromProcessField(candidate.stdout)]
    .filter(Boolean)
    .join("\n")
    .trim();
}

function isDockerInfrastructureFailure(error: unknown) {
  const processError = error as ProcessLikeError;
  const text = errorText(error).toLowerCase();

  if (processError.code === 125 || processError.code === "125") return true;

  return /cannot connect to the docker daemon|docker daemon is not running|permission denied while trying to connect|no such image|pull access denied|repository does not exist|manifest .* not found|mounts denied|invalid mount config|error response from daemon/.test(
    text
  );
}

async function runLocalCommand(
  options: SandboxedCommandOptions,
  fallbackReason?: string
): Promise<SandboxCommandResult> {
  const { stdout, stderr } = (await execFileAsync(options.localCommand, options.localArgs, {
    cwd: options.localCwd ?? options.workspaceRoot,
    timeout: options.timeoutMs,
    maxBuffer: options.maxBufferBytes
  })) as { stdout: string; stderr: string };
  await assertWorkspaceQuota(options.workspaceRoot, options.workspaceQuotaBytes);

  return {
    stdout,
    stderr,
    sandbox: {
      mode: "local",
      requestedMode: sandboxMode(),
      image: sandboxImage(),
      memoryLimit: sandboxMemoryLimit(),
      cpuLimit: sandboxCpuLimit(),
      networkEnabled: sandboxNetworkEnabled(),
      fallbackReason
    }
  };
}

async function checkDocker(image = sandboxImage()): Promise<DockerCheck> {
  try {
    await execFileAsync("docker", ["version", "--format", "{{.Server.Version}}"], {
      timeout: 3000,
      maxBuffer: 64 * 1024
    });
  } catch (error) {
    return {
      available: false,
      imageAvailable: false,
      reason: `Docker 不可用：${errorText(error) || "无法连接 Docker 服务"}`
    };
  }

  try {
    await execFileAsync("docker", ["image", "inspect", image], {
      timeout: 3000,
      maxBuffer: 64 * 1024
    });
    return { available: true, imageAvailable: true };
  } catch (error) {
    return {
      available: true,
      imageAvailable: false,
      reason: `Docker 镜像 ${image} 检查未通过：${errorText(error) || "image inspect failed"}。如果镜像已安装，系统会直接尝试 docker run。`
    };
  }
}

function sandboxContainerName() {
  return `manusxl_sandbox_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

async function cleanupContainer(containerName: string) {
  try {
    await execFileAsync("docker", ["rm", "-f", containerName], {
      timeout: 5000,
      maxBuffer: 64 * 1024
    });
  } catch {
    // Best-effort cleanup; the original command error is more useful to callers.
  }
}

function getSandboxPool() {
  globalForSandbox.manusxlSandboxPool ??= new Map<string, SandboxPoolContainer>();
  return globalForSandbox.manusxlSandboxPool;
}

function sandboxPoolKey(workspaceRoot: string) {
  return [
    resolve(workspaceRoot),
    sandboxImage(),
    sandboxMemoryLimit(),
    sandboxCpuLimit(),
    sandboxPidsLimit(),
    sandboxNetworkEnabled() ? "network" : "no-network"
  ].join("::");
}

function dockerRunBaseArgs(containerName: string, workspaceRoot: string) {
  return [
    "--name",
    containerName,
    "--network",
    sandboxNetworkEnabled() ? "bridge" : "none",
    "--memory",
    sandboxMemoryLimit(),
    "--cpus",
    sandboxCpuLimit(),
    "--pids-limit",
    sandboxPidsLimit(),
    "--security-opt",
    "no-new-privileges",
    "--cap-drop",
    "ALL",
    "--tmpfs",
    "/tmp:rw,nosuid,nodev,size=64m",
    "--workdir",
    "/workspace",
    "-e",
    "PYTHONUNBUFFERED=1",
    "--mount",
    `type=bind,source=${workspaceRoot},target=/workspace`
  ];
}

async function createPooledContainer(workspaceRoot: string) {
  const image = sandboxImage();
  const containerName = sandboxContainerName();
  const args = [
    "run",
    "-d",
    ...dockerRunBaseArgs(containerName, workspaceRoot),
    image,
    "tail",
    "-f",
    "/dev/null"
  ];

  try {
    await execFileAsync("docker", args, {
      timeout: 15_000,
      maxBuffer: 256 * 1024
    });

    const now = new Date().toISOString();
    return {
      containerName,
      workspaceRoot,
      image,
      createdAt: now,
      lastUsedAt: now,
      chain: Promise.resolve()
    } satisfies SandboxPoolContainer;
  } catch (error) {
    await cleanupContainer(containerName);
    throw error;
  }
}

async function getPooledContainer(workspaceRoot: string) {
  const pool = getSandboxPool();
  const key = sandboxPoolKey(workspaceRoot);
  const existing = pool.get(key);
  if (existing) return existing;

  const container = await createPooledContainer(workspaceRoot);
  pool.set(key, container);
  return container;
}

async function runWithContainerLock<T>(container: SandboxPoolContainer, work: () => Promise<T>) {
  const previous = container.chain.catch(() => undefined);
  const next = previous.then(work);
  container.chain = next.catch(() => undefined);
  return next;
}

async function runPooledDockerCommand(options: SandboxedCommandOptions): Promise<SandboxCommandResult> {
  const workspaceRoot = resolve(options.workspaceRoot);
  const container = await getPooledContainer(workspaceRoot);

  return runWithContainerLock(container, async () => {
    container.lastUsedAt = new Date().toISOString();
    try {
      const { stdout, stderr } = (await execFileAsync(
        "docker",
        [
          "exec",
          "--workdir",
          "/workspace",
          container.containerName,
          options.dockerCommand,
          ...options.dockerArgs
        ],
        {
          timeout: options.timeoutMs + 5000,
          maxBuffer: options.maxBufferBytes
        }
      )) as { stdout: string; stderr: string };
      await assertWorkspaceQuota(workspaceRoot, options.workspaceQuotaBytes);

      return {
        stdout,
        stderr,
        sandbox: {
          mode: "docker",
          requestedMode: sandboxMode(),
          image: sandboxImage(),
          memoryLimit: sandboxMemoryLimit(),
          cpuLimit: sandboxCpuLimit(),
          networkEnabled: sandboxNetworkEnabled(),
          containerName: container.containerName,
          pooled: true
        }
      };
    } catch (error) {
      const maybeProcessError = error as { code?: number | string; killed?: boolean; signal?: string };
      if (maybeProcessError.killed || maybeProcessError.signal || maybeProcessError.code === 137) {
        await cleanupSandboxForWorkspace(workspaceRoot);
      }
      throw error;
    }
  });
}

async function runOneShotDockerCommand(options: SandboxedCommandOptions): Promise<SandboxCommandResult> {
  const image = sandboxImage();
  const containerName = sandboxContainerName();
  const workspaceRoot = resolve(options.workspaceRoot);
  const args = [
    "run",
    "--rm",
    ...dockerRunBaseArgs(containerName, workspaceRoot),
    image,
    options.dockerCommand,
    ...options.dockerArgs
  ];

  try {
    const { stdout, stderr } = (await execFileAsync("docker", args, {
      timeout: options.timeoutMs + 5000,
      maxBuffer: options.maxBufferBytes
    })) as { stdout: string; stderr: string };
    await assertWorkspaceQuota(workspaceRoot, options.workspaceQuotaBytes);

    return {
      stdout,
      stderr,
      sandbox: {
        mode: "docker",
        requestedMode: sandboxMode(),
        image,
        memoryLimit: sandboxMemoryLimit(),
        cpuLimit: sandboxCpuLimit(),
        networkEnabled: sandboxNetworkEnabled(),
        containerName,
        pooled: false
      }
    };
  } catch (error) {
    await cleanupContainer(containerName);
    throw error;
  }
}

async function runDockerCommand(options: SandboxedCommandOptions) {
  return sandboxPoolEnabled() ? runPooledDockerCommand(options) : runOneShotDockerCommand(options);
}

export async function runSandboxedCommand(options: SandboxedCommandOptions) {
  const mode = sandboxMode();
  if (mode === "local") {
    if (options.requireDocker) {
      throw new Error("该沙盒检查需要 Docker 模式，当前配置为 local。");
    }
    return runLocalCommand(options);
  }

  const docker = await checkDocker();
  if (!docker.available) {
    if (mode === "docker" || options.requireDocker) {
      throw new Error(docker.reason ?? "Docker sandbox unavailable");
    }
    return runLocalCommand(options, docker.reason);
  }

  try {
    return await runDockerCommand(options);
  } catch (error) {
    if (mode === "docker" || options.requireDocker) throw error;
    if (isDockerInfrastructureFailure(error)) {
      return runLocalCommand(options, `Docker 沙盒执行失败，已回退本地执行：${errorText(error)}`);
    }
    throw error;
  }
}

export async function getSandboxStatus() {
  const mode = sandboxMode();
  const image = sandboxImage();
  const docker = mode === "local" ? null : await checkDocker(image);
  const pool = getSandboxPool();

  return {
    mode,
    image,
    memoryLimit: sandboxMemoryLimit(),
    cpuLimit: sandboxCpuLimit(),
    pidsLimit: sandboxPidsLimit(),
    workspaceQuotaBytes: workspaceQuotaBytes(),
    networkEnabled: sandboxNetworkEnabled(),
    poolEnabled: sandboxPoolEnabled(),
    pool: [...pool.values()].map((container) => ({
      containerName: container.containerName,
      workspaceRoot: container.workspaceRoot,
      image: container.image,
      createdAt: container.createdAt,
      lastUsedAt: container.lastUsedAt
    })),
    dockerAvailable: docker?.available ?? false,
    imageAvailable: docker?.imageAvailable ?? false,
    reason: docker?.reason
  };
}

export async function cleanupSandboxForWorkspace(workspaceRoot: string) {
  const pool = getSandboxPool();
  const keyPrefix = `${resolve(workspaceRoot)}::`;
  const matching = [...pool.entries()].filter(([key]) => key.startsWith(keyPrefix));

  await Promise.all(
    matching.map(async ([key, container]) => {
      pool.delete(key);
      await cleanupContainer(container.containerName);
    })
  );
}

export async function cleanupAllSandboxes() {
  const pool = getSandboxPool();
  const containers = [...pool.values()];
  pool.clear();
  await Promise.all(containers.map((container) => cleanupContainer(container.containerName)));
}
