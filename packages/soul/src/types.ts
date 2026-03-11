// ── Soul Document Types ─────────────────────────────────────────

/**
 * A single section of a soul document. Contains markdown content
 * and optional frontmatter-style metadata key-value pairs.
 */
export type SoulSection = {
  content: string;
  metadata?: Record<string, string>;
};

/**
 * A complete soul document with four sections:
 * - soul: Identity — who the agent IS, worldview, opinions
 * - style: Voice — how it communicates, tone, vocabulary, quirks
 * - skill: Instructions — what it knows how to do, decision defaults, boundaries
 * - memory: Context — accumulated facts and patterns from conversations
 */
export type SoulDocument = {
  id?: string;
  harnessId?: string;
  soul: SoulSection;
  style: SoulSection;
  skill: SoulSection;
  memory: SoulSection;
};

/**
 * A named soul template for common agent archetypes.
 */
export type SoulTemplate = {
  name: string;
  description: string;
  document: SoulDocument;
};

/** The four section names, useful for iteration. */
export type SoulSectionName = "soul" | "style" | "skill" | "memory";

export const SECTION_NAMES: readonly SoulSectionName[] = [
  "soul",
  "style",
  "skill",
  "memory",
] as const;

/** Section heading labels used in markdown output. */
export const SECTION_HEADINGS: Record<SoulSectionName, string> = {
  soul: "SOUL",
  style: "STYLE",
  skill: "SKILL",
  memory: "MEMORY",
};
