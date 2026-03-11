/**
 * Multi-user collaboration types for Phase 6.
 */

import type { ActorRef } from "./entities";

// ── Presence ──────────────────────────────────────────────────────────

/** Presence status for real-time thread presence (Phase 6). */
export type ThreadPresenceStatus = "active" | "idle" | "typing";

export type PresenceEntry = {
  id: string;
  threadId: string;
  actorType: "user" | "agent";
  actorId: string;
  status: ThreadPresenceStatus;
  lastSeen: number;
};

// ── Approvals ─────────────────────────────────────────────────────────

export type ApprovalStatus = "pending" | "approved" | "rejected";

export type ApprovalRequest = {
  id: string;
  workspaceId: string;
  threadId: string;
  requestedBy: ActorRef;
  type: string;
  payload: unknown;
  status: ApprovalStatus;
  resolvedBy?: string;
  resolvedAt?: number;
  createdAt: number;
};

// ── Conflicts ─────────────────────────────────────────────────────────

export type ConflictType = "file_edit" | "instruction" | "resource";
export type ConflictStatus = "active" | "resolved";

export type ConflictRecord = {
  id: string;
  workspaceId: string;
  threadId?: string;
  filePath?: string;
  type: ConflictType;
  involvedUsers: string[];
  status: ConflictStatus;
  description?: string;
  resolution?: string;
  createdAt: number;
  resolvedAt?: number;
};

// ── Membership ────────────────────────────────────────────────────────

export type WorkspaceRole = "owner" | "admin" | "editor" | "viewer";

export type WorkspaceMemberWithProfile = {
  _id: string;
  workspaceId: string;
  userId: string;
  role: WorkspaceRole;
  joinedAt: number;
  user: {
    handle: string;
    displayName: string;
    avatarUrl?: string;
  } | null;
};

// ── Invitation ────────────────────────────────────────────────────────

export type InvitationStatus = "pending" | "accepted" | "declined";

export type Invitation = {
  id: string;
  workspaceId: string;
  invitedEmail: string;
  invitedBy: string;
  role: "admin" | "editor" | "viewer";
  status: InvitationStatus;
  expiresAt: number;
};
