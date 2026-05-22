import { spawnSync } from "node:child_process";

export type ManusDatabaseProvider = "sqlite" | "postgres";
export type PsqlClientSource = "local" | "docker";

export interface PsqlCliStatus {
  available: boolean;
  version?: string;
  source?: PsqlClientSource;
  error?: string;
}

export function requestedDatabaseProvider(): ManusDatabaseProvider {
  return process.env.MANUSXL_DATABASE_PROVIDER?.trim().toLowerCase() === "postgres"
    ? "postgres"
    : "sqlite";
}

export function postgresDatabaseUrl() {
  return process.env.DATABASE_URL?.trim() || undefined;
}

function checkLocalPsqlCli(): PsqlCliStatus {
  const result = spawnSync("psql", ["--version"], {
    encoding: "utf8",
    timeout: 3000,
    stdio: "pipe"
  });
  if (result.status !== 0) {
    return { available: false, error: (result.stderr || result.stdout || "本机未找到 psql CLI").trim() };
  }
  return { available: true, version: result.stdout.trim(), source: "local" };
}

function checkDockerPsqlCli(): PsqlCliStatus {
  const image = process.env.MANUSXL_PSQL_DOCKER_IMAGE?.trim() || "postgres:16";
  const imageInspect = spawnSync("docker", ["image", "inspect", image], {
    encoding: "utf8",
    timeout: 5000,
    stdio: "pipe"
  });
  if (imageInspect.status !== 0) {
    return {
      available: false,
      error: `本机未找到 psql CLI，且 Docker 镜像 ${image} 不可用`
    };
  }

  const result = spawnSync("docker", ["run", "--rm", image, "psql", "--version"], {
    encoding: "utf8",
    timeout: 8000,
    stdio: "pipe"
  });
  if (result.status !== 0) {
    return {
      available: false,
      error: (result.stderr || result.stdout || `Docker 镜像 ${image} 无法运行 psql`).trim()
    };
  }
  return { available: true, version: result.stdout.trim(), source: "docker" };
}

export function checkPsqlCli(): PsqlCliStatus {
  const local = checkLocalPsqlCli();
  if (local.available) return local;

  const docker = checkDockerPsqlCli();
  if (docker.available) return docker;
  return { available: false, error: docker.error ?? local.error };
}

export function canUsePostgresRuntime(psql = checkPsqlCli()) {
  return requestedDatabaseProvider() === "postgres" && Boolean(postgresDatabaseUrl()) && psql.available;
}

function dockerReachableDatabaseUrl(databaseUrl: string) {
  try {
    const url = new URL(databaseUrl);
    if (["localhost", "127.0.0.1", "[::1]", "::1"].includes(url.hostname)) {
      url.hostname = "host.docker.internal";
    }
    return url.toString();
  } catch {
    return databaseUrl;
  }
}

export function runPsql(args: string[], options: {
  databaseUrl?: string;
  errorPrefix?: string;
  maxBuffer?: number;
  timeoutMs?: number;
} = {}) {
  const databaseUrl = options.databaseUrl ?? postgresDatabaseUrl();
  if (!databaseUrl) throw new Error(options.errorPrefix ?? "DATABASE_URL 未配置，无法使用 PostgreSQL");

  const psql = checkPsqlCli();
  if (!psql.available) {
    throw new Error(psql.error ?? "未找到可用的 psql 客户端");
  }

  const timeout = options.timeoutMs ?? 10_000;
  const maxBuffer = options.maxBuffer ?? 4 * 1024 * 1024;
  const result =
    psql.source === "docker"
      ? spawnSync(
          "docker",
          [
            "run",
            "--rm",
            process.env.MANUSXL_PSQL_DOCKER_IMAGE?.trim() || "postgres:16",
            "psql",
            dockerReachableDatabaseUrl(databaseUrl),
            "-v",
            "ON_ERROR_STOP=1",
            "-X",
            "-q",
            ...args
          ],
          {
            encoding: "utf8",
            timeout,
            maxBuffer,
            stdio: ["pipe", "pipe", "pipe"]
          }
        )
      : spawnSync("psql", [databaseUrl, "-v", "ON_ERROR_STOP=1", "-X", "-q", ...args], {
          encoding: "utf8",
          timeout,
          maxBuffer,
          stdio: ["pipe", "pipe", "pipe"]
        });

  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || "psql 执行失败").trim());
  }
  return result.stdout;
}
