import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createId } from "@/lib/id";
import {
  canUsePostgresRuntime,
  checkPsqlCli,
  requestedDatabaseProvider,
  runPsql
} from "@/server/db/provider";
import { getManusDb } from "@/server/sqlite";
import type { AuthUser } from "@/types/agent";

const accessCookieName = "manusxl_session";
const refreshCookieName = "manusxl_refresh";
const accessMaxAgeSeconds = 7 * 24 * 60 * 60;
const refreshMaxAgeSeconds = 30 * 24 * 60 * 60;
const jwtSecret = process.env.MANUSXL_AUTH_SECRET || "manusxl-local-dev-secret";

const globalForAuth = globalThis as unknown as {
  manusxlAuthStore?: AuthPersistenceAdapter;
};

interface UserRow {
  id: string;
  email: string;
  phone: string | null;
  display_name: string;
  password_hash: string;
  email_verified: number;
  verification_code: string | null;
  created_at: string;
  updated_at: string;
  data_json: string;
}

interface SessionPayload {
  sub: string;
  type: "access" | "refresh";
  exp: number;
}

interface AuthPersistenceAdapter {
  provider: "sqlite" | "postgres";
  ensureSchema: () => void;
  getByEmail: (email: string) => UserRow | undefined;
  getByPhone: (phone: string) => UserRow | undefined;
  getById: (userId: string) => UserRow | undefined;
  upsert: (row: UserRow) => void;
}

function openAuthDb() {
  const db = getManusDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      phone TEXT UNIQUE,
      display_name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      email_verified INTEGER NOT NULL,
      verification_code TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      data_json TEXT NOT NULL
    );
  `);
  ensureAuthColumns(db);
  return db;
}

function ensureAuthColumns(db: DatabaseSync) {
  const columns = new Set(
    (db.prepare("PRAGMA table_info(users)").all() as Array<{ name: string }>).map(
      (column) => column.name
    )
  );
  if (!columns.has("phone")) {
    db.exec("ALTER TABLE users ADD COLUMN phone TEXT");
    db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_phone ON users(phone)");
  }
}

function upsertUserRowSqlite(db: DatabaseSync, row: UserRow) {
  db.prepare(
    `
    INSERT INTO users
      (id, email, phone, display_name, password_hash, email_verified, verification_code, created_at, updated_at, data_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      email = excluded.email,
      phone = excluded.phone,
      display_name = excluded.display_name,
      password_hash = excluded.password_hash,
      email_verified = excluded.email_verified,
      verification_code = excluded.verification_code,
      updated_at = excluded.updated_at,
      data_json = excluded.data_json
  `
  )
    .run(
      row.id,
      row.email,
      row.phone,
      row.display_name,
      row.password_hash,
      row.email_verified,
      row.verification_code,
      row.created_at,
      row.updated_at,
      row.data_json
    );
}

function createSqliteAuthStore(): AuthPersistenceAdapter {
  const db = openAuthDb();
  return {
    provider: "sqlite",
    ensureSchema: () => ensureAuthColumns(db),
    getByEmail: (email) =>
      db.prepare("SELECT * FROM users WHERE email = ?").get(normalizeEmail(email)) as UserRow | undefined,
    getByPhone: (phone) =>
      db.prepare("SELECT * FROM users WHERE phone = ?").get(normalizePhone(phone)) as UserRow | undefined,
    getById: (userId) =>
      db.prepare("SELECT * FROM users WHERE id = ?").get(userId) as UserRow | undefined,
    upsert: (row) => upsertUserRowSqlite(db, row)
  };
}

function postgresSchemaPath() {
  return join(process.cwd(), "db", "postgres", "0001_initial.sql");
}

function quotePostgresString(value: string) {
  return `'${value.replaceAll("'", "''")}'`;
}

function postgresValue(value: string | number | null | undefined, options: { json?: boolean } = {}) {
  if (value === undefined || value === null) return "NULL";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "NULL";
  return options.json ? `${quotePostgresString(value)}::jsonb` : quotePostgresString(value);
}

function ensurePostgresSchema() {
  const schemaPath = postgresSchemaPath();
  if (!existsSync(schemaPath)) {
    throw new Error(`找不到 PostgreSQL schema：${schemaPath}`);
  }
  runPsql(["-f", schemaPath]);
}

function parsePostgresUserRow(output: string) {
  const line = output.trim();
  return line ? (JSON.parse(line) as UserRow) : undefined;
}

function selectUserRowJson(whereSql: string) {
  return `
    SELECT json_build_object(
      'id', id,
      'email', email,
      'phone', phone,
      'display_name', display_name,
      'password_hash', password_hash,
      'email_verified', email_verified,
      'verification_code', verification_code,
      'created_at', created_at,
      'updated_at', updated_at,
      'data_json', data_json::text
    )::text
    FROM users
    WHERE ${whereSql}
    LIMIT 1;
  `;
}

function upsertUserRowPostgres(row: UserRow) {
  runPsql([
    "-c",
    `
      INSERT INTO users
        (id, email, phone, display_name, password_hash, email_verified, verification_code, created_at, updated_at, data_json)
      VALUES (
        ${postgresValue(row.id)},
        ${postgresValue(row.email)},
        ${postgresValue(row.phone)},
        ${postgresValue(row.display_name)},
        ${postgresValue(row.password_hash)},
        ${postgresValue(row.email_verified)},
        ${postgresValue(row.verification_code)},
        ${postgresValue(row.created_at)},
        ${postgresValue(row.updated_at)},
        ${postgresValue(row.data_json, { json: true })}
      )
      ON CONFLICT (id) DO UPDATE SET
        email = EXCLUDED.email,
        phone = EXCLUDED.phone,
        display_name = EXCLUDED.display_name,
        password_hash = EXCLUDED.password_hash,
        email_verified = EXCLUDED.email_verified,
        verification_code = EXCLUDED.verification_code,
        updated_at = EXCLUDED.updated_at,
        data_json = EXCLUDED.data_json;
    `
  ]);
}

function createPostgresAuthStore(): AuthPersistenceAdapter {
  ensurePostgresSchema();
  return {
    provider: "postgres",
    ensureSchema: ensurePostgresSchema,
    getByEmail: (email) =>
      parsePostgresUserRow(
        runPsql(["-At", "-c", selectUserRowJson(`email = ${postgresValue(normalizeEmail(email))}`)])
      ),
    getByPhone: (phone) =>
      parsePostgresUserRow(
        runPsql(["-At", "-c", selectUserRowJson(`phone = ${postgresValue(normalizePhone(phone))}`)])
      ),
    getById: (userId) =>
      parsePostgresUserRow(
        runPsql(["-At", "-c", selectUserRowJson(`id = ${postgresValue(userId)}`)])
      ),
    upsert: upsertUserRowPostgres
  };
}

function createAuthStore(): AuthPersistenceAdapter {
  const requestedProvider = requestedDatabaseProvider();
  if (requestedProvider === "postgres") {
    const psql = checkPsqlCli();
    if (!canUsePostgresRuntime(psql)) {
      console.warn(
        "MANUSXL_DATABASE_PROVIDER=postgres 已设置，但 DATABASE_URL 或 psql CLI 不可用，认证存储回退 SQLite。"
      );
      return createSqliteAuthStore();
    }
    try {
      return createPostgresAuthStore();
    } catch (error) {
      console.warn(
        `PostgreSQL 认证存储初始化失败，已回退 SQLite：${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
  return createSqliteAuthStore();
}

function getAuthStore() {
  globalForAuth.manusxlAuthStore ??= createAuthStore();
  globalForAuth.manusxlAuthStore.ensureSchema();
  return globalForAuth.manusxlAuthStore;
}

function base64Url(input: Buffer | string) {
  return Buffer.from(input).toString("base64url");
}

function sign(value: string) {
  return createHmac("sha256", jwtSecret).update(value).digest("base64url");
}

function makeToken(payload: SessionPayload) {
  const header = base64Url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = base64Url(JSON.stringify(payload));
  return `${header}.${body}.${sign(`${header}.${body}`)}`;
}

function verifyToken(token: string, type: SessionPayload["type"]) {
  const [header, body, signature] = token.split(".");
  if (!header || !body || !signature) return undefined;
  const expected = sign(`${header}.${body}`);
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length || !timingSafeEqual(actualBuffer, expectedBuffer)) {
    return undefined;
  }

  const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as SessionPayload;
  if (payload.type !== type || payload.exp < Math.floor(Date.now() / 1000)) return undefined;
  return payload;
}

function hashPassword(password: string) {
  const salt = randomBytes(16).toString("base64url");
  const hash = scryptSync(password, salt, 32).toString("base64url");
  return `${salt}.${hash}`;
}

function verifyPassword(password: string, stored: string) {
  const [salt, hash] = stored.split(".");
  if (!salt || !hash) return false;
  const computed = scryptSync(password, salt, 32);
  const storedBuffer = Buffer.from(hash, "base64url");
  return storedBuffer.length === computed.length && timingSafeEqual(storedBuffer, computed);
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function normalizePhone(phone: string) {
  return phone.replace(/[^\d+]/g, "").replace(/^\+86/, "");
}

function phoneEmail(phone: string) {
  return `${normalizePhone(phone)}@phone.manusxl.local`;
}

function publicUser(row: UserRow): AuthUser {
  return {
    id: row.id,
    email: row.email,
    phone: row.phone ?? undefined,
    displayName: row.display_name,
    emailVerified: row.email_verified === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function getUserRowByEmail(email: string) {
  return getAuthStore().getByEmail(email);
}

function getUserRowByPhone(phone: string) {
  return getAuthStore().getByPhone(phone);
}

function getUserRowById(userId: string) {
  return getAuthStore().getById(userId);
}

function upsertUserRow(row: UserRow) {
  getAuthStore().upsert(row);
}

export function createUser(input: { email: string; password: string; displayName?: string }) {
  const email = normalizeEmail(input.email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("邮箱格式不正确");
  if (input.password.length < 8) throw new Error("密码至少需要 8 位");
  if (getUserRowByEmail(email)) throw new Error("该邮箱已注册");

  const now = new Date().toISOString();
  const verificationCode = String(Math.floor(100000 + Math.random() * 900000));
  const user: AuthUser = {
    id: createId("usr"),
    email,
    displayName: input.displayName?.trim() || email.split("@")[0],
    emailVerified: false,
    createdAt: now,
    updatedAt: now
  };

  upsertUserRow({
    id: user.id,
    email: user.email,
    phone: null,
    display_name: user.displayName,
    password_hash: hashPassword(input.password),
    email_verified: 0,
    verification_code: verificationCode,
    created_at: user.createdAt,
    updated_at: user.updatedAt,
    data_json: JSON.stringify(user)
  });

  return { user, verificationCode };
}

export function requestPhoneLoginCode(input: { phone: string }) {
  const phone = normalizePhone(input.phone);
  if (!/^1\d{10}$/.test(phone)) throw new Error("请输入 11 位手机号");

  const now = new Date().toISOString();
  const verificationCode = String(Math.floor(100000 + Math.random() * 900000));
  const existing = getUserRowByPhone(phone);

  if (existing) {
    const user = {
      ...publicUser(existing),
      updatedAt: now
    };
    upsertUserRow({
      ...existing,
      email_verified: 1,
      verification_code: verificationCode,
      updated_at: now,
      data_json: JSON.stringify(user)
    });
    return { user, verificationCode };
  }

  const user: AuthUser = {
    id: createId("usr"),
    email: phoneEmail(phone),
    phone,
    displayName: `用户${phone.slice(-4)}`,
    emailVerified: true,
    createdAt: now,
    updatedAt: now
  };

  upsertUserRow({
    id: user.id,
    email: user.email,
    phone: user.phone ?? null,
    display_name: user.displayName,
    password_hash: hashPassword(randomBytes(18).toString("base64url")),
    email_verified: 1,
    verification_code: verificationCode,
    created_at: user.createdAt,
    updated_at: user.updatedAt,
    data_json: JSON.stringify(user)
  });

  return { user, verificationCode };
}

export function verifyPhoneLogin(input: { phone: string; code: string }) {
  const row = getUserRowByPhone(input.phone);
  if (!row) throw new Error("请先获取验证码");
  if (row.verification_code !== input.code.trim()) throw new Error("验证码不正确");

  const now = new Date().toISOString();
  const user = {
    ...publicUser(row),
    updatedAt: now
  };
  upsertUserRow({
    ...row,
    email_verified: 1,
    verification_code: null,
    updated_at: now,
    data_json: JSON.stringify(user)
  });
  return user;
}

export function verifyEmail(input: { email: string; code: string }) {
  const row = getUserRowByEmail(input.email);
  if (!row) throw new Error("用户不存在");
  if (row.email_verified === 1) return publicUser(row);
  if (row.verification_code !== input.code.trim()) throw new Error("验证码不正确");

  const now = new Date().toISOString();
  const user = {
    ...publicUser(row),
    emailVerified: true,
    updatedAt: now
  };
  upsertUserRow({
    ...row,
    email_verified: 1,
    verification_code: null,
    updated_at: now,
    data_json: JSON.stringify(user)
  });
  return user;
}

export function authenticateUser(email: string, password: string) {
  const row = getUserRowByEmail(email);
  if (!row || !verifyPassword(password, row.password_hash)) throw new Error("邮箱或密码不正确");
  if (row.email_verified !== 1) throw new Error("邮箱还未验证");
  return publicUser(row);
}

export function upsertOAuthUser(input: {
  provider: string;
  providerAccountId: string;
  email?: string | null;
  displayName?: string | null;
}) {
  const email = input.email?.trim()
    ? normalizeEmail(input.email)
    : `${input.provider}-${input.providerAccountId}@oauth.manusxl.local`;
  const existing = getUserRowByEmail(email);
  const now = new Date().toISOString();

  if (existing) {
    const user = {
      ...publicUser(existing),
      displayName: input.displayName?.trim() || publicUser(existing).displayName,
      emailVerified: true,
      updatedAt: now
    };
    upsertUserRow({
      ...existing,
      display_name: user.displayName,
      email_verified: 1,
      updated_at: now,
      data_json: JSON.stringify(user)
    });
    return user;
  }

  const user: AuthUser = {
    id: createId("usr"),
    email,
    displayName: input.displayName?.trim() || email.split("@")[0],
    emailVerified: true,
    createdAt: now,
    updatedAt: now
  };

  upsertUserRow({
    id: user.id,
    email: user.email,
    phone: null,
    display_name: user.displayName,
    password_hash: hashPassword(randomBytes(18).toString("base64url")),
    email_verified: 1,
    verification_code: null,
    created_at: user.createdAt,
    updated_at: user.updatedAt,
    data_json: JSON.stringify({
      ...user,
      authProvider: input.provider,
      providerAccountId: input.providerAccountId
    })
  });

  return user;
}

export function readUser(userId: string) {
  const row = getUserRowById(userId);
  return row ? publicUser(row) : undefined;
}

export function makeSessionTokens(userId: string) {
  const now = Math.floor(Date.now() / 1000);
  return {
    accessToken: makeToken({ sub: userId, type: "access", exp: now + accessMaxAgeSeconds }),
    refreshToken: makeToken({ sub: userId, type: "refresh", exp: now + refreshMaxAgeSeconds })
  };
}

export function getAuthCookieNames() {
  return { accessCookieName, refreshCookieName, accessMaxAgeSeconds, refreshMaxAgeSeconds };
}

export function readAuthUserFromCookieHeader(cookieHeader: string | null) {
  const cookies = Object.fromEntries(
    (cookieHeader ?? "")
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const index = part.indexOf("=");
        return index >= 0 ? [part.slice(0, index), decodeURIComponent(part.slice(index + 1))] : [part, ""];
      })
  );
  const token = cookies[accessCookieName];
  if (!token) return undefined;
  const payload = verifyToken(token, "access");
  return payload ? readUser(payload.sub) : undefined;
}

export function readAuthUserFromAccessToken(token: string | null | undefined) {
  if (!token) return undefined;
  const payload = verifyToken(token, "access");
  return payload ? readUser(payload.sub) : undefined;
}

export function refreshAccessToken(refreshToken: string) {
  const payload = verifyToken(refreshToken, "refresh");
  if (!payload) return undefined;
  const user = readUser(payload.sub);
  if (!user) return undefined;
  return {
    user,
    ...makeSessionTokens(user.id)
  };
}
