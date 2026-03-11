import type { CSSProperties } from "react";
import React, { useState, useMemo } from "react";
import {
  useTrending,
  useRecentPublic,
  useDiscoverySearch,
  useDiscoveryByTag,
  usePublicProjects,
  usePublicPipelines,
  useToggleStar,
  useStarCount,
  useIsStarred,
} from "./convex-hooks";
import type { Id } from "../../../convex/_generated/dataModel";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ArtifactType = "project" | "harness" | "pipeline" | "soul";

interface ArtifactCard {
  _id: string;
  name: string;
  description?: string;
  type: ArtifactType;
  ownerId: Id<"users">;
  ownerName?: string;
  ownerHandle?: string;
  tags?: string[];
  targetType: string;
  targetId: string;
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface DiscoveryViewProps {
  currentUserId?: Id<"users">;
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
  tagBar: {
    display: "flex",
    flexWrap: "wrap" as const,
    gap: 6,
  },
  tagPill: {
    padding: "4px 12px",
    fontSize: 12,
    fontFamily: "var(--font-ui)",
    borderRadius: 999,
    border: "1px solid var(--color-border)",
    background: "var(--color-surface)",
    color: "var(--color-text-dim)",
    cursor: "pointer",
    transition: "all 0.15s",
  },
  tagPillActive: {
    background: "var(--color-accent)",
    color: "var(--color-text-bright)",
    borderColor: "var(--color-accent)",
  },
  section: {
    display: "flex",
    flexDirection: "column",
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
    gap: 8,
    padding: 16,
    background: "var(--color-surface)",
    border: "1px solid var(--color-border)",
    borderRadius: "var(--panel-radius)",
    cursor: "default",
    transition: "border-color 0.15s",
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
    lineHeight: 1.4,
    display: "-webkit-box",
    WebkitLineClamp: 2,
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
    paddingTop: 6,
    borderTop: "1px solid var(--color-border)",
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
    padding: "2px 6px",
    borderRadius: 999,
    background: "var(--color-panel)",
    color: "var(--color-text-dim)",
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
// Badge colour per type
// ---------------------------------------------------------------------------

const TYPE_COLORS: Record<ArtifactType, { bg: string; fg: string }> = {
  project: { bg: "#2563eb22", fg: "#60a5fa" },
  harness: { bg: "#7c3aed22", fg: "#a78bfa" },
  pipeline: { bg: "#059b6822", fg: "#34d399" },
  soul: { bg: "#d9770622", fg: "#fb923c" },
};

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

function ArtifactCardComponent({
  artifact,
  currentUserId,
  onNavigateToProfile,
}: {
  artifact: ArtifactCard;
  currentUserId?: Id<"users">;
  onNavigateToProfile?: (userId: Id<"users">) => void;
}) {
  const [hovered, setHovered] = useState(false);

  return (
    <div
      style={{
        ...styles.card,
        borderColor: hovered
          ? "var(--color-accent)"
          : "var(--color-border)",
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
        <StarButton
          currentUserId={currentUserId}
          targetType={artifact.targetType}
          targetId={artifact.targetId}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function DiscoveryView({
  currentUserId,
  onNavigateToProfile,
}: DiscoveryViewProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTag, setActiveTag] = useState<string | null>(null);

  // Data hooks
  const trending = useTrending(12);
  const recent = useRecentPublic(12);
  const searchResults = useDiscoverySearch(searchQuery || "");
  const tagResults = useDiscoveryByTag(activeTag ?? "");

  const isSearching = searchQuery.trim().length > 0;
  const isFiltering = activeTag !== null;

  // Pick the right dataset to display
  const displayData = useMemo(() => {
    if (isSearching) return searchResults;
    if (isFiltering) return tagResults;
    return null;
  }, [isSearching, isFiltering, searchResults, tagResults]);

  const handleTagClick = (tag: string) => {
    setActiveTag((prev) => (prev === tag ? null : tag));
    setSearchQuery("");
  };

  return (
    <div style={styles.container}>
      {/* Header + search */}
      <div style={styles.header}>
        <h2 style={styles.title}>Discover</h2>
        <div style={styles.searchBar}>
          <input
            style={styles.searchInput}
            type="text"
            placeholder="Search public projects, harnesses, pipelines..."
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              if (e.target.value.trim()) setActiveTag(null);
            }}
          />
        </div>
      </div>

      {/* Tag filter bar */}
      <div style={styles.tagBar}>
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
                <ArtifactCardComponent
                  key={a._id}
                  artifact={a}
                  currentUserId={currentUserId}
                  onNavigateToProfile={onNavigateToProfile}
                />
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

      {/* Trending section (show when not searching/filtering) */}
      {!isSearching && !isFiltering && (
        <div style={styles.section}>
          <h3 style={styles.sectionTitle}>Trending</h3>
          {trending === undefined ? (
            <div style={styles.loading}>Loading trending...</div>
          ) : trending && trending.length > 0 ? (
            <div style={styles.grid}>
              {trending.map((a: any) => (
                <ArtifactCardComponent
                  key={a._id}
                  artifact={a}
                  currentUserId={currentUserId}
                  onNavigateToProfile={onNavigateToProfile}
                />
              ))}
            </div>
          ) : (
            <div style={styles.emptyState}>
              Nothing trending yet. Be the first to publish!
            </div>
          )}
        </div>
      )}

      {/* Recent section (show when not searching/filtering) */}
      {!isSearching && !isFiltering && (
        <div style={styles.section}>
          <h3 style={styles.sectionTitle}>Recently Published</h3>
          {recent === undefined ? (
            <div style={styles.loading}>Loading recent...</div>
          ) : recent && recent.length > 0 ? (
            <div style={styles.grid}>
              {recent.map((a: any) => (
                <ArtifactCardComponent
                  key={a._id}
                  artifact={a}
                  currentUserId={currentUserId}
                  onNavigateToProfile={onNavigateToProfile}
                />
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
