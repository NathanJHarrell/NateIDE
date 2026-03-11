import { v } from "convex/values";
import { query, mutation } from "./_generated/server";

export const list = query({
  args: { threadId: v.id("threads") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("tasks")
      .withIndex("by_thread", (q) => q.eq("threadId", args.threadId))
      .collect();
  },
});

export const create = mutation({
  args: {
    threadId: v.id("threads"),
    title: v.string(),
    goal: v.string(),
    createdBy: v.object({
      type: v.string(),
      id: v.string(),
    }),
    assigneeAgentId: v.optional(v.string()),
    fileScope: v.optional(v.array(v.string())),
    terminalScope: v.optional(v.array(v.string())),
    dependsOnTaskIds: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    return await ctx.db.insert("tasks", {
      threadId: args.threadId,
      title: args.title,
      goal: args.goal,
      status: "open",
      createdBy: args.createdBy,
      assigneeAgentId: args.assigneeAgentId,
      fileScope: args.fileScope ?? [],
      terminalScope: args.terminalScope ?? [],
      dependsOnTaskIds: args.dependsOnTaskIds ?? [],
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const update = mutation({
  args: {
    id: v.id("tasks"),
    status: v.optional(
      v.union(
        v.literal("open"),
        v.literal("assigned"),
        v.literal("in_progress"),
        v.literal("blocked"),
        v.literal("completed"),
        v.literal("failed"),
      ),
    ),
    assigneeAgentId: v.optional(v.string()),
    title: v.optional(v.string()),
    goal: v.optional(v.string()),
    fileScope: v.optional(v.array(v.string())),
    terminalScope: v.optional(v.array(v.string())),
    dependsOnTaskIds: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const { id, ...fields } = args;
    const updates: Record<string, unknown> = { updatedAt: Date.now() };

    for (const [key, value] of Object.entries(fields)) {
      if (value !== undefined) updates[key] = value;
    }

    await ctx.db.patch(id, updates);
  },
});
