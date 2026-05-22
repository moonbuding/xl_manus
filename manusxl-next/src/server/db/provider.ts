import { spawnSync } from "node:child_process";

export type ManusDatabaseProvider = "sqlite" | "postgres";

export interface PsqlCliStatus {
  available: boolean;
  version?: string;
}

export function requestedDatabaseProvider(): ManusDatabaseProvider {
  return process.env.MANUSXL_DATABASE_PROVIDER?.trim().toLowerCase() === "postgres"
    ? "postgres"
    : "sqlite";
}

export function postgresDatabaseUrl() {
  return process.env.DATABASE_URL?.trim() || undefined;
}

export function checkPsqlCli(): PsqlCliStatus {
  const result = spawnSync("psql", ["--version"], {
    encoding: "utf8",
    timeout: 3000,
    stdio: "pipe"
  });
  if (result.status !== 0) {
    return { available: false };
  }
  return { available: true, version: result.stdout.trim() };
}

export function canUsePostgresRuntime(psql = checkPsqlCli()) {
  return requestedDatabaseProvider() === "postgres" && Boolean(postgresDatabaseUrl()) && psql.available;
}
