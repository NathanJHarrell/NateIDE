// ── Types ────────────────────────────────────────────────────
export type {
  SoulDocument,
  SoulSection,
  SoulTemplate,
  SoulSectionName,
} from "./types";
export { SECTION_NAMES, SECTION_HEADINGS } from "./types";

// ── Parser ───────────────────────────────────────────────────
export { parseSoulDocument } from "./parser";

// ── Renderer ─────────────────────────────────────────────────
export { renderToMarkdown, renderToSystemPrompt } from "./renderer";
export type { RenderToSystemPromptOptions } from "./renderer";

// ── Templates ────────────────────────────────────────────────
export {
  templates,
  getTemplate,
  listTemplates,
  blankDocument,
  plannerTemplate,
  implementerTemplate,
  reviewerTemplate,
  generalistTemplate,
  controllerTemplate,
} from "./templates";

// ── Memory ───────────────────────────────────────────────────
export {
  extractMemories,
  formatMemoryEntries,
  appendMemories,
  clearMemory,
  pruneMemory,
} from "./memory";
export type { MemoryEntry } from "./memory";

// ── Merger ───────────────────────────────────────────────────
export { mergeSoulDocuments } from "./merger";
