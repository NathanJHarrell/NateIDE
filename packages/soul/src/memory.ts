import type { SoulDocument } from "./types";

/**
 * Patterns that indicate memorable facts in conversation output.
 * Each pattern maps to a category label.
 */
const MEMORY_PATTERNS: Array<{ pattern: RegExp; category: string }> = [
  { pattern: /(?:prefers?|preference)\s+(.+)/i, category: "preference" },
  { pattern: /(?:always|never|must)\s+(.+)/i, category: "rule" },
  { pattern: /(?:remember|note|important)\s*:?\s+(.+)/i, category: "note" },
  { pattern: /(?:learned|discovered|found out)\s+(?:that\s+)?(.+)/i, category: "learning" },
  { pattern: /(?:uses?|using)\s+([\w\s]+)\s+(?:for|to)\s+(.+)/i, category: "tooling" },
  { pattern: /(?:project|codebase)\s+(?:uses?|is)\s+(.+)/i, category: "context" },
  { pattern: /(?:style|convention)\s*:?\s+(.+)/i, category: "style" },
  { pattern: /(?:avoid|don't|do not)\s+(.+)/i, category: "constraint" },
];

/**
 * A single extracted memory entry.
 */
export type MemoryEntry = {
  category: string;
  content: string;
  extractedAt: string; // ISO date string
};

/**
 * Extract potential memory entries from conversation text using pattern matching.
 *
 * This is a lightweight, non-ML approach. It scans for keywords and phrases
 * that suggest facts, preferences, rules, or context worth remembering.
 *
 * @param conversationText - The conversation text to scan
 * @returns Array of extracted memory entries
 */
export function extractMemories(conversationText: string): MemoryEntry[] {
  const entries: MemoryEntry[] = [];
  const seen = new Set<string>();
  const now = new Date().toISOString().split("T")[0]; // YYYY-MM-DD

  const lines = conversationText.split("\n");

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.length < 10) continue;

    for (const { pattern, category } of MEMORY_PATTERNS) {
      const match = trimmed.match(pattern);
      if (match) {
        // Use the captured group if available, otherwise the whole match
        const content = (match[1] || trimmed).trim();

        // Deduplicate
        const key = content.toLowerCase().slice(0, 80);
        if (!seen.has(key)) {
          seen.add(key);
          entries.push({ category, content, extractedAt: now });
        }
        break; // Only match one pattern per line
      }
    }
  }

  return entries;
}

/**
 * Format memory entries into markdown suitable for appending to a MEMORY section.
 *
 * Output format:
 * ```
 * ## 2026-03-10
 * - [preference] Prefers tabs over spaces
 * - [rule] Always run tests before committing
 * ```
 */
export function formatMemoryEntries(entries: MemoryEntry[]): string {
  if (entries.length === 0) return "";

  // Group by date
  const byDate = new Map<string, MemoryEntry[]>();
  for (const entry of entries) {
    const existing = byDate.get(entry.extractedAt) ?? [];
    existing.push(entry);
    byDate.set(entry.extractedAt, existing);
  }

  const parts: string[] = [];
  for (const [date, dateEntries] of byDate) {
    const lines = dateEntries.map((e) => `- [${e.category}] ${e.content}`);
    parts.push(`## ${date}\n${lines.join("\n")}`);
  }

  return parts.join("\n\n");
}

/**
 * Append new memory entries to a SoulDocument's memory section.
 * Returns a new SoulDocument with the updated memory.
 */
export function appendMemories(
  doc: SoulDocument,
  entries: MemoryEntry[],
): SoulDocument {
  if (entries.length === 0) return doc;

  const formatted = formatMemoryEntries(entries);
  const existingMemory = doc.memory.content.trim();
  const newContent = existingMemory
    ? existingMemory + "\n\n" + formatted
    : formatted;

  return {
    ...doc,
    memory: { ...doc.memory, content: newContent },
  };
}

/**
 * Clear the memory section of a SoulDocument.
 * Returns a new SoulDocument with empty memory.
 */
export function clearMemory(doc: SoulDocument): SoulDocument {
  return {
    ...doc,
    memory: { content: "" },
  };
}

/**
 * Prune memory content if it exceeds a character limit.
 *
 * Strategy: keep the most recent entries (at the bottom) and prepend
 * a summary marker for the removed portion.
 *
 * @param memoryContent - The raw memory section content
 * @param maxChars - Maximum characters to keep (default 8000)
 * @returns Pruned memory content
 */
export function pruneMemory(memoryContent: string, maxChars: number = 8000): string {
  if (memoryContent.length <= maxChars) return memoryContent;

  // Find date-headed sections (## YYYY-MM-DD)
  const sections = memoryContent.split(/(?=^## \d{4}-\d{2}-\d{2})/m);

  // Keep sections from the end until we hit the limit
  const kept: string[] = [];
  let totalLength = 0;
  const summaryPrefix = "[...older memories pruned...]\n\n";
  const budget = maxChars - summaryPrefix.length;

  for (let i = sections.length - 1; i >= 0; i--) {
    const section = sections[i].trim();
    if (totalLength + section.length > budget && kept.length > 0) {
      break;
    }
    kept.unshift(section);
    totalLength += section.length;
  }

  if (kept.length < sections.length) {
    return summaryPrefix + kept.join("\n\n");
  }

  // If we couldn't even fit one section, just truncate
  return summaryPrefix + memoryContent.slice(memoryContent.length - budget);
}
