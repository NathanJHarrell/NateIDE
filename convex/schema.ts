import { defineSchema, defineTable } from "convex/server";
import { authTables } from "@convex-dev/auth/server";
import { v } from "convex/values";

export default defineSchema({
  ...authTables,

  users: defineTable({
    handle: v.string(),
    displayName: v.string(),
    avatarUrl: v.optional(v.string()),
    bio: v.optional(v.string()),
    profileVisibility: v.union(
      v.literal("private"),
      v.literal("workspace"),
      v.literal("public"),
    ),
  }),

  workspaces: defineTable({
    name: v.string(),
    rootPath: v.string(),
    visibility: v.union(
      v.literal("private"),
      v.literal("workspace"),
      v.literal("public"),
    ),
    ownerId: v.id("users"),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_owner", ["ownerId"]),

  members: defineTable({
    workspaceId: v.id("workspaces"),
    userId: v.id("users"),
    role: v.union(
      v.literal("owner"),
      v.literal("admin"),
      v.literal("editor"),
      v.literal("viewer"),
    ),
    joinedAt: v.number(),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_user", ["userId"])
    .index("by_workspace_user", ["workspaceId", "userId"]),

  threads: defineTable({
    workspaceId: v.id("workspaces"),
    title: v.string(),
    status: v.union(
      v.literal("idle"),
      v.literal("active"),
      v.literal("blocked"),
      v.literal("completed"),
    ),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_workspace", ["workspaceId"]),

  events: defineTable({
    threadId: v.id("threads"),
    seq: v.number(),
    actor: v.object({
      type: v.string(),
      id: v.string(),
    }),
    eventType: v.string(),
    payload: v.any(),
    ts: v.number(),
  })
    .index("by_thread", ["threadId"])
    .index("by_thread_seq", ["threadId", "seq"]),

  tasks: defineTable({
    threadId: v.id("threads"),
    title: v.string(),
    goal: v.string(),
    status: v.union(
      v.literal("open"),
      v.literal("assigned"),
      v.literal("in_progress"),
      v.literal("blocked"),
      v.literal("completed"),
      v.literal("failed"),
    ),
    createdBy: v.object({
      type: v.string(),
      id: v.string(),
    }),
    assigneeAgentId: v.optional(v.string()),
    fileScope: v.array(v.string()),
    terminalScope: v.array(v.string()),
    dependsOnTaskIds: v.array(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_thread", ["threadId"]),

  runs: defineTable({
    threadId: v.id("threads"),
    taskId: v.id("tasks"),
    agentId: v.string(),
    status: v.union(
      v.literal("queued"),
      v.literal("starting"),
      v.literal("streaming"),
      v.literal("waiting"),
      v.literal("completed"),
      v.literal("failed"),
      v.literal("canceled"),
    ),
    startedAt: v.optional(v.number()),
    finishedAt: v.optional(v.number()),
    summary: v.optional(v.string()),
    tokenUsage: v.optional(
      v.object({
        inputTokens: v.number(),
        outputTokens: v.number(),
        totalTokens: v.number(),
        estimatedCostUsd: v.optional(v.number()),
      }),
    ),
  })
    .index("by_thread", ["threadId"])
    .index("by_task", ["taskId"]),

  settings: defineTable({
    userId: v.id("users"),
    apiKeys: v.object({
      anthropic: v.optional(v.string()),
      openai: v.optional(v.string()),
      google: v.optional(v.string()),
      openrouter: v.optional(v.string()),
    }),
    preferences: v.any(),
  }).index("by_user", ["userId"]),

  // ── Phase 6: Multi-User & Real-Time Collaboration ──────────────────

  /** Teams for team-owned workspaces */
  teams: defineTable({
    name: v.string(),
    createdBy: v.id("users"),
  }).index("by_creator", ["createdBy"]),

  /** Team membership */
  teamMembers: defineTable({
    teamId: v.id("teams"),
    userId: v.id("users"),
    role: v.union(
      v.literal("owner"),
      v.literal("admin"),
      v.literal("member"),
    ),
  })
    .index("by_team", ["teamId"])
    .index("by_user", ["userId"]),

  /** Workspace invitations */
  invitations: defineTable({
    workspaceId: v.id("workspaces"),
    invitedEmail: v.string(),
    invitedBy: v.id("users"),
    role: v.union(
      v.literal("admin"),
      v.literal("editor"),
      v.literal("viewer"),
    ),
    status: v.union(
      v.literal("pending"),
      v.literal("accepted"),
      v.literal("declined"),
    ),
    expiresAt: v.number(),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_email", ["invitedEmail"]),

  /** Real-time presence tracking */
  presence: defineTable({
    threadId: v.id("threads"),
    actorType: v.union(v.literal("user"), v.literal("agent")),
    actorId: v.string(),
    status: v.union(
      v.literal("active"),
      v.literal("idle"),
      v.literal("typing"),
    ),
    lastSeen: v.number(),
  }).index("by_thread", ["threadId"]),

  /** Multi-user approval queue */
  approvals: defineTable({
    workspaceId: v.id("workspaces"),
    threadId: v.id("threads"),
    requestedBy: v.object({
      type: v.string(),
      id: v.string(),
    }),
    type: v.string(),
    payload: v.any(),
    status: v.union(
      v.literal("pending"),
      v.literal("approved"),
      v.literal("rejected"),
    ),
    resolvedBy: v.optional(v.string()),
    resolvedAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_workspace_status", ["workspaceId", "status"])
    .index("by_thread", ["threadId"]),

  /** Conflict detection and resolution */
  conflicts: defineTable({
    workspaceId: v.id("workspaces"),
    threadId: v.optional(v.id("threads")),
    filePath: v.optional(v.string()),
    type: v.union(
      v.literal("file_edit"),
      v.literal("instruction"),
      v.literal("resource"),
    ),
    involvedUsers: v.array(v.string()),
    status: v.union(v.literal("active"), v.literal("resolved")),
    resolution: v.optional(v.string()),
    description: v.optional(v.string()),
    createdAt: v.number(),
    resolvedAt: v.optional(v.number()),
  }).index("by_workspace_status", ["workspaceId", "status"]),

  /** File locks for conflict detection */
  fileLocks: defineTable({
    workspaceId: v.id("workspaces"),
    filePath: v.string(),
    heldByAgentId: v.string(),
    heldByRunId: v.string(),
    acquiredAt: v.number(),
  }).index("by_workspace_file", ["workspaceId", "filePath"]),

  // ── Phase 7: Profiles, Projects & Discovery ─────────────────────

  /** Projects — top-level artifact grouping workspaces */
  projects: defineTable({
    name: v.string(),
    description: v.string(),
    visibility: v.union(
      v.literal("private"),
      v.literal("workspace"),
      v.literal("public"),
    ),
    ownerId: v.id("users"),
    workspaceIds: v.array(v.id("workspaces")),
    tags: v.array(v.string()),
    readme: v.optional(v.string()),
    starCount: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_owner", ["ownerId"])
    .index("by_visibility", ["visibility"])
    .searchIndex("search_projects", {
      searchField: "name",
      filterFields: ["visibility"],
    }),

  /** Stars on public artifacts */
  stars: defineTable({
    userId: v.id("users"),
    targetType: v.union(
      v.literal("project"),
      v.literal("harness"),
      v.literal("pipeline"),
      v.literal("soul"),
    ),
    targetId: v.string(),
    createdAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_target", ["targetType", "targetId"])
    .index("by_user_target", ["userId", "targetType", "targetId"]),

  /** Clone/import tracking */
  clones: defineTable({
    sourceType: v.union(
      v.literal("harness"),
      v.literal("pipeline"),
      v.literal("soul"),
    ),
    sourceId: v.string(),
    clonedById: v.id("users"),
    clonedAt: v.number(),
  })
    .index("by_source", ["sourceType", "sourceId"])
    .index("by_user", ["clonedById"]),

  // ── Phase 4: Custom Tools & MCP ───────────────────────────────

  /** User-created custom tools (command, HTTP, or MCP-backed) */
  customTools: defineTable({
    name: v.string(),
    description: v.string(),
    type: v.union(
      v.literal("command"),
      v.literal("http"),
      v.literal("mcp"),
    ),
    /** Type-specific configuration (shape varies by type) */
    config: v.any(),
    /** JSON Schema describing the tool's input parameters */
    inputSchema: v.any(),
    /** How tool output should be interpreted */
    outputFormat: v.union(
      v.literal("json"),
      v.literal("text"),
      v.literal("stream"),
    ),
    /** If true, skips approval in safe mode */
    isReadOnly: v.boolean(),
    workspaceId: v.optional(v.id("workspaces")),
    visibility: v.union(
      v.literal("private"),
      v.literal("workspace"),
      v.literal("public"),
    ),
    createdBy: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_creator", ["createdBy"])
    .index("by_visibility", ["visibility"]),

  /** MCP server configurations */
  mcpServers: defineTable({
    name: v.string(),
    transport: v.union(
      v.literal("stdio"),
      v.literal("sse"),
      v.literal("streamable-http"),
    ),
    /** For stdio transport */
    command: v.optional(v.string()),
    args: v.optional(v.array(v.string())),
    env: v.optional(v.any()),
    /** For HTTP transports (SSE / streamable-http) */
    url: v.optional(v.string()),
    headers: v.optional(v.any()),
    workspaceId: v.optional(v.id("workspaces")),
    visibility: v.union(
      v.literal("private"),
      v.literal("workspace"),
      v.literal("public"),
    ),
    createdBy: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_creator", ["createdBy"]),

  // ── Phase 5: Pipeline Overhaul ────────────────────────────────────

  /** Pipeline definitions — DAG-based agent/tool orchestration */
  pipelines: defineTable({
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
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_creator", ["createdBy"])
    .index("by_visibility", ["visibility"]),

  /** Pipeline execution state — tracks running/completed pipeline runs */
  pipelineExecutions: defineTable({
    pipelineId: v.id("pipelines"),
    status: v.string(),
    currentNodeIds: v.array(v.string()),
    completedNodeIds: v.array(v.string()),
    failedNodeIds: v.array(v.string()),
    nodeOutputs: v.any(),
    nodeErrors: v.any(),
    variables: v.optional(v.any()),
    triggeredBy: v.string(),
    startedAt: v.number(),
    finishedAt: v.optional(v.number()),
  })
    .index("by_pipeline", ["pipelineId"])
    .index("by_status", ["status"]),

  // ── Phase 3: Soul System ──────────────────────────────────────────

  /** Soul documents — SOUL/STYLE/SKILL/MEMORY markdown per harness or standalone */
  souls: defineTable({
    harnessId: v.optional(v.id("harnesses")),
    workspaceId: v.optional(v.id("workspaces")),
    name: v.string(),
    soul: v.object({
      content: v.string(),
      metadata: v.optional(v.any()),
    }),
    style: v.object({
      content: v.string(),
      metadata: v.optional(v.any()),
    }),
    skill: v.object({
      content: v.string(),
      metadata: v.optional(v.any()),
    }),
    memory: v.object({
      content: v.string(),
      metadata: v.optional(v.any()),
    }),
    visibility: v.union(
      v.literal("private"),
      v.literal("workspace"),
      v.literal("public"),
    ),
    createdBy: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_harness", ["harnessId"])
    .index("by_workspace", ["workspaceId"])
    .index("by_creator", ["createdBy"])
    .index("by_visibility", ["visibility"]),

  // ── Phase 2: Harness System ────────────────────────────────────

  /** Agent harness configurations */
  harnesses: defineTable({
    name: v.string(),
    description: v.string(),

    /** Model configuration */
    provider: v.string(),
    model: v.string(),
    fallbacks: v.optional(
      v.array(
        v.object({
          provider: v.string(),
          model: v.string(),
        }),
      ),
    ),

    /** Tool grants — array of discriminated grant objects */
    toolGrants: v.array(v.any()),

    /** Approval policy: "safe" or "yolo" */
    approvalPolicy: v.union(v.literal("safe"), v.literal("yolo")),

    /** Soul documents (Phase 3 expands this) */
    soul: v.optional(
      v.object({
        soul: v.string(),
        style: v.string(),
        skill: v.string(),
        memory: v.string(),
      }),
    ),

    /** Execution policy */
    maxIterations: v.number(),
    maxTokensPerTurn: v.number(),
    contextStrategy: v.union(
      v.literal("full"),
      v.literal("windowed"),
      v.literal("summary"),
    ),

    /** Display */
    color: v.string(),
    icon: v.optional(v.string()),

    /** Visibility */
    visibility: v.union(
      v.literal("private"),
      v.literal("workspace"),
      v.literal("public"),
    ),

    /** Ownership */
    createdBy: v.string(),
    workspaceId: v.optional(v.id("workspaces")),
    isBuiltIn: v.optional(v.boolean()),

    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_creator", ["createdBy"])
    .index("by_visibility", ["visibility"]),
});
