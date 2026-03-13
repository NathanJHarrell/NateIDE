import type { CSSProperties } from "react";
import React, { useState, useMemo } from "react";
import { useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import {
  useTrending,
  useRecentPublic,
  useDiscoverySearch,
  useDiscoveryByTag,
  useToggleStar,
  useStarCount,
  useIsStarred,
} from "./convex-hooks";
import type { Id } from "../../../convex/_generated/dataModel";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ArtifactType = "project" | "harness" | "pipeline" | "soul";
type SortMode = "trending" | "newest" | "most-starred";

interface ArtifactCard {
  _id: string;
  name: string;
  description?: string;
  type: ArtifactType;
  ownerId: Id<"users">;
  ownerName?: string;
  ownerHandle?: string;
  ownerAvatarUrl?: string;
  tags?: string[];
  targetType: string;
  targetId: string;
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface DiscoveryViewProps {
  currentUserId?: Id<"users">;
  currentWorkspaceId?: Id<"workspaces">;
  onNavigateToProfile?: (userId: Id<"users">) => void;
}

// ---------------------------------------------------------------------------
// Common tags
// ---------------------------------------------------------------------------

const COMMON_TAGS = [
  "coding",
  "writing",
  "research",
  "devops",
  "data",
  "design",
  "testing",
  "security",
  "ml",
  "infra",
];

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
  header: {
    display: "flex",
    flexDirection: "column",
    gap: 12,
  },
  title: {
    fontSize: 22,
    fontWeight: 700,
    color: "var(--color-text-bright)",
    margin: 0,
  },
  searchBar: {
    display: "flex",
    alignItems: "center",
    gap: 8,
  },
  searchInput: {
    flex: 1,
    padding: "10px 14px",
    fontSize: 14,
    fontFamily: "var(--font-ui)",
    background: "var(--color-input)",
    border: "1px solid var(--color-input-border)",
    borderRadius: "var(--panel-radius)",
    color: "var(--color-text)",
    outline: "none",
  },
  tagFilterBar: {
    display: "flex",
    flexWrap: "wrap" as const,
    gap: 6,
    padding: "10px 14px",
    background: "var(--color-surface)",
    border: "1px solid var(--color-border)",
    borderRadius: "var(--panel-radius)",
  },
  tagBarLabel: {
    fontSize: 11,
    fontWeight: 600,
    color: "var(--color-text-dim)",
    textTransform: "uppercase" as const,
    letterSpacing: "0.05em",
    alignSelf: "center",
    marginRight: 4,
  },
  tagPill: {
    padding: "4px 12px",
    fontSize: 12,
    fontFamily: "var(--font-ui)",
    borderRadius: 999,
    border: "1px solid var(--color-border)",
    background: "transparent",
    color: "var(--color-text-dim)",
    cursor: "pointer",
    transition: "all 0.15s",
  },
  tagPillActive: {
    background: "var(--color-accent)",
    color: "var(--color-text-bright)",
    borderColor: "var(--color-accent)",
  },
  sortBar: {
    display: "flex",
    alignItems: "center",
    gap: 4,
  },
  sortLabel: {
    fontSize: 12,
    color: "var(--color-text-dim)",
    marginRight: 4,
    whiteSpace: "nowrap" as const,
  },
  sortBtn: {
    padding: "4px 10px",
    fontSize: 11,
    fontFamily: "var(--font-ui)",
    fontWeight: 500,
    borderRadius: 4,
    border: "1px solid var(--color-border)",
    background: "transparent",
    color: "var(--color-text-dim)",
    cursor: "pointer",
    transition: "all 0.15s",
  },
  sortBtnActive: {
    background: "var(--color-accent)",
    color: "var(--color-background)",
    borderColor: "var(--color-accent)",
    fontWeight: 600,
  },
  section: {
    display: "flex",
    flexDirection: "column",
    gap: 12,
  },
  sectionHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: 600,
    color: "var(--color-text-bright)",
    margin: 0,
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))",
    gap: 14,
  },
  card: {
    display: "flex",
    flexDirection: "column",
    gap: 10,
    padding: "18px 18px 14px",
    background: "var(--color-surface)",
    border: "1px solid var(--color-border)",
    borderRadius: "var(--panel-radius)",
    cursor: "default",
    transition: "border-color 0.15s, box-shadow 0.15s",
  },
  cardHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 8,
  },
  cardName: {
    fontSize: 15,
    fontWeight: 600,
    color: "var(--color-text-bright)",
    margin: 0,
    wordBreak: "break-word" as const,
  },
  cardDescription: {
    fontSize: 13,
    color: "var(--color-text-dim)",
    margin: 0,
    lineHeight: 1.5,
    display: "-webkit-box",
    WebkitLineClamp: 3,
    WebkitBoxOrient: "vertical" as any,
    overflow: "hidden",
  },
  typeBadge: {
    fontSize: 11,
    fontWeight: 600,
    fontFamily: "var(--font-mono)",
    padding: "2px 8px",
    borderRadius: 4,
    textTransform: "uppercase" as const,
    whiteSpace: "nowrap" as const,
    flexShrink: 0,
  },
  cardFooter: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: "auto",
    paddingTop: 8,
    borderTop: "1px solid var(--color-border)",
  },
  ownerInfo: {
    display: "flex",
    alignItems: "center",
    gap: 6,
  },
  ownerAvatar: {
    width: 20,
    height: 20,
    borderRadius: "50%",
    background: "var(--color-panel)",
    border: "1px solid var(--color-border)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 9,
    fontWeight: 600,
    color: "var(--color-text-dim)",
    overflow: "hidden",
    flexShrink: 0,
  },
  ownerAvatarImg: {
    width: "100%",
    height: "100%",
    borderRadius: "50%",
    objectFit: "cover" as const,
  },
  ownerLink: {
    fontSize: 12,
    color: "var(--color-accent)",
    cursor: "pointer",
    background: "none",
    border: "none",
    fontFamily: "var(--font-ui)",
    padding: 0,
  },
  starBtn: {
    display: "flex",
    alignItems: "center",
    gap: 4,
    fontSize: 12,
    fontFamily: "var(--font-ui)",
    color: "var(--color-text-dim)",
    background: "none",
    border: "none",
    cursor: "pointer",
    padding: "2px 6px",
    borderRadius: 4,
  },
  cardTags: {
    display: "flex",
    flexWrap: "wrap" as const,
    gap: 4,
  },
  cardTagPill: {
    fontSize: 10,
    padding: "2px 8px",
    borderRadius: 999,
    background: "var(--color-panel)",
    color: "var(--color-text-dim)",
    border: "1px solid var(--color-border)",
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
  // Soul action buttons
  soulActions: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    marginTop: 4,
    paddingTop: 8,
    borderTop: "1px solid var(--color-border)",
  },
  forkBtn: {
    display: "flex",
    alignItems: "center",
    gap: 4,
    padding: "4px 10px",
    fontSize: 11,
    fontWeight: 600,
    fontFamily: "var(--font-ui)",
    borderRadius: 4,
    border: "1px solid var(--color-accent)",
    background: "transparent",
    color: "var(--color-accent)",
    cursor: "pointer",
    transition: "background 0.15s, color 0.15s",
  },
  reportBtn: {
    display: "flex",
    alignItems: "center",
    gap: 4,
    padding: "4px 10px",
    fontSize: 11,
    fontWeight: 500,
    fontFamily: "var(--font-ui)",
    borderRadius: 4,
    border: "1px solid rgba(255,80,80,0.25)",
    background: "transparent",
    color: "#f77",
    cursor: "pointer",
    transition: "background 0.15s",
    marginLeft: "auto",
  },
  reportPanel: {
    display: "flex",
    flexDirection: "column" as const,
    gap: 6,
    marginTop: 4,
    padding: "10px",
    background: "var(--color-panel)",
    borderRadius: 6,
    border: "1px solid rgba(255,80,80,0.2)",
  },
  reportLabel: {
    fontSize: 11,
    color: "#f77",
    fontWeight: 600,
    fontFamily: "var(--font-ui)",
  },
  reportInput: {
    padding: "6px 8px",
    fontSize: 12,
    fontFamily: "var(--font-ui)",
    background: "var(--color-input)",
    border: "1px solid var(--color-input-border)",
    borderRadius: 4,
    color: "var(--color-text)",
    outline: "none",
    resize: "none" as const,
  },
  reportActions: {
    display: "flex",
    gap: 6,
    justifyContent: "flex-end",
  },
  reportSubmitBtn: {
    padding: "4px 12px",
    fontSize: 11,
    fontWeight: 600,
    fontFamily: "var(--font-ui)",
    borderRadius: 4,
    border: "none",
    background: "#c0392b",
    color: "#fff",
    cursor: "pointer",
  },
  reportCancelBtn: {
    padding: "4px 12px",
    fontSize: 11,
    fontFamily: "var(--font-ui)",
    borderRadius: 4,
    border: "1px solid var(--color-border)",
    background: "transparent",
    color: "var(--color-text-dim)",
    cursor: "pointer",
  },
  toastSuccess: {
    fontSize: 11,
    color: "#4a4",
    fontFamily: "var(--font-ui)",
    padding: "4px 0",
  },
  toastError: {
    fontSize: 11,
    color: "#f77",
    fontFamily: "var(--font-ui)",
    padding: "4px 0",
  },
};

// ---------------------------------------------------------------------------
// Badge colour per type
// ---------------------------------------------------------------------------

const TYPE_COLORS: Record<ArtifactType, { bg: string; fg: string }> = {
  project: { bg: "#2563eb22", fg: "#60a5fa" },
  harness: { bg: "#7c3aed22", fg: "#a78bfa" },
  pipeline: { bg: "#059b6822", fg: "#34d399" },
  soul: { bg: "#d9770622", fg: "#fb923c" },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
// Sub-components
// ---------------------------------------------------------------------------

function TypeBadge({ type }: { type: ArtifactType }) {
  const c = TYPE_COLORS[type] ?? TYPE_COLORS.project;
  return (
    <span style={{ ...styles.typeBadge, background: c.bg, color: c.fg }}>
      {type}
    </span>
  );
}

function StarButton({
  currentUserId,
  targetType,
  targetId,
}: {
  currentUserId?: Id<"users">;
  targetType: string;
  targetId: string;
}) {
  const count = useStarCount(targetType as ArtifactType, targetId);
  const starred = useIsStarred(
    currentUserId as Id<"users">,
    targetType as ArtifactType,
    targetId
  );
  const toggleStar = useToggleStar();

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!currentUserId) return;
    toggleStar({ userId: currentUserId, targetType: targetType as ArtifactType, targetId });
  };

  return (
    <button
      style={{
        ...styles.starBtn,
        color: starred ? "#facc15" : "var(--color-text-dim)",
      }}
      onClick={handleClick}
      title={currentUserId ? (starred ? "Unstar" : "Star") : "Sign in to star"}
    >
      {starred ? "\u2605" : "\u2606"} {count ?? 0}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Soul-specific: Fork + Report
// ---------------------------------------------------------------------------

function ForkButton({
  soulId,
  soulName,
  currentUserId,
  currentWorkspaceId,
}: {
  soulId: Id<"souls">;
  soulName: string;
  currentUserId?: Id<"users">;
  currentWorkspaceId?: Id<"workspaces">;
}) {
  const forkSoul = useMutation(api.souls.fork);
  const [status, setStatus] = useState<"idle" | "forking" | "done" | "error">("idle");
  const [hovered, setHovered] = useState(false);

  const canFork = !!currentUserId && !!currentWorkspaceId;

  const handleFork = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!canFork || status === "forking") return;

    setStatus("forking");
    try {
      await forkSoul({
        id: soulId,
        workspaceId: currentWorkspaceId!,
        forkedBy: currentUserId! as unknown as string,
        newName: `${soulName} (fork)`,
      });
      setStatus("done");
      setTimeout(() => setStatus("idle"), 3000);
    } catch (err) {
      console.error("Fork failed:", err);
      setStatus("error");
      setTimeout(() => setStatus("idle"), 3000);
    }
  };

  if (status === "done") {
    return <span style={styles.toastSuccess}>{"\u2713"} Forked to your workspace</span>;
  }
  if (status === "error") {
    return <span style={styles.toastError}>Fork failed. Try again.</span>;
  }

  return (
    <button
      style={{
        ...styles.forkBtn,
        ...(hovered && canFork ? { background: "var(--color-accent)", color: "var(--color-background)" } : {}),
        opacity: canFork ? 1 : 0.4,
        cursor: canFork ? "pointer" : "not-allowed",
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={handleFork}
      title={
        !currentUserId
          ? "Sign in to fork"
          : !currentWorkspaceId
          ? "Open a workspace to fork into"
          : `Fork "${soulName}" into your workspace`
      }
      disabled={!canFork || status === "forking"}
    >
      {status === "forking" ? "Forking..." : "\u{1F374} Fork"}
    </button>
  );
}

function ReportButton({
  soulId,
  currentUserId,
}: {
  soulId: Id<"souls">;
  currentUserId?: Id<"users">;
}) {
  const reportSoul = useMutation(api.souls.report);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [status, setStatus] = useState<"idle" | "submitting" | "done" | "error">("idle");

  const handleSubmit = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!currentUserId || !reason.trim() || status === "submitting") return;

    setStatus("submitting");
    try {
      await reportSoul({
        id: soulId,
        reason: reason.trim(),
        reportedBy: currentUserId as unknown as string,
      });
      setStatus("done");
      setOpen(false);
      setReason("");
      setTimeout(() => setStatus("idle"), 4000);
    } catch (err) {
      console.error("Report failed:", err);
      setStatus("error");
      setTimeout(() => setStatus("idle"), 3000);
    }
  };

  if (status === "done") {
    return <span style={{ ...styles.toastSuccess, marginLeft: "auto" }}>Reported -- removed from public view</span>;
  }
  if (status === "error") {
    return <span style={{ ...styles.toastError, marginLeft: "auto" }}>Report failed. Try again.</span>;
  }

  if (open) {
    return (
      <div style={styles.reportPanel} onClick={(e) => e.stopPropagation()}>
        <span style={styles.reportLabel}>Report this soul document</span>
        <textarea
          style={{ ...styles.reportInput, height: 60 }}
          placeholder="Describe the issue (required)"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Escape") setOpen(false); }}
          autoFocus
        />
        <div style={styles.reportActions}>
          <button
            style={styles.reportCancelBtn}
            onClick={(e) => { e.stopPropagation(); setOpen(false); setReason(""); }}
          >
            Cancel
          </button>
          <button
            style={{
              ...styles.reportSubmitBtn,
              opacity: reason.trim() ? 1 : 0.5,
              cursor: reason.trim() ? "pointer" : "not-allowed",
            }}
            onClick={handleSubmit}
            disabled={!reason.trim() || status === "submitting"}
          >
            {status === "submitting" ? "Submitting..." : "Submit Report"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <button
      style={{ ...styles.reportBtn }}
      onClick={(e) => {
        e.stopPropagation();
        if (!currentUserId) return;
        setOpen(true);
      }}
      title={currentUserId ? "Report this soul document" : "Sign in to report"}
      disabled={!currentUserId}
    >
      {"\u{1F6A9}"} Report
    </button>
  );
}

// ---------------------------------------------------------------------------
// Artifact card
// ---------------------------------------------------------------------------

function ArtifactCardComponent({
  artifact,
  currentUserId,
  currentWorkspaceId,
  onNavigateToProfile,
}: {
  artifact: ArtifactCard;
  currentUserId?: Id<"users">;
  currentWorkspaceId?: Id<"workspaces">;
  onNavigateToProfile?: (userId: Id<"users">) => void;
}) {
  const [hovered, setHovered] = useState(false);
  const isSoul = artifact.type === "soul";

  return (
    <div
      className="discovery-card"
      style={{
        ...styles.card,
        borderColor: hovered ? "var(--color-accent)" : "var(--color-border)",
        boxShadow: hovered ? "0 0 12px rgba(94,165,232,0.08)" : "none",
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div style={styles.cardHeader}>
        <h4 style={styles.cardName}>{artifact.name}</h4>
        <TypeBadge type={artifact.type} />
      </div>

      {artifact.description && (
        <p style={styles.cardDescription}>{artifact.description}</p>
      )}

      {artifact.tags && artifact.tags.length > 0 && (
        <div style={styles.cardTags}>
          {artifact.tags.map((t) => (
            <span key={t} style={styles.cardTagPill}>
              {t}
            </span>
          ))}
        </div>
      )}

      <div style={styles.cardFooter}>
        <div style={styles.ownerInfo}>
          <div style={styles.ownerAvatar}>
            {artifact.ownerAvatarUrl ? (
              <img
                src={artifact.ownerAvatarUrl}
                alt=""
                style={styles.ownerAvatarImg}
              />
            ) : (
              getInitials(artifact.ownerName)
            )}
          </div>
          <button
            style={styles.ownerLink}
            onClick={() =>
              onNavigateToProfile && onNavigateToProfile(artifact.ownerId)
            }
          >
            {artifact.ownerHandle
              ? `@${artifact.ownerHandle}`
              : artifact.ownerName ?? "unknown"}
          </button>
        </div>
        <StarButton
          currentUserId={currentUserId}
          targetType={artifact.targetType}
          targetId={artifact.targetId}
        />
      </div>

      {/* Fork + Report -- soul cards only */}
      {isSoul && (
        <div style={styles.soulActions}>
          <ForkButton
            soulId={artifact.targetId as Id<"souls">}
            soulName={artifact.name}
            currentUserId={currentUserId}
            currentWorkspaceId={currentWorkspaceId}
          />
          <ReportButton
            soulId={artifact.targetId as Id<"souls">}
            currentUserId={currentUserId}
          />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sort bar
// ---------------------------------------------------------------------------

function SortBar({
  value,
  onChange,
}: {
  value: SortMode;
  onChange: (mode: SortMode) => void;
}) {
  const modes: { key: SortMode; label: string }[] = [
    { key: "trending", label: "Trending" },
    { key: "most-starred", label: "Most starred" },
    { key: "newest", label: "Newest" },
  ];

  return (
    <div style={styles.sortBar}>
      <span style={styles.sortLabel}>Sort:</span>
      {modes.map((m) => (
        <button
          key={m.key}
          style={{
            ...styles.sortBtn,
            ...(value === m.key ? styles.sortBtnActive : {}),
          }}
          onClick={() => onChange(m.key)}
        >
          {m.label}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function DiscoveryView({
  currentUserId,
  currentWorkspaceId,
  onNavigateToProfile,
}: DiscoveryViewProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [sortMode, setSortMode] = useState<SortMode>("trending");

  const trending = useTrending(12);
  const recent = useRecentPublic(12);
  const searchResults = useDiscoverySearch(searchQuery || "");
  const tagResults = useDiscoveryByTag(activeTag ?? "");

  const isSearching = searchQuery.trim().length > 0;
  const isFiltering = activeTag !== null;

  const displayData = useMemo(() => {
    if (isSearching) return searchResults;
    if (isFiltering) return tagResults;
    return null;
  }, [isSearching, isFiltering, searchResults, tagResults]);

  // Choose which main section data to show based on sort mode
  const mainSectionData = useMemo(() => {
    if (sortMode === "newest") return recent;
    // "trending" and "most-starred" both use trending data (backend ranks by stars)
    return trending;
  }, [sortMode, trending, recent]);

  const mainSectionTitle = useMemo(() => {
    switch (sortMode) {
      case "trending": return "Trending";
      case "most-starred": return "Most Starred";
      case "newest": return "Recently Published";
    }
  }, [sortMode]);

  const handleTagClick = (tag: string) => {
    setActiveTag((prev) => (prev === tag ? null : tag));
    setSearchQuery("");
  };

  const cardProps = { currentUserId, currentWorkspaceId, onNavigateToProfile };

  return (
    <div style={styles.container}>
      {/* Header + search */}
      <div style={styles.header}>
        <h2 style={styles.title}>Discover</h2>
        <div style={styles.searchBar}>
          <input
            style={styles.searchInput}
            type="text"
            placeholder="Search public projects, harnesses, pipelines, souls..."
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              if (e.target.value.trim()) setActiveTag(null);
            }}
          />
        </div>
      </div>

      {/* Tag filter bar */}
      <div style={styles.tagFilterBar}>
        <span style={styles.tagBarLabel}>Tags</span>
        {COMMON_TAGS.map((tag) => (
          <button
            key={tag}
            style={{
              ...styles.tagPill,
              ...(activeTag === tag ? styles.tagPillActive : {}),
            }}
            onClick={() => handleTagClick(tag)}
          >
            {tag}
          </button>
        ))}
      </div>

      {/* Search / tag results */}
      {(isSearching || isFiltering) && (
        <div style={styles.section}>
          <h3 style={styles.sectionTitle}>
            {isSearching
              ? `Results for "${searchQuery}"`
              : `Tagged: ${activeTag}`}
          </h3>
          {displayData === undefined ? (
            <div style={styles.loading}>Loading...</div>
          ) : displayData && displayData.length > 0 ? (
            <div style={styles.grid}>
              {displayData.map((a: any) => (
                <ArtifactCardComponent key={a._id} artifact={a} {...cardProps} />
              ))}
            </div>
          ) : (
            <div style={styles.emptyState}>
              {isSearching
                ? "No results found. Try a different search."
                : "No artifacts tagged with this label yet."}
            </div>
          )}
        </div>
      )}

      {/* Main browsing section with sort controls */}
      {!isSearching && !isFiltering && (
        <div style={styles.section}>
          <div style={styles.sectionHeader}>
            <h3 style={styles.sectionTitle}>{mainSectionTitle}</h3>
            <SortBar value={sortMode} onChange={setSortMode} />
          </div>
          {mainSectionData === undefined ? (
            <div style={styles.loading}>Loading...</div>
          ) : mainSectionData && mainSectionData.length > 0 ? (
            <div style={styles.grid}>
              {mainSectionData.map((a: any) => (
                <ArtifactCardComponent key={a._id} artifact={a} {...cardProps} />
              ))}
            </div>
          ) : (
            <div style={styles.emptyState}>
              Nothing here yet. Be the first to publish!
            </div>
          )}
        </div>
      )}

      {/* Recently Published -- show as secondary section when sorting by trending/most-starred */}
      {!isSearching && !isFiltering && sortMode !== "newest" && (
        <div style={styles.section}>
          <h3 style={styles.sectionTitle}>Recently Published</h3>
          {recent === undefined ? (
            <div style={styles.loading}>Loading recent...</div>
          ) : recent && recent.length > 0 ? (
            <div style={styles.grid}>
              {recent.map((a: any) => (
                <ArtifactCardComponent key={a._id} artifact={a} {...cardProps} />
              ))}
            </div>
          ) : (
            <div style={styles.emptyState}>
              No public artifacts yet. Publish something to get started!
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default DiscoveryView;
