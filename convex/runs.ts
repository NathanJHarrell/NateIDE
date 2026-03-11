import { v } from "convex/values";
import { query, mutation } from "./_generated/server";

export const list = query({
  args: { threadId: v.id("threads") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("runs")
      .withIndex("by_thread", (q) => q.eq("threadId", args.threadId))
      .collect();
  },
});

export const listByTask = query({
  args: { taskId: v.id("tasks") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("runs")
      .withIndex("by_task", (q) => q.eq("taskId", args.taskId))
      .collect();
  },
});

export const start = mutation({
  args: {
    threadId: v.id("threads"),
    taskId: v.id("tasks"),
    agentId: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("runs", {
      threadId: args.threadId,
      taskId: args.taskId,
      agentId: args.agentId,
      status: "queued",
    });
  },
});

export const complete = mutation({
  args: {
    id: v.id("runs"),
    status: v.union(
      v.literal("completed"),
      v.literal("failed"),
      v.literal("canceled"),
    ),
    summary: v.optional(v.string()),
    tokenUsage: v.optional(
      v.object({
        inputTokens: v.number(),
        outputTokens: v.number(),
        totalTokens: v.number(),
        estimatedCostUsd: v.optional(v.number()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, {
      status: args.status,
      summary: args.summary,
      tokenUsage: args.tokenUsage,
      finishedAt: Date.now(),
    });
  },
});
