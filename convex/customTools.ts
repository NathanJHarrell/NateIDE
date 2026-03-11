import { v } from "convex/values";
import { query, mutation } from "./_generated/server";

// ── Queries ──────────────────────────────────────────────────

/** List custom tools for a workspace (includes public tools). */
export const list = query({
  args: { workspaceId: v.optional(v.id("workspaces")) },
  handler: async (ctx, args) => {
    const results = [];

    // Workspace-specific tools
    if (args.workspaceId) {
      const workspaceTools = await ctx.db
        .query("customTools")
        .withIndex("by_workspace", (q) =>
          q.eq("workspaceId", args.workspaceId!),
        )
        .collect();
      results.push(...workspaceTools);
    }

    // Public tools (visible to everyone)
    const publicTools = await ctx.db
      .query("customTools")
      .withIndex("by_visibility", (q) => q.eq("visibility", "public"))
      .collect();

    // Merge, deduplicate by _id
    const seen = new Set(results.map((t) => t._id));
    for (const t of publicTools) {
      if (!seen.has(t._id)) {
        results.push(t);
      }
    }

    return results;
  },
});

/** Get a single custom tool by ID. */
export const get = query({
  args: { id: v.id("customTools") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

// ── Mutations ────────────────────────────────────────────────

/** Create a new custom tool. */
export const create = mutation({
  args: {
    name: v.string(),
    description: v.string(),
    type: v.union(
      v.literal("command"),
      v.literal("http"),
      v.literal("mcp"),
    ),
    config: v.any(),
    inputSchema: v.any(),
    outputFormat: v.union(
      v.literal("json"),
      v.literal("text"),
      v.literal("stream"),
    ),
    isReadOnly: v.boolean(),
    workspaceId: v.optional(v.id("workspaces")),
    visibility: v.union(
      v.literal("private"),
      v.literal("workspace"),
      v.literal("public"),
    ),
    createdBy: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    return await ctx.db.insert("customTools", {
      ...args,
      createdAt: now,
      updatedAt: now,
    });
  },
});

/** Update an existing custom tool. */
export const update = mutation({
  args: {
    id: v.id("customTools"),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
    type: v.optional(
      v.union(
        v.literal("command"),
        v.literal("http"),
        v.literal("mcp"),
      ),
    ),
    config: v.optional(v.any()),
    inputSchema: v.optional(v.any()),
    outputFormat: v.optional(
      v.union(
        v.literal("json"),
        v.literal("text"),
        v.literal("stream"),
      ),
    ),
    isReadOnly: v.optional(v.boolean()),
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
      throw new Error(`Custom tool ${args.id} not found`);
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

/** Delete a custom tool. */
export const remove = mutation({
  args: { id: v.id("customTools") },
  handler: async (ctx, args) => {
    const existing = await ctx.db.get(args.id);
    if (!existing) {
      throw new Error(`Custom tool ${args.id} not found`);
    }
    await ctx.db.delete(args.id);
  },
});
