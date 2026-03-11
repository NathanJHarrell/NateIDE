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

/** Create a new soul document. */
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
    const now = Date.now();
    return await ctx.db.insert("souls", {
      ...args,
      createdAt: now,
      updatedAt: now,
    });
  },
});

/** Update an existing soul document. Any provided field overwrites. */
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

/** Update a single section of a soul document. */
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
