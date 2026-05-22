import { isLocalBrowserPaused, updateAppConfig } from "@/server/config/app-config";
import type {
  LocalBrowserActionType,
  LocalBrowserOperation,
  LocalBrowserOperationStatus,
  LocalBrowserSafetyState
} from "@/types/agent";

const maxOperations = 80;

const globalForLocalBrowserAudit = globalThis as unknown as {
  manusxlLocalBrowserOperations?: LocalBrowserOperation[];
};

function operations() {
  globalForLocalBrowserAudit.manusxlLocalBrowserOperations ??= [];
  return globalForLocalBrowserAudit.manusxlLocalBrowserOperations;
}

function makeOperationId() {
  return `lbop_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function recordLocalBrowserOperation(input: {
  ownerId?: string;
  source?: "agent" | "settings" | "api";
  action: LocalBrowserActionType | "snapshot" | "screenshot" | "status" | "unknown";
  status?: LocalBrowserOperationStatus;
  title?: string;
  url?: string;
  tabId?: string;
  error?: string;
}) {
  const now = new Date().toISOString();
  const operation: LocalBrowserOperation = {
    id: makeOperationId(),
    ownerId: input.ownerId,
    source: input.source ?? "api",
    action: input.action,
    status: input.status ?? "started",
    title: input.title,
    url: input.url,
    tabId: input.tabId,
    error: input.error,
    createdAt: now,
    updatedAt: now
  };
  const list = operations();
  list.unshift(operation);
  if (list.length > maxOperations) list.length = maxOperations;
  return operation;
}

export function updateLocalBrowserOperation(
  operationId: string | undefined,
  patch: Partial<Pick<LocalBrowserOperation, "status" | "title" | "url" | "tabId" | "error">>
) {
  if (!operationId) return;
  const operation = operations().find((candidate) => candidate.id === operationId);
  if (!operation) return;
  Object.assign(operation, patch, { updatedAt: new Date().toISOString() });
}

export function listLocalBrowserOperations(limit = 20) {
  return operations().slice(0, Math.max(1, Math.min(limit, maxOperations)));
}

export function listLocalBrowserOperationsForOwner(ownerId: string | undefined, limit = 20) {
  const filtered = ownerId
    ? operations().filter((operation) => !operation.ownerId || operation.ownerId === ownerId)
    : operations();
  return filtered.slice(0, Math.max(1, Math.min(limit, maxOperations)));
}

export function setLocalBrowserPaused(paused: boolean) {
  updateAppConfig({ localBrowserPaused: paused });
  return getLocalBrowserSafetyState();
}

export function getLocalBrowserSafetyState(): LocalBrowserSafetyState {
  return {
    paused: isLocalBrowserPaused(),
    recentOperations: listLocalBrowserOperations()
  };
}

export function getLocalBrowserSafetyStateForOwner(ownerId: string | undefined): LocalBrowserSafetyState {
  return {
    paused: isLocalBrowserPaused(),
    recentOperations: listLocalBrowserOperationsForOwner(ownerId)
  };
}
