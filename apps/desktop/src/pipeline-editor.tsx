import { useCallback, useMemo, useState } from "react";
import type { CSSProperties, DragEvent } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  addEdge,
  useNodesState,
  useEdgesState,
  Handle,
  Position,
  type Connection,
  type Node,
  type Edge,
  type NodeTypes,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { AgentDescriptor } from "@nateide/agents";
import type { Id } from "../../../convex/_generated/dataModel";
import {
  usePipelines,
  useCreatePipeline,
  useUpdatePipeline,
  useRemovePipeline,
  useCreatePipelineExecution,
} from "./convex-hooks";

// ── Types ───────────────────────────────────────────────

interface PipelineEditorProps {
  agents: AgentDescriptor[];
  workspaceId?: Id<"workspaces">;
  currentUserId?: string;
}

/** Shape of a pipeline node as stored in Convex (v.any() array items). */
interface PipelineNodeData {
  id: string;
  type: "agent" | "condition" | "start" | "end" | "parallel-split" | "parallel-join";
  label: string;
  agentId?: string;
  condition?: string;
  position: { x: number; y: number };
}

/** Shape of a pipeline edge as stored in Convex (v.any() array items). */
interface PipelineEdgeData {
  id: string;
  source: string;
  target: string;
  label?: string;
  sourceHandle?: string;
}

/** Convex pipeline document shape (from usePipelines query). */
interface ConvexPipeline {
  _id: Id<"pipelines">;
  _creationTime: number;
  name: string;
  description?: string;
  nodes: PipelineNodeData[];
  edges: PipelineEdgeData[];
  variables?: Record<string, unknown>;
  defaultPolicy?: "safe" | "yolo";
  visibility: "private" | "workspace" | "public";
  workspaceId?: Id<"workspaces">;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
}

// ── Custom Node Components ──────────────────────────────

function AgentNode({ data }: NodeProps) {
  const d = data as { label: string; agentId: string; color: string };
  return (
    <div className="pipeline-node pipeline-node-agent" style={{ "--node-color": d.color } as CSSProperties}>
      <Handle type="target" position={Position.Left} />
      <div className="pipeline-node-label">{d.label}</div>
      <div className="pipeline-node-sub">{d.agentId}</div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

function ConditionNode({ data }: NodeProps) {
  const d = data as { label: string; condition: string };
  return (
    <div className="pipeline-node pipeline-node-condition">
      <Handle type="target" position={Position.Left} />
      <div className="pipeline-node-label">{d.label}</div>
      <div className="pipeline-node-sub">{d.condition || "condition"}</div>
      <Handle type="source" position={Position.Right} id="true" style={{ top: "30%" }} />
      <Handle type="source" position={Position.Right} id="false" style={{ top: "70%" }} />
    </div>
  );
}

function StartNode({ data }: NodeProps) {
  return (
    <div className="pipeline-node pipeline-node-start">
      <div className="pipeline-node-label">{(data as { label: string }).label}</div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

function EndNode({ data }: NodeProps) {
  return (
    <div className="pipeline-node pipeline-node-end">
      <Handle type="target" position={Position.Left} />
      <div className="pipeline-node-label">{(data as { label: string }).label}</div>
    </div>
  );
}

function ParallelSplitNode({ data }: NodeProps) {
  return (
    <div className="pipeline-node pipeline-node-parallel">
      <Handle type="target" position={Position.Left} />
      <div className="pipeline-node-label">{(data as { label: string }).label}</div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

function ParallelJoinNode({ data }: NodeProps) {
  return (
    <div className="pipeline-node pipeline-node-parallel">
      <Handle type="target" position={Position.Left} />
      <div className="pipeline-node-label">{(data as { label: string }).label}</div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

const nodeTypes: NodeTypes = {
  agent: AgentNode,
  condition: ConditionNode,
  start: StartNode,
  end: EndNode,
  "parallel-split": ParallelSplitNode,
  "parallel-join": ParallelJoinNode,
};

// ── Helpers ─────────────────────────────────────────────

function pipelineToFlowNodes(pipeline: ConvexPipeline, agents: AgentDescriptor[]): Node[] {
  return pipeline.nodes.map((n) => {
    const agent = n.agentId ? agents.find((a) => a.id === n.agentId) : undefined;
    return {
      id: n.id,
      type: n.type,
      position: n.position,
      data: {
        label: n.label,
        agentId: n.agentId ?? "",
        condition: n.condition ?? "",
        color: agent?.color ?? "#637777",
      },
    };
  });
}

function pipelineToFlowEdges(pipeline: ConvexPipeline): Edge[] {
  return pipeline.edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    label: e.label,
    sourceHandle: e.sourceHandle,
    animated: true,
    style: { stroke: "#3f78c7" },
  }));
}

function flowToPipelineNodes(nodes: Node[]): PipelineNodeData[] {
  return nodes.map((n) => ({
    id: n.id,
    type: (n.type ?? "agent") as PipelineNodeData["type"],
    agentId: (n.data as { agentId?: string }).agentId || undefined,
    condition: (n.data as { condition?: string }).condition || undefined,
    label: (n.data as { label: string }).label,
    position: n.position,
  }));
}

function flowToPipelineEdges(edges: Edge[]): PipelineEdgeData[] {
  return edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    label: typeof e.label === "string" ? e.label : undefined,
    sourceHandle: e.sourceHandle ?? undefined,
  }));
}

/** Default nodes for a brand-new unsaved pipeline. */
function newDefaultPipelineState() {
  return {
    name: "New Pipeline",
    description: "",
    nodes: [
      { id: "start-1", type: "start" as const, label: "Start", position: { x: 50, y: 200 } },
      { id: "end-1", type: "end" as const, label: "End", position: { x: 600, y: 200 } },
    ],
    edges: [] as PipelineEdgeData[],
  };
}

// ── Main Component ──────────────────────────────────────

export function PipelineEditor({ agents, workspaceId, currentUserId }: PipelineEditorProps) {
  const pipelines = usePipelines(workspaceId) as ConvexPipeline[] | undefined;
  const createPipeline = useCreatePipeline();
  const updatePipeline = useUpdatePipeline();
  const removePipeline = useRemovePipeline();
  const createExecution = useCreatePipelineExecution();

  const [activePipeline, setActivePipeline] = useState<ConvexPipeline | null>(null);
  const [pipelineName, setPipelineName] = useState("");
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [isSaving, setIsSaving] = useState(false);
  /** Track when a new pipeline is being edited but not yet saved to Convex. */
  const [isNewUnsaved, setIsNewUnsaved] = useState(false);

  const workerAgents = useMemo(
    () => agents.filter((a) => a.id !== "agent-controller"),
    [agents],
  );

  const onConnect = useCallback(
    (connection: Connection) => setEdges((eds) => addEdge({ ...connection, animated: true, style: { stroke: "#3f78c7" } }, eds)),
    [setEdges],
  );

  function loadPipeline(pipeline: ConvexPipeline) {
    setActivePipeline(pipeline);
    setIsNewUnsaved(false);
    setPipelineName(pipeline.name);
    setNodes(pipelineToFlowNodes(pipeline, agents));
    setEdges(pipelineToFlowEdges(pipeline));
  }

  function createNewPipeline() {
    const defaults = newDefaultPipelineState();
    // Build a temporary ConvexPipeline-shaped object (no _id yet).
    const temp = {
      _id: "" as Id<"pipelines">,
      _creationTime: Date.now(),
      name: defaults.name,
      description: defaults.description,
      nodes: defaults.nodes,
      edges: defaults.edges,
      visibility: "private" as const,
      createdBy: currentUserId ?? "unknown",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    } satisfies ConvexPipeline;

    setActivePipeline(temp);
    setIsNewUnsaved(true);
    setPipelineName(temp.name);
    setNodes(pipelineToFlowNodes(temp, agents));
    setEdges(pipelineToFlowEdges(temp));
  }

  async function savePipeline() {
    if (!activePipeline) return;
    setIsSaving(true);

    const pipelineNodes = flowToPipelineNodes(nodes);
    const pipelineEdges = flowToPipelineEdges(edges);
    const name = pipelineName || activePipeline.name;

    try {
      if (isNewUnsaved || !activePipeline._id) {
        // Create new pipeline in Convex
        const newId = await createPipeline({
          name,
          description: activePipeline.description ?? "",
          nodes: pipelineNodes,
          edges: pipelineEdges,
          variables: activePipeline.variables,
          defaultPolicy: activePipeline.defaultPolicy,
          visibility: activePipeline.visibility,
          workspaceId,
          createdBy: currentUserId ?? "unknown",
        });

        // Build the saved doc shape so we can keep editing
        const saved: ConvexPipeline = {
          ...activePipeline,
          _id: newId,
          name,
          nodes: pipelineNodes,
          edges: pipelineEdges,
          updatedAt: Date.now(),
        };
        setActivePipeline(saved);
        setIsNewUnsaved(false);
      } else {
        // Update existing pipeline in Convex
        await updatePipeline({
          id: activePipeline._id,
          name,
          description: activePipeline.description,
          nodes: pipelineNodes,
          edges: pipelineEdges,
          variables: activePipeline.variables,
          defaultPolicy: activePipeline.defaultPolicy,
          visibility: activePipeline.visibility,
        });

        setActivePipeline({
          ...activePipeline,
          name,
          nodes: pipelineNodes,
          edges: pipelineEdges,
          updatedAt: Date.now(),
        });
      }
    } finally {
      setIsSaving(false);
    }
  }

  async function deletePipeline() {
    if (!activePipeline || !activePipeline._id) return;
    await removePipeline({ id: activePipeline._id });
    setActivePipeline(null);
    setIsNewUnsaved(false);
    setNodes([]);
    setEdges([]);
    setPipelineName("");
  }

  async function executePipelineHandler() {
    if (!activePipeline || !activePipeline._id) return;
    await createExecution({
      pipelineId: activePipeline._id,
      triggeredBy: currentUserId ?? "unknown",
    });
  }

  function onDragOver(event: DragEvent) {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }

  function onDrop(event: DragEvent) {
    event.preventDefault();
    const agentId = event.dataTransfer.getData("application/pipeline-agent");
    if (!agentId) return;

    const agent = agents.find((a) => a.id === agentId);
    if (!agent) return;

    const bounds = (event.target as HTMLElement).closest(".react-flow")?.getBoundingClientRect();
    if (!bounds) return;

    const position = {
      x: event.clientX - bounds.left,
      y: event.clientY - bounds.top,
    };

    const newNode: Node = {
      id: `agent-${Date.now()}`,
      type: "agent",
      position,
      data: {
        label: agent.name,
        agentId: agent.id,
        color: agent.color,
      },
    };

    setNodes((nds) => [...nds, newNode]);
  }

  function addSpecialNode(type: "condition" | "parallel-split" | "parallel-join") {
    const labels: Record<string, string> = {
      condition: "Condition",
      "parallel-split": "Split",
      "parallel-join": "Join",
    };

    const newNode: Node = {
      id: `${type}-${Date.now()}`,
      type,
      position: { x: 300, y: 200 },
      data: {
        label: labels[type] ?? type,
        condition: type === "condition" ? "error" : "",
      },
    };

    setNodes((nds) => [...nds, newNode]);
  }

  const pipelineList = pipelines ?? [];

  return (
    <div className="pipeline-editor">
      <div className="pipeline-sidebar">
        <div className="pipeline-sidebar-section">
          <h3>Pipelines</h3>
          <button type="button" className="pipeline-btn pipeline-btn-new" onClick={createNewPipeline}>
            + New Pipeline
          </button>
          <div className="pipeline-list">
            {pipelineList.map((p) => (
              <button
                type="button"
                key={p._id}
                className={`pipeline-list-item ${activePipeline?._id === p._id ? "pipeline-list-item-active" : ""}`}
                onClick={() => loadPipeline(p)}
              >
                {p.name}
              </button>
            ))}
          </div>
        </div>

        <div className="pipeline-sidebar-section">
          <h3>Agents</h3>
          <p className="pipeline-sidebar-hint">Drag onto canvas</p>
          {workerAgents.map((agent) => (
            <div
              key={agent.id}
              className="pipeline-agent-chip"
              draggable
              onDragStart={(event) => {
                event.dataTransfer.setData("application/pipeline-agent", agent.id);
                event.dataTransfer.effectAllowed = "move";
              }}
              style={{ "--agent-color": agent.color } as CSSProperties}
            >
              <span className="pipeline-agent-dot" />
              <span>{agent.name}</span>
            </div>
          ))}
        </div>

        <div className="pipeline-sidebar-section">
          <h3>Nodes</h3>
          <button type="button" className="pipeline-btn" onClick={() => addSpecialNode("condition")}>
            + Condition
          </button>
          <button type="button" className="pipeline-btn" onClick={() => addSpecialNode("parallel-split")}>
            + Parallel Split
          </button>
          <button type="button" className="pipeline-btn" onClick={() => addSpecialNode("parallel-join")}>
            + Parallel Join
          </button>
        </div>
      </div>

      <div className="pipeline-canvas">
        <div className="pipeline-toolbar">
          {activePipeline && (
            <>
              <input
                className="pipeline-name-input"
                value={pipelineName}
                onChange={(e) => setPipelineName(e.target.value)}
                placeholder="Pipeline name..."
              />
              <button type="button" className="pipeline-btn pipeline-btn-save" onClick={() => void savePipeline()} disabled={isSaving}>
                {isSaving ? "Saving..." : "Save"}
              </button>
              <button type="button" className="pipeline-btn pipeline-btn-execute" onClick={() => void executePipelineHandler()}>
                Execute
              </button>
              <button type="button" className="pipeline-btn pipeline-btn-delete" onClick={() => void deletePipeline()}>
                Delete
              </button>
            </>
          )}
        </div>

        {activePipeline ? (
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onDragOver={onDragOver}
            onDrop={onDrop}
            nodeTypes={nodeTypes}
            fitView
            colorMode="dark"
          >
            <Background />
            <Controls />
            <MiniMap />
          </ReactFlow>
        ) : (
          <div className="pipeline-empty">
            <p>Select a pipeline or create a new one to get started.</p>
          </div>
        )}
      </div>
    </div>
  );
}
