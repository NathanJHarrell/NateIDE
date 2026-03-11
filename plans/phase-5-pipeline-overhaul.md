# Phase 5: Pipeline Overhaul

## Goal

Upgrade the pipeline system so agent nodes carry full harness configs, add
standalone tool nodes, improve condition nodes, and build a visual pipeline
editor using the existing @xyflow/react dependency.

## Depends On

- Phase 2 (Harness System) — agent nodes instantiate harnesses
- Phase 4 (Custom Tools & MCP) — tool nodes call any tool type

## Current State

- `apps/daemon/src/pipeline-engine.ts` (210 lines) implements a basic DAG
  executor
- Node types: start, end, agent, condition, parallel-split, parallel-join
- Agent nodes fire a single `chatCompletionWithFallback` call — no tool use,
  no iterative execution, no identity
- Condition nodes do simple string matching
- No visual editor — pipelines are defined in code/data
- `@xyflow/react` is already a dependency in the desktop app

## Target State

- Agent nodes carry a full harness config (inline or referenced by ID)
- New tool node type for direct tool execution without an LLM
- Condition nodes can check exit codes, string patterns, or use an LLM
- Visual pipeline editor for drag-and-drop pipeline building
- Pipelines are shareable artifacts with visibility controls
- Pipeline-level approval policy cascades to nodes unless overridden

## Updated Types

### Pipeline Node

```ts
type PipelineNode =
  | { type: "start"; id: string; label: string }
  | { type: "end"; id: string; label: string }
  | {
      type: "agent"
      id: string
      label: string
      harness:
        | { ref: string }                  // reference a saved harness by ID
        | { inline: AgentHarnessInline }   // inline harness config
      soulOverride?: Partial<HarnessSoul>  // override soul for this pipeline step
    }
  | {
      type: "tool"
      id: string
      label: string
      toolCall: PipelineToolCall
    }
  | {
      type: "condition"
      id: string
      label: string
      condition: ConditionConfig
    }
  | { type: "parallel-split"; id: string; label: string }
  | { type: "parallel-join"; id: string; label: string; strategy: "concat" | "structured" }

type AgentHarnessInline = {
  provider: string
  model: string
  tools: AgentToolGrant[]
  soul: HarnessSoul
  approvalPolicy: ApprovalPolicy
  maxIterations: number
}

type PipelineToolCall = {
  toolId: string                        // built-in, custom, or MCP tool
  parameters: Record<string, string>    // static values or {{input}} template refs
  approvalPolicy?: ApprovalPolicy       // override pipeline default
}

type ConditionConfig =
  | { type: "exit_code"; operator: "eq" | "neq"; value: number }
  | { type: "contains"; text: string; caseSensitive?: boolean }
  | { type: "regex"; pattern: string }
  | { type: "llm"; prompt: string; model?: string }    // ask an LLM to evaluate
```

### Pipeline

```ts
type Pipeline = {
  id: string
  name: string
  description?: string
  createdBy: string
  workspaceId: string
  visibility: Visibility

  nodes: PipelineNode[]
  edges: PipelineEdge[]

  defaultPolicy: ApprovalPolicy        // cascades to all nodes
}

type PipelineEdge = {
  id: string
  source: string                        // node ID
  target: string                        // node ID
  label?: string                        // "true" / "false" for condition edges
}
```

## Steps

### 5.1 Rewrite Pipeline Engine

Replace `pipeline-engine.ts` with a new implementation that:

1. **Agent nodes instantiate harnesses.** When the engine reaches an agent
   node, it creates an `AgentHarnessRuntime` from the node's harness config
   (resolved from ref or inline). The harness runs its full execution loop
   including tool use, approval, and multi-turn LLM interaction.

2. **Tool nodes execute directly.** When the engine reaches a tool node, it
   calls `ToolExecutor.execute()` with the configured tool and parameters.
   Template variables like `{{input}}` are replaced with the input from the
   previous node.

3. **Condition nodes are smarter.** Support four condition types:
   - `exit_code`: check the numeric exit code from a previous tool node
   - `contains`: check if the previous output contains a string
   - `regex`: check if the previous output matches a regex
   - `llm`: ask an LLM "Given this output, should we proceed?" — returns
     true/false based on the model's response

4. **Parallel join strategies.** Two options:
   - `concat`: join all branch outputs with `\n---\n` separators (current)
   - `structured`: produce a JSON object keyed by branch node IDs

5. **Approval policy cascade.** The pipeline's `defaultPolicy` applies to all
   nodes. Individual agent or tool nodes can override with their own policy.

6. **Event emission.** The engine emits structured events for each step:
   - `pipeline.execution.started`
   - `pipeline.node.started` (with node type and config)
   - `pipeline.node.completed` (with output summary)
   - `pipeline.node.failed`
   - `pipeline.execution.completed`

### 5.2 Pipeline Execution State

Track execution state in Convex:

```ts
type PipelineExecution = {
  id: string
  pipelineId: string
  threadId: string
  triggeredBy: string               // userId
  status: "running" | "waiting_approval" | "completed" | "failed" | "canceled"
  currentNodeIds: string[]
  completedNodeIds: string[]
  nodeOutputs: Record<string, string>
  startedAt: string
  finishedAt?: string
}
```

Stored in a `pipelineExecutions` Convex table. The desktop app subscribes
to execution state for live progress visualization.

### 5.3 Build the Visual Pipeline Editor

Using `@xyflow/react` (already a dependency):

#### Node palette
A sidebar with draggable node types:
- Start (green circle)
- End (red circle)
- Agent (rectangle with model icon and harness name)
- Tool (hexagon with tool icon)
- Condition (diamond)
- Parallel Split (double bar)
- Parallel Join (double bar)

#### Canvas
- Drag nodes from palette onto canvas
- Connect nodes by dragging from output handles to input handles
- Select a node to see its configuration panel on the right

#### Node configuration panel
Appears when a node is selected:

**Agent node:**
- Harness: [Select saved harness ▾] or [Configure inline ▸]
- Soul override: [Edit ▸] (optional, opens soul editor for this step)
- Label: [text field]

**Tool node:**
- Tool: [Select from registry ▾]
- Parameters: [key-value editor with {{input}} variable support]
- Approval policy: [Inherit from pipeline / Safe / YOLO]

**Condition node:**
- Type: [Exit code / Contains / Regex / LLM ▾]
- Configuration fields based on type
- True edge label / False edge label

**Parallel join node:**
- Strategy: [Concatenate / Structured]

#### Pipeline-level config
Top bar or panel:
- Pipeline name and description
- Default approval policy: [Safe / YOLO]
- Visibility: [Private / Workspace / Public]

#### Execution controls
- [Run] button — start execution from the Start node
- [Stop] button — cancel running execution
- Live progress: nodes light up as they execute, show status icons
- Click a completed node to see its output

### 5.4 Pipeline Templates

Provide pre-built pipeline templates that users can import and customize:

| Template | Description | Nodes |
|----------|-------------|-------|
| Code Review | Read code → Review → Report | 3 agent nodes |
| Feature Builder | Plan → Implement → Test → Review | 4 agent + 1 tool |
| Bug Fix | Reproduce → Diagnose → Fix → Verify | 3 agent + 2 tool |
| Research | Search → Analyze → Summarize | 3 agent nodes |
| CI Pipeline | Build → Test → Lint → Report | 4 tool nodes |

### 5.5 Pipeline Import/Export

Pipelines are serializable JSON:

```ts
type ExportedPipeline = {
  format: "oc-pipeline-v1"
  pipeline: Pipeline
  // Inline harness configs for portability
  embeddedHarnesses: Record<string, AgentHarness>
  // Inline tool configs for portability
  embeddedTools: Record<string, CustomTool>
}
```

Export: serialize to JSON, download as `.oc-pipeline.json`.
Import: upload file, resolve harness and tool references (map to existing
or create new from embedded configs).

### 5.6 Pipeline Convex Schema

```ts
pipelines: defineTable({
  name: v.string(),
  description: v.optional(v.string()),
  createdBy: v.id("users"),
  workspaceId: v.id("workspaces"),
  visibility: v.union(v.literal("private"), v.literal("workspace"), v.literal("public")),
  nodes: v.array(v.any()),
  edges: v.array(v.any()),
  defaultPolicy: v.union(v.literal("safe"), v.literal("yolo")),
}).index("by_workspace", ["workspaceId"])
  .index("by_visibility", ["visibility"]),

pipelineExecutions: defineTable({
  pipelineId: v.id("pipelines"),
  threadId: v.id("threads"),
  triggeredBy: v.id("users"),
  status: v.string(),
  currentNodeIds: v.array(v.string()),
  completedNodeIds: v.array(v.string()),
  nodeOutputs: v.any(),
  startedAt: v.string(),
  finishedAt: v.optional(v.string()),
}).index("by_pipeline", ["pipelineId"])
  .index("by_thread", ["threadId"]),
```

## Testing Strategy

- Unit tests for pipeline engine: mock harnesses and tool executor, verify
  DAG traversal, condition branching, parallel execution
- Unit tests for each condition type: exit_code, contains, regex, LLM
- Integration test: build pipeline → run → verify each node executes in order
- Parallel test: split → two branches → join → verify outputs merge correctly
- Approval test: tool node in safe mode → approval required → verify execution
  pauses and resumes
- Visual editor test: create pipeline via UI → save → reload → verify structure
- Import/export test: export pipeline → import in new workspace → verify
  harness and tool resolution

## Definition of Done

- [ ] Pipeline engine rewritten with harness-per-node and tool nodes
- [ ] Four condition types implemented (exit_code, contains, regex, LLM)
- [ ] Parallel join supports concat and structured strategies
- [ ] Pipeline execution state tracked in Convex
- [ ] Visual pipeline editor built with @xyflow/react
- [ ] Node palette, canvas, and configuration panels functional
- [ ] Pipeline templates available
- [ ] Import/export as JSON with embedded harness/tool configs
- [ ] Pipelines are shareable artifacts with visibility controls
- [ ] Live execution visualization (nodes light up, show progress)
- [ ] Pipeline-level approval policy cascades to nodes
