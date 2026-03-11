import { v } from "convex/values";
import { query, mutation } from "./_generated/server";

// ── Queries ──────────────────────────────────────────────────

/** Get star count for a target. */
export const count = query({
  args: {
    targetType: v.union(
      v.literal("project"),
      v.literal("harness"),
      v.literal("pipeline"),
      v.literal("soul"),
    ),
    targetId: v.string(),
  },
  handler: async (ctx, args) => {
    const stars = await ctx.db
      .query("stars")
      .withIndex("by_target", (q) =>
        q.eq("targetType", args.targetType).eq("targetId", args.targetId),
      )
      .collect();
    return stars.length;
  },
});

/** Check if a user has starred a target. */
export const isStarred = query({
  args: {
    userId: v.id("users"),
    targetType: v.union(
      v.literal("project"),
      v.literal("harness"),
      v.literal("pipeline"),
      v.literal("soul"),
    ),
    targetId: v.string(),
  },
  handler: async (ctx, args) => {
    const star = await ctx.db
      .query("stars")
      .withIndex("by_user_target", (q) =>
        q
          .eq("userId", args.userId)
          .eq("targetType", args.targetType)
          .eq("targetId", args.targetId),
      )
      .first();
    return star !== null;
  },
});

/** List a user's starred items. */
export const listByUser = query({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("stars")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();
  },
});

// ── Mutations ────────────────────────────────────────────────

/** Toggle star/unstar on a target. Idempotent. */
export const toggle = mutation({
  args: {
    userId: v.id("users"),
    targetType: v.union(
      v.literal("project"),
      v.literal("harness"),
      v.literal("pipeline"),
      v.literal("soul"),
    ),
    targetId: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("stars")
      .withIndex("by_user_target", (q) =>
        q
          .eq("userId", args.userId)
          .eq("targetType", args.targetType)
          .eq("targetId", args.targetId),
      )
      .first();

    if (existing) {
      // Unstar
      await ctx.db.delete(existing._id);

      // Decrement starCount on project if applicable
      if (args.targetType === "project") {
        const project = await ctx.db.get(args.targetId as any);
        if (project) {
          await ctx.db.patch(project._id, {
            starCount: Math.max(0, (project as any).starCount - 1),
          });
        }
      }

      return { starred: false };
    } else {
      // Star
      await ctx.db.insert("stars", {
        userId: args.userId,
        targetType: args.targetType,
        targetId: args.targetId,
        createdAt: Date.now(),
      });

      // Increment starCount on project if applicable
      if (args.targetType === "project") {
        const project = await ctx.db.get(args.targetId as any);
        if (project) {
          await ctx.db.patch(project._id, {
            starCount: ((project as any).starCount ?? 0) + 1,
          });
        }
      }

      return { starred: true };
    }
  },
});
