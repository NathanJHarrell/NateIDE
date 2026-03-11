import { v } from "convex/values";
import { query, mutation } from "./_generated/server";

const conflictTypeValues = v.union(
  v.literal("file_edit"),
  v.literal("instruction"),
  v.literal("resource"),
);

const conflictStatusValues = v.union(
  v.literal("active"),
  v.literal("resolved"),
);

/** Record a detected conflict. */
export const detect = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    threadId: v.optional(v.id("threads")),
    filePath: v.optional(v.string()),
    type: conflictTypeValues,
    involvedUsers: v.array(v.string()),
    description: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const conflictId = await ctx.db.insert("conflicts", {
      workspaceId: args.workspaceId,
      threadId: args.threadId,
      filePath: args.filePath,
      type: args.type,
      involvedUsers: args.involvedUsers,
      status: "active",
      description: args.description,
      createdAt: Date.now(),
    });

    return conflictId;
  },
});

/** List active (unresolved) conflicts for a workspace. */
export const listActive = query({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("conflicts")
      .withIndex("by_workspace_status", (q) =>
        q.eq("workspaceId", args.workspaceId).eq("status", "active"),
      )
      .collect();
  },
});

/** Mark a conflict as resolved. */
export const resolve = mutation({
  args: {
    id: v.id("conflicts"),
    resolution: v.string(),
  },
  handler: async (ctx, args) => {
    const conflict = await ctx.db.get(args.id);

    if (!conflict) {
      throw new Error("Conflict not found");
    }

    if (conflict.status === "resolved") {
      throw new Error("Conflict is already resolved");
    }

    await ctx.db.patch(args.id, {
      status: "resolved",
      resolution: args.resolution,
      resolvedAt: Date.now(),
    });
  },
});
