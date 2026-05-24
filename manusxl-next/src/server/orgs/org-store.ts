import { randomBytes } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { createId } from "@/lib/id";
import { readUser } from "@/server/auth/auth-store";
import { getManusDb } from "@/server/sqlite";
import type {
  AuthUser,
  Organization,
  OrganizationInvitation,
  OrganizationMembership,
  OrganizationRole,
  OrganizationTaskShare,
  TaskVisibility
} from "@/types/agent";

interface OrgRow {
  id: string;
  name: string;
  slug: string;
  task_quota: number;
  created_by_user_id: string;
  created_at: string;
  updated_at: string;
  data_json: string;
}

interface MembershipRow {
  org_id: string;
  user_id: string;
  role: OrganizationRole;
  created_at: string;
  updated_at: string;
  data_json: string;
}

interface InvitationRow {
  id: string;
  org_id: string;
  invited_by_user_id: string;
  email: string | null;
  phone: string | null;
  role: Exclude<OrganizationRole, "owner">;
  token: string;
  status: OrganizationInvitation["status"];
  expires_at: string;
  created_at: string;
  accepted_at: string | null;
  data_json: string;
}

interface TaskShareRow {
  org_id: string;
  task_id: string;
  visibility: Exclude<TaskVisibility, "private">;
  created_by_user_id: string;
  created_at: string;
  updated_at: string;
  data_json: string;
}

const defaultTaskQuota = 100;

function openOrgDb() {
  const db = getManusDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS organizations (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      task_quota INTEGER NOT NULL,
      created_by_user_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      data_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS organization_memberships (
      org_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      data_json TEXT NOT NULL,
      PRIMARY KEY (org_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS organization_invitations (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      invited_by_user_id TEXT NOT NULL,
      email TEXT,
      phone TEXT,
      role TEXT NOT NULL,
      token TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      accepted_at TEXT,
      data_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS organization_task_shares (
      org_id TEXT NOT NULL,
      task_id TEXT NOT NULL,
      visibility TEXT NOT NULL,
      created_by_user_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      data_json TEXT NOT NULL,
      PRIMARY KEY (org_id, task_id)
    );

    CREATE INDEX IF NOT EXISTS idx_org_memberships_user_id ON organization_memberships(user_id);
    CREATE INDEX IF NOT EXISTS idx_org_invitations_token ON organization_invitations(token);
    CREATE INDEX IF NOT EXISTS idx_org_task_shares_task_id ON organization_task_shares(task_id);
  `);
  return db;
}

function slugify(value: string) {
  const base = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return (base || "org").slice(0, 60);
}

function normalizePhone(phone?: string) {
  return phone?.replace(/[^\d+]/g, "").replace(/^\+86/, "") || undefined;
}

function normalizeEmail(email?: string) {
  const value = email?.trim().toLowerCase();
  return value || undefined;
}

function normalizeRole(role?: string): Exclude<OrganizationRole, "owner"> {
  if (role === "admin" || role === "member" || role === "viewer") return role;
  return "member";
}

function normalizeQuota(value: unknown) {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) return defaultTaskQuota;
  return Math.max(0, Math.min(10000, Math.round(numberValue)));
}

function isManager(role?: OrganizationRole) {
  return role === "owner" || role === "admin";
}

function canCreateTask(role?: OrganizationRole) {
  return role === "owner" || role === "admin" || role === "member";
}

function canManageTarget(requesterRole: OrganizationRole, targetRole: OrganizationRole) {
  if (!isManager(requesterRole) || targetRole === "owner") return false;
  if (requesterRole === "admin" && targetRole === "admin") return false;
  return true;
}

function orgFromRow(row: OrgRow, role?: OrganizationRole): Organization {
  const data = JSON.parse(row.data_json) as Organization;
  return {
    ...data,
    taskQuota: row.task_quota,
    taskCount: countOrgTasks(row.id),
    role
  };
}

function membershipFromRow(row: MembershipRow): OrganizationMembership {
  return JSON.parse(row.data_json) as OrganizationMembership;
}

function invitationFromRow(row: InvitationRow): OrganizationInvitation {
  return JSON.parse(row.data_json) as OrganizationInvitation;
}

function taskShareFromRow(row: TaskShareRow): OrganizationTaskShare {
  return JSON.parse(row.data_json) as OrganizationTaskShare;
}

function uniqueSlug(db: DatabaseSync, seed: string) {
  const base = slugify(seed);
  let slug = base;
  let index = 2;
  while (db.prepare("SELECT id FROM organizations WHERE slug = ?").get(slug)) {
    slug = `${base}-${index++}`;
  }
  return slug;
}

function insertOrg(db: DatabaseSync, org: Organization) {
  db.prepare(`
    INSERT INTO organizations
      (id, name, slug, task_quota, created_by_user_id, created_at, updated_at, data_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      slug = excluded.slug,
      task_quota = excluded.task_quota,
      updated_at = excluded.updated_at,
      data_json = excluded.data_json
  `).run(
    org.id,
    org.name,
    org.slug,
    org.taskQuota,
    org.createdByUserId,
    org.createdAt,
    org.updatedAt,
    JSON.stringify(org)
  );
}

function upsertMembership(db: DatabaseSync, membership: OrganizationMembership) {
  db.prepare(`
    INSERT INTO organization_memberships
      (org_id, user_id, role, created_at, updated_at, data_json)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(org_id, user_id) DO UPDATE SET
      role = excluded.role,
      updated_at = excluded.updated_at,
      data_json = excluded.data_json
  `).run(
    membership.orgId,
    membership.userId,
    membership.role,
    membership.createdAt,
    membership.updatedAt,
    JSON.stringify(membership)
  );
}

export function ensurePersonalOrganization(user: AuthUser) {
  const db = openOrgDb();
  const existing = db
    .prepare("SELECT * FROM organization_memberships WHERE user_id = ? AND role = 'owner'")
    .get(user.id) as MembershipRow | undefined;
  if (existing) return getOrganization(existing.org_id);

  const now = new Date().toISOString();
  const org: Organization = {
    id: createId("org"),
    name: `${user.displayName || "User"} 的个人空间`,
    slug: uniqueSlug(db, `personal-${user.id}`),
    taskQuota: defaultTaskQuota,
    taskCount: 0,
    createdByUserId: user.id,
    createdAt: now,
    updatedAt: now
  };
  insertOrg(db, org);
  upsertMembership(db, {
    orgId: org.id,
    userId: user.id,
    role: "owner",
    createdAt: now,
    updatedAt: now
  });
  return org;
}

export function getOrganization(orgId: string) {
  const row = openOrgDb().prepare("SELECT * FROM organizations WHERE id = ?").get(orgId) as OrgRow | undefined;
  return row ? orgFromRow(row) : undefined;
}

export function getOrganizationMembership(orgId: string, userId: string) {
  const row = openOrgDb()
    .prepare("SELECT * FROM organization_memberships WHERE org_id = ? AND user_id = ?")
    .get(orgId, userId) as MembershipRow | undefined;
  return row ? membershipFromRow(row) : undefined;
}

export function listOrganizationsForUser(user: AuthUser) {
  ensurePersonalOrganization(user);
  const db = openOrgDb();
  const rows = db
    .prepare(`
      SELECT organizations.*, organization_memberships.role AS membership_role
      FROM organizations
      INNER JOIN organization_memberships ON organization_memberships.org_id = organizations.id
      WHERE organization_memberships.user_id = ?
      ORDER BY organizations.created_at ASC
    `)
    .all(user.id) as unknown as Array<OrgRow & { membership_role: OrganizationRole }>;
  return rows.map((row) => orgFromRow(row, row.membership_role));
}

export function listOrganizationMembers(orgId: string, requesterUserId: string) {
  const requester = getOrganizationMembership(orgId, requesterUserId);
  if (!requester) {
    return { ok: false as const, status: 404, error: "Organization not found" };
  }
  const rows = openOrgDb()
    .prepare("SELECT * FROM organization_memberships WHERE org_id = ? ORDER BY created_at ASC")
    .all(orgId) as unknown as MembershipRow[];
  return {
    ok: true as const,
    members: rows.map((row) => {
      const membership = membershipFromRow(row);
      const user = readUser(membership.userId);
      return {
        ...membership,
        user: user
          ? {
              id: user.id,
              email: user.email,
              phone: user.phone,
              displayName: user.displayName
            }
          : undefined
      };
    })
  };
}

export function updateOrganizationMemberRole(input: {
  orgId: string;
  requesterUserId: string;
  targetUserId: string;
  role: string;
}) {
  const db = openOrgDb();
  const requester = getOrganizationMembership(input.orgId, input.requesterUserId);
  if (!requester) return { ok: false as const, status: 404, error: "Organization not found" };

  const target = getOrganizationMembership(input.orgId, input.targetUserId);
  if (!target) return { ok: false as const, status: 404, error: "成员不存在" };
  if (target.userId === input.requesterUserId) {
    return { ok: false as const, status: 403, error: "不能修改自己的组织角色" };
  }
  if (!canManageTarget(requester.role, target.role)) {
    return { ok: false as const, status: 403, error: "没有修改该成员角色的权限" };
  }

  const nextRole = normalizeRole(input.role);
  if (requester.role === "admin" && nextRole === "admin") {
    return { ok: false as const, status: 403, error: "Admin 不能提升其他成员为 Admin" };
  }

  const now = new Date().toISOString();
  const updated: OrganizationMembership = {
    ...target,
    role: nextRole,
    updatedAt: now
  };
  upsertMembership(db, updated);
  return { ok: true as const, membership: updated };
}

export function removeOrganizationMember(input: {
  orgId: string;
  requesterUserId: string;
  targetUserId: string;
}) {
  const db = openOrgDb();
  const requester = getOrganizationMembership(input.orgId, input.requesterUserId);
  if (!requester) return { ok: false as const, status: 404, error: "Organization not found" };

  const target = getOrganizationMembership(input.orgId, input.targetUserId);
  if (!target) return { ok: false as const, status: 404, error: "成员不存在" };
  if (target.userId === input.requesterUserId) {
    return { ok: false as const, status: 403, error: "不能移除自己" };
  }
  if (!canManageTarget(requester.role, target.role)) {
    return { ok: false as const, status: 403, error: "没有移除该成员的权限" };
  }

  db.prepare("DELETE FROM organization_memberships WHERE org_id = ? AND user_id = ?").run(
    input.orgId,
    input.targetUserId
  );
  return { ok: true as const, removed: target };
}

export function createOrganization(input: { user: AuthUser; name: string; taskQuota?: number }) {
  ensurePersonalOrganization(input.user);
  const name = input.name.trim();
  if (!name) throw new Error("组织名称不能为空");
  const db = openOrgDb();
  const now = new Date().toISOString();
  const org: Organization = {
    id: createId("org"),
    name: name.slice(0, 80),
    slug: uniqueSlug(db, name),
    taskQuota: normalizeQuota(input.taskQuota),
    taskCount: 0,
    createdByUserId: input.user.id,
    createdAt: now,
    updatedAt: now,
    role: "owner"
  };
  insertOrg(db, org);
  upsertMembership(db, {
    orgId: org.id,
    userId: input.user.id,
    role: "owner",
    createdAt: now,
    updatedAt: now
  });
  return org;
}

export function createOrganizationInvitation(input: {
  orgId: string;
  invitedBy: AuthUser;
  email?: string;
  phone?: string;
  role?: string;
}) {
  const membership = getOrganizationMembership(input.orgId, input.invitedBy.id);
  if (!isManager(membership?.role)) {
    return { ok: false as const, status: membership ? 403 : 404, error: "没有邀请成员的权限" };
  }
  const phone = normalizePhone(input.phone);
  const email = normalizeEmail(input.email);
  if (!phone && !email) {
    return { ok: false as const, status: 400, error: "需要提供手机号或邮箱" };
  }

  const db = openOrgDb();
  const now = new Date().toISOString();
  const invitation: OrganizationInvitation = {
    id: createId("orginv"),
    orgId: input.orgId,
    invitedByUserId: input.invitedBy.id,
    email,
    phone,
    role: normalizeRole(input.role),
    token: `${createId("orgtoken")}_${randomBytes(12).toString("base64url")}`,
    status: "pending",
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    createdAt: now
  };
  db.prepare(`
    INSERT INTO organization_invitations
      (id, org_id, invited_by_user_id, email, phone, role, token, status, expires_at, created_at, accepted_at, data_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    invitation.id,
    invitation.orgId,
    invitation.invitedByUserId,
    invitation.email ?? null,
    invitation.phone ?? null,
    invitation.role,
    invitation.token,
    invitation.status,
    invitation.expiresAt,
    invitation.createdAt,
    null,
    JSON.stringify(invitation)
  );
  return { ok: true as const, invitation };
}

export function acceptOrganizationInvitation(input: { token: string; user: AuthUser }) {
  const db = openOrgDb();
  const row = db
    .prepare("SELECT * FROM organization_invitations WHERE token = ?")
    .get(input.token.trim()) as InvitationRow | undefined;
  if (!row) return { ok: false as const, status: 404, error: "邀请不存在" };
  const invitation = invitationFromRow(row);
  if (invitation.status !== "pending" || Date.parse(invitation.expiresAt) < Date.now()) {
    return { ok: false as const, status: 409, error: "邀请已失效" };
  }
  if (invitation.phone && normalizePhone(input.user.phone) !== invitation.phone) {
    return { ok: false as const, status: 403, error: "当前登录手机号与邀请不匹配" };
  }
  if (invitation.email && input.user.email.toLowerCase() !== invitation.email) {
    return { ok: false as const, status: 403, error: "当前登录邮箱与邀请不匹配" };
  }

  const now = new Date().toISOString();
  upsertMembership(db, {
    orgId: invitation.orgId,
    userId: input.user.id,
    role: invitation.role,
    createdAt: now,
    updatedAt: now
  });
  const accepted = {
    ...invitation,
    status: "accepted" as const,
    acceptedAt: now
  };
  db.prepare(`
    UPDATE organization_invitations
    SET status = ?, accepted_at = ?, data_json = ?
    WHERE id = ?
  `).run(accepted.status, accepted.acceptedAt, JSON.stringify(accepted), accepted.id);
  return { ok: true as const, invitation: accepted, organization: getOrganization(invitation.orgId) };
}

export function countOrgTasks(orgId: string) {
  const row = openOrgDb()
    .prepare("SELECT COUNT(*) AS count FROM organization_task_shares WHERE org_id = ?")
    .get(orgId) as { count: number } | undefined;
  return row?.count ?? 0;
}

export function authorizeOrgTaskCreate(userId: string, orgId: string) {
  const org = getOrganization(orgId);
  const membership = getOrganizationMembership(orgId, userId);
  if (!org || !membership) {
    return { ok: false as const, status: 404, error: "Organization not found" };
  }
  if (!canCreateTask(membership.role)) {
    return { ok: false as const, status: 403, error: "Viewer 角色不能在组织内新建任务" };
  }
  if (countOrgTasks(orgId) >= org.taskQuota) {
    return { ok: false as const, status: 409, error: "组织任务配额已达上限" };
  }
  return { ok: true as const, org, membership };
}

export function shareTaskWithOrganization(input: {
  orgId: string;
  taskId: string;
  createdByUserId: string;
  visibility?: TaskVisibility;
}) {
  const visibility = input.visibility === "team" ? "team" : "org";
  const now = new Date().toISOString();
  const share: OrganizationTaskShare = {
    orgId: input.orgId,
    taskId: input.taskId,
    createdByUserId: input.createdByUserId,
    visibility,
    createdAt: now,
    updatedAt: now
  };
  openOrgDb().prepare(`
    INSERT INTO organization_task_shares
      (org_id, task_id, visibility, created_by_user_id, created_at, updated_at, data_json)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(org_id, task_id) DO UPDATE SET
      visibility = excluded.visibility,
      updated_at = excluded.updated_at,
      data_json = excluded.data_json
  `).run(
    share.orgId,
    share.taskId,
    share.visibility,
    share.createdByUserId,
    share.createdAt,
    share.updatedAt,
    JSON.stringify(share)
  );
  return share;
}

export function canUserReadOrgTask(userId: string, taskId: string) {
  const rows = openOrgDb()
    .prepare("SELECT * FROM organization_task_shares WHERE task_id = ?")
    .all(taskId) as unknown as TaskShareRow[];
  return rows.some((row) => Boolean(getOrganizationMembership(row.org_id, userId)));
}

export function listOrgTaskShares(orgId: string, userId: string) {
  const membership = getOrganizationMembership(orgId, userId);
  if (!membership) return { ok: false as const, status: 404, error: "Organization not found" };
  const rows = openOrgDb()
    .prepare("SELECT * FROM organization_task_shares WHERE org_id = ? ORDER BY created_at DESC")
    .all(orgId) as unknown as TaskShareRow[];
  return { ok: true as const, shares: rows.map(taskShareFromRow), membership };
}
