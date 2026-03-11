import { v } from "convex/values";
import { query, mutation } from "./_generated/server";

// ── Queries ──────────────────────────────────────────────────

/** List MCP server configs for a workspace (includes public configs). */
export const list = query({
  args: { workspaceId: v.optional(v.id("workspaces")) },
  handler: async (ctx, args) => {
    const results = [];

    // Workspace-specific servers
    if (args.workspaceId) {
      const workspaceServers = await ctx.db
        .query("mcpServers")
        .withIndex("by_workspace", (q) =>
          q.eq("workspaceId", args.workspaceId!),
        )
        .collect();
      results.push(...workspaceServers);
    }

    // Also include servers visible to everyone
    // (no visibility index on mcpServers, so filter in memory)
    const allServers = await ctx.db.query("mcpServers").collect();
    const seen = new Set(results.map((s) => s._id));
    for (const s of allServers) {
      if (!seen.has(s._id) && s.visibility === "public") {
        results.push(s);
      }
    }

    return results;
  },
});

/** Get a single MCP server config by ID. */
export const get = query({
  args: { id: v.id("mcpServers") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

// ── Mutations ────────────────────────────────────────────────

/** Create a new MCP server config. */
export const create = mutation({
  args: {
    name: v.string(),
    transport: v.union(
      v.literal("stdio"),
      v.literal("sse"),
      v.literal("streamable-http"),
    ),
    command: v.optional(v.string()),
    args: v.optional(v.array(v.string())),
    env: v.optional(v.any()),
    url: v.optional(v.string()),
    headers: v.optional(v.any()),
    workspaceId: v.optional(v.id("workspaces")),
    visibility: v.union(
      v.literal("private"),
      v.literal("workspace"),
      v.literal("public"),
    ),
    createdBy: v.string(),
  },
  handler: async (ctx, args) => {
    // Validate transport-specific fields
    if (args.transport === "stdio" && !args.command) {
      throw new Error("stdio transport requires a command");
    }
    if (
      (args.transport === "sse" || args.transport === "streamable-http") &&
      !args.url
    ) {
      throw new Error(`${args.transport} transport requires a url`);
    }

    const now = Date.now();
    return await ctx.db.insert("mcpServers", {
      ...args,
      createdAt: now,
      updatedAt: now,
    });
  },
});

/** Update an existing MCP server config. */
export const update = mutation({
  args: {
    id: v.id("mcpServers"),
    name: v.optional(v.string()),
    transport: v.optional(
      v.union(
        v.literal("stdio"),
        v.literal("sse"),
        v.literal("streamable-http"),
      ),
    ),
    command: v.optional(v.string()),
    args: v.optional(v.array(v.string())),
    env: v.optional(v.any()),
    url: v.optional(v.string()),
    headers: v.optional(v.any()),
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
      throw new Error(`MCP server ${args.id} not found`);
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

/** Delete an MCP server config. */
export const remove = mutation({
  args: { id: v.id("mcpServers") },
  handler: async (ctx, args) => {
    const existing = await ctx.db.get(args.id);
    if (!existing) {
      throw new Error(`MCP server ${args.id} not found`);
    }
    await ctx.db.delete(args.id);
  },
});
