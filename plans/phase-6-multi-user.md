# Phase 6: Multi-User & Real-Time Collaboration

## Goal

Add workspace membership, real-time presence, shared threads where multiple
users interact with agents simultaneously, multi-user approval queues, and
conflict detection with execution halting.

## Depends On

- Phase 1 (Convex Foundation) — auth, real-time subscriptions, user identity

## Current State

- Single user assumed throughout the system
- No auth (Phase 1 adds it)
- No presence
- No concept of workspace membership
- Approval queue is single-user
- No conflict detection

## Target State

- Workspaces have members with roles (owner, admin, editor, viewer)
- Real-time presence shows who's online and what they're looking at
- Multiple users can send messages in the same thread simultaneously
- Agents see and address all users by name
- Any editor can approve/deny tool calls (first responder wins)
- Contradictory instructions and file conflicts halt agent execution
- Users resolve conflicts in the thread, then execution resumes
- Workspace ownership is flexible: personal or team-owned

## Steps

### 6.1 Workspace Membership

#### Roles and permissions

| Role | Invite | Configure agents | Send messages | Approve tools | Run pipelines | View |
|------|--------|-----------------|---------------|---------------|---------------|------|
| Owner | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Admin | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Editor | ✗ | ✗ | ✓ | ✓ | ✓ | ✓ |
| Viewer | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ |

#### Ownership models

Personal workspace:
- Created by one user who is the owner
- Owner invites others and assigns roles
- Owner can transfer ownership

Team workspace:
- Created by a team (group of users)
- Multiple admins possible
- Members are managed at the team level
- Team can own multiple workspaces

Users choose the ownership model when creating a workspace.

#### Convex schema additions

```ts
teams: defineTable({
  name: v.string(),
  createdBy: v.id("users"),
}).index("by_creator", ["createdBy"]),

teamMembers: defineTable({
  teamId: v.id("teams"),
  userId: v.id("users"),
  role: v.union(v.literal("owner"), v.literal("admin"), v.literal("member")),
}).index("by_team", ["teamId"])
  .index("by_user", ["userId"]),

// Update workspaces table
workspaces: defineTable({
  // ... existing fields
  ownership: v.union(
    v.object({ type: v.literal("personal"), ownerId: v.id("users") }),
    v.object({ type: v.literal("team"), teamId: v.id("teams") }),
  ),
}),

workspaceMembers: defineTable({
  workspaceId: v.id("workspaces"),
  userId: v.id("users"),
  role: v.union(
    v.literal("owner"),
    v.literal("admin"),
    v.literal("editor"),
    v.literal("viewer"),
  ),
  invitedBy: v.id("users"),
  joinedAt: v.number(),
}).index("by_workspace", ["workspaceId"])
  .index("by_user", ["userId"]),

invitations: defineTable({
  workspaceId: v.id("workspaces"),
  invitedEmail: v.string(),
  invitedBy: v.id("users"),
  role: v.string(),
  status: v.union(v.literal("pending"), v.literal("accepted"), v.literal("declined")),
  expiresAt: v.number(),
}).index("by_workspace", ["workspaceId"])
  .index("by_email", ["invitedEmail"]),
```

#### Authorization middleware

Every Convex function that accesses workspace data must check membership:

```ts
async function assertWorkspaceAccess(
  ctx: QueryCtx | MutationCtx,
  workspaceId: Id<"workspaces">,
  requiredRole: "viewer" | "editor" | "admin" | "owner",
): Promise<Id<"users">>
```

This checks that the authenticated user has the required role for the
workspace. Used in every query and mutation.

### 6.2 Real-Time Presence

Presence uses a Convex table with short-lived documents:

```ts
presence: defineTable({
  workspaceId: v.id("workspaces"),
  userId: v.id("users"),
  threadId: v.optional(v.id("threads")),
  location: v.optional(v.object({
    type: v.string(),     // "thread", "file", "pipeline", "settings"
    target: v.string(),   // thread ID, file path, etc.
  })),
  cursor: v.optional(v.object({
    line: v.number(),
    column: v.number(),
    file: v.string(),
  })),
  status: v.union(
    v.literal("active"),
    v.literal("idle"),
    v.literal("typing"),
  ),
  lastSeen: v.number(),
}).index("by_workspace", ["workspaceId"]),
```

The desktop app updates presence every 10 seconds (heartbeat) and on
meaningful actions (navigating to a thread, starting to type, opening a file).

Stale presence (lastSeen > 60 seconds) is treated as offline. A scheduled
Convex function cleans up stale presence records periodically.

#### Presence UI

- Workspace sidebar shows online members with colored dots
- Thread header shows who's viewing this thread
- Typing indicator: "Sarah is typing..." when another user's status is
  "typing" in the same thread
- File presence: show user avatars next to files they have open (later,
  cursor positions in Monaco)

### 6.3 Multi-User Threads

Multiple users sending messages in the same thread:

#### Message attribution

Every thread message event includes the user who sent it:

```ts
type ThreadMessageCreated = EventEnvelope<
  "thread.message.created",
  {
    messageId: string
    content: string
    format: "markdown" | "plain"
    userId: string         // who sent it
    displayName: string    // for rendering
  }
>
```

#### Agent context

When building the system prompt or message context for agents, include user
identity:

```
[Nate]: Let's add login with GitHub
[Sarah]: We should also support email/password
```

Agents address users by name in responses. The controller is aware that
multiple humans are participating and can ask specific users for clarification.

#### Permission checks

- Only editors and above can send messages
- Viewers can read the thread but cannot send messages
- The UI hides the message input for viewers

### 6.4 Multi-User Approval Queue

The approval queue becomes multi-user aware:

```ts
approvalQueue: defineTable({
  workspaceId: v.id("workspaces"),
  threadId: v.id("threads"),
  agentId: v.string(),
  runId: v.optional(v.string()),
  toolName: v.string(),
  toolParameters: v.any(),
  status: v.union(
    v.literal("pending"),
    v.literal("approved"),
    v.literal("denied"),
  ),
  resolvedBy: v.optional(v.id("users")),
  resolvedAt: v.optional(v.number()),
  createdAt: v.number(),
}).index("by_workspace_pending", ["workspaceId", "status"]),
```

Behaviors:
- Any editor in the workspace can approve or deny
- First responder wins — once one user responds, the request is resolved
- Other users see that it was resolved and by whom
- "Allow & remember" adds the pattern to the harness's allowlist (requires
  admin role)
- If YOLO mode is on for the harness, approvals are skipped entirely
- Timeout: 5 minutes with no response → auto-deny

#### Approval UI

All editors in the workspace see pending approval cards:

```
┌─ Codex wants to run a command ───────────┐
│                                          │
│  $ npm install express                   │
│                                          │
│  [Allow]  [Allow & remember]  [Deny]     │
│                                          │
│  Waiting... (Nate, Sarah can approve)    │
└──────────────────────────────────────────┘
```

After resolution:

```
┌─ Codex ran a command ────────────────────┐
│                                          │
│  $ npm install express                   │
│  ✓ Approved by Nate                      │
└──────────────────────────────────────────┘
```

### 6.5 Conflict Detection

Two types of conflicts:

#### Contradictory instructions

When multiple users send messages to the same thread, the controller (or a
dedicated conflict detection step) checks for contradictions.

Implementation:
1. After each user message, if there are recent messages from other users,
   run a quick LLM check: "Do these messages contain contradictory
   instructions?"
2. If yes, emit a `conflict.detected` event
3. Pause all agent execution in the thread
4. Show a conflict notification to all users

```ts
type ConflictDetected = EventEnvelope<
  "conflict.detected",
  {
    conflictId: string
    type: "contradictory_instructions" | "file_lock"
    description: string
    involvedUsers: string[]        // user IDs
    involvedMessages?: string[]    // message IDs
    involvedFiles?: string[]       // file paths
  }
>

type ConflictResolved = EventEnvelope<
  "conflict.resolved",
  {
    conflictId: string
    resolvedBy: string             // userId
    resolution: string             // description of how it was resolved
  }
>
```

#### File lock conflicts

When two agents (potentially triggered by different users) try to write the
same file, the ToolExecutor detects the conflict:

1. Before writing a file, check if another agent has an active write lock
2. If locked, emit `conflict.detected` with type `file_lock`
3. Pause the requesting agent's execution
4. Notify both users
5. Users discuss in the thread and one cancels their agent's operation or
   they agree on a resolution

File locks are lightweight — stored in a Convex table, scoped to the
workspace, and auto-released when a run completes or is canceled.

```ts
fileLocks: defineTable({
  workspaceId: v.id("workspaces"),
  filePath: v.string(),
  heldByAgentId: v.string(),
  heldByRunId: v.string(),
  acquiredAt: v.number(),
}).index("by_workspace_file", ["workspaceId", "filePath"]),
```

#### Conflict resolution flow

1. Conflict detected → toast notification to all workspace members
2. Agent execution paused (harness awaits resolution)
3. Users discuss in the thread
4. Any editor clicks "Resolve conflict" and provides a resolution message
5. `conflict.resolved` event emitted
6. Agent execution resumes (or the user cancels the conflicting operation)

Conflict UI:

```
┌─ ⚠ Conflict ────────────────────────────┐
│                                          │
│  Contradictory instructions detected     │
│                                          │
│  Nate: "Use PostgreSQL"                  │
│  Sarah: "Use SQLite"                     │
│                                          │
│  Agent execution paused.                 │
│  Discuss in the thread and resolve.      │
│                                          │
│  [Resolve: Use Nate's suggestion]        │
│  [Resolve: Use Sarah's suggestion]       │
│  [Resolve with custom message...]        │
│                                          │
└──────────────────────────────────────────┘
```

### 6.6 Invitation Flow

Users invite others to workspaces:

1. Owner/admin enters email address and selects role
2. System creates an invitation record
3. If the email matches an existing user, they see the invitation in their
   workspace list
4. If not, send an email invitation (via Convex's email action or a
   transactional email service)
5. Invited user accepts or declines
6. On accept, they become a workspace member with the assigned role

Join-by-link: generate a shareable link that auto-adds the user as an editor
(configurable role). Links can be single-use or multi-use with an expiry.

### 6.7 Workspace Settings UI

Add a workspace settings panel:

```
┌─ Workspace Settings ─────────────────────┐
│                                          │
│  Name: [nateide            ]         │
│  Visibility: ○ Private  ○ Public         │
│  Ownership: ◉ Personal  ○ Team           │
│                                          │
│  ── Members ─────────────────────────── │
│                                          │
│  👤 Nate        Owner    [─]             │
│  👤 Sarah       Editor   [Role ▾] [✕]   │
│  👤 Mike        Viewer   [Role ▾] [✕]   │
│                                          │
│  [Invite member]                         │
│  [Generate invite link]                  │
│                                          │
│  ── Danger Zone ─────────────────────── │
│                                          │
│  [Transfer ownership]                    │
│  [Delete workspace]                      │
│                                          │
└──────────────────────────────────────────┘
```

## New Events

```ts
"presence.joined"           — user came online in workspace
"presence.left"             — user went offline
"presence.updated"          — user changed location/status
"conflict.detected"         — contradictory instructions or file lock
"conflict.resolved"         — conflict resolved by a user
"member.invited"            — invitation sent
"member.joined"             — user accepted invitation
"member.left"               — user left or was removed
"member.role_changed"       — user's role was changed
```

## Testing Strategy

- Auth test: sign up two users, one creates workspace, invites other, verify
  role-based access
- Presence test: two clients connected, verify presence updates are received
  in real time
- Multi-user thread test: two users send messages, agent sees both, responds
  addressing both by name
- Approval test: agent requests approval, both users see it, first approver
  wins, other sees resolution
- Conflict test (instructions): two users send contradictory messages, verify
  execution pauses and conflict notification appears
- Conflict test (file lock): two agents try to write same file, verify
  conflict detection and resolution flow
- Invitation test: invite by email, accept, verify membership and role
- Permission test: viewer tries to send message → blocked, editor sends →
  allowed

## Definition of Done

- [ ] Workspace membership with roles (owner, admin, editor, viewer)
- [ ] Team ownership model alongside personal ownership
- [ ] Authorization checks on all Convex functions
- [ ] Real-time presence (online status, location, typing indicator)
- [ ] Multi-user threads (messages attributed to users, agents address by name)
- [ ] Multi-user approval queue (first responder wins)
- [ ] Conflict detection for contradictory instructions
- [ ] Conflict detection for file locks
- [ ] Conflict resolution flow (pause → discuss → resolve → resume)
- [ ] Invitation flow (email + link)
- [ ] Workspace settings UI with member management
- [ ] Presence UI (online indicators, typing indicators)
