import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties, FormEvent } from "react";
import type { Id } from "../../../convex/_generated/dataModel";
import {
  useMembers,
  useMemberRole,
  usePresence,
  usePresenceHeartbeat,
  usePresenceLeave,
  useInviteMember,
  useUpdateMemberRole,
  useRemoveMember,
  useLeaveWorkspace,
} from "./convex-hooks";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Role = "admin" | "editor" | "viewer";

interface MemberPanelProps {
  workspaceId: Id<"workspaces"> | undefined;
  currentUserId: Id<"users"> | undefined;
  activeThreadId?: Id<"threads">;
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = {
  container: {
    display: "flex",
    flexDirection: "column",
    height: "100%",
    background: "var(--color-background)",
    color: "var(--color-text)",
    fontFamily: "var(--font-family, system-ui, sans-serif)",
    fontSize: 13,
    overflow: "hidden",
  } satisfies CSSProperties,

  header: {
    padding: "12px 16px",
    borderBottom: "1px solid var(--color-border)",
    fontWeight: 600,
    fontSize: 14,
    display: "flex",
    alignItems: "center",
    gap: 8,
  } satisfies CSSProperties,

  badge: {
    background: "var(--color-accent)",
    color: "var(--color-background)",
    borderRadius: 10,
    padding: "1px 7px",
    fontSize: 11,
    fontWeight: 600,
    minWidth: 18,
    textAlign: "center",
  } satisfies CSSProperties,

  scrollArea: {
    flex: 1,
    overflowY: "auto",
    padding: "8px 0",
  } satisfies CSSProperties,

  section: {
    padding: "8px 16px",
  } satisfies CSSProperties,

  sectionTitle: {
    fontSize: 11,
    fontWeight: 600,
    textTransform: "uppercase",
    color: "var(--color-text-muted)",
    letterSpacing: "0.05em",
    marginBottom: 8,
  } satisfies CSSProperties,

  memberRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "6px 0",
    borderBottom: "1px solid var(--color-border)",
  } satisfies CSSProperties,

  avatar: {
    width: 28,
    height: 28,
    borderRadius: "50%",
    background: "var(--color-surface)",
    border: "1px solid var(--color-border)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 12,
    fontWeight: 600,
    color: "var(--color-text-muted)",
    position: "relative",
    flexShrink: 0,
  } satisfies CSSProperties,

  presenceDot: {
    position: "absolute",
    bottom: -1,
    right: -1,
    width: 10,
    height: 10,
    borderRadius: "50%",
    border: "2px solid var(--color-background)",
  } satisfies CSSProperties,

  memberInfo: {
    flex: 1,
    minWidth: 0,
  } satisfies CSSProperties,

  memberName: {
    fontWeight: 500,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  } satisfies CSSProperties,

  memberRole: {
    fontSize: 11,
    color: "var(--color-text-muted)",
  } satisfies CSSProperties,

  roleSelect: {
    background: "var(--color-surface)",
    color: "var(--color-text)",
    border: "1px solid var(--color-border)",
    borderRadius: 4,
    padding: "2px 4px",
    fontSize: 11,
    cursor: "pointer",
  } satisfies CSSProperties,

  removeBtn: {
    background: "transparent",
    color: "var(--color-error, #e55)",
    border: "1px solid var(--color-error, #e55)",
    borderRadius: 4,
    padding: "2px 8px",
    fontSize: 11,
    cursor: "pointer",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,

  inviteForm: {
    display: "flex",
    gap: 6,
    padding: "12px 16px",
    borderTop: "1px solid var(--color-border)",
    alignItems: "center",
    flexWrap: "wrap",
  } satisfies CSSProperties,

  input: {
    flex: 1,
    minWidth: 120,
    background: "var(--color-surface)",
    color: "var(--color-text)",
    border: "1px solid var(--color-border)",
    borderRadius: 4,
    padding: "6px 8px",
    fontSize: 13,
    outline: "none",
  } satisfies CSSProperties,

  select: {
    background: "var(--color-surface)",
    color: "var(--color-text)",
    border: "1px solid var(--color-border)",
    borderRadius: 4,
    padding: "6px 8px",
    fontSize: 13,
    cursor: "pointer",
  } satisfies CSSProperties,

  button: {
    background: "var(--color-accent)",
    color: "var(--color-background)",
    border: "none",
    borderRadius: 4,
    padding: "6px 12px",
    fontSize: 13,
    fontWeight: 500,
    cursor: "pointer",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,

  leaveBtn: {
    background: "transparent",
    color: "var(--color-error, #e55)",
    border: "1px solid var(--color-error, #e55)",
    borderRadius: 4,
    padding: "6px 12px",
    fontSize: 12,
    cursor: "pointer",
    margin: "8px 16px",
    textAlign: "center",
  } satisfies CSSProperties,

  empty: {
    color: "var(--color-text-muted)",
    fontStyle: "italic",
    padding: "12px 0",
    textAlign: "center",
  } satisfies CSSProperties,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PRESENCE_COLORS: Record<string, string> = {
  active: "#22c55e",
  idle: "#eab308",
  typing: "#f97316",
};

function getInitials(name: string | undefined): string {
  if (!name) return "?";
  return name
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function MemberPanel({
  workspaceId,
  currentUserId,
  activeThreadId,
}: MemberPanelProps) {
  const members = useMembers(workspaceId);
  const myRole = useMemberRole(workspaceId, currentUserId);
  const presence = usePresence(activeThreadId);
  const heartbeat = usePresenceHeartbeat();
  const leave = usePresenceLeave();
  const inviteMember = useInviteMember();
  const updateRole = useUpdateMemberRole();
  const removeMember = useRemoveMember();
  const leaveWorkspace = useLeaveWorkspace();

  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<Role>("editor");
  const [inviting, setInviting] = useState(false);

  // ── Presence heartbeat ──────────────────────────────────────────
  const heartbeatRef = useRef(heartbeat);
  heartbeatRef.current = heartbeat;

  useEffect(() => {
    if (!activeThreadId || !currentUserId) return;

    // Immediate heartbeat on mount
    heartbeatRef.current({
      threadId: activeThreadId,
      actorType: "user" as const,
      actorId: String(currentUserId),
      status: "active",
    });

    const interval = setInterval(() => {
      heartbeatRef.current({
        threadId: activeThreadId,
        actorType: "user" as const,
        actorId: String(currentUserId),
        status: "active",
      });
    }, 10_000);

    return () => {
      clearInterval(interval);
      leave({
        threadId: activeThreadId,
        actorType: "user" as const,
        actorId: String(currentUserId),
      });
    };
  }, [activeThreadId, currentUserId, leave]);

  // ── Presence lookup ─────────────────────────────────────────────
  const presenceByUser = new Map<string, string>();
  if (presence) {
    for (const p of presence) {
      presenceByUser.set(p.actorId, p.status);
    }
  }

  // ── Invite handler ──────────────────────────────────────────────
  const handleInvite = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      if (!workspaceId || !inviteEmail.trim()) return;
      setInviting(true);
      try {
        await inviteMember({
          workspaceId,
          email: inviteEmail.trim(),
          role: inviteRole as "admin" | "editor" | "viewer",
          invitedBy: currentUserId!,
        });
        setInviteEmail("");
      } finally {
        setInviting(false);
      }
    },
    [workspaceId, inviteEmail, inviteRole, inviteMember],
  );

  // ── Permissions ─────────────────────────────────────────────────
  const isOwner = myRole === "owner";
  const isAdminOrOwner = myRole === "owner" || myRole === "admin";

  const memberCount = members?.length ?? 0;

  return (
    <div style={styles.container}>
      {/* Header */}
      <div style={styles.header}>
        <span>Members</span>
        {memberCount > 0 && (
          <span style={styles.badge}>{memberCount}</span>
        )}
      </div>

      {/* Member list */}
      <div style={styles.scrollArea}>
        <div style={styles.section}>
          <div style={styles.sectionTitle}>Workspace Members</div>

          {!members && (
            <div style={styles.empty}>Loading...</div>
          )}

          {members && members.length === 0 && (
            <div style={styles.empty}>No members yet</div>
          )}

          {members?.map((member) => {
            const presenceStatus = presenceByUser.get(member.userId);
            const isSelf = member.userId === currentUserId;

            return (
              <div key={member._id} style={styles.memberRow}>
                {/* Avatar + presence */}
                <div style={styles.avatar}>
                  {getInitials(member.user?.displayName)}
                  {presenceStatus && (
                    <div
                      style={{
                        ...styles.presenceDot,
                        background: PRESENCE_COLORS[presenceStatus] ?? "#888",
                      }}
                      title={presenceStatus}
                    />
                  )}
                </div>

                {/* Name + role */}
                <div style={styles.memberInfo}>
                  <div style={styles.memberName}>
                    {member.user?.displayName ?? "Unknown"}
                    {isSelf && " (you)"}
                  </div>
                  <div style={styles.memberRole}>
                    {isOwner && !isSelf && member.role !== "owner" ? (
                      <select
                        style={styles.roleSelect}
                        value={member.role}
                        onChange={(e) =>
                          updateRole({
                            workspaceId: workspaceId!,
                            targetUserId: member.userId,
                            newRole: e.target.value as Role,
                            requestingUserId: currentUserId!,
                          })
                        }
                      >
                        <option value="admin">admin</option>
                        <option value="editor">editor</option>
                        <option value="viewer">viewer</option>
                      </select>
                    ) : (
                      member.role
                    )}
                  </div>
                </div>

                {/* Remove button (owner only, can't remove self) */}
                {isOwner && !isSelf && member.role !== "owner" && (
                  <button
                    style={styles.removeBtn}
                    onClick={() =>
                      removeMember({
                        workspaceId: workspaceId!,
                        targetUserId: member.userId,
                        requestingUserId: currentUserId!,
                      })
                    }
                  >
                    Remove
                  </button>
                )}
              </div>
            );
          })}
        </div>

        {/* Presence legend */}
        {activeThreadId && presence && presence.length > 0 && (
          <div style={styles.section}>
            <div style={styles.sectionTitle}>Active in Thread</div>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              {(["active", "idle", "typing"] as const).map((status) => (
                <span
                  key={status}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 4,
                    fontSize: 11,
                    color: "var(--color-text-muted)",
                  }}
                >
                  <span
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: "50%",
                      background: PRESENCE_COLORS[status],
                      display: "inline-block",
                    }}
                  />
                  {status}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Leave workspace (non-owners) */}
        {!isOwner && workspaceId && currentUserId && (
          <button
            style={styles.leaveBtn}
            onClick={() => leaveWorkspace({ workspaceId, userId: currentUserId })}
          >
            Leave Workspace
          </button>
        )}
      </div>

      {/* Invite form (admins/owners only) */}
      {isAdminOrOwner && workspaceId && (
        <form style={styles.inviteForm} onSubmit={handleInvite}>
          <input
            style={styles.input}
            type="email"
            placeholder="Email to invite..."
            value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)}
          />
          <select
            style={styles.select}
            value={inviteRole}
            onChange={(e) => setInviteRole(e.target.value as Role)}
          >
            <option value="admin">admin</option>
            <option value="editor">editor</option>
            <option value="viewer">viewer</option>
          </select>
          <button style={styles.button} type="submit" disabled={inviting}>
            {inviting ? "..." : "Invite"}
          </button>
        </form>
      )}
    </div>
  );
}
