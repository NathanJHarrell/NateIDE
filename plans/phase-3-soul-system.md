# Phase 3: Soul System

## Goal

Replace the current structured `SoulDocument` type with the SOUL.md framework.
Each harness gets four user-editable markdown documents: SOUL (identity), STYLE
(voice/tone), SKILL (operating instructions), and MEMORY (accumulated context).
Users edit these directly in a tabbed markdown editor.

## Depends On

- Phase 2 (Harness System) — souls attach to harnesses

## Current State

- `packages/agents/src/soul-documents.ts` defines a `SoulDocument` type with
  fixed fields: identity, values, communicationStyle, disagreementBehavior,
  collaborationGuidelines, escalationRules, learnedPreferences
- Four default soul documents exist for the built-in agents
- `soulDocumentToPromptSection()` converts the struct to a prompt string
- `mergeSoulDocument()` allows partial overrides
- Soul content reads like job descriptions — functional but not personal
- Settings store allows user customization of soul documents

## Target State

- Each harness has a `HarnessSoul` object with four markdown strings
- Users edit soul documents in a tabbed markdown editor within the harness
  builder
- Templates help users write effective souls ("What opinions does this agent
  have?", "What would it never say?")
- MEMORY grows automatically after conversations via memory extraction
- Built-in agents have their existing soul content migrated to the new format
- Soul content is rendered into the system prompt at runtime

## New Package: `packages/soul/`

```
packages/soul/
  src/
    index.ts              — public API exports
    types.ts              — HarnessSoul type
    render.ts             — convert soul to system prompt sections
    templates.ts          — starter templates for different agent archetypes
    memory.ts             — memory extraction and pruning
    migrate.ts            — convert old SoulDocument to HarnessSoul
```

## Steps

### 3.1 Define the Soul Type

```ts
type HarnessSoul = {
  // Freeform markdown, user-editable
  soul: string       // Who this agent IS — identity, worldview, opinions
  style: string      // How it communicates — tone, vocabulary, quirks
  skill: string      // How it operates — decision defaults, boundaries, workflows
  memory: string     // Accumulated context — grows over time

  // Structured fields extracted from markdown or set separately
  // Used by the system for programmatic decisions
  structured: {
    values: string[]
    escalationRules: string
    learnedPreferences: string[]
  }
}
```

### 3.2 Build the Soul Renderer

`render.ts` converts a `HarnessSoul` into system prompt sections:

```ts
function renderSoulToPrompt(soul: HarnessSoul): string
```

The renderer produces a prompt section like:

```
--- AGENT IDENTITY ---
<soul.soul content>

--- COMMUNICATION STYLE ---
<soul.style content>

--- OPERATING INSTRUCTIONS ---
<soul.skill content>

--- CONTEXT FROM PREVIOUS SESSIONS ---
<soul.memory content, truncated to fit context budget>
--- END AGENT IDENTITY ---
```

The memory section is truncated from the oldest entries first if it exceeds
a configurable token budget (default: 2000 tokens).

### 3.3 Create Soul Templates

Provide starter templates for common agent archetypes:

| Template | Description |
|----------|-------------|
| Planner | Strategic thinker, decomposes work, doesn't implement |
| Executor | Action-oriented, precise, implements faithfully |
| Reviewer | Thorough, balanced feedback, catches issues |
| Researcher | Exhaustive, skeptical, primary-source focused |
| Creative | Exploratory, divergent thinking, generates options |
| Strict | Rules-focused, blocks on violations, no compromises |
| Minimal | Bare bones, just the essentials |
| Blank | Empty template for starting from scratch |

Each template has all four sections pre-filled with prompting questions as
comments that the user replaces:

```markdown
# Soul

<!-- Who is this agent? What are its core beliefs? -->
<!-- What opinions does it hold strongly? -->
<!-- What would it never do? -->
<!-- What makes it different from a generic AI? -->
```

### 3.4 Build Memory Extraction

Adapt the existing `extractMemories` logic from `session-store.ts:1605-1640`:

```ts
async function extractMemories(
  conversationSummary: string,
  existingMemory: string,
  agentId: string,
): Promise<string>
```

After a conversation round completes:
1. Summarize the conversation (already exists)
2. Ask the LLM: "What should this agent remember for next time?"
3. Append new memories to the MEMORY section with a date header
4. Save to Convex via mutation

Memory pruning:
- When MEMORY exceeds a configurable limit (default 5000 tokens), summarize
  older entries and replace them with the summary
- User can manually edit MEMORY at any time
- User can clear MEMORY entirely

### 3.5 Migrate Built-In Soul Documents

Convert the four existing soul documents to the new format:

| Old Field | New Location |
|-----------|-------------|
| `identity` | `soul.soul` |
| `communicationStyle` | `soul.style` |
| `disagreementBehavior` | `soul.style` (appended) |
| `collaborationGuidelines` | `soul.skill` |
| `escalationRules` | `soul.skill` (appended) + `structured.escalationRules` |
| `values` | `soul.soul` (as bullet list) + `structured.values` |
| `learnedPreferences` | `soul.memory` + `structured.learnedPreferences` |

### 3.6 Build the Soul Editor UI

A tabbed editor within the harness builder:

```
┌─ Soul ────────────────────────────────────┐
│  [SOUL]  [STYLE]  [SKILL]  [MEMORY]      │
│                                           │
│  ┌─────────────────────────────────────┐  │
│  │                                     │  │
│  │  (markdown editor with preview)     │  │
│  │                                     │  │
│  │                                     │  │
│  │                                     │  │
│  │                                     │  │
│  └─────────────────────────────────────┘  │
│                                           │
│  [Start from template ▾]  [Import .md]    │
│  [Export .md]  [Reset to default]         │
└───────────────────────────────────────────┘
```

Features:
- Four tabs, each a markdown text area
- "Start from template" dropdown loads a template into the current tab
- "Import .md" loads from a file on disk
- "Export .md" saves to a file on disk
- "Reset to default" restores the built-in soul (only for built-in agents)
- Live preview toggle (rendered markdown alongside the editor)
- Character/token count indicator
- MEMORY tab shows a "Clear memory" button and a "Last updated" timestamp

### 3.7 Soul in Convex

The soul is stored as part of the harness document in Convex. No separate
table — it's an embedded object:

```ts
// In the harnesses table schema
soul: v.object({
  soul: v.string(),
  style: v.string(),
  skill: v.string(),
  memory: v.string(),
  structured: v.object({
    values: v.array(v.string()),
    escalationRules: v.string(),
    learnedPreferences: v.array(v.string()),
  }),
})
```

Mutations:
- `updateHarnessSoul(harnessId, section, content)` — update one section
- `appendMemory(harnessId, memoryEntry)` — append to memory section
- `clearMemory(harnessId)` — reset memory to empty

### 3.8 Deprecate Old Soul System

- Mark `packages/agents/src/soul-documents.ts` as deprecated
- Update all imports to use the new `packages/soul/` package
- Remove `SoulDocument` type from protocol after migration
- Remove `mergeSoulDocument` and `soulDocumentToPromptSection`

## Testing Strategy

- Unit tests for soul renderer: verify markdown → prompt conversion
- Unit tests for memory extraction: mock LLM, verify append behavior
- Unit tests for memory pruning: verify old entries are summarized
- Migration test: convert all four built-in soul documents and verify
  prompt output is equivalent
- UI test: create harness, edit soul, save, reload, verify persistence
- Template test: load each template, verify all four sections are populated

## Definition of Done

- [ ] `packages/soul/` package created with all modules
- [ ] `HarnessSoul` type defined and integrated into `AgentHarness`
- [ ] Soul renderer produces correct system prompt sections
- [ ] Templates available for 8 archetypes
- [ ] Memory extraction works after conversation rounds
- [ ] Memory pruning works when limit exceeded
- [ ] Built-in soul documents migrated to new format
- [ ] Soul editor UI functional with tabs, templates, import/export
- [ ] Old `soul-documents.ts` deprecated and unused
- [ ] Soul persisted in Convex as part of harness document
