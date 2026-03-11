import type { SoulDocument, SoulSectionName } from "./types";
import { SECTION_NAMES, SECTION_HEADINGS } from "./types";

/**
 * Render a SoulDocument back to a markdown string with `# SOUL`, `# STYLE`,
 * `# SKILL`, `# MEMORY` headings.
 *
 * Metadata (if present) is rendered as `key: value` lines at the top of
 * each section, followed by a blank line, then the content.
 */
export function renderToMarkdown(doc: SoulDocument): string {
  const parts: string[] = [];

  for (const name of SECTION_NAMES) {
    const section = doc[name];
    const heading = `# ${SECTION_HEADINGS[name]}`;

    let body = "";
    if (section.metadata && Object.keys(section.metadata).length > 0) {
      const metaLines = Object.entries(section.metadata)
        .map(([k, v]) => `${k}: ${v}`)
        .join("\n");
      body = metaLines + (section.content ? "\n\n" + section.content : "");
    } else {
      body = section.content;
    }

    parts.push(heading + (body ? "\n\n" + body : ""));
  }

  return parts.join("\n\n");
}

/** Prompt section labels for system prompt rendering. */
const PROMPT_LABELS: Record<SoulSectionName, string> = {
  soul: "AGENT IDENTITY",
  style: "COMMUNICATION STYLE",
  skill: "OPERATING INSTRUCTIONS",
  memory: "CONTEXT FROM PREVIOUS SESSIONS",
};

export type RenderToSystemPromptOptions = {
  /**
   * Maximum character length for the memory section.
   * If the memory content exceeds this, older content (from the top) is
   * truncated. Set to 0 or omit for no limit.
   */
  memoryCharLimit?: number;
};

/**
 * Render a SoulDocument into a system prompt string suitable for LLM calls.
 *
 * Each section is wrapped in labeled delimiters:
 * ```
 * --- AGENT IDENTITY ---
 * <soul content>
 *
 * --- COMMUNICATION STYLE ---
 * <style content>
 *
 * --- OPERATING INSTRUCTIONS ---
 * <skill content>
 *
 * --- CONTEXT FROM PREVIOUS SESSIONS ---
 * <memory content>
 * --- END AGENT SOUL ---
 * ```
 *
 * Sections with no content are omitted entirely.
 */
export function renderToSystemPrompt(
  doc: SoulDocument,
  options?: RenderToSystemPromptOptions,
): string {
  const parts: string[] = [];

  for (const name of SECTION_NAMES) {
    let content = doc[name].content.trim();
    if (!content) continue;

    // Apply memory truncation
    if (name === "memory" && options?.memoryCharLimit && options.memoryCharLimit > 0) {
      content = truncateMemory(content, options.memoryCharLimit);
    }

    parts.push(`--- ${PROMPT_LABELS[name]} ---\n${content}`);
  }

  if (parts.length === 0) return "";

  return parts.join("\n\n") + "\n--- END AGENT SOUL ---";
}

/**
 * Truncate memory content to fit within a character limit.
 * Removes content from the top (oldest entries) first, preserving
 * the most recent entries at the bottom.
 */
function truncateMemory(content: string, maxChars: number): string {
  if (content.length <= maxChars) return content;

  // Take from the end (most recent)
  const truncated = content.slice(content.length - maxChars);

  // Try to find a clean break point (newline)
  const firstNewline = truncated.indexOf("\n");
  if (firstNewline > 0 && firstNewline < maxChars * 0.2) {
    return "[...earlier context truncated...]\n" + truncated.slice(firstNewline + 1);
  }

  return "[...earlier context truncated...]\n" + truncated;
}
