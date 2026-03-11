import React, { useState } from "react";
import type { CSSProperties } from "react";
import {
  useProfile,
  usePublicArtifacts,
  useUserStars,
  useMyProjects,
  useUpdateProfile,
} from "./convex-hooks";
import type { Id } from "../../../convex/_generated/dataModel";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface ProfileViewProps {
  userId?: Id<"users">;
  isOwnProfile?: boolean;
}

// ---------------------------------------------------------------------------
// Tab type
// ---------------------------------------------------------------------------

type TabKey = "projects" | "public" | "starred";

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles: Record<string, CSSProperties> = {
  container: {
    display: "flex",
    flexDirection: "column",
    gap: 24,
    padding: 24,
    fontFamily: "var(--font-ui)",
    color: "var(--color-text)",
    background: "var(--color-background)",
    minHeight: "100%",
    overflowY: "auto",
  },
  profileHeader: {
    display: "flex",
    gap: 20,
    alignItems: "flex-start",
    padding: 20,
    background: "var(--color-surface)",
    border: "1px solid var(--color-border)",
    borderRadius: "var(--panel-radius)",
  },
  avatar: {
    width: 72,
    height: 72,
    borderRadius: "50%",
    background: "var(--color-accent)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 28,
    fontWeight: 700,
    color: "#fff",
    flexShrink: 0,
    overflow: "hidden",
  },
  avatarImg: {
    width: "100%",
    height: "100%",
    objectFit: "cover" as const,
    borderRadius: "50%",
  },
  profileInfo: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
    flex: 1,
    minWidth: 0,
  },
  displayName: {
    fontSize: 20,
    fontWeight: 700,
    color: "var(--color-text-bright)",
    margin: 0,
    wordBreak: "break-word" as const,
  },
  handle: {
    fontSize: 14,
    color: "var(--color-text-dim)",
    fontFamily: "var(--font-mono)",
    margin: 0,
  },
  bio: {
    fontSize: 14,
    color: "var(--color-text)",
    lineHeight: 1.5,
    margin: "4px 0 0 0",
  },
  editBtn: {
    padding: "6px 14px",
    fontSize: 13,
    fontFamily: "var(--font-ui)",
    fontWeight: 500,
    background: "var(--color-panel)",
    border: "1px solid var(--color-border)",
    borderRadius: "var(--panel-radius)",
    color: "var(--color-text)",
    cursor: "pointer",
    whiteSpace: "nowrap" as const,
    flexShrink: 0,
    alignSelf: "flex-start",
  },
  // Edit mode
  editForm: {
    display: "flex",
    flexDirection: "column",
    gap: 10,
    flex: 1,
  },
  editField: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
  },
  editLabel: {
    fontSize: 11,
    fontWeight: 600,
    color: "var(--color-text-dim)",
    textTransform: "uppercase" as const,
    letterSpacing: "0.05em",
  },
  editInput: {
    padding: "8px 10px",
    fontSize: 14,
    fontFamily: "var(--font-ui)",
    background: "var(--color-input)",
    border: "1px solid var(--color-input-border)",
    borderRadius: "var(--panel-radius)",
    color: "var(--color-text)",
    outline: "none",
  },
  editTextarea: {
    padding: "8px 10px",
    fontSize: 14,
    fontFamily: "var(--font-ui)",
    background: "var(--color-input)",
    border: "1px solid var(--color-input-border)",
    borderRadius: "var(--panel-radius)",
    color: "var(--color-text)",
    outline: "none",
    resize: "vertical" as const,
    minHeight: 60,
  },
  editSelect: {
    padding: "8px 10px",
    fontSize: 14,
    fontFamily: "var(--font-ui)",
    background: "var(--color-input)",
    border: "1px solid var(--color-input-border)",
    borderRadius: "var(--panel-radius)",
    color: "var(--color-text)",
    outline: "none",
  },
  editActions: {
    display: "flex",
    gap: 8,
    marginTop: 4,
  },
  saveBtn: {
    padding: "6px 16px",
    fontSize: 13,
    fontFamily: "var(--font-ui)",
    fontWeight: 600,
    background: "var(--color-accent)",
    border: "none",
    borderRadius: "var(--panel-radius)",
    color: "#fff",
    cursor: "pointer",
  },
  cancelBtn: {
    padding: "6px 16px",
    fontSize: 13,
    fontFamily: "var(--font-ui)",
    fontWeight: 500,
    background: "var(--color-panel)",
    border: "1px solid var(--color-border)",
    borderRadius: "var(--panel-radius)",
    color: "var(--color-text)",
    cursor: "pointer",
  },
  // Stats
  statsRow: {
    display: "flex",
    gap: 24,
    padding: "12px 20px",
    background: "var(--color-surface)",
    border: "1px solid var(--color-border)",
    borderRadius: "var(--panel-radius)",
  },
  statItem: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 2,
  },
  statValue: {
    fontSize: 18,
    fontWeight: 700,
    color: "var(--color-text-bright)",
  },
  statLabel: {
    fontSize: 11,
    color: "var(--color-text-dim)",
    textTransform: "uppercase" as const,
    letterSpacing: "0.04em",
  },
  // Tabs
  tabBar: {
    display: "flex",
    gap: 0,
    borderBottom: "1px solid var(--color-border)",
  },
  tab: {
    padding: "10px 20px",
    fontSize: 14,
    fontFamily: "var(--font-ui)",
    fontWeight: 500,
    background: "none",
    border: "none",
    borderBottom: "2px solid transparent",
    color: "var(--color-text-dim)",
    cursor: "pointer",
    transition: "all 0.15s",
  },
  tabActive: {
    color: "var(--color-text-bright)",
    borderBottomColor: "var(--color-accent)",
  },
  // Grid
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
    gap: 14,
  },
  card: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
    padding: 14,
    background: "var(--color-surface)",
    border: "1px solid var(--color-border)",
    borderRadius: "var(--panel-radius)",
  },
  cardName: {
    fontSize: 14,
    fontWeight: 600,
    color: "var(--color-text-bright)",
    margin: 0,
    wordBreak: "break-word" as const,
  },
  cardDesc: {
    fontSize: 13,
    color: "var(--color-text-dim)",
    margin: 0,
    lineHeight: 1.4,
    display: "-webkit-box",
    WebkitLineClamp: 2,
    WebkitBoxOrient: "vertical" as any,
    overflow: "hidden",
  },
  cardMeta: {
    fontSize: 11,
    color: "var(--color-text-dim)",
    fontFamily: "var(--font-mono)",
  },
  typeBadge: {
    display: "inline-block",
    fontSize: 10,
    fontWeight: 600,
    fontFamily: "var(--font-mono)",
    padding: "1px 6px",
    borderRadius: 4,
    textTransform: "uppercase" as const,
    marginRight: 6,
  },
  emptyState: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 40,
    color: "var(--color-text-dim)",
    fontSize: 14,
    fontStyle: "italic",
  },
  loading: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    color: "var(--color-text-dim)",
    fontSize: 13,
  },
};

// ---------------------------------------------------------------------------
// Badge colours
// ---------------------------------------------------------------------------

const TYPE_COLORS: Record<string, { bg: string; fg: string }> = {
  project: { bg: "#2563eb22", fg: "#60a5fa" },
  harness: { bg: "#7c3aed22", fg: "#a78bfa" },
  pipeline: { bg: "#059b6822", fg: "#34d399" },
  soul: { bg: "#d9770622", fg: "#fb923c" },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getInitials(name?: string): string {
  if (!name) return "?";
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ArtifactCard({ artifact }: { artifact: any }) {
  const typeKey = (artifact.type ?? "project") as string;
  const c = TYPE_COLORS[typeKey] ?? TYPE_COLORS.project;

  return (
    <div style={styles.card}>
      <div style={{ display: "flex", alignItems: "center" }}>
        <span style={{ ...styles.typeBadge, background: c.bg, color: c.fg }}>
          {typeKey}
        </span>
        <h4 style={styles.cardName}>{artifact.name ?? "Untitled"}</h4>
      </div>
      {artifact.description && (
        <p style={styles.cardDesc}>{artifact.description}</p>
      )}
      {artifact.tags && artifact.tags.length > 0 && (
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
          {artifact.tags.map((t: string) => (
            <span
              key={t}
              style={{
                fontSize: 10,
                padding: "1px 6px",
                borderRadius: 999,
                background: "var(--color-panel)",
                color: "var(--color-text-dim)",
              }}
            >
              {t}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function ProfileView({ userId, isOwnProfile }: ProfileViewProps) {
  const [activeTab, setActiveTab] = useState<TabKey>("projects");
  const [editing, setEditing] = useState(false);

  // Data hooks
  const profile = useProfile(userId as Id<"users">);
  const publicArtifacts = usePublicArtifacts(userId as Id<"users">);
  const userStars = useUserStars(userId as Id<"users">);
  const myProjects = useMyProjects(userId as Id<"users">);
  const updateProfile = useUpdateProfile();

  // Edit form state
  const [editName, setEditName] = useState("");
  const [editHandle, setEditHandle] = useState("");
  const [editBio, setEditBio] = useState("");
  const [editVisibility, setEditVisibility] = useState<"private" | "workspace" | "public">("private");

  if (!userId) {
    return (
      <div style={styles.container}>
        <div style={styles.emptyState}>No user selected.</div>
      </div>
    );
  }

  if (profile === undefined) {
    return (
      <div style={styles.container}>
        <div style={styles.loading}>Loading profile...</div>
      </div>
    );
  }

  if (profile === null) {
    return (
      <div style={styles.container}>
        <div style={styles.emptyState}>Profile not found.</div>
      </div>
    );
  }

  const startEditing = () => {
    setEditName(profile.displayName ?? "");
    setEditHandle(profile.handle ?? "");
    setEditBio(profile.bio ?? "");
    setEditVisibility(profile.profileVisibility ?? "private");
    setEditing(true);
  };

  const cancelEditing = () => {
    setEditing(false);
  };

  const saveProfile = () => {
    if (!userId) return;
    updateProfile({
      userId,
      displayName: editName,
      handle: editHandle,
      bio: editBio,
      profileVisibility: editVisibility,
    });
    setEditing(false);
  };

  // Stats
  const projectCount = myProjects?.length ?? 0;
  const starsGiven = userStars?.length ?? 0;
  const starsReceived = 0;

  // Tabs config
  const tabs: { key: TabKey; label: string }[] = [
    { key: "projects", label: "Projects" },
    { key: "public", label: "Public Artifacts" },
    { key: "starred", label: "Starred" },
  ];

  // Current tab data
  let tabData: any[] | undefined;
  let tabEmpty: string;
  switch (activeTab) {
    case "projects":
      tabData = myProjects;
      tabEmpty = "No projects yet.";
      break;
    case "public":
      tabData = publicArtifacts
        ? [...(publicArtifacts.harnesses ?? []), ...(publicArtifacts.projects ?? [])]
        : undefined;
      tabEmpty = "No public artifacts yet.";
      break;
    case "starred":
      tabData = userStars;
      tabEmpty = "No starred items yet.";
      break;
  }

  return (
    <div style={styles.container}>
      {/* Profile header */}
      <div style={styles.profileHeader}>
        <div style={styles.avatar}>
          {profile.avatarUrl ? (
            <img
              src={profile.avatarUrl}
              alt={profile.displayName ?? "Avatar"}
              style={styles.avatarImg}
            />
          ) : (
            getInitials(profile.displayName)
          )}
        </div>

        {editing ? (
          <div style={styles.editForm}>
            <div style={styles.editField}>
              <label style={styles.editLabel}>Display Name</label>
              <input
                style={styles.editInput}
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                placeholder="Display name"
              />
            </div>
            <div style={styles.editField}>
              <label style={styles.editLabel}>Handle</label>
              <input
                style={styles.editInput}
                value={editHandle}
                onChange={(e) => setEditHandle(e.target.value)}
                placeholder="handle"
              />
            </div>
            <div style={styles.editField}>
              <label style={styles.editLabel}>Bio</label>
              <textarea
                style={styles.editTextarea}
                value={editBio}
                onChange={(e) => setEditBio(e.target.value)}
                placeholder="Write a short bio..."
              />
            </div>
            <div style={styles.editField}>
              <label style={styles.editLabel}>Profile Visibility</label>
              <select
                style={styles.editSelect}
                value={editVisibility}
                onChange={(e) => setEditVisibility(e.target.value as "private" | "workspace" | "public")}
              >
                <option value="private">Private</option>
                <option value="workspace">Workspace</option>
                <option value="public">Public</option>
              </select>
            </div>
            <div style={styles.editActions}>
              <button style={styles.saveBtn} onClick={saveProfile}>
                Save
              </button>
              <button style={styles.cancelBtn} onClick={cancelEditing}>
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div style={styles.profileInfo}>
            <h2 style={styles.displayName}>
              {profile.displayName ?? "Unnamed User"}
            </h2>
            {profile.handle && (
              <p style={styles.handle}>@{profile.handle}</p>
            )}
            {profile.bio && <p style={styles.bio}>{profile.bio}</p>}
          </div>
        )}

        {isOwnProfile && !editing && (
          <button style={styles.editBtn} onClick={startEditing}>
            Edit Profile
          </button>
        )}
      </div>

      {/* Stats row */}
      <div style={styles.statsRow}>
        <div style={styles.statItem}>
          <span style={styles.statValue}>{projectCount}</span>
          <span style={styles.statLabel}>Projects</span>
        </div>
        <div style={styles.statItem}>
          <span style={styles.statValue}>{starsGiven}</span>
          <span style={styles.statLabel}>Stars Given</span>
        </div>
        <div style={styles.statItem}>
          <span style={styles.statValue}>{starsReceived}</span>
          <span style={styles.statLabel}>Stars Received</span>
        </div>
      </div>

      {/* Tabs */}
      <div style={styles.tabBar}>
        {tabs.map((t) => (
          <button
            key={t.key}
            style={{
              ...styles.tab,
              ...(activeTab === t.key ? styles.tabActive : {}),
            }}
            onClick={() => setActiveTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tabData === undefined ? (
        <div style={styles.loading}>Loading...</div>
      ) : tabData.length > 0 ? (
        <div style={styles.grid}>
          {tabData.map((item: any) => (
            <ArtifactCard key={item._id} artifact={item} />
          ))}
        </div>
      ) : (
        <div style={styles.emptyState}>{tabEmpty}</div>
      )}
    </div>
  );
}

export default ProfileView;
