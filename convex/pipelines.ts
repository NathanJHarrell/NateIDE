import { v } from "convex/values";
import { query, mutation } from "./_generated/server";

// ── Pipeline Queries ──────────────────────────────────────────

/** Get a single pipeline by ID. */
export const get = query({
  args: { id: v.id("pipelines") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

/** List pipelines in a workspace. */
export const list = query({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("pipelines")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .collect();
  },
});

/** List all public pipelines. */
export const listPublic = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query("pipelines")
      .withIndex("by_visibility", (q) => q.eq("visibility", "public"))
      .collect();
  },
});

/** List pipelines created by a specific user. */
export const listByCreator = query({
  args: { createdBy: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("pipelines")
      .withIndex("by_creator", (q) => q.eq("createdBy", args.createdBy))
      .collect();
  },
});

// ── Pipeline Mutations ────────────────────────────────────────

/** Create a new pipeline. */
export const create = mutation({
  args: {
    name: v.string(),
    description: v.optional(v.string()),
    nodes: v.array(v.any()),
    edges: v.array(v.any()),
    variables: v.optional(v.any()),
    defaultPolicy: v.optional(
      v.union(v.literal("safe"), v.literal("yolo")),
    ),
    visibility: v.union(
      v.literal("private"),
      v.literal("workspace"),
      v.literal("public"),
    ),
    workspaceId: v.optional(v.id("workspaces")),
    createdBy: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    return await ctx.db.insert("pipelines", {
      name: args.name,
      description: args.description,
      nodes: args.nodes,
      edges: args.edges,
      variables: args.variables,
      defaultPolicy: args.defaultPolicy,
      visibility: args.visibility,
      workspaceId: args.workspaceId,
      createdBy: args.createdBy,
      createdAt: now,
      updatedAt: now,
    });
  },
});

/** Update an existing pipeline. */
export const update = mutation({
  args: {
    id: v.id("pipelines"),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
    nodes: v.optional(v.array(v.any())),
    edges: v.optional(v.array(v.any())),
    variables: v.optional(v.any()),
    defaultPolicy: v.optional(
      v.union(v.literal("safe"), v.literal("yolo")),
    ),
    visibility: v.optional(
      v.union(
        v.literal("private"),
        v.literal("workspace"),
        v.literal("public"),
      ),
    ),
  },
  handler: async (ctx, args) => {
    const { id, ...updates } = args;
    const existing = await ctx.db.get(id);
    if (!existing) {
      throw new Error("Pipeline not found");
    }

    // Filter out undefined values
    const patch: Record<string, unknown> = { updatedAt: Date.now() };
    for (const [key, value] of Object.entries(updates)) {
      if (value !== undefined) {
        patch[key] = value;
      }
    }

    await ctx.db.patch(id, patch);
    return id;
  },
});

/** Delete a pipeline. */
export const remove = mutation({
  args: { id: v.id("pipelines") },
  handler: async (ctx, args) => {
    const existing = await ctx.db.get(args.id);
    if (!existing) {
      throw new Error("Pipeline not found");
    }
    await ctx.db.delete(args.id);
  },
});

/** Clone a pipeline (independent copy). */
export const clone = mutation({
  args: {
    sourceId: v.id("pipelines"),
    createdBy: v.string(),
    workspaceId: v.optional(v.id("workspaces")),
    name: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const source = await ctx.db.get(args.sourceId);
    if (!source) {
      throw new Error("Source pipeline not found");
    }

    const now = Date.now();
    return await ctx.db.insert("pipelines", {
      name: args.name ?? `${source.name} (copy)`,
      description: source.description,
      nodes: source.nodes,
      edges: source.edges,
      variables: source.variables,
      defaultPolicy: source.defaultPolicy,
      visibility: "private",
      workspaceId: args.workspaceId,
      createdBy: args.createdBy,
      createdAt: now,
      updatedAt: now,
    });
  },
});

// ── Pipeline Execution Queries ────────────────────────────────

/** Get a single pipeline execution. */
export const getExecution = query({
  args: { id: v.id("pipelineExecutions") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

/** List executions for a pipeline. */
export const listExecutions = query({
  args: { pipelineId: v.id("pipelines") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("pipelineExecutions")
      .withIndex("by_pipeline", (q) => q.eq("pipelineId", args.pipelineId))
      .order("desc")
      .collect();
  },
});

/** List executions by status. */
export const listExecutionsByStatus = query({
  args: { status: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("pipelineExecutions")
      .withIndex("by_status", (q) => q.eq("status", args.status))
      .collect();
  },
});

// ── Pipeline Execution Mutations ──────────────────────────────

/** Create a new execution record. */
export const createExecution = mutation({
  args: {
    pipelineId: v.id("pipelines"),
    triggeredBy: v.string(),
    variables: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    return await ctx.db.insert("pipelineExecutions", {
      pipelineId: args.pipelineId,
      status: "running",
      currentNodeIds: [],
      completedNodeIds: [],
      failedNodeIds: [],
      nodeOutputs: {},
      nodeErrors: {},
      variables: args.variables,
      triggeredBy: args.triggeredBy,
      startedAt: now,
    });
  },
});

/** Update an execution's state. */
export const updateExecution = mutation({
  args: {
    id: v.id("pipelineExecutions"),
    status: v.optional(v.string()),
    currentNodeIds: v.optional(v.array(v.string())),
    completedNodeIds: v.optional(v.array(v.string())),
    failedNodeIds: v.optional(v.array(v.string())),
    nodeOutputs: v.optional(v.any()),
    nodeErrors: v.optional(v.any()),
    variables: v.optional(v.any()),
    finishedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { id, ...updates } = args;
    const existing = await ctx.db.get(id);
    if (!existing) {
      throw new Error("Pipeline execution not found");
    }

    const patch: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(updates)) {
      if (value !== undefined) {
        patch[key] = value;
      }
    }

    await ctx.db.patch(id, patch);
    return id;
  },
});
