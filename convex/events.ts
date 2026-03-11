import { v } from "convex/values";
import { query, mutation } from "./_generated/server";

export const list = query({
  args: {
    threadId: v.id("threads"),
    afterSeq: v.optional(v.number()),
    paginationOpts: v.object({
      numItems: v.number(),
      cursor: v.union(v.string(), v.null()),
    }),
  },
  handler: async (ctx, args) => {
    let q = ctx.db
      .query("events")
      .withIndex("by_thread_seq", (q) => {
        const base = q.eq("threadId", args.threadId);
        if (args.afterSeq !== undefined) {
          return base.gt("seq", args.afterSeq);
        }
        return base;
      });

    return await q.paginate(args.paginationOpts);
  },
});

export const append = mutation({
  args: {
    threadId: v.id("threads"),
    actor: v.object({
      type: v.string(),
      id: v.string(),
    }),
    eventType: v.string(),
    payload: v.any(),
  },
  handler: async (ctx, args) => {
    // Find the current max seq for this thread
    const lastEvent = await ctx.db
      .query("events")
      .withIndex("by_thread_seq", (q) => q.eq("threadId", args.threadId))
      .order("desc")
      .first();

    const seq = lastEvent ? lastEvent.seq + 1 : 1;

    return await ctx.db.insert("events", {
      threadId: args.threadId,
      seq,
      actor: args.actor,
      eventType: args.eventType,
      payload: args.payload,
      ts: Date.now(),
    });
  },
});
