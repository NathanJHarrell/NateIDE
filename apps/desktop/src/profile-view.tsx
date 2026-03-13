import React, { useState } from "react";
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
// Badge colours
// ---------------------------------------------------------------------------

const TYPE_COLORS: Record<string, { bg: string; fg: string }> = {
  project: { bg: "#2563eb22", fg: "#60a5fa" },
  harness: { bg: "#7c3aed22", fg: "#a78bfa" },
  pipeline: { bg: "#059b6822", fg: "#34d399" },
  soul: { bg: "#d9770622", fg: "#fb923c" },
};

// ---------------------------------------------------------------------------
// Activity kind icons (simple text glyphs)
// ---------------------------------------------------------------------------

const KIND_ICONS: Record<string, string> = {
  Project: "\u25A0",         // filled square
  "Public Project": "\u25C6", // diamond
  "Public Harness": "\u25B2", // triangle
  Star: "\u2605",             // star
};

const KIND_COLORS: Record<string, string> = {
  Project: "#60a5fa",
  "Public Project": "#34d399",
  "Public Harness": "#a78bfa",
  Star: "#fbbf24",
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

function formatVisibilityLabel(visibility?: "private" | "workspace" | "public"): string {
  switch (visibility) {
    case "public":
      return "Public";
    case "workspace":
      return "Workspace";
    default:
      return "Private";
  }
}

function formatDateLabel(value?: number | string): string {
  if (!value) {
    return "No date";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "No date";
  }

  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function relativeTime(ts: number): string {
  const now = Date.now();
  const diff = now - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return formatDateLabel(ts);
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ArtifactCard({ artifact }: { artifact: any }) {
  const typeKey = (artifact.type ?? artifact.targetType ?? "project") as string;
  const c = TYPE_COLORS[typeKey] ?? TYPE_COLORS.project;
  const displayName =
    artifact.name
    ?? `${artifact.targetType ?? artifact.type ?? "artifact"} ${artifact.targetId ?? ""}`.trim();
  const description =
    artifact.description
    ?? (artifact.targetId ? `Saved target ${artifact.targetId}` : undefined);
  const tags = Array.isArray(artifact.tags) ? artifact.tags : [];

  return (
    <div className="pv-artifact-card">
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span
          className="pv-type-badge"
          style={{ background: c.bg, color: c.fg }}
        >
          {typeKey}
        </span>
        <h4 className="pv-card-name">{displayName}</h4>
      </div>
      {description && (
        <p className="pv-card-desc">{description}</p>
      )}
      {tags.length > 0 && (
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
          {tags.map((t: string) => (
            <span key={t} className="pv-tag">
              {t}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function EmptyState({ icon, title, description }: { icon: string; title: string; description: string }) {
  return (
    <div className="pv-empty-state">
      <span className="pv-empty-icon">{icon}</span>
      <span className="pv-empty-title">{title}</span>
      <span className="pv-empty-desc">{description}</span>
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
      <div className="pv-container">
        <EmptyState icon="\u{1F464}" title="No user selected" description="Select a user to view their profile." />
      </div>
    );
  }

  if (profile === undefined) {
    return (
      <div className="pv-container">
        <div className="pv-loading">Loading profile...</div>
      </div>
    );
  }

  if (profile === null) {
    return (
      <div className="pv-container">
        <EmptyState icon="\u{1F50D}" title="Profile not found" description="This user doesn't seem to exist." />
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
  const publicArtifactCount =
    (publicArtifacts?.projects?.length ?? 0) + (publicArtifacts?.harnesses?.length ?? 0);
  const starsGiven = userStars?.length ?? 0;
  const checklistItems = [
    !profile.displayName ? "Add a display name" : null,
    !profile.handle ? "Claim a handle" : null,
    !profile.bio ? "Write a short bio" : null,
    !profile.avatarUrl ? "Upload an avatar" : null,
    profile.profileVisibility !== "public" ? "Switch visibility to public when you're ready" : null,
  ].filter((item): item is string => Boolean(item));
  const profileCompletion = Math.round(((5 - checklistItems.length) / 5) * 100);
  const completedItems = 5 - checklistItems.length;
  const joinedAt = profile._creationTime ?? undefined;
  const recentActivity = [
    ...(myProjects ?? []).map((project) => ({
      id: `project-${project._id}`,
      kind: "Project",
      title: project.name ?? "Untitled project",
      description: project.description ?? "Workspace project",
      ts: project.updatedAt ?? project.createdAt ?? project._creationTime ?? 0,
    })),
    ...((publicArtifacts?.projects ?? []).map((project) => ({
      id: `public-project-${project._id}`,
      kind: "Public Project",
      title: project.name ?? "Untitled public project",
      description: project.description ?? "Published to discovery",
      ts: project.updatedAt ?? project.createdAt ?? project._creationTime ?? 0,
    }))),
    ...((publicArtifacts?.harnesses ?? []).map((harness) => ({
      id: `public-harness-${harness._id}`,
      kind: "Public Harness",
      title: harness.name ?? "Untitled harness",
      description: harness.description ?? "Published harness",
      ts: harness.updatedAt ?? harness.createdAt ?? harness._creationTime ?? 0,
    }))),
    ...(userStars ?? []).map((star) => ({
      id: `star-${star._id}`,
      kind: "Star",
      title: `Starred ${star.targetType}`,
      description: star.targetId,
      ts: star.createdAt ?? star._creationTime ?? 0,
    })),
  ]
    .sort((left, right) => right.ts - left.ts)
    .slice(0, 8);

  // Tabs config
  const tabs: { key: TabKey; label: string; count: number; emptyIcon: string; emptyTitle: string; emptyDesc: string }[] = [
    { key: "projects", label: "Projects", count: projectCount, emptyIcon: "\u{1F4C1}", emptyTitle: "No projects yet", emptyDesc: "Create a project to get started building." },
    { key: "public", label: "Public", count: publicArtifactCount, emptyIcon: "\u{1F310}", emptyTitle: "Nothing published", emptyDesc: "Publish a project or harness to share your work with the community." },
    { key: "starred", label: "Starred", count: starsGiven, emptyIcon: "\u2B50", emptyTitle: "No stars yet", emptyDesc: "Star projects you find interesting to bookmark them here." },
  ];

  // Current tab data
  let tabData: any[] | undefined;
  const currentTab = tabs.find((t) => t.key === activeTab)!;
  switch (activeTab) {
    case "projects":
      tabData = myProjects;
      break;
    case "public":
      tabData = publicArtifacts
        ? [...(publicArtifacts.harnesses ?? []), ...(publicArtifacts.projects ?? [])]
        : undefined;
      break;
    case "starred":
      tabData = userStars;
      break;
  }

  return (
    <div className="pv-container">
      {/* ── Hero header card ── */}
      <div className="pv-hero">
        <div className="pv-hero-banner" />
        <div className="pv-hero-body">
          <div className="pv-avatar-large">
            {profile.avatarUrl ? (
              <img
                src={profile.avatarUrl}
                alt={profile.displayName ?? "Avatar"}
                className="pv-avatar-img"
              />
            ) : (
              getInitials(profile.displayName)
            )}
          </div>

          <div className="pv-hero-info">
            {editing ? (
              <div className="pv-edit-form">
                <div className="pv-edit-field">
                  <label className="pv-edit-label">Display Name</label>
                  <input
                    className="pv-edit-input"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    placeholder="Display name"
                  />
                </div>
                <div className="pv-edit-field">
                  <label className="pv-edit-label">Handle</label>
                  <input
                    className="pv-edit-input"
                    value={editHandle}
                    onChange={(e) => setEditHandle(e.target.value)}
                    placeholder="handle"
                  />
                </div>
                <div className="pv-edit-field">
                  <label className="pv-edit-label">Bio</label>
                  <textarea
                    className="pv-edit-textarea"
                    value={editBio}
                    onChange={(e) => setEditBio(e.target.value)}
                    placeholder="Write a short bio..."
                  />
                </div>
                <div className="pv-edit-field">
                  <label className="pv-edit-label">Profile Visibility</label>
                  <select
                    className="pv-edit-select"
                    value={editVisibility}
                    onChange={(e) => setEditVisibility(e.target.value as "private" | "workspace" | "public")}
                  >
                    <option value="private">Private</option>
                    <option value="workspace">Workspace</option>
                    <option value="public">Public</option>
                  </select>
                </div>
                <div className="pv-edit-actions">
                  <button className="pv-btn-primary" onClick={saveProfile}>
                    Save
                  </button>
                  <button className="pv-btn-secondary" onClick={cancelEditing}>
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="pv-name-row">
                  <h2 className="pv-display-name">
                    {profile.displayName ?? "Unnamed User"}
                  </h2>
                  <span className="pv-visibility-badge">
                    {formatVisibilityLabel(profile.profileVisibility)}
                  </span>
                </div>
                {profile.handle && (
                  <p className="pv-handle">@{profile.handle}</p>
                )}
                {profile.bio && <p className="pv-bio">{profile.bio}</p>}
                <div className="pv-hero-meta">
                  <span className="pv-meta-item">Joined {formatDateLabel(joinedAt)}</span>
                  {profile.handle && (
                    <span className="pv-meta-item">Findable as @{profile.handle}</span>
                  )}
                </div>
              </>
            )}
          </div>

          <div className="pv-hero-actions">
            {isOwnProfile && !editing && (
              <button className="pv-btn-secondary" onClick={startEditing}>
                Edit Profile
              </button>
            )}
            {!isOwnProfile && (
              <>
                <button className="pv-btn-primary">Follow</button>
                <button className="pv-btn-secondary">Message</button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* ── Stats row ── */}
      <div className="pv-stats-row">
        <div className="pv-stat">
          <span className="pv-stat-value">{projectCount}</span>
          <span className="pv-stat-label">Projects</span>
        </div>
        <div className="pv-stat-divider" />
        <div className="pv-stat">
          <span className="pv-stat-value">{publicArtifactCount}</span>
          <span className="pv-stat-label">Public</span>
        </div>
        <div className="pv-stat-divider" />
        <div className="pv-stat">
          <span className="pv-stat-value">{starsGiven}</span>
          <span className="pv-stat-label">Stars</span>
        </div>
        <div className="pv-stat-divider" />
        <div className="pv-stat">
          <span className="pv-stat-value">{formatVisibilityLabel(profile.profileVisibility)}</span>
          <span className="pv-stat-label">Visibility</span>
        </div>
      </div>

      {/* ── Profile completion (own profile only) ── */}
      {isOwnProfile && (
        <div className="pv-completion-card">
          <div className="pv-completion-header">
            <div>
              <h3 className="pv-section-title">Profile Completion</h3>
              <span className="pv-completion-fraction">{completedItems} of 5 complete</span>
            </div>
            <span className="pv-completion-pct">{profileCompletion}%</span>
          </div>
          <div className="pv-progress-track">
            <div
              className="pv-progress-fill"
              style={{ width: `${profileCompletion}%` }}
            />
          </div>
          {checklistItems.length > 0 && (
            <div className="pv-checklist">
              {[
                { label: "Add a display name", done: !!profile.displayName },
                { label: "Claim a handle", done: !!profile.handle },
                { label: "Write a short bio", done: !!profile.bio },
                { label: "Upload an avatar", done: !!profile.avatarUrl },
                { label: "Switch visibility to public", done: profile.profileVisibility === "public" },
              ].map((step) => (
                <div key={step.label} className={`pv-checklist-item ${step.done ? "pv-checklist-done" : ""}`}>
                  <span className="pv-check-icon">{step.done ? "\u2713" : "\u25CB"}</span>
                  <span>{step.label}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Activity timeline ── */}
      <div className="pv-section-card">
        <div className="pv-section-header">
          <h3 className="pv-section-title">Recent Activity</h3>
          <span className="pv-section-count">{recentActivity.length} items</span>
        </div>
        {recentActivity.length > 0 ? (
          <div className="pv-timeline">
            {recentActivity.map((item, idx) => {
              const icon = KIND_ICONS[item.kind] ?? "\u25CF";
              const color = KIND_COLORS[item.kind] ?? "var(--color-accent)";
              return (
                <div key={item.id} className="pv-timeline-item">
                  <div className="pv-timeline-rail">
                    <span className="pv-timeline-dot" style={{ color }}>{icon}</span>
                    {idx < recentActivity.length - 1 && <div className="pv-timeline-line" />}
                  </div>
                  <div className="pv-timeline-content">
                    <div className="pv-timeline-top">
                      <span className="pv-timeline-kind">{item.kind}</span>
                      <span className="pv-timeline-time">{relativeTime(item.ts)}</span>
                    </div>
                    <span className="pv-timeline-title">{item.title}</span>
                    {item.description && (
                      <p className="pv-timeline-desc">{item.description}</p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <EmptyState
            icon="\u{1F4AC}"
            title="No activity yet"
            description="Start a project or star something to seed this feed."
          />
        )}
      </div>

      {/* ── Tabs ── */}
      <div className="pv-tab-bar">
        {tabs.map((t) => (
          <button
            key={t.key}
            className={`pv-tab ${activeTab === t.key ? "pv-tab-active" : ""}`}
            onClick={() => setActiveTab(t.key)}
          >
            <span className="pv-tab-label">{t.label}</span>
            <span className="pv-tab-count">{t.count}</span>
          </button>
        ))}
      </div>

      {/* ── Tab content ── */}
      {tabData === undefined ? (
        <div className="pv-loading">Loading...</div>
      ) : tabData.length > 0 ? (
        <div className="pv-grid">
          {tabData.map((item: any) => (
            <ArtifactCard key={item._id} artifact={item} />
          ))}
        </div>
      ) : (
        <EmptyState
          icon={currentTab.emptyIcon}
          title={currentTab.emptyTitle}
          description={currentTab.emptyDesc}
        />
      )}
    </div>
  );
}

export default ProfileView;
