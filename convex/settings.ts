import { v } from "convex/values";
import { query, mutation } from "./_generated/server";

export const get = query({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("settings")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .unique();
  },
});

export const update = mutation({
  args: {
    userId: v.id("users"),
    apiKeys: v.optional(
      v.object({
        anthropic: v.optional(v.string()),
        openai: v.optional(v.string()),
        google: v.optional(v.string()),
        openrouter: v.optional(v.string()),
      }),
    ),
    preferences: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("settings")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .unique();

    if (existing) {
      const updates: Record<string, unknown> = {};
      if (args.apiKeys !== undefined) updates.apiKeys = args.apiKeys;
      if (args.preferences !== undefined) updates.preferences = args.preferences;
      await ctx.db.patch(existing._id, updates);
      return existing._id;
    }

    return await ctx.db.insert("settings", {
      userId: args.userId,
      apiKeys: args.apiKeys ?? {},
      preferences: args.preferences ?? {},
    });
  },
});
