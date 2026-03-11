import { v } from "convex/values";
import { query, mutation } from "./_generated/server";

// ── Queries ──────────────────────────────────────────────────

/** Get a single harness by ID. */
export const get = query({
  args: { id: v.id("harnesses") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

/** List all harnesses in a workspace (including built-in defaults). */
export const listByWorkspace = query({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args) => {
    const harnesses = await ctx.db
      .query("harnesses")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .collect();

    // Also include built-in harnesses (workspaceId is undefined)
    const builtIns = await ctx.db
      .query("harnesses")
      .filter((q) => q.eq(q.field("isBuiltIn"), true))
      .collect();

    // Merge, deduplicate by _id
    const seen = new Set(harnesses.map((h) => h._id));
    for (const b of builtIns) {
      if (!seen.has(b._id)) {
        harnesses.push(b);
      }
    }

    return harnesses;
  },
});

/** List harnesses created by a specific user. */
export const listByCreator = query({
  args: { createdBy: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("harnesses")
      .withIndex("by_creator", (q) => q.eq("createdBy", args.createdBy))
      .collect();
  },
});

/** List all public harnesses (for discovery). */
export const listPublic = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query("harnesses")
      .withIndex("by_visibility", (q) => q.eq("visibility", "public"))
      .collect();
  },
});

// ── Mutations ────────────────────────────────────────────────

/** Create a new harness. */
export const create = mutation({
  args: {
    name: v.string(),
    description: v.string(),
    provider: v.string(),
    model: v.string(),
    fallbacks: v.optional(
      v.array(
        v.object({
          provider: v.string(),
          model: v.string(),
        }),
      ),
    ),
    toolGrants: v.array(v.any()),
    approvalPolicy: v.union(v.literal("safe"), v.literal("yolo")),
    soul: v.optional(
      v.object({
        soul: v.string(),
        style: v.string(),
        skill: v.string(),
        memory: v.string(),
      }),
    ),
    maxIterations: v.number(),
    maxTokensPerTurn: v.number(),
    contextStrategy: v.union(
      v.literal("full"),
      v.literal("windowed"),
      v.literal("summary"),
    ),
    color: v.string(),
    icon: v.optional(v.string()),
    visibility: v.union(
      v.literal("private"),
      v.literal("workspace"),
      v.literal("public"),
    ),
    createdBy: v.string(),
    workspaceId: v.optional(v.id("workspaces")),
    isBuiltIn: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    return await ctx.db.insert("harnesses", {
      ...args,
      createdAt: now,
      updatedAt: now,
    });
  },
});

/** Update an existing harness. Only non-built-in harnesses can be updated. */
export const update = mutation({
  args: {
    id: v.id("harnesses"),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
    provider: v.optional(v.string()),
    model: v.optional(v.string()),
    fallbacks: v.optional(
      v.array(
        v.object({
          provider: v.string(),
          model: v.string(),
        }),
      ),
    ),
    toolGrants: v.optional(v.array(v.any())),
    approvalPolicy: v.optional(v.union(v.literal("safe"), v.literal("yolo"))),
    soul: v.optional(
      v.object({
        soul: v.string(),
        style: v.string(),
        skill: v.string(),
        memory: v.string(),
      }),
    ),
    maxIterations: v.optional(v.number()),
    maxTokensPerTurn: v.optional(v.number()),
    contextStrategy: v.optional(
      v.union(
        v.literal("full"),
        v.literal("windowed"),
        v.literal("summary"),
      ),
    ),
    color: v.optional(v.string()),
    icon: v.optional(v.string()),
    visibility: v.optional(
      v.union(
        v.literal("private"),
        v.literal("workspace"),
        v.literal("public"),
      ),
    ),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db.get(args.id);
    if (!existing) {
      throw new Error(`Harness ${args.id} not found`);
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

/** Delete a harness. Built-in harnesses cannot be deleted. */
export const remove = mutation({
  args: { id: v.id("harnesses") },
  handler: async (ctx, args) => {
    const existing = await ctx.db.get(args.id);
    if (!existing) {
      throw new Error(`Harness ${args.id} not found`);
    }
    if (existing.isBuiltIn) {
      throw new Error("Cannot delete a built-in harness. You can only reset it to defaults.");
    }
    await ctx.db.delete(args.id);
  },
});

/** Clone a harness — creates an independent copy with a new name. */
export const clone = mutation({
  args: {
    sourceId: v.id("harnesses"),
    newName: v.string(),
    createdBy: v.string(),
    workspaceId: v.optional(v.id("workspaces")),
  },
  handler: async (ctx, args) => {
    const source = await ctx.db.get(args.sourceId);
    if (!source) {
      throw new Error(`Source harness ${args.sourceId} not found`);
    }

    const now = Date.now();
    const { _id, _creationTime, ...rest } = source;
    return await ctx.db.insert("harnesses", {
      ...rest,
      name: args.newName,
      createdBy: args.createdBy,
      workspaceId: args.workspaceId,
      isBuiltIn: false,
      createdAt: now,
      updatedAt: now,
    });
  },
});
