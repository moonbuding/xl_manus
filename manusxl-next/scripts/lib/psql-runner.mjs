import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

function postgresDockerImage() {
  return process.env.MANUSXL_PSQL_DOCKER_IMAGE?.trim() || "postgres:16";
}

function dockerReachableDatabaseUrl(databaseUrl) {
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

function localPsqlCandidates() {
  return [
    process.env.MANUSXL_PSQL_BIN?.trim(),
    "psql",
    "/Library/PostgreSQL/17/bin/psql",
    "/Library/PostgreSQL/16/bin/psql",
    "/opt/homebrew/bin/psql",
    "/usr/local/bin/psql"
  ].filter(Boolean);
}

function canTryPsqlCandidate(candidate) {
  return !candidate.includes("/") || existsSync(candidate);
}

function checkLocalPsql() {
  for (const candidate of localPsqlCandidates()) {
    if (!canTryPsqlCandidate(candidate)) continue;
    const result = spawnSync(candidate, ["--version"], {
      encoding: "utf8",
      timeout: 3000,
      stdio: "pipe"
    });
    if (result.status === 0) {
      return { available: true, source: "local", version: result.stdout.trim(), bin: candidate };
    }
  }
  return { available: false, error: "本机未找到 psql CLI" };
}

function checkDockerPsql() {
  const image = postgresDockerImage();
  const imageInspect = spawnSync("docker", ["image", "inspect", image], {
    encoding: "utf8",
    timeout: 5000,
    stdio: "pipe"
  });
  if (imageInspect.status !== 0) {
    return { available: false, error: `本机未找到 psql CLI，且 Docker 镜像 ${image} 不可用` };
  }

  const result = spawnSync("docker", ["run", "--rm", image, "psql", "--version"], {
    encoding: "utf8",
    timeout: 8000,
    stdio: "pipe"
  });
  if (result.status !== 0) {
    return { available: false, error: (result.stderr || result.stdout || `Docker 镜像 ${image} 无法运行 psql`).trim() };
  }
  return { available: true, source: "docker", version: result.stdout.trim() };
}

export function checkPsqlClient() {
  const local = checkLocalPsql();
  if (local.available) return local;

  const docker = checkDockerPsql();
  if (docker.available) return docker;
  return { available: false, error: docker.error ?? local.error };
}

export function runPsql(databaseUrl, args, options = {}) {
  const client = options.client ?? checkPsqlClient();
  if (!client.available) {
    throw new Error(client.error ?? "未找到可用的 psql 客户端");
  }

  const result =
    client.source === "docker"
      ? spawnSync(
          "docker",
          [
            "run",
            "--rm",
            postgresDockerImage(),
            "psql",
            dockerReachableDatabaseUrl(databaseUrl),
            "-v",
            "ON_ERROR_STOP=1",
            ...args
          ],
          {
            encoding: "utf8",
            timeout: options.timeoutMs ?? 30_000,
            stdio: "pipe"
          }
        )
      : spawnSync(client.bin ?? "psql", [databaseUrl, "-v", "ON_ERROR_STOP=1", ...args], {
          encoding: "utf8",
          timeout: options.timeoutMs ?? 30_000,
          stdio: "pipe"
        });

  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || "psql 执行失败").trim());
  }
  return result.stdout.trim();
}

export function buildPsqlCommand(databaseUrl, args, client = checkPsqlClient()) {
  if (!client.available) {
    throw new Error(client.error ?? "未找到可用的 psql 客户端");
  }
  if (client.source === "docker") {
    return {
      command: "docker",
      args: [
        "run",
        "--rm",
        postgresDockerImage(),
        "psql",
        dockerReachableDatabaseUrl(databaseUrl),
        "-v",
        "ON_ERROR_STOP=1",
        ...args
      ]
    };
  }
  return {
    command: client.bin ?? "psql",
    args: [databaseUrl, "-v", "ON_ERROR_STOP=1", ...args]
  };
}
