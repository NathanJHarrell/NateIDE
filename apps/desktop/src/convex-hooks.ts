/**
 * Convex hooks for the desktop app.
 *
 * These wrap Convex queries and mutations, providing a clean interface
 * between the app components and the Convex backend. Components should
 * use these hooks instead of raw fetch() calls to the daemon for any
 * state that lives in Convex (workspaces, threads, events, tasks, runs,
 * settings).
 *
 * Usage:
 *   import { useWorkspaces, useCreateThread } from "./convex-hooks";
 *   const workspaces = useWorkspaces(userId);
 *   const createThread = useCreateThread();
 */

import { useQuery, useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";

// ---------------------------------------------------------------------------
// Auth / current user
// ---------------------------------------------------------------------------

/** Get the current authenticated user's profile. */
export function useMe() {
  return useQuery(api.profiles.me);
}

// ---------------------------------------------------------------------------
// Query hooks
// ---------------------------------------------------------------------------

/** List all workspaces the user is a member of. */
export function useWorkspaces(userId: Id<"users"> | undefined) {
  return useQuery(api.workspaces.list, userId ? { userId } : "skip");
}

/** Get a single workspace by ID. */
export function useWorkspace(id: Id<"workspaces"> | undefined) {
  return useQuery(api.workspaces.get, id ? { id } : "skip");
}

/** List threads in a workspace. */
export function useThreads(workspaceId: Id<"workspaces"> | undefined) {
  return useQuery(api.threads.list, workspaceId ? { workspaceId } : "skip");
}

/** Get a single thread by ID. */
export function useThread(id: Id<"threads"> | undefined) {
  return useQuery(api.threads.get, id ? { id } : "skip");
}

/** List events in a thread (paginated). */
export function useEvents(
  threadId: Id<"threads"> | undefined,
  opts?: { afterSeq?: number; numItems?: number; cursor?: string | null },
) {
  return useQuery(
    api.events.list,
    threadId
      ? {
          threadId,
          afterSeq: opts?.afterSeq,
          paginationOpts: {
            numItems: opts?.numItems ?? 50,
            cursor: opts?.cursor ?? null,
          },
        }
      : "skip",
  );
}

/** List tasks in a thread. */
export function useTasks(threadId: Id<"threads"> | undefined) {
  return useQuery(api.tasks.list, threadId ? { threadId } : "skip");
}

/** List runs in a thread. */
export function useRuns(threadId: Id<"threads"> | undefined) {
  return useQuery(api.runs.list, threadId ? { threadId } : "skip");
}

/** Get user settings. */
export function useSettings(userId: Id<"users"> | undefined) {
  return useQuery(api.settings.get, userId ? { userId } : "skip");
}

// ---------------------------------------------------------------------------
// Mutation hooks
// ---------------------------------------------------------------------------

/** Create a new workspace. */
export function useCreateWorkspace() {
  return useMutation(api.workspaces.create);
}

/** Update workspace fields. */
export function useUpdateWorkspace() {
  return useMutation(api.workspaces.update);
}

/** Create a new thread. */
export function useCreateThread() {
  return useMutation(api.threads.create);
}

/** Update a thread's status. */
export function useUpdateThreadStatus() {
  return useMutation(api.threads.updateStatus);
}

/** Append an event to a thread. */
export function useAppendEvent() {
  return useMutation(api.events.append);
}

/** Create a task. */
export function useCreateTask() {
  return useMutation(api.tasks.create);
}

/** Update a task. */
export function useUpdateTask() {
  return useMutation(api.tasks.update);
}

/** Start a run. */
export function useStartRun() {
  return useMutation(api.runs.start);
}

/** Complete a run. */
export function useCompleteRun() {
  return useMutation(api.runs.complete);
}

/** Update user settings. */
export function useUpdateSettings() {
  return useMutation(api.settings.update);
}

// ---------------------------------------------------------------------------
// Phase 6: Multi-User & Real-Time Collaboration hooks
// ---------------------------------------------------------------------------

/** List all members of a workspace (with user profiles). */
export function useMembers(workspaceId: Id<"workspaces"> | undefined) {
  return useQuery(api.members.list, workspaceId ? { workspaceId } : "skip");
}

/** Get the current user's role in a workspace. */
export function useMemberRole(
  workspaceId: Id<"workspaces"> | undefined,
  userId: Id<"users"> | undefined,
) {
  return useQuery(
    api.members.getRole,
    workspaceId && userId ? { workspaceId, userId } : "skip",
  );
}

/** List presence entries for a thread (filters stale automatically). */
export function usePresence(threadId: Id<"threads"> | undefined) {
  return useQuery(api.presence.list, threadId ? { threadId } : "skip");
}

/**
 * Returns a heartbeat function to call periodically for presence tracking.
 * Call the returned function every ~10 seconds while the user is active.
 */
export function usePresenceHeartbeat() {
  return useMutation(api.presence.heartbeat);
}

/** Remove presence when leaving a thread. */
export function usePresenceLeave() {
  return useMutation(api.presence.leave);
}

/** List pending approvals for a workspace. */
export function usePendingApprovals(workspaceId: Id<"workspaces"> | undefined) {
  return useQuery(
    api.approvals.listPending,
    workspaceId ? { workspaceId } : "skip",
  );
}

/** Resolve (approve/reject) an approval request. */
export function useResolveApproval() {
  return useMutation(api.approvals.resolve);
}

/** Create an approval request. */
export function useRequestApproval() {
  return useMutation(api.approvals.request);
}

/** List active (unresolved) conflicts for a workspace. */
export function useActiveConflicts(workspaceId: Id<"workspaces"> | undefined) {
  return useQuery(
    api.conflicts.listActive,
    workspaceId ? { workspaceId } : "skip",
  );
}

/** Resolve a conflict. */
export function useResolveConflict() {
  return useMutation(api.conflicts.resolve);
}

/** Invite a user to a workspace. */
export function useInviteMember() {
  return useMutation(api.members.invite);
}

/** Update a member's role. */
export function useUpdateMemberRole() {
  return useMutation(api.members.updateRole);
}

/** Remove a member from a workspace. */
export function useRemoveMember() {
  return useMutation(api.members.remove);
}

/** Leave a workspace. */
export function useLeaveWorkspace() {
  return useMutation(api.members.leave);
}

// ---------------------------------------------------------------------------
// Phase 7: Profiles, Projects & Discovery hooks
// ---------------------------------------------------------------------------

// ── Projects ──────────────────────────────────────────────────

/** Get a single project by ID. */
export function useProject(id: Id<"projects"> | undefined) {
  return useQuery(api.projects.get, id ? { id } : "skip");
}

/** List projects owned by the current user. */
export function useMyProjects(userId: Id<"users"> | undefined) {
  return useQuery(
    api.projects.listByOwner,
    userId ? { ownerId: userId } : "skip",
  );
}

/** List public projects (optionally filtered by tag). */
export function usePublicProjects(tag?: string) {
  return useQuery(api.projects.listPublic, { tag });
}

/** Create a new project. */
export function useCreateProject() {
  return useMutation(api.projects.create);
}

/** Update a project. */
export function useUpdateProject() {
  return useMutation(api.projects.update);
}

/** Delete a project. */
export function useRemoveProject() {
  return useMutation(api.projects.remove);
}

/** Add a workspace to a project. */
export function useAddWorkspaceToProject() {
  return useMutation(api.projects.addWorkspace);
}

/** Remove a workspace from a project. */
export function useRemoveWorkspaceFromProject() {
  return useMutation(api.projects.removeWorkspace);
}

// ── Stars ─────────────────────────────────────────────────────

/** Get star count for a target. */
export function useStarCount(
  targetType: "project" | "harness" | "pipeline" | "soul" | undefined,
  targetId: string | undefined,
) {
  return useQuery(
    api.stars.count,
    targetType && targetId ? { targetType, targetId } : "skip",
  );
}

/** Check if the current user has starred a target. */
export function useIsStarred(
  userId: Id<"users"> | undefined,
  targetType: "project" | "harness" | "pipeline" | "soul" | undefined,
  targetId: string | undefined,
) {
  return useQuery(
    api.stars.isStarred,
    userId && targetType && targetId
      ? { userId, targetType, targetId }
      : "skip",
  );
}

/** Toggle star/unstar on a target. */
export function useToggleStar() {
  return useMutation(api.stars.toggle);
}

/** List a user's starred items. */
export function useUserStars(userId: Id<"users"> | undefined) {
  return useQuery(api.stars.listByUser, userId ? { userId } : "skip");
}

// ── Profiles ──────────────────────────────────────────────────

/** Get a user's profile by ID. */
export function useProfile(userId: Id<"users"> | undefined) {
  return useQuery(api.profiles.get, userId ? { userId } : "skip");
}

/** Get a user's profile by handle. */
export function useProfileByHandle(handle: string | undefined) {
  return useQuery(
    api.profiles.getByHandle,
    handle ? { handle } : "skip",
  );
}

/** Search users by handle or display name. */
export function useSearchUsers(queryStr: string | undefined) {
  return useQuery(
    api.profiles.search,
    queryStr ? { query: queryStr } : "skip",
  );
}

/** Get a user's public artifacts. */
export function usePublicArtifacts(userId: Id<"users"> | undefined) {
  return useQuery(
    api.profiles.getPublicArtifacts,
    userId ? { userId } : "skip",
  );
}

/** Update own profile. */
export function useUpdateProfile() {
  return useMutation(api.profiles.update);
}

// ── Discovery ─────────────────────────────────────────────────

/** Get trending public projects and harnesses. */
export function useTrending(limit?: number) {
  return useQuery(api.discovery.trending, { limit });
}

/** Get recently published public artifacts. */
export function useRecentPublic(limit?: number) {
  return useQuery(api.discovery.recent, { limit });
}

/** Full-text search across public artifacts. */
export function useDiscoverySearch(queryStr: string | undefined) {
  return useQuery(
    api.discovery.search,
    queryStr ? { query: queryStr } : "skip",
  );
}

/** Browse public projects by tag. */
export function useDiscoveryByTag(tag: string | undefined) {
  return useQuery(api.discovery.byTag, tag ? { tag } : "skip");
}

// ---------------------------------------------------------------------------
// Phase 5: Pipeline Overhaul hooks
// ---------------------------------------------------------------------------

// ── Pipeline Queries ──────────────────────────────────────────

/** Get a single pipeline by ID. */
export function usePipeline(id: Id<"pipelines"> | undefined) {
  return useQuery(api.pipelines.get, id ? { id } : "skip");
}

/** List pipelines in a workspace. */
export function usePipelines(workspaceId: Id<"workspaces"> | undefined) {
  return useQuery(
    api.pipelines.list,
    workspaceId ? { workspaceId } : "skip",
  );
}

/** List all public pipelines. */
export function usePublicPipelines() {
  return useQuery(api.pipelines.listPublic, {});
}

// ── Pipeline Mutations ────────────────────────────────────────

/** Create a new pipeline. */
export function useCreatePipeline() {
  return useMutation(api.pipelines.create);
}

/** Update an existing pipeline. */
export function useUpdatePipeline() {
  return useMutation(api.pipelines.update);
}

/** Delete a pipeline. */
export function useRemovePipeline() {
  return useMutation(api.pipelines.remove);
}

/** Clone a pipeline (creates an independent copy). */
export function useClonePipeline() {
  return useMutation(api.pipelines.clone);
}

// ── Pipeline Execution Queries ────────────────────────────────

/** Get a single pipeline execution by ID. */
export function usePipelineExecution(id: Id<"pipelineExecutions"> | undefined) {
  return useQuery(
    api.pipelines.getExecution,
    id ? { id } : "skip",
  );
}

/** List executions for a pipeline. */
export function usePipelineExecutions(pipelineId: Id<"pipelines"> | undefined) {
  return useQuery(
    api.pipelines.listExecutions,
    pipelineId ? { pipelineId } : "skip",
  );
}

// ── Pipeline Execution Mutations ──────────────────────────────

/** Create a new pipeline execution record. */
export function useCreatePipelineExecution() {
  return useMutation(api.pipelines.createExecution);
}

/** Update pipeline execution state. */
export function useUpdatePipelineExecution() {
  return useMutation(api.pipelines.updateExecution);
}

// ---------------------------------------------------------------------------
// Harness hooks
// ---------------------------------------------------------------------------

/** Get a single harness by ID. */
export function useHarness(id: Id<"harnesses"> | undefined) {
  return useQuery(api.harnesses.get, id ? { id } : "skip");
}

/** List all harnesses in a workspace. */
export function useHarnesses(workspaceId: Id<"workspaces"> | undefined) {
  return useQuery(
    api.harnesses.listByWorkspace,
    workspaceId ? { workspaceId } : "skip",
  );
}

/** List public harnesses. */
export function usePublicHarnesses() {
  return useQuery(api.harnesses.listPublic, {});
}

/** Create a new harness. */
export function useCreateHarness() {
  return useMutation(api.harnesses.create);
}

/** Update a harness. */
export function useUpdateHarness() {
  return useMutation(api.harnesses.update);
}

/** Delete a harness. */
export function useRemoveHarness() {
  return useMutation(api.harnesses.remove);
}

/** Clone a harness. */
export function useCloneHarness() {
  return useMutation(api.harnesses.clone);
}

// ---------------------------------------------------------------------------
// Soul hooks
// ---------------------------------------------------------------------------

/** Get a single soul document by ID. */
export function useSoul(id: Id<"souls"> | undefined) {
  return useQuery(api.souls.get, id ? { id } : "skip");
}

/** Get soul for a harness. */
export function useSoulByHarness(harnessId: Id<"harnesses"> | undefined) {
  return useQuery(
    api.souls.getByHarness,
    harnessId ? { harnessId } : "skip",
  );
}

/** List soul documents in a workspace. */
export function useSouls(workspaceId: Id<"workspaces"> | undefined) {
  return useQuery(
    api.souls.listByWorkspace,
    workspaceId ? { workspaceId } : "skip",
  );
}

/** List public souls. */
export function usePublicSouls() {
  return useQuery(api.souls.listPublic, {});
}

/** Create a new soul document. */
export function useCreateSoul() {
  return useMutation(api.souls.create);
}

/** Update a soul document. */
export function useUpdateSoul() {
  return useMutation(api.souls.update);
}

/** Update a single soul section. */
export function useUpdateSoulSection() {
  return useMutation(api.souls.updateSection);
}

/** Append to soul memory. */
export function useAppendSoulMemory() {
  return useMutation(api.souls.appendMemory);
}

/** Clear soul memory. */
export function useClearSoulMemory() {
  return useMutation(api.souls.clearMemory);
}

/** Delete a soul document. */
export function useRemoveSoul() {
  return useMutation(api.souls.remove);
}

// ---------------------------------------------------------------------------
// Custom Tools hooks
// ---------------------------------------------------------------------------

/** List custom tools in a workspace. */
export function useCustomTools(workspaceId: Id<"workspaces"> | undefined) {
  return useQuery(
    api.customTools.list,
    workspaceId ? { workspaceId } : "skip",
  );
}

/** Create a custom tool. */
export function useCreateCustomTool() {
  return useMutation(api.customTools.create);
}

/** Update a custom tool. */
export function useUpdateCustomTool() {
  return useMutation(api.customTools.update);
}

/** Delete a custom tool. */
export function useRemoveCustomTool() {
  return useMutation(api.customTools.remove);
}

// ---------------------------------------------------------------------------
// MCP Server hooks
// ---------------------------------------------------------------------------

/** List MCP servers in a workspace. */
export function useMcpServers(workspaceId: Id<"workspaces"> | undefined) {
  return useQuery(
    api.mcpServers.list,
    workspaceId ? { workspaceId } : "skip",
  );
}

/** Create an MCP server config. */
export function useCreateMcpServer() {
  return useMutation(api.mcpServers.create);
}

/** Update an MCP server config. */
export function useUpdateMcpServer() {
  return useMutation(api.mcpServers.update);
}

/** Delete an MCP server config. */
export function useRemoveMcpServer() {
  return useMutation(api.mcpServers.remove);
}
