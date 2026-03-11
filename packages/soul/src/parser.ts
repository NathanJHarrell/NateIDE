import type { SoulDocument, SoulSection } from "./types";

/**
 * Heading pattern: matches `# SOUL`, `# STYLE`, `# SKILL`, `# MEMORY`
 * Case-insensitive, allows optional whitespace after #.
 */
const HEADING_RE = /^#\s+(SOUL|STYLE|SKILL|MEMORY)\s*$/i;

/**
 * Metadata line pattern: `key: value` at the start of a section.
 * Only matches simple single-line key-value pairs (no multiline YAML).
 */
const METADATA_RE = /^([a-zA-Z_][a-zA-Z0-9_-]*)\s*:\s*(.+)$/;

/**
 * Parse a markdown string into a SoulDocument.
 *
 * The markdown is split on `# SOUL`, `# STYLE`, `# SKILL`, `# MEMORY` headings
 * (case-insensitive). Each section's content is everything between its heading
 * and the next heading (or EOF).
 *
 * If no headings are found, the entire content is treated as the SOUL section.
 *
 * If a section starts with YAML-like `key: value` lines (before any blank line
 * or other content), those are extracted as metadata.
 */
export function parseSoulDocument(markdown: string): SoulDocument {
  const lines = markdown.split("\n");

  // Find all heading positions
  const headings: Array<{ section: string; lineIndex: number }> = [];
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(HEADING_RE);
    if (match) {
      headings.push({ section: match[1].toLowerCase(), lineIndex: i });
    }
  }

  // If no headings found, treat entire content as SOUL section
  if (headings.length === 0) {
    return {
      soul: parseSection(markdown.trim()),
      style: { content: "" },
      skill: { content: "" },
      memory: { content: "" },
    };
  }

  // Extract raw content for each section
  const rawSections: Record<string, string> = {};
  for (let i = 0; i < headings.length; i++) {
    const start = headings[i].lineIndex + 1; // skip the heading line
    const end =
      i + 1 < headings.length ? headings[i + 1].lineIndex : lines.length;
    const sectionLines = lines.slice(start, end);
    // Trim leading/trailing blank lines
    const content = trimBlankLines(sectionLines.join("\n"));
    rawSections[headings[i].section] = content;
  }

  return {
    soul: parseSection(rawSections["soul"] ?? ""),
    style: parseSection(rawSections["style"] ?? ""),
    skill: parseSection(rawSections["skill"] ?? ""),
    memory: parseSection(rawSections["memory"] ?? ""),
  };
}

/**
 * Parse a section's raw content, extracting optional frontmatter metadata.
 * Metadata lines are `key: value` lines at the very start of the section,
 * before any blank line or non-metadata content.
 */
function parseSection(raw: string): SoulSection {
  if (!raw) {
    return { content: "" };
  }

  const lines = raw.split("\n");
  const metadata: Record<string, string> = {};
  let metadataEndIndex = 0;
  let foundMetadata = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Blank line ends metadata block
    if (line.trim() === "") {
      if (foundMetadata) {
        metadataEndIndex = i + 1;
      }
      break;
    }

    const match = line.match(METADATA_RE);
    if (match) {
      metadata[match[1]] = match[2].trim();
      foundMetadata = true;
      metadataEndIndex = i + 1;
    } else {
      // Non-metadata line: stop looking
      break;
    }
  }

  if (foundMetadata) {
    const content = trimBlankLines(lines.slice(metadataEndIndex).join("\n"));
    return { content, metadata };
  }

  return { content: raw };
}

/**
 * Trim leading and trailing blank lines from a string,
 * but preserve internal blank lines.
 */
function trimBlankLines(s: string): string {
  return s.replace(/^\n+/, "").replace(/\n+$/, "");
}
