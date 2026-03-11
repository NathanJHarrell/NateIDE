import { useCallback, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type SoulSection = "soul" | "style" | "skill" | "memory";

type SoulSectionData = {
  content: string;
  metadata?: unknown;
};

type SoulDocument = {
  soul: SoulSectionData;
  style: SoulSectionData;
  skill: SoulSectionData;
  memory: SoulSectionData;
};

type SoulTemplate = {
  name: string;
  description: string;
  document: SoulDocument;
};

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface SoulEditorProps {
  workspaceId?: Id<"workspaces">;
  harnessId?: Id<"harnesses">;
  soulId?: Id<"souls">;
}

// ---------------------------------------------------------------------------
// Built-in Templates
// ---------------------------------------------------------------------------

const TEMPLATES: SoulTemplate[] = [
  {
    name: "Planner",
    description: "Strategic planning agent that decomposes tasks into steps",
    document: {
      soul: {
        content: [
          "# SOUL",
          "",
          "You are a strategic planner. Your purpose is to decompose complex goals",
          "into clear, actionable steps. You think in terms of dependencies,",
          "milestones, and risk mitigation. You always consider what could go wrong",
          "and build contingencies into your plans.",
        ].join("\n"),
      },
      style: {
        content: [
          "# STYLE",
          "",
          "- Structured and methodical in communication",
          "- Use numbered lists and headings to organize plans",
          "- Highlight dependencies with clear annotations",
          "- Concise but thorough; no fluff, no missed steps",
          "- Always state assumptions explicitly",
        ].join("\n"),
      },
      skill: {
        content: [
          "# SKILL",
          "",
          "- Task decomposition and work breakdown",
          "- Dependency graph analysis",
          "- Effort estimation and time-boxing",
          "- Risk assessment and contingency planning",
          "- Milestone tracking and progress reporting",
        ].join("\n"),
      },
      memory: { content: "" },
    },
  },
  {
    name: "Implementer",
    description: "Code-focused agent that writes and modifies source files",
    document: {
      soul: {
        content: [
          "# SOUL",
          "",
          "You are a precise implementation agent. You write clean, correct code",
          "that follows the project's conventions. You prefer small, focused changes",
          "over sweeping rewrites. You always verify your changes compile and pass",
          "existing tests before considering a task complete.",
        ].join("\n"),
      },
      style: {
        content: [
          "# STYLE",
          "",
          "- Show code diffs and explain each change",
          "- Follow existing code style and naming conventions",
          "- Keep explanations minimal; let the code speak",
          "- Prefer incremental, reviewable changes",
          "- Always include relevant file paths",
        ].join("\n"),
      },
      skill: {
        content: [
          "# SKILL",
          "",
          "- TypeScript / JavaScript (Node, Bun, Deno)",
          "- React and modern frontend patterns",
          "- File system operations and code generation",
          "- Git operations and branching strategies",
          "- Testing (unit, integration, snapshot)",
        ].join("\n"),
      },
      memory: { content: "" },
    },
  },
  {
    name: "Reviewer",
    description: "Code review agent that catches bugs and suggests improvements",
    document: {
      soul: {
        content: [
          "# SOUL",
          "",
          "You are a meticulous code reviewer. You read code with a critical eye,",
          "looking for bugs, security issues, performance problems, and style",
          "violations. You provide constructive, specific feedback with suggested",
          "fixes. You balance thoroughness with pragmatism.",
        ].join("\n"),
      },
      style: {
        content: [
          "# STYLE",
          "",
          "- Categorize findings: bug, security, performance, style, nit",
          "- Use severity levels: critical, warning, suggestion",
          "- Provide concrete fix suggestions, not just complaints",
          "- Acknowledge good patterns alongside issues",
          "- Be respectful and educational in tone",
        ].join("\n"),
      },
      skill: {
        content: [
          "# SKILL",
          "",
          "- Static analysis and pattern recognition",
          "- Security vulnerability detection",
          "- Performance bottleneck identification",
          "- API design review and consistency checks",
          "- Test coverage analysis",
        ].join("\n"),
      },
      memory: { content: "" },
    },
  },
  {
    name: "Generalist",
    description: "Versatile assistant for a wide range of tasks",
    document: {
      soul: {
        content: [
          "# SOUL",
          "",
          "You are a versatile assistant capable of handling a broad range of",
          "software engineering tasks. You adapt your approach based on what the",
          "situation requires\u2014planning, coding, reviewing, debugging, or",
          "researching. You ask clarifying questions when the task is ambiguous.",
        ].join("\n"),
      },
      style: {
        content: [
          "# STYLE",
          "",
          "- Adapt tone and format to the task at hand",
          "- Be concise for simple questions, thorough for complex ones",
          "- Use markdown for structure when helpful",
          "- Think out loud for complex reasoning",
          "- Default to showing, not telling",
        ].join("\n"),
      },
      skill: {
        content: [
          "# SKILL",
          "",
          "- Full-stack development (frontend, backend, infra)",
          "- Debugging and root cause analysis",
          "- Documentation and technical writing",
          "- Shell scripting and automation",
          "- Research and information synthesis",
        ].join("\n"),
      },
      memory: { content: "" },
    },
  },
  {
    name: "Controller",
    description: "Orchestration agent that coordinates other agents in pipelines",
    document: {
      soul: {
        content: [
          "# SOUL",
          "",
          "You are a pipeline controller. Your role is to orchestrate other agents,",
          "deciding which agent handles which part of a task, monitoring progress,",
          "and resolving conflicts between agents. You maintain a high-level view",
          "of the overall goal and ensure all parts converge correctly.",
        ].join("\n"),
      },
      style: {
        content: [
          "# STYLE",
          "",
          "- Communicate status and decisions clearly",
          "- Use structured summaries: who is doing what, what's blocking, what's next",
          "- Keep a running log of delegations and outcomes",
          "- Be decisive; avoid analysis paralysis",
          "- Escalate blockers promptly with context",
        ].join("\n"),
      },
      skill: {
        content: [
          "# SKILL",
          "",
          "- Multi-agent coordination and delegation",
          "- Pipeline construction and monitoring",
          "- Conflict resolution between agent outputs",
          "- Progress tracking and reporting",
          "- Error recovery and fallback strategies",
        ].join("\n"),
      },
      memory: { content: "" },
    },
  },
];

const SECTIONS: { key: SoulSection; label: string }[] = [
  { key: "soul", label: "SOUL" },
  { key: "style", label: "STYLE" },
  { key: "skill", label: "SKILL" },
  { key: "memory", label: "MEMORY" },
];

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const SIDEBAR_WIDTH = 260;

const s: Record<string, CSSProperties> = {
  root: {
    display: "flex",
    height: "100%",
    width: "100%",
    fontFamily: "var(--font-ui)",
    color: "var(--color-text)",
    background: "var(--color-background)",
    overflow: "hidden",
  },

  /* ── Sidebar ─────────────────────────────────────────── */

  sidebar: {
    width: SIDEBAR_WIDTH,
    minWidth: SIDEBAR_WIDTH,
    borderRight: "1px solid var(--color-border)",
    background: "var(--color-panel)",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
  },
  sidebarHeader: {
    padding: "16px 16px 12px",
    borderBottom: "1px solid var(--color-border)",
    display: "flex",
    flexDirection: "column",
    gap: 10,
  },
  sidebarTitle: {
    fontSize: 13,
    fontWeight: 600,
    letterSpacing: "0.04em",
    textTransform: "uppercase" as const,
    color: "var(--color-text-dim)",
    margin: 0,
  },
  newButton: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    padding: "7px 12px",
    borderRadius: 6,
    border: "1px solid var(--color-accent)",
    background: "transparent",
    color: "var(--color-accent)",
    fontSize: 12,
    fontWeight: 600,
    fontFamily: "var(--font-ui)",
    cursor: "pointer",
    transition: "background 0.15s ease, color 0.15s ease",
    width: "100%",
  },
  newButtonHover: {
    background: "var(--color-accent)",
    color: "var(--color-background)",
  },
  sidebarList: {
    flex: 1,
    overflowY: "auto" as const,
    padding: "8px 0",
  },
  sidebarItem: {
    padding: "10px 16px",
    cursor: "pointer",
    borderLeft: "3px solid transparent",
    transition: "background 0.1s ease, border-color 0.15s ease",
    display: "flex",
    flexDirection: "column" as const,
    gap: 2,
  },
  sidebarItemActive: {
    background: "var(--color-surface)",
    borderLeftColor: "var(--color-accent)",
  },
  sidebarItemHover: {
    background: "rgba(255,255,255,0.03)",
  },
  sidebarItemName: {
    fontSize: 13,
    fontWeight: 500,
    color: "var(--color-text-bright)",
    overflow: "hidden" as const,
    textOverflow: "ellipsis" as const,
    whiteSpace: "nowrap" as const,
  },
  sidebarItemMeta: {
    fontSize: 11,
    color: "var(--color-text-dim)",
  },
  sidebarEmpty: {
    padding: "24px 16px",
    textAlign: "center" as const,
    fontSize: 12,
    color: "var(--color-text-dim)",
    lineHeight: 1.5,
  },

  /* ── Main ────────────────────────────────────────────── */

  main: {
    flex: 1,
    display: "flex",
    flexDirection: "column" as const,
    overflow: "hidden",
  },

  /* ── Toolbar ─────────────────────────────────────────── */

  toolbar: {
    padding: "12px 20px",
    borderBottom: "1px solid var(--color-border)",
    background: "var(--color-panel)",
    display: "flex",
    alignItems: "center",
    gap: 12,
    flexShrink: 0,
  },
  nameInput: {
    flex: 1,
    background: "var(--color-input)",
    border: "1px solid var(--color-input-border)",
    borderRadius: 6,
    padding: "6px 10px",
    fontSize: 14,
    fontWeight: 600,
    fontFamily: "var(--font-ui)",
    color: "var(--color-text-bright)",
    outline: "none",
    transition: "border-color 0.15s ease",
  },
  templateSelect: {
    background: "var(--color-input)",
    border: "1px solid var(--color-input-border)",
    borderRadius: 6,
    padding: "6px 10px",
    fontSize: 12,
    fontFamily: "var(--font-ui)",
    color: "var(--color-text)",
    outline: "none",
    cursor: "pointer",
    minWidth: 160,
  },
  visibilitySelect: {
    background: "var(--color-input)",
    border: "1px solid var(--color-input-border)",
    borderRadius: 6,
    padding: "6px 10px",
    fontSize: 12,
    fontFamily: "var(--font-ui)",
    color: "var(--color-text)",
    outline: "none",
    cursor: "pointer",
  },
  deleteButton: {
    padding: "6px 12px",
    borderRadius: 6,
    border: "1px solid rgba(255, 80, 80, 0.3)",
    background: "transparent",
    color: "#f55",
    fontSize: 12,
    fontWeight: 500,
    fontFamily: "var(--font-ui)",
    cursor: "pointer",
    transition: "background 0.15s ease",
    whiteSpace: "nowrap" as const,
  },

  /* ── Tabs ────────────────────────────────────────────── */

  tabBar: {
    display: "flex",
    borderBottom: "1px solid var(--color-border)",
    background: "var(--color-panel)",
    flexShrink: 0,
    paddingLeft: 20,
  },
  tab: {
    padding: "10px 20px",
    fontSize: 12,
    fontWeight: 600,
    fontFamily: "var(--font-ui)",
    letterSpacing: "0.06em",
    color: "var(--color-text-dim)",
    cursor: "pointer",
    border: "none",
    background: "transparent",
    borderBottom: "2px solid transparent",
    transition: "color 0.15s ease, border-color 0.15s ease",
    position: "relative" as const,
  },
  tabActive: {
    color: "var(--color-accent)",
    borderBottomColor: "var(--color-accent)",
  },
  tabHover: {
    color: "var(--color-text-bright)",
  },

  /* ── Editor Area ─────────────────────────────────────── */

  editorArea: {
    flex: 1,
    display: "flex",
    flexDirection: "column" as const,
    overflow: "hidden",
    position: "relative" as const,
  },
  sectionHeader: {
    padding: "12px 20px 8px",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    flexShrink: 0,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: "0.06em",
    textTransform: "uppercase" as const,
    color: "var(--color-text-dim)",
  },
  charCount: {
    fontSize: 11,
    color: "var(--color-text-dim)",
    fontFamily: "var(--font-mono)",
  },
  textarea: {
    flex: 1,
    margin: "0 20px 20px",
    padding: 16,
    background: "var(--color-surface)",
    border: "1px solid var(--color-border)",
    borderRadius: 8,
    color: "var(--color-text-bright)",
    fontSize: 13,
    lineHeight: 1.6,
    fontFamily: "var(--font-mono)",
    resize: "none" as const,
    outline: "none",
    overflow: "auto" as const,
    transition: "border-color 0.15s ease",
  },
  textareaFocus: {
    borderColor: "var(--color-accent)",
  },

  /* ── Memory ──────────────────────────────────────────── */

  clearMemoryButton: {
    padding: "4px 10px",
    borderRadius: 4,
    border: "1px solid rgba(255, 160, 60, 0.3)",
    background: "transparent",
    color: "#fa3",
    fontSize: 11,
    fontWeight: 500,
    fontFamily: "var(--font-ui)",
    cursor: "pointer",
    transition: "background 0.15s ease",
  },

  /* ── Empty State ─────────────────────────────────────── */

  emptyMain: {
    flex: 1,
    display: "flex",
    flexDirection: "column" as const,
    alignItems: "center",
    justifyContent: "center",
    gap: 16,
    color: "var(--color-text-dim)",
    padding: 40,
    textAlign: "center" as const,
  },
  emptyIcon: {
    fontSize: 48,
    lineHeight: 1,
    opacity: 0.3,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: 600,
    color: "var(--color-text)",
    margin: 0,
  },
  emptySubtitle: {
    fontSize: 13,
    color: "var(--color-text-dim)",
    lineHeight: 1.5,
    maxWidth: 340,
    margin: 0,
  },

  /* ── Save Indicator ──────────────────────────────────── */

  saveIndicator: {
    fontSize: 11,
    color: "var(--color-text-dim)",
    padding: "0 20px 10px",
    fontFamily: "var(--font-ui)",
    display: "flex",
    alignItems: "center",
    gap: 6,
    flexShrink: 0,
  },
  saveDot: {
    width: 6,
    height: 6,
    borderRadius: "50%",
    background: "#4a4",
    flexShrink: 0,
  },
  saveDotPending: {
    background: "#fa3",
  },
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SoulEditor({ workspaceId, harnessId, soulId }: SoulEditorProps) {
  // ── State ─────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<SoulSection>("soul");
  const [selectedId, setSelectedId] = useState<Id<"souls"> | null>(
    soulId ?? null,
  );
  const [hoveredTab, setHoveredTab] = useState<SoulSection | null>(null);
  const [hoveredSidebarId, setHoveredSidebarId] = useState<string | null>(null);
  const [newButtonHovered, setNewButtonHovered] = useState(false);
  const [textareaFocused, setTextareaFocused] = useState(false);
  const [saveState, setSaveState] = useState<"saved" | "saving" | "dirty">("saved");
  const [localContent, setLocalContent] = useState<Record<SoulSection, string>>({
    soul: "",
    style: "",
    skill: "",
    memory: "",
  });
  const [localName, setLocalName] = useState("");
  const [showNewDialog, setShowNewDialog] = useState(false);
  const [newName, setNewName] = useState("Untitled Soul");
  const [newTemplate, setNewTemplate] = useState("");

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const nameDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Queries ───────────────────────────────────────────
  const soulList = useQuery(
    api.souls.listByWorkspace,
    workspaceId ? { workspaceId } : "skip",
  );
  const activeSoul = useQuery(
    api.souls.get,
    selectedId ? { id: selectedId } : "skip",
  );

  // ── Mutations ─────────────────────────────────────────
  const createSoul = useMutation(api.souls.create);
  const updateSoul = useMutation(api.souls.update);
  const updateSection = useMutation(api.souls.updateSection);
  const clearMemory = useMutation(api.souls.clearMemory);
  const removeSoul = useMutation(api.souls.remove);

  // ── Sync remote data to local state ───────────────────
  const prevSoulRef = useRef<string | null>(null);
  if (activeSoul && activeSoul._id !== prevSoulRef.current) {
    prevSoulRef.current = activeSoul._id;
    setLocalContent({
      soul: activeSoul.soul.content,
      style: activeSoul.style.content,
      skill: activeSoul.skill.content,
      memory: activeSoul.memory.content,
    });
    setLocalName(activeSoul.name);
    setSaveState("saved");
  }

  // Keep memory in sync (it can change externally via appendMemory)
  if (
    activeSoul &&
    activeSoul._id === prevSoulRef.current &&
    activeTab !== "memory"
  ) {
    if (activeSoul.memory.content !== localContent.memory) {
      localContent.memory = activeSoul.memory.content;
    }
  }

  // ── Auto-save on blur ─────────────────────────────────
  const handleBlur = useCallback(async () => {
    setTextareaFocused(false);
    if (!selectedId || !activeSoul) return;

    const section = activeTab;
    const content = localContent[section];
    if (content === activeSoul[section].content) return;

    setSaveState("saving");
    try {
      await updateSection({ id: selectedId, section, content });
      setSaveState("saved");
    } catch (err) {
      console.error("Failed to save section:", err);
      setSaveState("dirty");
    }
  }, [selectedId, activeSoul, activeTab, localContent, updateSection]);

  // ── Name save on blur ─────────────────────────────────
  const handleNameBlur = useCallback(async () => {
    if (!selectedId || !activeSoul) return;
    if (localName === activeSoul.name) return;
    try {
      await updateSoul({ id: selectedId, name: localName });
    } catch (err) {
      console.error("Failed to update name:", err);
    }
  }, [selectedId, activeSoul, localName, updateSoul]);

  // ── Template picker ───────────────────────────────────
  const handleApplyTemplate = useCallback(
    (templateName: string) => {
      const template = TEMPLATES.find((t) => t.name === templateName);
      if (!template || !selectedId) return;
      setLocalContent({
        soul: template.document.soul.content,
        style: template.document.style.content,
        skill: template.document.skill.content,
        memory: template.document.memory.content,
      });
      setSaveState("dirty");
      // Save all sections
      void (async () => {
        setSaveState("saving");
        try {
          await updateSoul({
            id: selectedId,
            soul: { content: template.document.soul.content },
            style: { content: template.document.style.content },
            skill: { content: template.document.skill.content },
            memory: { content: template.document.memory.content },
          });
          setSaveState("saved");
        } catch (err) {
          console.error("Failed to apply template:", err);
          setSaveState("dirty");
        }
      })();
    },
    [selectedId, updateSoul],
  );

  // ── Create new soul ───────────────────────────────────
  const handleCreate = useCallback(async () => {
    if (!workspaceId) return;
    const template = TEMPLATES.find((t) => t.name === newTemplate);
    const doc: SoulDocument = template
      ? template.document
      : {
          soul: { content: "# SOUL\n\n" },
          style: { content: "# STYLE\n\n" },
          skill: { content: "# SKILL\n\n" },
          memory: { content: "" },
        };
    try {
      const id = await createSoul({
        workspaceId,
        harnessId: harnessId ?? undefined,
        name: newName || "Untitled Soul",
        soul: doc.soul,
        style: doc.style,
        skill: doc.skill,
        memory: doc.memory,
        visibility: "workspace",
        createdBy: "user",
      });
      setSelectedId(id);
      setShowNewDialog(false);
      setNewName("Untitled Soul");
      setNewTemplate("");
    } catch (err) {
      console.error("Failed to create soul:", err);
    }
  }, [workspaceId, harnessId, newName, newTemplate, createSoul]);

  // ── Delete soul ───────────────────────────────────────
  const handleDelete = useCallback(async () => {
    if (!selectedId) return;
    try {
      await removeSoul({ id: selectedId });
      setSelectedId(null);
      prevSoulRef.current = null;
    } catch (err) {
      console.error("Failed to delete soul:", err);
    }
  }, [selectedId, removeSoul]);

  // ── Clear memory ──────────────────────────────────────
  const handleClearMemory = useCallback(async () => {
    if (!selectedId) return;
    try {
      await clearMemory({ id: selectedId });
      setLocalContent((prev) => ({ ...prev, memory: "" }));
      setSaveState("saved");
    } catch (err) {
      console.error("Failed to clear memory:", err);
    }
  }, [selectedId, clearMemory]);

  // ── Render ────────────────────────────────────────────

  const sortedSouls = useMemo(() => {
    if (!soulList) return [];
    return [...soulList].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
  }, [soulList]);

  const currentContent = localContent[activeTab];

  return (
    <div style={s.root}>
      {/* ── Sidebar ──────────────────────────────────────── */}
      <div style={s.sidebar}>
        <div style={s.sidebarHeader}>
          <h3 style={s.sidebarTitle}>Soul Documents</h3>
          <button
            style={{
              ...s.newButton,
              ...(newButtonHovered ? s.newButtonHover : {}),
            }}
            onMouseEnter={() => setNewButtonHovered(true)}
            onMouseLeave={() => setNewButtonHovered(false)}
            onClick={() => setShowNewDialog(true)}
          >
            + New Soul
          </button>
        </div>

        <div style={s.sidebarList}>
          {sortedSouls.length === 0 && !showNewDialog && (
            <div style={s.sidebarEmpty}>
              No soul documents yet.
              <br />
              Create one to define how your agents think and behave.
            </div>
          )}

          {sortedSouls.map((soul) => {
            const isActive = soul._id === selectedId;
            const isHovered = soul._id === hoveredSidebarId;
            return (
              <div
                key={soul._id}
                style={{
                  ...s.sidebarItem,
                  ...(isActive ? s.sidebarItemActive : {}),
                  ...(!isActive && isHovered ? s.sidebarItemHover : {}),
                }}
                onMouseEnter={() => setHoveredSidebarId(soul._id)}
                onMouseLeave={() => setHoveredSidebarId(null)}
                onClick={() => {
                  setSelectedId(soul._id);
                  prevSoulRef.current = null; // force reload
                }}
              >
                <span style={s.sidebarItemName}>{soul.name}</span>
                <span style={s.sidebarItemMeta}>
                  {soul.visibility}
                  {soul.harnessId ? " \u00B7 harness-linked" : ""}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Main Area ────────────────────────────────────── */}
      <div style={s.main}>
        {/* New Soul Dialog */}
        {showNewDialog && (
          <div
            style={{
              padding: 20,
              borderBottom: "1px solid var(--color-border)",
              background: "var(--color-surface)",
              display: "flex",
              flexDirection: "column",
              gap: 12,
            }}
          >
            <div style={{ fontSize: 14, fontWeight: 600, color: "var(--color-text-bright)" }}>
              Create New Soul Document
            </div>
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <input
                style={{ ...s.nameInput, flex: 1 }}
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Soul name..."
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter") void handleCreate();
                  if (e.key === "Escape") setShowNewDialog(false);
                }}
              />
              <select
                style={s.templateSelect}
                value={newTemplate}
                onChange={(e) => setNewTemplate(e.target.value)}
              >
                <option value="">Blank document</option>
                {TEMPLATES.map((t) => (
                  <option key={t.name} value={t.name}>
                    {t.name} \u2014 {t.description}
                  </option>
                ))}
              </select>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                style={{
                  ...s.newButton,
                  width: "auto",
                  padding: "7px 20px",
                }}
                onClick={() => void handleCreate()}
              >
                Create
              </button>
              <button
                style={{
                  ...s.deleteButton,
                  borderColor: "var(--color-border)",
                  color: "var(--color-text-dim)",
                }}
                onClick={() => setShowNewDialog(false)}
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {!selectedId || !activeSoul ? (
          /* ── Empty State ───────────────────────────────── */
          <div style={s.emptyMain}>
            <div style={s.emptyIcon}>{"\u2728"}</div>
            <h3 style={s.emptyTitle}>Soul Editor</h3>
            <p style={s.emptySubtitle}>
              Select a soul document from the sidebar or create a new one.
              Souls define how agents think (SOUL), communicate (STYLE),
              what they can do (SKILL), and what they remember (MEMORY).
            </p>
          </div>
        ) : (
          <>
            {/* ── Toolbar ────────────────────────────────── */}
            <div style={s.toolbar}>
              <input
                style={s.nameInput}
                value={localName}
                onChange={(e) => setLocalName(e.target.value)}
                onBlur={() => void handleNameBlur()}
                placeholder="Soul name..."
              />
              <select
                style={s.templateSelect}
                value=""
                onChange={(e) => {
                  if (e.target.value) handleApplyTemplate(e.target.value);
                }}
              >
                <option value="">Apply template...</option>
                {TEMPLATES.map((t) => (
                  <option key={t.name} value={t.name}>
                    {t.name}
                  </option>
                ))}
              </select>
              <select
                style={s.visibilitySelect}
                value={(activeSoul as any)?.visibility ?? "workspace"}
                onChange={(e) => {
                  void updateSoul({
                    id: selectedId,
                    visibility: e.target.value as "private" | "workspace" | "public",
                  });
                }}
              >
                <option value="private">Private</option>
                <option value="workspace">Workspace</option>
                <option value="public">Public</option>
              </select>
              <button
                style={s.deleteButton}
                onClick={() => {
                  if (confirm("Delete this soul document?")) void handleDelete();
                }}
              >
                Delete
              </button>
            </div>

            {/* ── Tab Bar ────────────────────────────────── */}
            <div style={s.tabBar}>
              {SECTIONS.map(({ key, label }) => (
                <button
                  key={key}
                  style={{
                    ...s.tab,
                    ...(activeTab === key ? s.tabActive : {}),
                    ...(hoveredTab === key && activeTab !== key ? s.tabHover : {}),
                  }}
                  onMouseEnter={() => setHoveredTab(key)}
                  onMouseLeave={() => setHoveredTab(null)}
                  onClick={() => {
                    // Save current section before switching
                    if (textareaRef.current) {
                      textareaRef.current.blur();
                    }
                    setActiveTab(key);
                  }}
                >
                  {label}
                  {localContent[key] !== (activeSoul[key] as SoulSectionData).content && (
                    <span
                      style={{
                        position: "absolute",
                        top: 6,
                        right: 6,
                        width: 5,
                        height: 5,
                        borderRadius: "50%",
                        background: "#fa3",
                      }}
                    />
                  )}
                </button>
              ))}
            </div>

            {/* ── Editor ─────────────────────────────────── */}
            <div style={s.editorArea}>
              <div style={s.sectionHeader}>
                <span style={s.sectionLabel}>
                  {activeTab.toUpperCase()} Section
                </span>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  {activeTab === "memory" && (
                    <button
                      style={s.clearMemoryButton}
                      onClick={() => {
                        if (confirm("Clear all memory entries? This cannot be undone.")) {
                          void handleClearMemory();
                        }
                      }}
                    >
                      Clear Memory
                    </button>
                  )}
                  <span style={s.charCount}>
                    {currentContent.length} chars
                  </span>
                </div>
              </div>

              <textarea
                ref={textareaRef}
                style={{
                  ...s.textarea,
                  ...(textareaFocused ? s.textareaFocus : {}),
                }}
                value={currentContent}
                onChange={(e) => {
                  setLocalContent((prev) => ({
                    ...prev,
                    [activeTab]: e.target.value,
                  }));
                  setSaveState("dirty");
                }}
                onFocus={() => setTextareaFocused(true)}
                onBlur={() => void handleBlur()}
                placeholder={`Write your ${activeTab.toUpperCase()} section here...`}
                spellCheck={false}
              />

              <div style={s.saveIndicator}>
                <span
                  style={{
                    ...s.saveDot,
                    ...(saveState !== "saved" ? s.saveDotPending : {}),
                  }}
                />
                {saveState === "saved" && "All changes saved"}
                {saveState === "saving" && "Saving..."}
                {saveState === "dirty" && "Unsaved changes \u2014 click away to save"}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default SoulEditor;
