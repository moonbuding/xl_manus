import { Buffer } from "node:buffer";
import { hostname } from "node:os";
import net from "node:net";
import tls from "node:tls";

interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user?: string;
  password?: string;
  from: string;
}

interface SmtpResponse {
  code: number;
  lines: string[];
}

type SmtpSocket = net.Socket | tls.TLSSocket;

interface MailInput {
  to: string;
  subject: string;
  text: string;
}

type EmailDeliveryMode = "development" | "smtp";

export interface EmailDeliveryResult {
  ok: boolean;
  mode: EmailDeliveryMode;
  sent: boolean;
  verificationCodeExposed: boolean;
  error?: string;
}

function envBoolean(name: string, fallback = false) {
  const value = process.env[name]?.trim().toLowerCase();
  if (!value) return fallback;
  return value === "1" || value === "true" || value === "yes";
}

function shouldExposeVerificationCode() {
  const configured = process.env.MANUSXL_AUTH_SHOW_VERIFICATION_CODE?.trim().toLowerCase();
  if (configured) return configured === "1" || configured === "true" || configured === "yes";
  return process.env.NODE_ENV !== "production";
}

function smtpConfig(): SmtpConfig | undefined {
  const host = process.env.MANUSXL_SMTP_HOST?.trim();
  const from = process.env.MANUSXL_EMAIL_FROM?.trim() || process.env.MANUSXL_SMTP_FROM?.trim();
  if (!host || !from) return undefined;

  const secure = envBoolean("MANUSXL_SMTP_SECURE", process.env.MANUSXL_SMTP_PORT === "465");
  const port = Number(process.env.MANUSXL_SMTP_PORT ?? (secure ? 465 : 25));
  return {
    host,
    port: Number.isFinite(port) ? port : secure ? 465 : 25,
    secure,
    user: process.env.MANUSXL_SMTP_USER?.trim() || undefined,
    password: process.env.MANUSXL_SMTP_PASSWORD || undefined,
    from
  };
}

function sanitizeAddress(address: string) {
  const value = address.trim();
  if (!value || /[\r\n<>]/.test(value)) throw new Error("邮件地址不合法");
  return value;
}

function encodeHeader(value: string) {
  return `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

function dotStuff(text: string) {
  return text
    .replace(/\r?\n/g, "\r\n")
    .split("\r\n")
    .map((line) => (line.startsWith(".") ? `.${line}` : line))
    .join("\r\n");
}

function buildMessage(input: MailInput, from: string) {
  const safeFrom = sanitizeAddress(from);
  const safeTo = sanitizeAddress(input.to);
  const body = input.text.replace(/\r?\n/g, "\r\n");
  return [
    `From: <${safeFrom}>`,
    `To: <${safeTo}>`,
    `Subject: ${encodeHeader(input.subject)}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    body
  ].join("\r\n");
}

class SmtpSession {
  private socket?: SmtpSocket;
  private buffer = "";
  private lines: string[] = [];
  private waiters: Array<{
    resolve: (line: string) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }> = [];

  constructor(private readonly config: SmtpConfig) {}

  async connect() {
    this.socket = this.config.secure
      ? tls.connect({
          host: this.config.host,
          port: this.config.port,
          servername: this.config.host,
          timeout: 10_000
        })
      : net.connect({
          host: this.config.host,
          port: this.config.port,
          timeout: 10_000
        });

    this.socket.setEncoding("utf8");
    this.socket.on("data", (chunk) => this.receive(chunk.toString()));
    this.socket.on("error", (error) => this.rejectAll(error));
    this.socket.on("timeout", () => this.rejectAll(new Error("SMTP 连接超时")));
    await new Promise<void>((resolve, reject) => {
      const socket = this.socket;
      if (!socket) return reject(new Error("SMTP socket 未初始化"));
      const onError = (error: Error) => {
        socket.off("connect", onConnect);
        socket.off("secureConnect", onConnect);
        reject(error);
      };
      const onConnect = () => {
        socket.off("error", onError);
        resolve();
      };
      socket.once("error", onError);
      socket.once(this.config.secure ? "secureConnect" : "connect", onConnect);
    });
    await this.expect([220]);
  }

  async command(command: string, expected: number[]) {
    this.write(`${command}\r\n`);
    return this.expect(expected);
  }

  async data(message: string) {
    this.write(`${dotStuff(message)}\r\n.\r\n`);
    return this.expect([250]);
  }

  close() {
    this.socket?.end();
  }

  private write(value: string) {
    if (!this.socket) throw new Error("SMTP socket 未连接");
    this.socket.write(value);
  }

  private receive(chunk: string) {
    this.buffer += chunk;
    let index = this.buffer.indexOf("\n");
    while (index >= 0) {
      const line = this.buffer.slice(0, index).replace(/\r$/, "");
      this.buffer = this.buffer.slice(index + 1);
      const waiter = this.waiters.shift();
      if (waiter) {
        clearTimeout(waiter.timer);
        waiter.resolve(line);
      } else {
        this.lines.push(line);
      }
      index = this.buffer.indexOf("\n");
    }
  }

  private rejectAll(error: Error) {
    const waiters = this.waiters.splice(0);
    waiters.forEach((waiter) => {
      clearTimeout(waiter.timer);
      waiter.reject(error);
    });
  }

  private readLine(timeoutMs = 10_000) {
    const queued = this.lines.shift();
    if (queued !== undefined) return Promise.resolve(queued);

    return new Promise<string>((resolve, reject) => {
      const waiter = {
        resolve,
        reject,
        timer: setTimeout(() => {
          this.waiters = this.waiters.filter((candidate) => candidate !== waiter);
          reject(new Error("SMTP 响应超时"));
        }, timeoutMs)
      };
      this.waiters.push(waiter);
    });
  }

  private async readResponse(): Promise<SmtpResponse> {
    const first = await this.readLine();
    const code = Number(first.slice(0, 3));
    if (!Number.isFinite(code)) throw new Error(`SMTP 响应不合法：${first}`);
    const lines = [first];
    while (lines[lines.length - 1]?.startsWith(`${code}-`)) {
      lines.push(await this.readLine());
    }
    return { code, lines };
  }

  private async expect(expected: number[]) {
    const response = await this.readResponse();
    if (!expected.includes(response.code)) {
      throw new Error(`SMTP 返回 ${response.code}：${response.lines.join(" / ")}`);
    }
    return response;
  }
}

async function sendSmtpMail(config: SmtpConfig, input: MailInput) {
  const session = new SmtpSession(config);
  try {
    await session.connect();
    await session.command(`EHLO ${hostname() || "manusxl.local"}`, [250]);
    if (config.user && config.password) {
      const payload = Buffer.from(`\0${config.user}\0${config.password}`, "utf8").toString("base64");
      await session.command(`AUTH PLAIN ${payload}`, [235]);
    }
    await session.command(`MAIL FROM:<${sanitizeAddress(config.from)}>`, [250]);
    await session.command(`RCPT TO:<${sanitizeAddress(input.to)}>`, [250, 251]);
    await session.command("DATA", [354]);
    await session.data(buildMessage(input, config.from));
    await session.command("QUIT", [221]).catch(() => undefined);
  } finally {
    session.close();
  }
}

export function getEmailDeliveryStatus() {
  const config = smtpConfig();
  return {
    mode: config ? "smtp" as const : "development" as const,
    configured: Boolean(config),
    host: config?.host,
    port: config?.port,
    secure: config?.secure,
    from: config?.from,
    verificationCodeExposed: shouldExposeVerificationCode()
  };
}

export async function sendVerificationEmail(input: {
  email: string;
  displayName?: string;
  verificationCode: string;
}): Promise<EmailDeliveryResult> {
  const config = smtpConfig();
  const verificationCodeExposed = shouldExposeVerificationCode();
  if (!config) {
    return {
      ok: true,
      mode: "development",
      sent: false,
      verificationCodeExposed
    };
  }

  try {
    await sendSmtpMail(config, {
      to: input.email,
      subject: "ManusXL 邮箱验证码",
      text: [
        `${input.displayName || "你好"}，`,
        "",
        `你的 ManusXL 邮箱验证码是：${input.verificationCode}`,
        "",
        "如果不是你本人操作，可以忽略这封邮件。"
      ].join("\n")
    });
    return {
      ok: true,
      mode: "smtp",
      sent: true,
      verificationCodeExposed
    };
  } catch (error) {
    return {
      ok: false,
      mode: "smtp",
      sent: false,
      verificationCodeExposed,
      error: error instanceof Error ? error.message : "邮件发送失败"
    };
  }
}
