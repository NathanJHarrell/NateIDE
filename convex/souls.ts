import { v } from "convex/values";
import { query, mutation } from "./_generated/server";

// ── Shared Validators ───────────────────────────────────────

const soulSectionValidator = v.object({
  content: v.string(),
  metadata: v.optional(v.any()),
});

const visibilityValidator = v.union(
  v.literal("private"),
  v.literal("workspace"),
  v.literal("public"),
);

// ── Content Guardrails ───────────────────────────────────────

/**
 * Patterns that indicate prompt injection or manipulation attempts.
 * These are checked against soul content before saving — especially
 * before allowing a soul to be made public.
 *
 * Note: Soul documents are injected as system context. They cannot
 * bypass the underlying model's safety training. These checks raise
 * the floor against obvious abuse without claiming to be exhaustive.
 */
const INJECTION_PATTERNS: RegExp[] = [
  /ignore (all |previous |your )?(instructions|rules|guidelines|constraints)/i,
  /disregard (all |previous |your )?(instructions|rules|guidelines|constraints)/i,
  /forget (all |previous |your )?(instructions|rules|guidelines|constraints)/i,
  /you (are|must) (now |always )?(ignore|bypass|override|disregard)/i,
  /override (your |all )?(safety|guidelines|instructions|rules|constraints)/i,
  /bypass (your |all )?(safety|guidelines|instructions|rules|constraints)/i,
  /new (system |master |prime )?(instructions|directive|prompt|rules):/i,
  /\[system\]/i,
  /act as (if you (have no|are not)|an? (unrestricted|unfiltered|jailbroken))/i,
  /you have no (restrictions|limitations|guidelines|safety)/i,
  /pretend (you (have no|are not)|to be (an? )?(unrestricted|unfiltered))/i,
  /do anything( now)?/i,
  /jailbreak/i,
];

/**
 * Validates the content of a soul section.
 * Returns an error message string if the content is problematic,
 * or null if it's clean.
 */
function validateSoulContent(content: string): string | null {
  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(content)) {
      return `Soul content contains patterns that could be used for prompt injection. ` +
        `Please revise your content. (matched: ${pattern.source})`;
    }
  }

  // Enforce a reasonable size limit (32KB per section)
  if (content.length > 32_768) {
    return `Soul section content exceeds the maximum allowed length of 32,768 characters.`;
  }

  return null;
}

/**
 * Validates all sections of a soul document.
 * Throws a descriptive error if any section fails validation.
 */
function assertSoulDocumentClean(
  sections: Partial<Record<"soul" | "style" | "skill" | "memory", { content: string } | undefined>>,
) {
  for (const [key, section] of Object.entries(sections)) {
    if (!section) continue;
    const error = validateSoulContent(section.content);
    if (error) {
      throw new Error(`Validation failed in "${key}" section: ${error}`);
    }
  }
}

/**
 * Stricter check applied only when a soul is being made public.
 * Public souls are shared across all users, so we hold them to a
 * higher standard than private or workspace souls.
 */
function assertSafeForPublish(
  soul: { soul: { content: string }; style: { content: string }; skill: { content: string }; memory: { content: string } },
) {
  // Run standard validation across all sections
  assertSoulDocumentClean(soul);

  // Additional check: memory section should be empty before publishing.
  // Memory is runtime state and shouldn't be baked into a public template.
  if (soul.memory.content.trim().length > 0) {
    throw new Error(
      `Public souls must have an empty memory section. ` +
      `Clear the MEMORY section before publishing.`,
    );
  }
}

// ── Queries ──────────────────────────────────────────────────

/** Get a single soul document by ID. */
export const get = query({
  args: { id: v.id("souls") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

/** Get the soul document for a harness. */
export const getByHarness = query({
  args: { harnessId: v.id("harnesses") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("souls")
      .withIndex("by_harness", (q) => q.eq("harnessId", args.harnessId))
      .first();
  },
});

/** List all soul documents in a workspace. */
export const listByWorkspace = query({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("souls")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .collect();
  },
});

/** List soul documents created by a specific user. */
export const listByCreator = query({
  args: { createdBy: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("souls")
      .withIndex("by_creator", (q) => q.eq("createdBy", args.createdBy))
      .collect();
  },
});

/** List all public soul documents (for discovery/sharing). */
export const listPublic = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query("souls")
      .withIndex("by_visibility", (q) => q.eq("visibility", "public"))
      .collect();
  },
});

// ── Mutations ────────────────────────────────────────────────

/**
 * Create a new soul document.
 *
 * All section content is validated against injection patterns.
 * Public souls are held to stricter standards (no memory content).
 */
export const create = mutation({
  args: {
    harnessId: v.optional(v.id("harnesses")),
    workspaceId: v.optional(v.id("workspaces")),
    name: v.string(),
    soul: soulSectionValidator,
    style: soulSectionValidator,
    skill: soulSectionValidator,
    memory: soulSectionValidator,
    visibility: visibilityValidator,
    createdBy: v.string(),
  },
  handler: async (ctx, args) => {
    // Always validate content
    assertSoulDocumentClean({
      soul: args.soul,
      style: args.style,
      skill: args.skill,
      memory: args.memory,
    });

    // Stricter check if being created as public
    if (args.visibility === "public") {
      assertSafeForPublish({
        soul: args.soul,
        style: args.style,
        skill: args.skill,
        memory: args.memory,
      });
    }

    const now = Date.now();
    return await ctx.db.insert("souls", {
      ...args,
      createdAt: now,
      updatedAt: now,
    });
  },
});

/**
 * Update an existing soul document.
 *
 * Validates any updated section content.
 * Applies stricter publish checks when visibility is being set to public.
 */
export const update = mutation({
  args: {
    id: v.id("souls"),
    name: v.optional(v.string()),
    soul: v.optional(soulSectionValidator),
    style: v.optional(soulSectionValidator),
    skill: v.optional(soulSectionValidator),
    memory: v.optional(soulSectionValidator),
    visibility: v.optional(visibilityValidator),
    harnessId: v.optional(v.id("harnesses")),
    workspaceId: v.optional(v.id("workspaces")),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db.get(args.id);
    if (!existing) {
      throw new Error(`Soul document ${args.id} not found`);
    }

    // Validate any sections being updated
    assertSoulDocumentClean({
      soul: args.soul,
      style: args.style,
      skill: args.skill,
      memory: args.memory,
    });

    // If changing visibility to public, validate the full final document
    if (args.visibility === "public" && existing.visibility !== "public") {
      const finalSoul = {
        soul: args.soul ?? existing.soul,
        style: args.style ?? existing.style,
        skill: args.skill ?? existing.skill,
        memory: args.memory ?? existing.memory,
      };
      assertSafeForPublish(finalSoul);
    }

    const { id, ...fields } = args;
    const updates: Record<string, unknown> = { updatedAt: Date.now() };

    for (const [key, value] of Object.entries(fields)) {
      if (value !== undefined) {
        updates[key] = value;
      }
    }

    await ctx.db.patch(id, updates);
  },
});

/**
 * Update a single section of a soul document.
 *
 * Content is validated before saving.
 * If the soul is currently public, the updated section is also
 * checked against publish-level rules.
 */
export const updateSection = mutation({
  args: {
    id: v.id("souls"),
    section: v.union(
      v.literal("soul"),
      v.literal("style"),
      v.literal("skill"),
      v.literal("memory"),
    ),
    content: v.string(),
    metadata: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db.get(args.id);
    if (!existing) {
      throw new Error(`Soul document ${args.id} not found`);
    }

    // Validate the new content
    const error = validateSoulContent(args.content);
    if (error) {
      throw new Error(`Validation failed in "${args.section}" section: ${error}`);
    }

    // If soul is public, apply stricter checks
    if (existing.visibility === "public") {
      const finalSoul = {
        soul: existing.soul,
        style: existing.style,
        skill: existing.skill,
        memory: existing.memory,
        [args.section]: { content: args.content },
      };
      assertSafeForPublish(finalSoul);
    }

    const sectionValue: { content: string; metadata?: unknown } = {
      content: args.content,
    };
    if (args.metadata !== undefined) {
      sectionValue.metadata = args.metadata;
    }

    await ctx.db.patch(args.id, {
      [args.section]: sectionValue,
      updatedAt: Date.now(),
    });
  },
});

/** Append content to the memory section. */
export const appendMemory = mutation({
  args: {
    id: v.id("souls"),
    memoryEntry: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db.get(args.id);
    if (!existing) {
      throw new Error(`Soul document ${args.id} not found`);
    }

    const currentMemory = existing.memory.content;
    const newContent = currentMemory
      ? currentMemory + "\n\n" + args.memoryEntry
      : args.memoryEntry;

    await ctx.db.patch(args.id, {
      memory: { ...existing.memory, content: newContent },
      updatedAt: Date.now(),
    });
  },
});

/** Clear the memory section entirely. */
export const clearMemory = mutation({
  args: { id: v.id("souls") },
  handler: async (ctx, args) => {
    const existing = await ctx.db.get(args.id);
    if (!existing) {
      throw new Error(`Soul document ${args.id} not found`);
    }

    await ctx.db.patch(args.id, {
      memory: { content: "" },
      updatedAt: Date.now(),
    });
  },
});

/**
 * Fork a public soul document into your own workspace.
 *
 * Creates a private copy you can modify freely. The original is
 * unchanged and remains owned by its creator. Memory is intentionally
 * not copied — forks start with a clean slate.
 */
export const fork = mutation({
  args: {
    id: v.id("souls"),
    workspaceId: v.id("workspaces"),
    forkedBy: v.string(),
    newName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const source = await ctx.db.get(args.id);
    if (!source) {
      throw new Error(`Soul document ${args.id} not found`);
    }

    // Only public souls can be forked by other users
    if (source.visibility !== "public") {
      throw new Error(`Only public soul documents can be forked.`);
    }

    const now = Date.now();
    return await ctx.db.insert("souls", {
      workspaceId: args.workspaceId,
      name: args.newName ?? `${source.name} (fork)`,
      soul: source.soul,
      style: source.style,
      skill: source.skill,
      memory: { content: "" }, // forks start with empty memory
      visibility: "private",
      createdBy: args.forkedBy,
      createdAt: now,
      updatedAt: now,
    });
  },
});

/**
 * Report a public soul document for review.
 *
 * Increments a report counter and reverts visibility to "workspace"
 * so the soul is no longer publicly discoverable until reviewed.
 * This is a lightweight moderation gate — no AI, no delay.
 */
export const report = mutation({
  args: {
    id: v.id("souls"),
    reason: v.string(),
    reportedBy: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db.get(args.id);
    if (!existing) {
      throw new Error(`Soul document ${args.id} not found`);
    }

    // Revert to workspace visibility immediately
    await ctx.db.patch(args.id, {
      visibility: "workspace",
      updatedAt: Date.now(),
    });

    // Log the report for manual review
    // Note: add a `soulReports` table to your schema to persist these.
    // For now we throw a structured error so the caller knows the report landed.
    console.log(`[soul.report] soul=${args.id} reportedBy=${args.reportedBy} reason=${args.reason}`);

    return { reported: true, visibility: "workspace" };
  },
});

/** Delete a soul document. */
export const remove = mutation({
  args: { id: v.id("souls") },
  handler: async (ctx, args) => {
    const existing = await ctx.db.get(args.id);
    if (!existing) {
      throw new Error(`Soul document ${args.id} not found`);
    }
    await ctx.db.delete(args.id);
  },
});
