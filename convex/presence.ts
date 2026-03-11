import { v } from "convex/values";
import { query, mutation, internalQuery } from "./_generated/server";

const statusValues = v.union(
  v.literal("active"),
  v.literal("idle"),
  v.literal("typing"),
);

const actorTypeValues = v.union(v.literal("user"), v.literal("agent"));

/** List all presence entries for a thread. */
export const list = query({
  args: { threadId: v.id("threads") },
  handler: async (ctx, args) => {
    const entries = await ctx.db
      .query("presence")
      .withIndex("by_thread", (q) => q.eq("threadId", args.threadId))
      .collect();

    // Filter out stale entries (older than 60 seconds)
    const cutoff = Date.now() - 60_000;
    return entries.filter((e) => e.lastSeen > cutoff);
  },
});

/** Upsert presence: heartbeat or status change. */
export const heartbeat = mutation({
  args: {
    threadId: v.id("threads"),
    actorType: actorTypeValues,
    actorId: v.string(),
    status: statusValues,
  },
  handler: async (ctx, args) => {
    // Look for existing presence entry for this actor in this thread
    const entries = await ctx.db
      .query("presence")
      .withIndex("by_thread", (q) => q.eq("threadId", args.threadId))
      .collect();

    const existing = entries.find(
      (e) => e.actorType === args.actorType && e.actorId === args.actorId,
    );

    if (existing) {
      await ctx.db.patch(existing._id, {
        status: args.status,
        lastSeen: Date.now(),
      });
      return existing._id;
    }

    return await ctx.db.insert("presence", {
      threadId: args.threadId,
      actorType: args.actorType,
      actorId: args.actorId,
      status: args.status,
      lastSeen: Date.now(),
    });
  },
});

/** Remove presence entry when a user/agent leaves a thread. */
export const leave = mutation({
  args: {
    threadId: v.id("threads"),
    actorType: actorTypeValues,
    actorId: v.string(),
  },
  handler: async (ctx, args) => {
    const entries = await ctx.db
      .query("presence")
      .withIndex("by_thread", (q) => q.eq("threadId", args.threadId))
      .collect();

    const existing = entries.find(
      (e) => e.actorType === args.actorType && e.actorId === args.actorId,
    );

    if (existing) {
      await ctx.db.delete(existing._id);
    }
  },
});

/** Internal query: find stale presence entries for periodic cleanup. */
export const listStale = internalQuery({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - 60_000;
    const allEntries = await ctx.db.query("presence").collect();
    return allEntries.filter((e) => e.lastSeen <= cutoff);
  },
});
