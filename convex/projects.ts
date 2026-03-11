import { v } from "convex/values";
import { query, mutation } from "./_generated/server";

// ── Queries ──────────────────────────────────────────────────

/** Get a single project by ID. */
export const get = query({
  args: { id: v.id("projects") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

/** List projects owned by a user. */
export const listByOwner = query({
  args: { ownerId: v.id("users") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("projects")
      .withIndex("by_owner", (q) => q.eq("ownerId", args.ownerId))
      .collect();
  },
});

/** List public projects, optionally filtered by tag. */
export const listPublic = query({
  args: { tag: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const projects = await ctx.db
      .query("projects")
      .withIndex("by_visibility", (q) => q.eq("visibility", "public"))
      .collect();

    if (args.tag) {
      return projects.filter((p) => p.tags.includes(args.tag!));
    }

    return projects;
  },
});

// ── Mutations ────────────────────────────────────────────────

/** Create a new project. */
export const create = mutation({
  args: {
    name: v.string(),
    description: v.string(),
    visibility: v.union(
      v.literal("private"),
      v.literal("workspace"),
      v.literal("public"),
    ),
    ownerId: v.id("users"),
    tags: v.array(v.string()),
    readme: v.optional(v.string()),
    workspaceIds: v.optional(v.array(v.id("workspaces"))),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    return await ctx.db.insert("projects", {
      name: args.name,
      description: args.description,
      visibility: args.visibility,
      ownerId: args.ownerId,
      workspaceIds: args.workspaceIds ?? [],
      tags: args.tags,
      readme: args.readme,
      starCount: 0,
      createdAt: now,
      updatedAt: now,
    });
  },
});

/** Update a project's details. */
export const update = mutation({
  args: {
    id: v.id("projects"),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
    visibility: v.optional(
      v.union(
        v.literal("private"),
        v.literal("workspace"),
        v.literal("public"),
      ),
    ),
    tags: v.optional(v.array(v.string())),
    readme: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db.get(args.id);
    if (!existing) {
      throw new Error(`Project ${args.id} not found`);
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

/** Delete a project. */
export const remove = mutation({
  args: { id: v.id("projects") },
  handler: async (ctx, args) => {
    const existing = await ctx.db.get(args.id);
    if (!existing) {
      throw new Error(`Project ${args.id} not found`);
    }
    await ctx.db.delete(args.id);
  },
});

/** Add a workspace to a project. */
export const addWorkspace = mutation({
  args: {
    projectId: v.id("projects"),
    workspaceId: v.id("workspaces"),
  },
  handler: async (ctx, args) => {
    const project = await ctx.db.get(args.projectId);
    if (!project) {
      throw new Error(`Project ${args.projectId} not found`);
    }

    if (project.workspaceIds.includes(args.workspaceId)) {
      return; // already added
    }

    await ctx.db.patch(args.projectId, {
      workspaceIds: [...project.workspaceIds, args.workspaceId],
      updatedAt: Date.now(),
    });
  },
});

/** Remove a workspace from a project. */
export const removeWorkspace = mutation({
  args: {
    projectId: v.id("projects"),
    workspaceId: v.id("workspaces"),
  },
  handler: async (ctx, args) => {
    const project = await ctx.db.get(args.projectId);
    if (!project) {
      throw new Error(`Project ${args.projectId} not found`);
    }

    await ctx.db.patch(args.projectId, {
      workspaceIds: project.workspaceIds.filter((id) => id !== args.workspaceId),
      updatedAt: Date.now(),
    });
  },
});
