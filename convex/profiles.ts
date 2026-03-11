import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";

// ── Queries ──────────────────────────────────────────────────

/** Get the current authenticated user's profile. */
export const me = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    return await ctx.db.get(userId);
  },
});

/** Get user profile by ID. */
export const get = query({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.userId);
  },
});

/** Get user profile by handle. */
export const getByHandle = query({
  args: { handle: v.string() },
  handler: async (ctx, args) => {
    const users = await ctx.db.query("users").collect();
    return users.find((u) => u.handle === args.handle) ?? null;
  },
});

/** Search users by handle or displayName. */
export const search = query({
  args: { query: v.string() },
  handler: async (ctx, args) => {
    const q = args.query.toLowerCase();
    const users = await ctx.db.query("users").collect();
    return users.filter(
      (u) =>
        u.handle.toLowerCase().includes(q) ||
        u.displayName.toLowerCase().includes(q),
    );
  },
});

/** Get a user's public artifacts (harnesses, projects). */
export const getPublicArtifacts = query({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!user) {
      throw new Error(`User ${args.userId} not found`);
    }

    // Public harnesses by this user
    const allHarnesses = await ctx.db
      .query("harnesses")
      .withIndex("by_creator", (q) => q.eq("createdBy", args.userId))
      .collect();
    const harnesses = allHarnesses.filter((h) => h.visibility === "public");

    // Public projects by this user
    const allProjects = await ctx.db
      .query("projects")
      .withIndex("by_owner", (q) => q.eq("ownerId", args.userId))
      .collect();
    const projects = allProjects.filter((p) => p.visibility === "public");

    return {
      user: {
        id: user._id,
        handle: user.handle,
        displayName: user.displayName,
        avatarUrl: user.avatarUrl,
        bio: user.bio,
        profileVisibility: user.profileVisibility,
      },
      harnesses,
      projects,
    };
  },
});

// ── Mutations ────────────────────────────────────────────────

/** Update own profile. */
export const update = mutation({
  args: {
    userId: v.id("users"),
    displayName: v.optional(v.string()),
    bio: v.optional(v.string()),
    avatarUrl: v.optional(v.string()),
    profileVisibility: v.optional(
      v.union(
        v.literal("private"),
        v.literal("workspace"),
        v.literal("public"),
      ),
    ),
    handle: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db.get(args.userId);
    if (!existing) {
      throw new Error(`User ${args.userId} not found`);
    }

    const { userId, ...fields } = args;
    const updates: Record<string, unknown> = {};

    // If handle is being changed, check uniqueness
    if (fields.handle !== undefined && fields.handle !== existing.handle) {
      const handleLower = fields.handle.toLowerCase();

      // Validate handle format: lowercase, alphanumeric + hyphens
      if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(handleLower) && handleLower.length > 1) {
        throw new Error(
          "Handle must be lowercase, alphanumeric with hyphens, and cannot start or end with a hyphen.",
        );
      }
      if (handleLower.length < 2) {
        throw new Error("Handle must be at least 2 characters.");
      }

      // Check uniqueness
      const allUsers = await ctx.db.query("users").collect();
      const taken = allUsers.find(
        (u) => u.handle.toLowerCase() === handleLower && u._id !== userId,
      );
      if (taken) {
        throw new Error(`Handle "${fields.handle}" is already taken.`);
      }

      updates.handle = handleLower;
    }

    for (const [key, value] of Object.entries(fields)) {
      if (value !== undefined && key !== "handle") {
        updates[key] = value;
      }
    }

    if (Object.keys(updates).length > 0) {
      await ctx.db.patch(userId, updates);
    }
  },
});
