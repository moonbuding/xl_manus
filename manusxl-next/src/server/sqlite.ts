import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { dataPath } from "@/server/data-root";

const dbFile = dataPath("manusxl.sqlite");

const globalForSqlite = globalThis as unknown as {
  manusxlDb?: DatabaseSync;
};

export function getManusDb() {
  if (!globalForSqlite.manusxlDb) {
    mkdirSync(dirname(dbFile), { recursive: true });
    const db = new DatabaseSync(dbFile);
    db.exec(`
      PRAGMA busy_timeout = 10000;
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      PRAGMA foreign_keys = ON;
    `);
    globalForSqlite.manusxlDb = db;
  }
  return globalForSqlite.manusxlDb;
}
