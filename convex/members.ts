import { v } from "convex/values";
import { query, mutation } from "./_generated/server";

const roleValues = v.union(
  v.literal("owner"),
  v.literal("admin"),
  v.literal("editor"),
  v.literal("viewer"),
);

/** Role hierarchy for permission checks. Lower index = more powerful. */
const ROLE_HIERARCHY: Array<"owner" | "admin" | "editor" | "viewer"> = [
  "owner",
  "admin",
  "editor",
  "viewer",
];

function roleIndex(role: string): number {
  const idx = ROLE_HIERARCHY.indexOf(role as any);
  return idx === -1 ? ROLE_HIERARCHY.length : idx;
}

function hasRole(
  userRole: string,
  requiredRole: "owner" | "admin" | "editor" | "viewer",
): boolean {
  return roleIndex(userRole) <= roleIndex(requiredRole);
}

/** List all members of a workspace (with user profile data). */
export const list = query({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args) => {
    const memberships = await ctx.db
      .query("members")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .collect();

    const membersWithProfiles = await Promise.all(
      memberships.map(async (m) => {
        const user = await ctx.db.get(m.userId);
        return {
          _id: m._id,
          workspaceId: m.workspaceId,
          userId: m.userId,
          role: m.role,
          joinedAt: m.joinedAt,
          user: user
            ? {
                handle: user.handle,
                displayName: user.displayName,
                avatarUrl: user.avatarUrl,
              }
            : null,
        };
      }),
    );

    return membersWithProfiles;
  },
});

/** Get the current user's role in a workspace. */
export const getRole = query({
  args: {
    workspaceId: v.id("workspaces"),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const membership = await ctx.db
      .query("members")
      .withIndex("by_workspace_user", (q) =>
        q.eq("workspaceId", args.workspaceId).eq("userId", args.userId),
      )
      .unique();

    return membership?.role ?? null;
  },
});

/** Invite a user to a workspace by email. */
export const invite = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    invitedBy: v.id("users"),
    email: v.string(),
    role: v.union(
      v.literal("admin"),
      v.literal("editor"),
      v.literal("viewer"),
    ),
  },
  handler: async (ctx, args) => {
    // Check that the inviter has permission (owner or admin)
    const inviterMembership = await ctx.db
      .query("members")
      .withIndex("by_workspace_user", (q) =>
        q.eq("workspaceId", args.workspaceId).eq("userId", args.invitedBy),
      )
      .unique();

    if (!inviterMembership || !hasRole(inviterMembership.role, "admin")) {
      throw new Error("Only owners and admins can invite members");
    }

    // Check for existing pending invitation
    const existing = await ctx.db
      .query("invitations")
      .withIndex("by_email", (q) => q.eq("invitedEmail", args.email))
      .collect();

    const alreadyPending = existing.find(
      (inv) =>
        inv.workspaceId === args.workspaceId && inv.status === "pending",
    );

    if (alreadyPending) {
      throw new Error("An invitation is already pending for this email");
    }

    const invitationId = await ctx.db.insert("invitations", {
      workspaceId: args.workspaceId,
      invitedEmail: args.email,
      invitedBy: args.invitedBy,
      role: args.role,
      status: "pending",
      expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000, // 7 days
    });

    return invitationId;
  },
});

/** Update a member's role (owner/admin only). */
export const updateRole = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    requestingUserId: v.id("users"),
    targetUserId: v.id("users"),
    newRole: roleValues,
  },
  handler: async (ctx, args) => {
    // Check that the requester has permission
    const requesterMembership = await ctx.db
      .query("members")
      .withIndex("by_workspace_user", (q) =>
        q.eq("workspaceId", args.workspaceId).eq("userId", args.requestingUserId),
      )
      .unique();

    if (!requesterMembership || !hasRole(requesterMembership.role, "admin")) {
      throw new Error("Only owners and admins can change roles");
    }

    // Cannot change your own role
    if (args.requestingUserId === args.targetUserId) {
      throw new Error("Cannot change your own role");
    }

    // Find the target membership
    const targetMembership = await ctx.db
      .query("members")
      .withIndex("by_workspace_user", (q) =>
        q.eq("workspaceId", args.workspaceId).eq("userId", args.targetUserId),
      )
      .unique();

    if (!targetMembership) {
      throw new Error("User is not a member of this workspace");
    }

    // Only owners can promote to owner or change other owners/admins
    if (
      args.newRole === "owner" &&
      requesterMembership.role !== "owner"
    ) {
      throw new Error("Only owners can promote to owner");
    }

    if (
      targetMembership.role === "owner" &&
      requesterMembership.role !== "owner"
    ) {
      throw new Error("Only owners can change another owner's role");
    }

    await ctx.db.patch(targetMembership._id, { role: args.newRole });
  },
});

/** Remove a member from a workspace (owner/admin only). */
export const remove = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    requestingUserId: v.id("users"),
    targetUserId: v.id("users"),
  },
  handler: async (ctx, args) => {
    // Check that the requester has permission
    const requesterMembership = await ctx.db
      .query("members")
      .withIndex("by_workspace_user", (q) =>
        q.eq("workspaceId", args.workspaceId).eq("userId", args.requestingUserId),
      )
      .unique();

    if (!requesterMembership || !hasRole(requesterMembership.role, "admin")) {
      throw new Error("Only owners and admins can remove members");
    }

    // Cannot remove yourself (use leave instead)
    if (args.requestingUserId === args.targetUserId) {
      throw new Error("Use leave() to remove yourself from a workspace");
    }

    const targetMembership = await ctx.db
      .query("members")
      .withIndex("by_workspace_user", (q) =>
        q.eq("workspaceId", args.workspaceId).eq("userId", args.targetUserId),
      )
      .unique();

    if (!targetMembership) {
      throw new Error("User is not a member of this workspace");
    }

    // Cannot remove an owner unless you're also an owner
    if (
      targetMembership.role === "owner" &&
      requesterMembership.role !== "owner"
    ) {
      throw new Error("Only owners can remove other owners");
    }

    await ctx.db.delete(targetMembership._id);
  },
});

/** Leave a workspace voluntarily. */
export const leave = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const membership = await ctx.db
      .query("members")
      .withIndex("by_workspace_user", (q) =>
        q.eq("workspaceId", args.workspaceId).eq("userId", args.userId),
      )
      .unique();

    if (!membership) {
      throw new Error("Not a member of this workspace");
    }

    // If the user is the sole owner, they cannot leave
    if (membership.role === "owner") {
      const allMembers = await ctx.db
        .query("members")
        .withIndex("by_workspace", (q) =>
          q.eq("workspaceId", args.workspaceId),
        )
        .collect();

      const otherOwners = allMembers.filter(
        (m) => m.role === "owner" && m.userId !== args.userId,
      );

      if (otherOwners.length === 0) {
        throw new Error(
          "Cannot leave workspace as the sole owner. Transfer ownership first.",
        );
      }
    }

    await ctx.db.delete(membership._id);
  },
});
