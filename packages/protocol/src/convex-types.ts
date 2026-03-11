/**
 * Convex-specific type helpers for the protocol layer.
 * These types bridge protocol entities with Convex's document model.
 */

/** Visibility levels for all shareable artifacts */
export type Visibility = "private" | "workspace" | "public";

/** Member roles in a workspace */
export type MemberRole = "owner" | "admin" | "editor" | "viewer";

/**
 * Represents a Convex document ID as a branded string.
 * This is a client-side type alias — actual ID validation happens in Convex.
 */
export type ConvexId<TableName extends string> = string & {
  __tableName: TableName;
};

/** API key provider names */
export type ApiKeyProvider = "anthropic" | "openai" | "google" | "openrouter";

/** User settings as stored in Convex */
export type UserSettings = {
  userId: ConvexId<"users">;
  apiKeys: Partial<Record<ApiKeyProvider, string>>;
  preferences: Record<string, unknown>;
};

/** User profile */
export type UserProfile = {
  id: ConvexId<"users">;
  handle: string;
  displayName: string;
  avatarUrl?: string;
  bio?: string;
  profileVisibility: Visibility;
};

/** Workspace member */
export type WorkspaceMember = {
  id: ConvexId<"members">;
  workspaceId: ConvexId<"workspaces">;
  userId: ConvexId<"users">;
  role: MemberRole;
  joinedAt: number;
};
