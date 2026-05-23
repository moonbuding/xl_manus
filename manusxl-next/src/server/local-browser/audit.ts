import { safeRecordAuditLog } from "@/server/audit/audit-store";
import { isLocalBrowserPaused, updateAppConfig } from "@/server/config/app-config";
import type {
  LocalBrowserActionType,
  LocalBrowserApprovalRequest,
  LocalBrowserOperation,
  LocalBrowserOperationStatus,
  LocalBrowserSafetyState
} from "@/types/agent";

const maxOperations = 80;
const maxApprovals = 80;
const approvalTtlMs = 45 * 1000;

const globalForLocalBrowserAudit = globalThis as unknown as {
  manusxlLocalBrowserOperations?: LocalBrowserOperation[];
  manusxlLocalBrowserApprovals?: LocalBrowserApprovalRequest[];
  manusxlLocalBrowserApprovalWaiters?: Record<string, (request: LocalBrowserApprovalRequest) => void>;
};

function operations() {
  globalForLocalBrowserAudit.manusxlLocalBrowserOperations ??= [];
  return globalForLocalBrowserAudit.manusxlLocalBrowserOperations;
}

function approvals() {
  globalForLocalBrowserAudit.manusxlLocalBrowserApprovals ??= [];
  return globalForLocalBrowserAudit.manusxlLocalBrowserApprovals;
}

function approvalWaiters() {
  globalForLocalBrowserAudit.manusxlLocalBrowserApprovalWaiters ??= {};
  return globalForLocalBrowserAudit.manusxlLocalBrowserApprovalWaiters;
}

function makeOperationId() {
  return `lbop_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function makeApprovalId() {
  return `lbap_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function cleanExpiredApprovals() {
  const now = Date.now();
  approvals().forEach((approval) => {
    if (approval.status === "pending" && new Date(approval.expiresAt).getTime() <= now) {
      approval.status = "expired";
      approval.decidedAt = new Date().toISOString();
      updateLocalBrowserOperation(approval.operationId, {
        status: "blocked",
        error: "扩展确认超时"
      });
      const waiter = approvalWaiters()[approval.id];
      if (waiter) {
        delete approvalWaiters()[approval.id];
        waiter(approval);
      }
    }
  });
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
  if (operation.ownerId) {
    safeRecordAuditLog({
      userId: operation.ownerId,
      action: `local_browser.${operation.action}`,
      resource: operation.url ?? operation.tabId ?? "local_browser",
      status: operation.status === "blocked" ? "blocked" : operation.status === "failed" ? "failed" : "started",
      metadata: {
        source: operation.source,
        title: operation.title,
        error: operation.error
      }
    });
  }
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

export function createLocalBrowserApprovalRequest(input: {
  ownerId?: string;
  operationId: string;
  source?: "agent" | "settings" | "api";
  action: LocalBrowserActionType;
  title?: string;
  url?: string;
  tabId?: string;
  description?: string;
}) {
  cleanExpiredApprovals();
  const now = new Date();
  const approval: LocalBrowserApprovalRequest = {
    id: makeApprovalId(),
    operationId: input.operationId,
    ownerId: input.ownerId,
    source: input.source ?? "api",
    action: input.action,
    status: "pending",
    title: input.title,
    url: input.url,
    tabId: input.tabId,
    description: input.description,
    requestedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + approvalTtlMs).toISOString()
  };
  const list = approvals();
  list.unshift(approval);
  if (list.length > maxApprovals) list.length = maxApprovals;
  updateLocalBrowserOperation(input.operationId, {
    status: "pending_approval",
    title: input.title,
    url: input.url,
    tabId: input.tabId
  });
  return approval;
}

export function listLocalBrowserApprovalRequestsForOwner(ownerId: string | undefined, limit = 10) {
  cleanExpiredApprovals();
  const filtered = ownerId
    ? approvals().filter((approval) => approval.ownerId === ownerId)
    : approvals();
  return filtered
    .filter((approval) => approval.status === "pending")
    .slice(0, Math.max(1, Math.min(limit, maxApprovals)));
}

export function decideLocalBrowserApprovalRequest(input: {
  ownerId?: string;
  approvalId?: string;
  approved: boolean;
}) {
  cleanExpiredApprovals();
  const approval = approvals().find(
    (candidate) => candidate.id === input.approvalId && (!input.ownerId || candidate.ownerId === input.ownerId)
  );
  if (!approval) {
    return { ok: false, error: "待确认操作不存在或已过期。" };
  }
  if (approval.status !== "pending") {
    return { ok: false, approval, error: "待确认操作已经处理。" };
  }
  approval.status = input.approved ? "approved" : "rejected";
  approval.decidedAt = new Date().toISOString();
  updateLocalBrowserOperation(approval.operationId, {
    status: input.approved ? "approved" : "blocked",
    error: input.approved ? undefined : "扩展拒绝执行"
  });
  const waiter = approvalWaiters()[approval.id];
  if (waiter) {
    delete approvalWaiters()[approval.id];
    waiter(approval);
  }
  return { ok: true, approval };
}

export async function waitForLocalBrowserApproval(approvalId: string, timeoutMs = approvalTtlMs) {
  cleanExpiredApprovals();
  const approval = approvals().find((candidate) => candidate.id === approvalId);
  if (!approval || approval.status !== "pending") return approval;

  const boundedTimeout = Math.max(1000, Math.min(timeoutMs, approvalTtlMs));
  return await new Promise<LocalBrowserApprovalRequest>((resolve) => {
    approvalWaiters()[approvalId] = resolve;
    setTimeout(() => {
      const current = approvals().find((candidate) => candidate.id === approvalId);
      if (!current || current.status !== "pending") return;
      current.status = "expired";
      current.decidedAt = new Date().toISOString();
      updateLocalBrowserOperation(current.operationId, {
        status: "blocked",
        error: "扩展确认超时"
      });
      delete approvalWaiters()[approvalId];
      resolve(current);
    }, boundedTimeout);
  });
}

export function setLocalBrowserPaused(paused: boolean) {
  updateAppConfig({ localBrowserPaused: paused });
  return getLocalBrowserSafetyState();
}

export function getLocalBrowserSafetyState(): LocalBrowserSafetyState {
  return {
    paused: isLocalBrowserPaused(),
    recentOperations: listLocalBrowserOperations(),
    pendingApprovals: listLocalBrowserApprovalRequestsForOwner(undefined)
  };
}

export function getLocalBrowserSafetyStateForOwner(ownerId: string | undefined): LocalBrowserSafetyState {
  return {
    paused: isLocalBrowserPaused(),
    recentOperations: listLocalBrowserOperationsForOwner(ownerId),
    pendingApprovals: listLocalBrowserApprovalRequestsForOwner(ownerId)
  };
}
