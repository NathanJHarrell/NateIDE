import { v } from "convex/values";
import { query, mutation } from "./_generated/server";

const statusValues = v.union(
  v.literal("pending"),
  v.literal("approved"),
  v.literal("rejected"),
);

/** List pending approvals for a workspace. */
export const listPending = query({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("approvals")
      .withIndex("by_workspace_status", (q) =>
        q.eq("workspaceId", args.workspaceId).eq("status", "pending"),
      )
      .collect();
  },
});

/** Get a single approval by ID. */
export const get = query({
  args: { id: v.id("approvals") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

/** List approvals for a specific thread. */
export const listByThread = query({
  args: { threadId: v.id("threads") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("approvals")
      .withIndex("by_thread", (q) => q.eq("threadId", args.threadId))
      .collect();
  },
});

/** Create an approval request. */
export const request = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    threadId: v.id("threads"),
    requestedBy: v.object({
      type: v.string(),
      id: v.string(),
    }),
    type: v.string(),
    payload: v.any(),
  },
  handler: async (ctx, args) => {
    const approvalId = await ctx.db.insert("approvals", {
      workspaceId: args.workspaceId,
      threadId: args.threadId,
      requestedBy: args.requestedBy,
      type: args.type,
      payload: args.payload,
      status: "pending",
      createdAt: Date.now(),
    });

    return approvalId;
  },
});

/** Resolve an approval (approve or reject). First responder wins. */
export const resolve = mutation({
  args: {
    id: v.id("approvals"),
    status: v.union(v.literal("approved"), v.literal("rejected")),
    resolvedBy: v.string(),
  },
  handler: async (ctx, args) => {
    const approval = await ctx.db.get(args.id);

    if (!approval) {
      throw new Error("Approval not found");
    }

    if (approval.status !== "pending") {
      throw new Error(
        `Approval already resolved as "${approval.status}" by ${approval.resolvedBy}`,
      );
    }

    await ctx.db.patch(args.id, {
      status: args.status,
      resolvedBy: args.resolvedBy,
      resolvedAt: Date.now(),
    });
  },
});
