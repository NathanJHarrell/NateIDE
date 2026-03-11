import { v } from "convex/values";
import { query, mutation } from "./_generated/server";

export const get = query({
  args: { id: v.id("workspaces") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

export const list = query({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const memberships = await ctx.db
      .query("members")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();

    const workspaces = await Promise.all(
      memberships.map((m) => ctx.db.get(m.workspaceId)),
    );

    return workspaces.filter(Boolean);
  },
});

export const create = mutation({
  args: {
    userId: v.id("users"),
    name: v.string(),
    rootPath: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    const workspaceId = await ctx.db.insert("workspaces", {
      name: args.name,
      rootPath: args.rootPath,
      visibility: "private",
      ownerId: args.userId,
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.insert("members", {
      workspaceId,
      userId: args.userId,
      role: "owner",
      joinedAt: now,
    });

    return workspaceId;
  },
});

export const update = mutation({
  args: {
    id: v.id("workspaces"),
    name: v.optional(v.string()),
    visibility: v.optional(
      v.union(
        v.literal("private"),
        v.literal("workspace"),
        v.literal("public"),
      ),
    ),
  },
  handler: async (ctx, args) => {
    const { id, ...fields } = args;
    const updates: Record<string, unknown> = { updatedAt: Date.now() };

    if (fields.name !== undefined) updates.name = fields.name;
    if (fields.visibility !== undefined) updates.visibility = fields.visibility;

    await ctx.db.patch(id, updates);
  },
});
