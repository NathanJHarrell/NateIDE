import type { SoulDocument, SoulSection, SoulSectionName } from "./types";
import { SECTION_NAMES } from "./types";

/**
 * Merge two SoulDocuments. The override document takes precedence:
 * - If a section in `overrides` has non-empty content, it replaces the
 *   corresponding section in `base`.
 * - If a section in `overrides` is empty, the `base` section is kept.
 * - Metadata is merged per-section: override keys win, base keys are kept
 *   if not overridden.
 * - `id` and `harnessId` from `overrides` take precedence if set.
 *
 * This is useful for applying user customizations on top of a template.
 */
export function mergeSoulDocuments(
  base: SoulDocument,
  overrides: Partial<SoulDocument>,
): SoulDocument {
  const result: SoulDocument = {
    id: overrides.id ?? base.id,
    harnessId: overrides.harnessId ?? base.harnessId,
    soul: base.soul,
    style: base.style,
    skill: base.skill,
    memory: base.memory,
  };

  for (const name of SECTION_NAMES) {
    const overrideSection = overrides[name];
    if (overrideSection) {
      result[name] = mergeSections(base[name], overrideSection);
    }
  }

  return result;
}

/**
 * Merge two SoulSections. If the override has content, it replaces the base.
 * Metadata is shallow-merged with override keys winning.
 */
function mergeSections(base: SoulSection, override: SoulSection): SoulSection {
  const content = override.content.trim() ? override.content : base.content;

  let metadata: Record<string, string> | undefined;
  if (base.metadata || override.metadata) {
    metadata = { ...(base.metadata ?? {}), ...(override.metadata ?? {}) };
  }

  return metadata ? { content, metadata } : { content };
}
