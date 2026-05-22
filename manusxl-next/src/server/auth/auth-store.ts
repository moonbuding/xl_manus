import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { createId } from "@/lib/id";
import { getManusDb } from "@/server/sqlite";
import type { AuthUser } from "@/types/agent";

const accessCookieName = "manusxl_session";
const refreshCookieName = "manusxl_refresh";
const accessMaxAgeSeconds = 7 * 24 * 60 * 60;
const refreshMaxAgeSeconds = 30 * 24 * 60 * 60;
const jwtSecret = process.env.MANUSXL_AUTH_SECRET || "manusxl-local-dev-secret";

const globalForAuth = globalThis as unknown as {
  manusxlAuthDb?: DatabaseSync;
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

function getDb() {
  globalForAuth.manusxlAuthDb ??= openAuthDb();
  return globalForAuth.manusxlAuthDb;
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
  return getDb()
    .prepare("SELECT * FROM users WHERE email = ?")
    .get(normalizeEmail(email)) as UserRow | undefined;
}

function getUserRowByPhone(phone: string) {
  return getDb()
    .prepare("SELECT * FROM users WHERE phone = ?")
    .get(normalizePhone(phone)) as UserRow | undefined;
}

function getUserRowById(userId: string) {
  return getDb().prepare("SELECT * FROM users WHERE id = ?").get(userId) as UserRow | undefined;
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

  getDb()
    .prepare(
      `
      INSERT INTO users
        (id, email, display_name, password_hash, email_verified, verification_code, created_at, updated_at, data_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
    )
    .run(
      user.id,
      user.email,
      user.displayName,
      hashPassword(input.password),
      0,
      verificationCode,
      user.createdAt,
      user.updatedAt,
      JSON.stringify(user)
    );

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
    getDb()
      .prepare(
        `
        UPDATE users
        SET verification_code = ?, email_verified = 1, updated_at = ?, data_json = ?
        WHERE id = ?
      `
      )
      .run(verificationCode, now, JSON.stringify(user), existing.id);
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

  getDb()
    .prepare(
      `
      INSERT INTO users
        (id, email, phone, display_name, password_hash, email_verified, verification_code, created_at, updated_at, data_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
    )
    .run(
      user.id,
      user.email,
      user.phone ?? null,
      user.displayName,
      hashPassword(randomBytes(18).toString("base64url")),
      1,
      verificationCode,
      user.createdAt,
      user.updatedAt,
      JSON.stringify(user)
    );

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
  getDb()
    .prepare(
      `
      UPDATE users
      SET verification_code = NULL, email_verified = 1, updated_at = ?, data_json = ?
      WHERE id = ?
    `
    )
    .run(now, JSON.stringify(user), row.id);
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
  getDb()
    .prepare(
      `
      UPDATE users
      SET email_verified = 1, verification_code = NULL, updated_at = ?, data_json = ?
      WHERE id = ?
    `
    )
    .run(now, JSON.stringify(user), row.id);
  return user;
}

export function authenticateUser(email: string, password: string) {
  const row = getUserRowByEmail(email);
  if (!row || !verifyPassword(password, row.password_hash)) throw new Error("邮箱或密码不正确");
  if (row.email_verified !== 1) throw new Error("邮箱还未验证");
  return publicUser(row);
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
