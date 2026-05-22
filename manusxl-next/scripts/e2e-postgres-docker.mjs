import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { checkPsqlClient, runPsql } from "./lib/psql-runner.mjs";

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const image = process.env.MANUSXL_PG_DOCKER_IMAGE || "postgres:16";
const containerName = `manusxl-pg-e2e-${randomBytes(4).toString("hex")}`;
const user = process.env.MANUSXL_PG_DOCKER_USER || "manusxl";
const password = process.env.MANUSXL_PG_DOCKER_PASSWORD || "manusxl";
const database = process.env.MANUSXL_PG_DOCKER_DB || "manusxl";
const hostPort = process.env.MANUSXL_PG_DOCKER_PORT || "55432";

function docker(args, options = {}) {
  return execFileSync("docker", args, {
    encoding: "utf8",
    stdio: options.stdio ?? ["ignore", "pipe", "pipe"],
    timeout: options.timeoutMs ?? 30_000
  }).trim();
}

function hasImage() {
  const result = spawnSync("docker", ["image", "inspect", image], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
  return result.status === 0;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForPostgres(databaseUrl, client) {
  const startedAt = Date.now();
  let lastError = "";
  while (Date.now() - startedAt < 45_000) {
    try {
      runPsql(databaseUrl, ["-X", "-q", "-c", "SELECT 1;"], {
        client,
        timeoutMs: 5000
      });
      return;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      await wait(1000);
    }
  }
  throw new Error(`PostgreSQL 容器启动超时：${lastError}`);
}

function runConcurrency(databaseUrl) {
  const result = spawnSync("node", [join(projectRoot, "scripts", "e2e-postgres-concurrency.mjs")], {
    cwd: projectRoot,
    env: {
      ...process.env,
      MANUSXL_PG_E2E_DATABASE_URL: databaseUrl
    },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
  if (result.stdout.trim()) console.log(result.stdout.trim());
  if (result.stderr.trim()) console.error(result.stderr.trim());
  assert.equal(result.status, 0, `PostgreSQL 并发验收失败，退出码 ${result.status}`);
}

async function main() {
  const psqlClient = checkPsqlClient();
  assert(psqlClient.available, psqlClient.error ?? "未找到可用的 psql 客户端");
  assert(
    hasImage(),
    [
      `缺少 Docker 镜像 ${image}，未自动拉取。`,
      `请先运行：docker pull ${image}`,
      "然后再执行：npm run e2e:pg-docker"
    ].join("\n")
  );

  const databaseUrl = `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@127.0.0.1:${hostPort}/${encodeURIComponent(database)}`;
  let started = false;
  try {
    docker([
      "run",
      "--rm",
      "-d",
      "--name",
      containerName,
      "-e",
      `POSTGRES_USER=${user}`,
      "-e",
      `POSTGRES_PASSWORD=${password}`,
      "-e",
      `POSTGRES_DB=${database}`,
      "-p",
      `127.0.0.1:${hostPort}:5432`,
      image
    ]);
    started = true;
    await waitForPostgres(databaseUrl, psqlClient);
    runConcurrency(databaseUrl);
  } finally {
    if (started) {
      try {
        docker(["rm", "-f", containerName], { timeoutMs: 15_000 });
      } catch (error) {
        console.warn(`清理 PostgreSQL E2E 容器失败：${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
