import { useCallback, useState } from "react";
import type { CSSProperties } from "react";
import type { Id } from "../../../convex/_generated/dataModel";
import {
  usePendingApprovals,
  useResolveApproval,
  useActiveConflicts,
  useResolveConflict,
} from "./convex-hooks";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ApprovalPanelProps {
  workspaceId: Id<"workspaces"> | undefined;
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

  warningBadge: {
    background: "var(--color-warning, #eab308)",
    color: "#000",
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
    display: "flex",
    alignItems: "center",
    gap: 8,
  } satisfies CSSProperties,

  card: {
    background: "var(--color-surface)",
    border: "1px solid var(--color-border)",
    borderRadius: 6,
    padding: "10px 12px",
    marginBottom: 8,
  } satisfies CSSProperties,

  cardHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 6,
  } satisfies CSSProperties,

  cardType: {
    fontSize: 12,
    fontWeight: 600,
    color: "var(--color-accent)",
    textTransform: "uppercase",
    letterSpacing: "0.03em",
  } satisfies CSSProperties,

  cardMeta: {
    fontSize: 11,
    color: "var(--color-text-muted)",
  } satisfies CSSProperties,

  cardBody: {
    fontSize: 12,
    color: "var(--color-text)",
    lineHeight: 1.4,
    marginBottom: 8,
  } satisfies CSSProperties,

  filePath: {
    fontFamily: "var(--font-mono, monospace)",
    fontSize: 11,
    color: "var(--color-accent)",
    background: "var(--color-background)",
    padding: "2px 6px",
    borderRadius: 3,
    display: "inline-block",
    marginBottom: 6,
  } satisfies CSSProperties,

  userList: {
    fontSize: 11,
    color: "var(--color-text-muted)",
    marginBottom: 6,
  } satisfies CSSProperties,

  actions: {
    display: "flex",
    gap: 6,
    justifyContent: "flex-end",
  } satisfies CSSProperties,

  approveBtn: {
    background: "var(--color-success, #22c55e)",
    color: "#fff",
    border: "none",
    borderRadius: 4,
    padding: "4px 12px",
    fontSize: 12,
    fontWeight: 500,
    cursor: "pointer",
  } satisfies CSSProperties,

  rejectBtn: {
    background: "transparent",
    color: "var(--color-error, #e55)",
    border: "1px solid var(--color-error, #e55)",
    borderRadius: 4,
    padding: "4px 12px",
    fontSize: 12,
    fontWeight: 500,
    cursor: "pointer",
  } satisfies CSSProperties,

  resolveBtn: {
    background: "var(--color-accent)",
    color: "var(--color-background)",
    border: "none",
    borderRadius: 4,
    padding: "4px 12px",
    fontSize: 12,
    fontWeight: 500,
    cursor: "pointer",
  } satisfies CSSProperties,

  empty: {
    color: "var(--color-text-muted)",
    fontStyle: "italic",
    padding: "12px 0",
    textAlign: "center",
    fontSize: 12,
  } satisfies CSSProperties,

  conflictTypeBadge: {
    fontSize: 10,
    fontWeight: 600,
    textTransform: "uppercase",
    padding: "2px 6px",
    borderRadius: 3,
    letterSpacing: "0.03em",
  } satisfies CSSProperties,
};

const CONFLICT_TYPE_COLORS: Record<string, { bg: string; color: string }> = {
  file_edit: { bg: "rgba(239, 68, 68, 0.15)", color: "var(--color-error, #e55)" },
  instruction: { bg: "rgba(234, 179, 8, 0.15)", color: "var(--color-warning, #eab308)" },
  resource: { bg: "rgba(59, 130, 246, 0.15)", color: "var(--color-accent)" },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function summarizePayload(payload: unknown): string {
  if (!payload) return "No details";
  if (typeof payload === "string") return payload;
  if (typeof payload === "object") {
    const obj = payload as Record<string, unknown>;
    // Try common summary fields
    if (typeof obj.description === "string") return obj.description;
    if (typeof obj.message === "string") return obj.message;
    if (typeof obj.action === "string") return obj.action;
    // Fallback: JSON summary truncated
    const json = JSON.stringify(obj);
    return json.length > 120 ? json.slice(0, 117) + "..." : json;
  }
  return String(payload);
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ApprovalPanel({ workspaceId }: ApprovalPanelProps) {
  const approvals = usePendingApprovals(workspaceId);
  const resolveApproval = useResolveApproval();
  const conflicts = useActiveConflicts(workspaceId);
  const resolveConflict = useResolveConflict();

  const [busyApprovals, setBusyApprovals] = useState<Set<string>>(new Set());
  const [busyConflicts, setBusyConflicts] = useState<Set<string>>(new Set());

  const handleApproval = useCallback(
    async (approvalId: Id<"approvals">, decision: "approved" | "rejected") => {
      setBusyApprovals((prev) => new Set(prev).add(approvalId));
      try {
        await resolveApproval({ id: approvalId, status: decision, resolvedBy: "user" });
      } finally {
        setBusyApprovals((prev) => {
          const next = new Set(prev);
          next.delete(approvalId);
          return next;
        });
      }
    },
    [resolveApproval],
  );

  const handleResolveConflict = useCallback(
    async (conflictId: Id<"conflicts">, resolution: string) => {
      setBusyConflicts((prev) => new Set(prev).add(conflictId));
      try {
        await resolveConflict({ id: conflictId, resolution });
      } finally {
        setBusyConflicts((prev) => {
          const next = new Set(prev);
          next.delete(conflictId);
          return next;
        });
      }
    },
    [resolveConflict],
  );

  const approvalCount = approvals?.length ?? 0;
  const conflictCount = conflicts?.length ?? 0;
  const totalCount = approvalCount + conflictCount;

  return (
    <div style={styles.container}>
      {/* Header */}
      <div style={styles.header}>
        <span>Approvals & Conflicts</span>
        {totalCount > 0 && (
          <span style={styles.badge}>{totalCount}</span>
        )}
      </div>

      {/* Scrollable body */}
      <div style={styles.scrollArea}>
        {/* ── Pending Approvals ──────────────────────────────────── */}
        <div style={styles.section}>
          <div style={styles.sectionTitle}>
            <span>Pending Approvals</span>
            {approvalCount > 0 && (
              <span style={styles.badge}>{approvalCount}</span>
            )}
          </div>

          {!approvals && (
            <div style={styles.empty}>Loading...</div>
          )}

          {approvals && approvals.length === 0 && (
            <div style={styles.empty}>No pending approvals</div>
          )}

          {approvals?.map((approval) => {
            const busy = busyApprovals.has(approval._id);
            return (
              <div key={approval._id} style={styles.card}>
                <div style={styles.cardHeader}>
                  <span style={styles.cardType}>{approval.type}</span>
                  <span style={styles.cardMeta}>
                    {approval.requestedBy.type}: {approval.requestedBy.id}
                  </span>
                </div>
                <div style={styles.cardBody}>
                  {summarizePayload(approval.payload)}
                </div>
                <div style={styles.actions}>
                  <button
                    style={styles.rejectBtn}
                    disabled={busy}
                    onClick={() => handleApproval(approval._id, "rejected")}
                  >
                    {busy ? "..." : "Reject"}
                  </button>
                  <button
                    style={styles.approveBtn}
                    disabled={busy}
                    onClick={() => handleApproval(approval._id, "approved")}
                  >
                    {busy ? "..." : "Approve"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {/* ── Active Conflicts ──────────────────────────────────── */}
        <div style={styles.section}>
          <div style={styles.sectionTitle}>
            <span>Active Conflicts</span>
            {conflictCount > 0 && (
              <span style={styles.warningBadge}>{conflictCount}</span>
            )}
          </div>

          {!conflicts && (
            <div style={styles.empty}>Loading...</div>
          )}

          {conflicts && conflicts.length === 0 && (
            <div style={styles.empty}>No active conflicts</div>
          )}

          {conflicts?.map((conflict) => {
            const busy = busyConflicts.has(conflict._id);
            const typeStyle = CONFLICT_TYPE_COLORS[conflict.type] ?? {
              bg: "rgba(128,128,128,0.15)",
              color: "var(--color-text-muted)",
            };

            return (
              <div key={conflict._id} style={styles.card}>
                <div style={styles.cardHeader}>
                  <span
                    style={{
                      ...styles.conflictTypeBadge,
                      background: typeStyle.bg,
                      color: typeStyle.color,
                    }}
                  >
                    {conflict.type.replace("_", " ")}
                  </span>
                  <span style={styles.cardMeta}>
                    {new Date(conflict.createdAt).toLocaleTimeString()}
                  </span>
                </div>

                {conflict.filePath && (
                  <div style={styles.filePath}>{conflict.filePath}</div>
                )}

                {conflict.description && (
                  <div style={styles.cardBody}>{conflict.description}</div>
                )}

                {conflict.involvedUsers.length > 0 && (
                  <div style={styles.userList}>
                    Involved: {conflict.involvedUsers.join(", ")}
                  </div>
                )}

                <div style={styles.actions}>
                  <button
                    style={styles.resolveBtn}
                    disabled={busy}
                    onClick={() =>
                      handleResolveConflict(conflict._id, "Resolved manually")
                    }
                  >
                    {busy ? "..." : "Resolve"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
