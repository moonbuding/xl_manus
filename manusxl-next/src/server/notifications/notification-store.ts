import { DatabaseSync } from "node:sqlite";
import { createId } from "@/lib/id";
import { readUser } from "@/server/auth/auth-store";
import { getEmailDeliveryStatus, sendPlainEmail } from "@/server/auth/email";
import { safeRecordAuditLog } from "@/server/audit/audit-store";
import { getManusDb } from "@/server/sqlite";
import type {
  NotificationChannel,
  NotificationLog,
  NotificationSettings,
  Task,
  TaskStatus
} from "@/types/agent";

type TerminalStatus = Extract<TaskStatus, "completed" | "failed" | "cancelled" | "timeout">;

interface NotificationSettingsRow {
  data_json: string;
}

interface NotificationLogRow {
  data_json: string;
}

interface NotificationStore {
  version: number;
  ensureSchema: () => void;
  getSettings: (ownerId: string) => NotificationSettings | undefined;
  saveSettings: (settings: NotificationSettings) => void;
  insertLog: (log: NotificationLog) => void;
  listLogs: (ownerId: string, limit: number) => NotificationLog[];
}

export interface NotificationSettingsPatch {
  emailEnabled?: boolean;
  webhookEnabled?: boolean;
  slackEnabled?: boolean;
  webhookUrl?: string;
  slackWebhookUrl?: string;
  notifyOnCompleted?: boolean;
  notifyOnFailed?: boolean;
}

const notificationStoreVersion = 1;
const terminalStatuses = new Set<TaskStatus>(["completed", "failed", "cancelled", "timeout"]);

const globalForNotifications = globalThis as unknown as {
  manusxlNotificationStore?: NotificationStore;
  manusxlNotificationSentTaskIds?: Set<string>;
};

function openNotificationDb() {
  const db = getManusDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS notification_settings (
      owner_id TEXT PRIMARY KEY,
      email_enabled INTEGER NOT NULL DEFAULT 0,
      webhook_enabled INTEGER NOT NULL DEFAULT 0,
      slack_enabled INTEGER NOT NULL DEFAULT 0,
      webhook_url TEXT,
      slack_webhook_url TEXT,
      notify_on_completed INTEGER NOT NULL DEFAULT 1,
      notify_on_failed INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      data_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS notification_logs (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      task_id TEXT,
      channel TEXT NOT NULL,
      status TEXT NOT NULL,
      target TEXT,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      error TEXT,
      created_at TEXT NOT NULL,
      data_json TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_notification_logs_owner_id ON notification_logs(owner_id);
    CREATE INDEX IF NOT EXISTS idx_notification_logs_task_id ON notification_logs(task_id);
    CREATE INDEX IF NOT EXISTS idx_notification_logs_created_at ON notification_logs(created_at);
  `);
  ensureNotificationSchema(db);
  return db;
}

function ensureColumn(db: DatabaseSync, table: string, column: string, definition: string) {
  const columns = new Set(
    (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map(
      (item) => item.name
    )
  );
  if (!columns.has(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

function ensureNotificationSchema(db: DatabaseSync) {
  ensureColumn(db, "notification_settings", "slack_enabled", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "notification_settings", "slack_webhook_url", "TEXT");
  ensureColumn(db, "notification_settings", "notify_on_completed", "INTEGER NOT NULL DEFAULT 1");
  ensureColumn(db, "notification_settings", "notify_on_failed", "INTEGER NOT NULL DEFAULT 1");
}

function rowToSettings(row: NotificationSettingsRow | undefined) {
  return row ? (JSON.parse(row.data_json) as NotificationSettings) : undefined;
}

function rowToLog(row: NotificationLogRow) {
  return JSON.parse(row.data_json) as NotificationLog;
}

function createSqliteNotificationStore(): NotificationStore {
  const db = openNotificationDb();
  return {
    version: notificationStoreVersion,
    ensureSchema: () => ensureNotificationSchema(db),
    getSettings: (ownerId) =>
      rowToSettings(
        db
          .prepare("SELECT data_json FROM notification_settings WHERE owner_id = ?")
          .get(ownerId) as NotificationSettingsRow | undefined
      ),
    saveSettings: (settings) => {
      db.prepare(
        `
          INSERT INTO notification_settings
            (owner_id, email_enabled, webhook_enabled, slack_enabled, webhook_url, slack_webhook_url,
             notify_on_completed, notify_on_failed, created_at, updated_at, data_json)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(owner_id) DO UPDATE SET
            email_enabled = excluded.email_enabled,
            webhook_enabled = excluded.webhook_enabled,
            slack_enabled = excluded.slack_enabled,
            webhook_url = excluded.webhook_url,
            slack_webhook_url = excluded.slack_webhook_url,
            notify_on_completed = excluded.notify_on_completed,
            notify_on_failed = excluded.notify_on_failed,
            updated_at = excluded.updated_at,
            data_json = excluded.data_json
        `
      ).run(
        settings.ownerId,
        settings.emailEnabled ? 1 : 0,
        settings.webhookEnabled ? 1 : 0,
        settings.slackEnabled ? 1 : 0,
        settings.webhookUrl ?? null,
        settings.slackWebhookUrl ?? null,
        settings.notifyOnCompleted ? 1 : 0,
        settings.notifyOnFailed ? 1 : 0,
        settings.createdAt,
        settings.updatedAt,
        JSON.stringify(settings)
      );
    },
    insertLog: (log) => {
      db.prepare(
        `
          INSERT INTO notification_logs
            (id, owner_id, task_id, channel, status, target, title, message, error, created_at, data_json)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `
      ).run(
        log.id,
        log.ownerId,
        log.taskId ?? null,
        log.channel,
        log.status,
        log.target ?? null,
        log.title,
        log.message,
        log.error ?? null,
        log.createdAt,
        JSON.stringify(log)
      );
    },
    listLogs: (ownerId, limit) =>
      (db
        .prepare(
          `
            SELECT data_json FROM notification_logs
            WHERE owner_id = ?
            ORDER BY datetime(created_at) DESC, id DESC
            LIMIT ?
          `
        )
        .all(ownerId, Math.max(1, Math.min(limit, 100))) as unknown as NotificationLogRow[]).map(rowToLog)
  };
}

function getNotificationStore() {
  const existing = globalForNotifications.manusxlNotificationStore;
  if (existing?.version === notificationStoreVersion) {
    existing.ensureSchema();
    return existing;
  }
  const store = createSqliteNotificationStore();
  globalForNotifications.manusxlNotificationStore = store;
  return store;
}

function defaultSettings(ownerId: string): NotificationSettings {
  const now = new Date().toISOString();
  return {
    ownerId,
    emailEnabled: false,
    webhookEnabled: false,
    slackEnabled: false,
    notifyOnCompleted: true,
    notifyOnFailed: true,
    createdAt: now,
    updatedAt: now
  };
}

function sanitizeUrl(value?: string) {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}

export function getNotificationSettings(ownerId: string) {
  return getNotificationStore().getSettings(ownerId) ?? defaultSettings(ownerId);
}

export function updateNotificationSettings(ownerId: string, patch: NotificationSettingsPatch) {
  const current = getNotificationSettings(ownerId);
  const next: NotificationSettings = {
    ...current,
    emailEnabled: patch.emailEnabled ?? current.emailEnabled,
    webhookEnabled: patch.webhookEnabled ?? current.webhookEnabled,
    slackEnabled: patch.slackEnabled ?? current.slackEnabled,
    webhookUrl: patch.webhookUrl !== undefined ? sanitizeUrl(patch.webhookUrl) : current.webhookUrl,
    slackWebhookUrl:
      patch.slackWebhookUrl !== undefined ? sanitizeUrl(patch.slackWebhookUrl) : current.slackWebhookUrl,
    notifyOnCompleted: patch.notifyOnCompleted ?? current.notifyOnCompleted,
    notifyOnFailed: patch.notifyOnFailed ?? current.notifyOnFailed,
    updatedAt: new Date().toISOString()
  };
  getNotificationStore().saveSettings(next);
  safeRecordAuditLog({
    userId: ownerId,
    action: "notifications.settings_update",
    resource: "notifications",
    status: "completed",
    metadata: {
      emailEnabled: next.emailEnabled,
      webhookEnabled: next.webhookEnabled,
      slackEnabled: next.slackEnabled,
      notifyOnCompleted: next.notifyOnCompleted,
      notifyOnFailed: next.notifyOnFailed
    }
  });
  return next;
}

export function listNotificationLogs(ownerId: string, limit = 20) {
  return getNotificationStore().listLogs(ownerId, limit);
}

function publicBaseUrl() {
  return (
    process.env.MANUSXL_PUBLIC_BASE_URL?.trim() ||
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    `http://localhost:${process.env.PORT || "3000"}`
  ).replace(/\/+$/, "");
}

function taskUrl(taskId?: string) {
  const base = publicBaseUrl();
  return taskId ? `${base}/?taskId=${encodeURIComponent(taskId)}` : base;
}

function shouldNotify(settings: NotificationSettings, status: TaskStatus) {
  if (status === "completed") return settings.notifyOnCompleted;
  if (status === "failed" || status === "timeout" || status === "cancelled") return settings.notifyOnFailed;
  return false;
}

function notificationText(task: Pick<Task, "id" | "prompt" | "status" | "finalAnswer" | "error" | "updatedAt">) {
  const statusText = task.status === "completed" ? "已完成" : task.status === "timeout" ? "已超时" : "失败";
  const title = `ManusXL 任务${statusText}`;
  const summary = task.finalAnswer?.slice(0, 500) || task.error || "任务已经结束，请回到 ManusXL 查看详情。";
  const message = [
    `任务：${task.prompt}`,
    `状态：${statusText}`,
    `时间：${task.updatedAt}`,
    "",
    summary,
    "",
    `打开任务：${taskUrl(task.id)}`
  ].join("\n");
  return { title, message };
}

function insertLog(input: Omit<NotificationLog, "id" | "createdAt">) {
  const log: NotificationLog = {
    id: createId("noti"),
    createdAt: new Date().toISOString(),
    ...input
  };
  getNotificationStore().insertLog(log);
  return log;
}

async function postJsonWithTimeout(url: string, body: unknown) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
  } finally {
    clearTimeout(timer);
  }
}

async function sendEmailNotification(ownerId: string, task: Task, title: string, message: string) {
  const user = readUser(ownerId);
  const target = user?.email;
  if (!target) {
    return insertLog({
      ownerId,
      taskId: task.id,
      channel: "email",
      status: "failed",
      title,
      message,
      error: "用户邮箱不存在"
    });
  }
  const result = await sendPlainEmail({ to: target, subject: title, text: message });
  return insertLog({
    ownerId,
    taskId: task.id,
    channel: "email",
    status: result.sent ? "sent" : result.mode === "development" ? "development" : "failed",
    target,
    title,
    message,
    error: result.error
  });
}

async function sendWebhookNotification(
  ownerId: string,
  task: Pick<Task, "id" | "prompt" | "status" | "updatedAt">,
  channel: Extract<NotificationChannel, "webhook" | "slack">,
  target: string,
  title: string,
  message: string
) {
  const payload =
    channel === "slack"
      ? {
          text: title,
          blocks: [
            { type: "header", text: { type: "plain_text", text: title } },
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text: `*任务*：${task.prompt}\n*状态*：${task.status}\n*链接*：${taskUrl(task.id)}`
              }
            }
          ]
        }
      : {
          title,
          message,
          task: {
            id: task.id,
            prompt: task.prompt,
            status: task.status,
            updatedAt: task.updatedAt,
            url: taskUrl(task.id)
          }
        };

  try {
    await postJsonWithTimeout(target, payload);
    return insertLog({ ownerId, taskId: task.id, channel, status: "sent", target, title, message });
  } catch (error) {
    return insertLog({
      ownerId,
      taskId: task.id,
      channel,
      status: "failed",
      target,
      title,
      message,
      error: error instanceof Error ? error.message : "Webhook 发送失败"
    });
  }
}

export async function sendTaskNotification(task: Task) {
  if (!task.ownerId || !terminalStatuses.has(task.status)) return [];
  const settings = getNotificationSettings(task.ownerId);
  if (!shouldNotify(settings, task.status)) return [];

  const { title, message } = notificationText(task);
  const logs: NotificationLog[] = [];
  if (!settings.emailEnabled && !settings.webhookEnabled && !settings.slackEnabled) {
    logs.push(
      insertLog({
        ownerId: task.ownerId,
        taskId: task.id,
        channel: "email",
        status: "skipped",
        title,
        message,
        error: "通知渠道未启用"
      })
    );
    return logs;
  }

  if (settings.emailEnabled) logs.push(await sendEmailNotification(task.ownerId, task, title, message));
  if (settings.webhookEnabled && settings.webhookUrl) {
    logs.push(await sendWebhookNotification(task.ownerId, task, "webhook", settings.webhookUrl, title, message));
  }
  if (settings.slackEnabled && settings.slackWebhookUrl) {
    logs.push(
      await sendWebhookNotification(task.ownerId, task, "slack", settings.slackWebhookUrl, title, message)
    );
  }
  return logs;
}

export function queueTaskNotification(task: Task) {
  if (!task.ownerId || !terminalStatuses.has(task.status)) return;
  const sent = (globalForNotifications.manusxlNotificationSentTaskIds ??= new Set<string>());
  if (sent.has(task.id)) return;
  sent.add(task.id);
  void sendTaskNotification(task).catch((error) => {
    insertLog({
      ownerId: task.ownerId!,
      taskId: task.id,
      channel: "email",
      status: "failed",
      title: "ManusXL 通知失败",
      message: task.prompt,
      error: error instanceof Error ? error.message : "通知发送失败"
    });
  });
}

export async function sendTestNotification(ownerId: string, status: TerminalStatus = "completed") {
  const now = new Date().toISOString();
  return sendTaskNotification({
    id: createId("task_test_notification"),
    ownerId,
    prompt: "ManusXL 通知链路测试",
    status,
    model: "notification-test",
    createdAt: now,
    updatedAt: now,
    events: [],
    artifacts: [],
    finalAnswer: status === "completed" ? "这是一条开发环境通知测试。" : undefined,
    error: status === "completed" ? undefined : "这是一条失败通知测试。"
  });
}

export function notificationRuntimeStatus() {
  const email = getEmailDeliveryStatus();
  return {
    emailMode: email.mode,
    emailConfigured: email.configured,
    webhookSupported: true,
    slackSupported: true
  };
}
