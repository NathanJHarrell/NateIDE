# Phase 7: Profiles, Projects & Discovery

## Goal

Add user profiles, project pages, public artifact browsing, stars, cloning,
and the community discovery surface. This is the social layer that makes the
platform feel like an Agentic GitHub.

## Depends On

- Phase 6 (Multi-User) — user identity, workspace membership, teams

## Current State

- No user profiles
- No project concept (workspaces exist but aren't social objects)
- No public browsing or discovery
- No starring or cloning
- All artifacts are local/private

## Target State

- Every user has a profile page (public by default, can be set to private)
- Projects are top-level artifacts that group workspaces
- Public artifacts (projects, harnesses, pipelines, tools, MCP configs)
  appear on user profiles
- Users can star, clone, and import public artifacts
- Project pages show readme, threads, agents, pipelines, and activity
- Discovery surface for browsing public projects and artifacts

## Types

### User Profile

```ts
type UserProfile = {
  userId: string
  handle: string                     // unique, like @nate
  displayName: string
  avatar?: string
  bio?: string
  links: ProfileLink[]
  visibility: "public" | "private"
  joinedAt: string
}

type ProfileLink = {
  label: string                      // "GitHub", "Twitter", "Website"
  url: string
}
```

### Project

```ts
type Project = {
  id: string
  name: string
  description?: string
  readme?: string                    // markdown
  createdBy: string                  // userId
  visibility: Visibility
  tags: string[]
  language?: string                  // primary language

  // Relationships
  workspaceIds: string[]             // a project can span multiple workspaces

  // Derived stats (computed, not stored directly)
  memberCount: number
  agentCount: number
  threadCount: number
  starCount: number
}
```

## Steps

### 7.1 User Profiles

#### Convex schema

```ts
// Extend existing users table or create a profiles table
profiles: defineTable({
  userId: v.id("users"),
  handle: v.string(),
  displayName: v.string(),
  avatar: v.optional(v.string()),
  bio: v.optional(v.string()),
  links: v.array(v.object({
    label: v.string(),
    url: v.string(),
  })),
  visibility: v.union(v.literal("public"), v.literal("private")),
}).index("by_handle", ["handle"])
  .index("by_user", ["userId"]),
```

#### Handle registration

- Users choose a handle during onboarding (after first sign-in)
- Handles are unique, lowercase, alphanumeric + hyphens
- Validated at the Convex mutation level
- Can be changed later (with uniqueness check)

#### Profile page

```
┌─ @nate ────────────────────────────────────┐
│                                            │
│  [avatar]  Nate                            │
│            @nate                           │
│            Building multi-agent IDEs       │
│                                            │
│            🔗 github.com/nate              │
│            🔗 nate.dev                     │
│                                            │
│  [Projects]  [Agents]  [Pipelines]         │
│  [Tools]  [MCP Servers]                    │
│                                            │
│  ── Projects (2) ──────────────────────── │
│  ...                                       │
│                                            │
│  ── Agents (3) ────────────────────────── │
│  ...                                       │
│                                            │
│  ── Pipelines (1) ─────────────────────── │
│  ...                                       │
│                                            │
└────────────────────────────────────────────┘
```

#### Privacy rules

- **Public profile**: anyone can see all sections. Only public artifacts shown.
- **Private profile**: only handle and avatar visible. Everything else hidden.
  Message: "This profile is private."
- Private workspaces and private artifacts NEVER appear on profiles regardless
  of profile visibility.
- Direct links to public artifacts still work even if the creator's profile
  is private. Profile privacy controls discoverability, not access.

### 7.2 Projects

#### Convex schema

```ts
projects: defineTable({
  name: v.string(),
  description: v.optional(v.string()),
  readme: v.optional(v.string()),
  createdBy: v.id("users"),
  visibility: v.union(v.literal("private"), v.literal("workspace"), v.literal("public")),
  tags: v.array(v.string()),
  language: v.optional(v.string()),
  workspaceIds: v.array(v.id("workspaces")),
}).index("by_creator", ["createdBy"])
  .index("by_visibility", ["visibility"]),
```

#### Project page

```
┌─ nateide ──────────────────────────────┐
│                                            │
│  Multi-agent orchestration IDE             │
│  by @nate · Public · ⭐ 42 · 3 members     │
│                                            │
│  [README]  [Threads]  [Agents]             │
│  [Pipelines]  [Tools]  [Activity]          │
│                                            │
│  ── README ────────────────────────────── │
│  (rendered markdown)                       │
│                                            │
│  ── Recent Threads ────────────────────── │
│  🟢 Build auth system        2h ago        │
│  ✅ Add pipeline engine      yesterday     │
│                                            │
│  ── Agents ────────────────────────────── │
│  Claude · Codex · Gemini · Kimi            │
│  + Research Bot (custom)                   │
│                                            │
│  ── Pipelines ─────────────────────────── │
│  Feature Builder (6 nodes)                 │
│                                            │
│  [⭐ Star]  [Clone project]               │
│  [Request to join]                         │
│                                            │
└────────────────────────────────────────────┘
```

Tabs:
- **README**: rendered project readme (editable by admins)
- **Threads**: public threads with status, agents involved, message count
- **Agents**: harnesses used in this project (public ones only)
- **Pipelines**: pipelines in this project (public ones only)
- **Tools**: custom tools in this project (public ones only)
- **Activity**: recent events across all workspaces in the project

### 7.3 Stars

Users can star any public artifact:

```ts
stars: defineTable({
  userId: v.id("users"),
  artifactType: v.union(
    v.literal("project"),
    v.literal("harness"),
    v.literal("pipeline"),
    v.literal("tool"),
    v.literal("mcpServer"),
  ),
  artifactId: v.string(),
  starredAt: v.number(),
}).index("by_user", ["userId"])
  .index("by_artifact", ["artifactType", "artifactId"]),
```

Star counts are computed on read (count query) or cached in a separate
counter table for performance at scale.

### 7.4 Clone and Import

Every public artifact has a clone/import action:

| Artifact | Action | What happens |
|----------|--------|-------------|
| Project | Clone | Creates a new project with copies of all public workspaces, harnesses, pipelines, and tools. Independent copy. |
| Harness | Clone | Copies the harness config (including soul) into the user's workspace. |
| Pipeline | Import | Copies the pipeline definition. Agent nodes reference embedded harness configs. User maps to existing harnesses or creates new ones. |
| Tool | Add | Copies the tool config into the user's workspace. |
| MCP Server | Add | Copies the server config. User provides their own credentials if needed. |

All clones/imports are snapshots. No live linking to the original.

#### Clone flow

1. User clicks [Clone] on a public artifact
2. Dialog: "Clone to which workspace?" with workspace selector
3. Clone is created with `visibility: private` by default
4. User can rename, modify, and change visibility

### 7.5 Discovery Surface

A browsable page for finding public content:

```
┌─ Explore ──────────────────────────────────┐
│                                            │
│  [Search...                         🔍]   │
│                                            │
│  [Projects]  [Agents]  [Pipelines]         │
│  [Tools]  [People]                         │
│                                            │
│  ── Trending Projects ─────────────────── │
│                                            │
│  nateide by @nate          ⭐ 42       │
│  Multi-agent orchestration IDE             │
│  TypeScript · 4 agents · 3 members         │
│                                            │
│  ml-research by @sarah         ⭐ 28       │
│  Agent-powered ML experiments              │
│  Python · 2 agents · 1 member              │
│                                            │
│  ── Popular Agents ────────────────────── │
│                                            │
│  🟣 Research Bot by @nate      ⭐ 15       │
│  deepseek-r1 · 3 tools                    │
│  [Clone]                                   │
│                                            │
│  ── New Pipelines ─────────────────────── │
│                                            │
│  Feature Builder by @nate      ⭐ 8        │
│  6 nodes · Plan → Implement → Test         │
│  [Import]                                  │
│                                            │
└────────────────────────────────────────────┘
```

Sorting options: trending (stars over time), most starred, newest, most used.

Search: full-text search across project names, descriptions, tags, harness
names, pipeline names, tool names, user handles.

Convex supports full-text search natively — use search indexes on the
relevant tables.

### 7.6 Profile Editor

Settings page for editing your profile:

```
┌─ Edit Profile ─────────────────────────────┐
│                                            │
│  Avatar: [Upload] [Remove]                 │
│                                            │
│  Handle: [@nate                  ]         │
│  Display name: [Nate             ]         │
│  Bio: [Building multi-agent IDEs ]         │
│                                            │
│  Links:                                    │
│  [GitHub    ] [github.com/nate      ] [✕]  │
│  [Website   ] [nate.dev             ] [✕]  │
│  [+ Add link]                              │
│                                            │
│  Profile visibility:                       │
│  ◉ Public (anyone can see your profile)    │
│  ○ Private (only handle and avatar shown)  │
│                                            │
│  [Save]                                    │
│                                            │
└────────────────────────────────────────────┘
```

### 7.7 Artifact Visibility Management

Users need a central place to see and manage the visibility of all their
artifacts:

```
┌─ My Artifacts ─────────────────────────────┐
│                                            │
│  [All]  [Public]  [Workspace]  [Private]   │
│                                            │
│  Projects                                  │
│  nateide        Public    [Change ▾]   │
│  ml-sandbox         Private   [Change ▾]   │
│                                            │
│  Agents                                    │
│  Research Bot       Public    [Change ▾]   │
│  Strict Reviewer    Workspace [Change ▾]   │
│                                            │
│  Pipelines                                 │
│  Feature Builder    Public    [Change ▾]   │
│                                            │
│  Tools                                     │
│  lint-staged        Public    [Change ▾]   │
│  deploy             Private   [Change ▾]   │
│                                            │
└────────────────────────────────────────────┘
```

### 7.8 Activity Feed

Project pages and user profiles show an activity feed:

```ts
type ActivityEntry = {
  id: string
  timestamp: string
  actor: { userId: string; displayName: string }
  action: string       // "created", "updated", "starred", "cloned", "joined"
  targetType: string   // "project", "harness", "pipeline", "tool", "thread"
  targetId: string
  targetName: string
  projectId?: string
}
```

Activity is computed from events and stored in a dedicated Convex table for
fast querying. Only public actions on public artifacts appear in public
activity feeds.

## New Convex Tables

```ts
profiles: defineTable({ ... }),
projects: defineTable({ ... }),
stars: defineTable({ ... }),
activity: defineTable({
  userId: v.id("users"),
  action: v.string(),
  targetType: v.string(),
  targetId: v.string(),
  targetName: v.string(),
  projectId: v.optional(v.id("projects")),
  timestamp: v.number(),
  isPublic: v.boolean(),
}).index("by_user", ["userId"])
  .index("by_project", ["projectId"])
  .index("by_public", ["isPublic", "timestamp"]),
```

## Testing Strategy

- Profile test: create profile, set public, view from another account, verify
  only public artifacts shown
- Privacy test: set profile to private, view from another account, verify
  only handle and avatar visible
- Project test: create project, add readme, add workspaces, verify project
  page renders correctly
- Star test: star a project, verify count increments, verify it appears in
  user's starred list
- Clone test: clone a public harness, verify independent copy in user's
  workspace
- Import test: import a public pipeline, verify harness resolution flow
- Discovery test: create public project, verify it appears in explore page
- Search test: search for project by name, tag, description, verify results
- Activity test: perform actions, verify activity feed updates

## Definition of Done

- [ ] User profiles with handle, avatar, bio, links, visibility
- [ ] Profile page shows public artifacts organized by type
- [ ] Handle registration during onboarding with uniqueness check
- [ ] Project entity created with readme, tags, workspace associations
- [ ] Project page with README, threads, agents, pipelines, tools, activity
- [ ] Stars on all public artifact types
- [ ] Clone/import flow for all artifact types
- [ ] Explore/discovery page with search, trending, sorting
- [ ] Profile editor in settings
- [ ] Artifact visibility management page
- [ ] Activity feed on project pages and profiles
- [ ] Privacy rules enforced (private profiles, private artifacts invisible)
- [ ] Full-text search across public artifacts
