import { createHash, randomBytes } from "node:crypto";
import { getLocalBrowserSafetyStateForOwner } from "@/server/local-browser/audit";
import type {
  LocalBrowserPairedDevice,
  LocalBrowserPairingStatus,
  LocalBrowserPairingVerifyResponse
} from "@/types/agent";

interface PairingCodeRecord {
  code: string;
  ownerId: string;
  expiresAt: string;
}

interface PairedDeviceRecord extends LocalBrowserPairedDevice {
  tokenHash: string;
}

const pairingTtlMs = 5 * 60 * 1000;
const maxDevices = 20;

const globalForLocalBrowserPairing = globalThis as unknown as {
  manusxlLocalBrowserPairingCodes?: PairingCodeRecord[];
  manusxlLocalBrowserPairedDevices?: PairedDeviceRecord[];
};

function codeRecords() {
  globalForLocalBrowserPairing.manusxlLocalBrowserPairingCodes ??= [];
  return globalForLocalBrowserPairing.manusxlLocalBrowserPairingCodes;
}

function deviceRecords() {
  globalForLocalBrowserPairing.manusxlLocalBrowserPairedDevices ??= [];
  return globalForLocalBrowserPairing.manusxlLocalBrowserPairedDevices;
}

function nowMs() {
  return Date.now();
}

function cleanExpiredCodes() {
  const active = codeRecords().filter((record) => new Date(record.expiresAt).getTime() > nowMs());
  globalForLocalBrowserPairing.manusxlLocalBrowserPairingCodes = active;
  return active;
}

function makePairingCode() {
  const value = String(Math.floor(100000 + Math.random() * 900000));
  return `${value.slice(0, 3)}-${value.slice(3)}`;
}

function normalizeCode(code: string) {
  return code.replace(/[^0-9a-z]/gi, "").toUpperCase();
}

function makeDeviceId() {
  return `lbdev_${nowMs().toString(36)}_${randomBytes(4).toString("hex")}`;
}

function makeToken() {
  return `lbp_${randomBytes(24).toString("base64url")}`;
}

function tokenHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function publicDevice(record: PairedDeviceRecord): LocalBrowserPairedDevice {
  return {
    id: record.id,
    ownerId: record.ownerId,
    name: record.name,
    extensionId: record.extensionId,
    createdAt: record.createdAt,
    lastSeenAt: record.lastSeenAt
  };
}

export function createLocalBrowserPairingCode(ownerId: string): LocalBrowserPairingStatus {
  const active = cleanExpiredCodes().filter((record) => record.ownerId !== ownerId);
  const code = makePairingCode();
  const record: PairingCodeRecord = {
    code,
    ownerId,
    expiresAt: new Date(nowMs() + pairingTtlMs).toISOString()
  };
  globalForLocalBrowserPairing.manusxlLocalBrowserPairingCodes = [record, ...active];
  return getLocalBrowserPairingStatus(ownerId);
}

export function getLocalBrowserPairingStatus(ownerId: string): LocalBrowserPairingStatus {
  const active = cleanExpiredCodes().find((record) => record.ownerId === ownerId);
  const devices = deviceRecords()
    .filter((record) => record.ownerId === ownerId)
    .map(publicDevice);
  return {
    activeCode: active ? { code: active.code, expiresAt: active.expiresAt } : undefined,
    pairedDevices: devices
  };
}

export function verifyLocalBrowserPairingCode(input: {
  code?: string;
  deviceName?: string;
  extensionId?: string;
}): LocalBrowserPairingVerifyResponse {
  const normalized = normalizeCode(input.code ?? "");
  const record = cleanExpiredCodes().find((candidate) => normalizeCode(candidate.code) === normalized);
  if (!record) {
    return {
      paired: false,
      error: "配对码无效或已过期。"
    };
  }

  const token = makeToken();
  const now = new Date().toISOString();
  const device: PairedDeviceRecord = {
    id: makeDeviceId(),
    ownerId: record.ownerId,
    name: (input.deviceName || "Chrome Extension").trim().slice(0, 80),
    extensionId: input.extensionId?.trim().slice(0, 160) || undefined,
    tokenHash: tokenHash(token),
    createdAt: now,
    lastSeenAt: now
  };
  const remainingCodes = cleanExpiredCodes().filter((candidate) => candidate.code !== record.code);
  const remainingDevices = deviceRecords()
    .filter((candidate) => candidate.ownerId !== record.ownerId || candidate.extensionId !== device.extensionId)
    .slice(0, maxDevices - 1);
  globalForLocalBrowserPairing.manusxlLocalBrowserPairingCodes = remainingCodes;
  globalForLocalBrowserPairing.manusxlLocalBrowserPairedDevices = [device, ...remainingDevices];

  return {
    paired: true,
    token,
    device: publicDevice(device),
    safety: getLocalBrowserSafetyStateForOwner(record.ownerId)
  };
}

export function resolveLocalBrowserPairingToken(token?: string) {
  if (!token) return undefined;
  const hash = tokenHash(token);
  const device = deviceRecords().find((candidate) => candidate.tokenHash === hash);
  if (!device) return undefined;
  device.lastSeenAt = new Date().toISOString();
  return device;
}

export function getLocalBrowserExtensionState(token?: string): LocalBrowserPairingVerifyResponse {
  const device = resolveLocalBrowserPairingToken(token);
  if (!device) {
    return {
      paired: false,
      error: "扩展尚未配对或令牌已失效。"
    };
  }
  return {
    paired: true,
    device: publicDevice(device),
    safety: getLocalBrowserSafetyStateForOwner(device.ownerId)
  };
}
