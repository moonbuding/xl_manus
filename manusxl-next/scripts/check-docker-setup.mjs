import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function read(path) {
  assert(existsSync(path), `${path} 不存在`);
  return readFileSync(path, "utf8");
}

function commandAvailable(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8" });
  return {
    ok: result.status === 0,
    output: `${result.stdout ?? ""}${result.stderr ?? ""}`.trim()
  };
}

const dockerfile = read("Dockerfile");
const compose = read("docker-compose.yml");
const dockerignore = read(".dockerignore");
const envExample = read(".env.local.example");
const quickstart = read("scripts/quickstart.sh");
const nextConfig = read("next.config.ts");

[
  ["Dockerfile 使用 deps 阶段", /FROM node:\d+-alpine AS deps/.test(dockerfile)],
  ["Dockerfile 使用 builder 阶段", /FROM node:\d+-alpine AS builder/.test(dockerfile)],
  ["Dockerfile 使用 runner 阶段", /FROM node:\d+-alpine AS runner/.test(dockerfile)],
  ["Dockerfile 安装锁定依赖", dockerfile.includes("npm ci")],
  ["Dockerfile 执行生产构建", dockerfile.includes("npm run build")],
  ["Dockerfile 复制 standalone 输出", dockerfile.includes(".next/standalone")],
  ["Dockerfile 使用非 root 用户", dockerfile.includes("USER nextjs")],
  ["Dockerfile 暴露 3000 端口", dockerfile.includes("EXPOSE 3000")],
  ["Compose 定义 manusxl 服务", compose.includes("manusxl:")],
  ["Compose 使用 env_file", compose.includes("env_file:") && compose.includes(".env.local")],
  ["Compose 映射默认 3001 端口", compose.includes("${MANUSXL_PORT:-3001}:3000")],
  ["Compose 定义持久化卷", compose.includes("manusxl_data")],
  ["Compose 定义健康检查", compose.includes("healthcheck:") && compose.includes("/api/config")],
  ["Next 启用 standalone 输出", nextConfig.includes('output: "standalone"')],
  [".dockerignore 排除 node_modules", dockerignore.includes("node_modules")],
  [".env.local.example 包含 DeepSeek Key", envExample.includes("DEEPSEEK_API_KEY")],
  ["quickstart 调用 Docker Compose", quickstart.includes("docker compose")]
].forEach(([label, ok]) => {
  assert(ok, `Docker 检查失败：${label}`);
  console.log(`✓ ${label}`);
});

const docker = commandAvailable("docker", ["--version"]);
const composeVersion = commandAvailable("docker", ["compose", "version"]);

if (docker.ok && composeVersion.ok) {
  console.log(`✓ Docker 可用：${docker.output}`);
  console.log(`✓ Docker Compose 可用：${composeVersion.output}`);
  const composeConfig = spawnSync("docker", ["compose", "config"], { encoding: "utf8" });
  assert(composeConfig.status === 0, `docker compose config 失败：${composeConfig.stderr}`);
  console.log("✓ docker compose config 通过");
} else {
  console.log("! 当前环境未检测到 Docker CLI，已完成 Docker 文件静态检查。");
}

console.log("Docker 配置检查完成。");
