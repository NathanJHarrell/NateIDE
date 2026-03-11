/**
 * Phase 7: Profiles, Projects & Discovery types.
 */

export type Project = {
  id: string;
  name: string;
  description: string;
  visibility: "private" | "workspace" | "public";
  ownerId: string;
  workspaceIds: string[];
  tags: string[];
  readme?: string;
  starCount: number;
  createdAt: number;
  updatedAt: number;
};

export type Star = {
  id: string;
  userId: string;
  targetType: "project" | "harness" | "pipeline" | "soul";
  targetId: string;
  createdAt: number;
};

export type PublicProfile = {
  id: string;
  handle: string;
  displayName: string;
  avatarUrl?: string;
  bio?: string;
  projectCount: number;
  harnessCount: number;
};

export type DiscoveryResult = {
  type: "project" | "harness" | "pipeline" | "soul";
  id: string;
  name: string;
  description: string;
  ownerHandle: string;
  starCount: number;
  tags: string[];
  updatedAt: number;
};
