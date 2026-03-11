import { useCallback, useEffect, useMemo, useState } from "react";
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
import type { Pipeline, PipelineNode, PipelineEdge } from "@nateide/protocol";

const API_ROOT = "/api";

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

function pipelineToFlowNodes(pipeline: Pipeline, agents: AgentDescriptor[]): Node[] {
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

function pipelineToFlowEdges(pipeline: Pipeline): Edge[] {
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

function flowToPipelineNodes(nodes: Node[]): PipelineNode[] {
  return nodes.map((n) => ({
    id: n.id,
    type: (n.type ?? "agent") as PipelineNode["type"],
    agentId: (n.data as { agentId?: string }).agentId || undefined,
    condition: (n.data as { condition?: string }).condition || undefined,
    label: (n.data as { label: string }).label,
    position: n.position,
  }));
}

function flowToPipelineEdges(edges: Edge[]): PipelineEdge[] {
  return edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    label: typeof e.label === "string" ? e.label : undefined,
    sourceHandle: e.sourceHandle ?? undefined,
  }));
}

function newDefaultPipeline(): Pipeline {
  return {
    id: `pipeline-${Date.now()}`,
    name: "New Pipeline",
    description: "",
    nodes: [
      { id: "start-1", type: "start", label: "Start", position: { x: 50, y: 200 } },
      { id: "end-1", type: "end", label: "End", position: { x: 600, y: 200 } },
    ],
    edges: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

// ── Main Component ──────────────────────────────────────

export function PipelineEditor({ agents }: { agents: AgentDescriptor[] }) {
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [activePipeline, setActivePipeline] = useState<Pipeline | null>(null);
  const [pipelineName, setPipelineName] = useState("");
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [isSaving, setIsSaving] = useState(false);

  const workerAgents = useMemo(
    () => agents.filter((a) => a.id !== "agent-controller"),
    [agents],
  );

  // Load pipelines
  useEffect(() => {
    fetch(`${API_ROOT}/pipelines`)
      .then((r) => r.json())
      .then((data) => setPipelines(data as Pipeline[]))
      .catch(() => {});
  }, []);

  const onConnect = useCallback(
    (connection: Connection) => setEdges((eds) => addEdge({ ...connection, animated: true, style: { stroke: "#3f78c7" } }, eds)),
    [setEdges],
  );

  function loadPipeline(pipeline: Pipeline) {
    setActivePipeline(pipeline);
    setPipelineName(pipeline.name);
    setNodes(pipelineToFlowNodes(pipeline, agents));
    setEdges(pipelineToFlowEdges(pipeline));
  }

  function createNewPipeline() {
    const p = newDefaultPipeline();
    loadPipeline(p);
  }

  async function savePipeline() {
    if (!activePipeline) return;
    setIsSaving(true);

    const updated: Pipeline = {
      ...activePipeline,
      name: pipelineName || activePipeline.name,
      nodes: flowToPipelineNodes(nodes),
      edges: flowToPipelineEdges(edges),
    };

    try {
      const saved = await fetch(`${API_ROOT}/pipelines`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(updated),
      }).then((r) => r.json()) as Pipeline;

      setActivePipeline(saved);
      setPipelines((prev) => {
        const index = prev.findIndex((p) => p.id === saved.id);
        if (index >= 0) {
          const next = [...prev];
          next[index] = saved;
          return next;
        }
        return [...prev, saved];
      });
    } finally {
      setIsSaving(false);
    }
  }

  async function deletePipeline() {
    if (!activePipeline) return;
    await fetch(`${API_ROOT}/pipelines/${encodeURIComponent(activePipeline.id)}`, { method: "DELETE" });
    setPipelines((prev) => prev.filter((p) => p.id !== activePipeline!.id));
    setActivePipeline(null);
    setNodes([]);
    setEdges([]);
    setPipelineName("");
  }

  async function executePipelineHandler() {
    if (!activePipeline) return;
    await fetch(`${API_ROOT}/pipelines/${encodeURIComponent(activePipeline.id)}/execute`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "Execute this pipeline" }),
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

  return (
    <div className="pipeline-editor">
      <div className="pipeline-sidebar">
        <div className="pipeline-sidebar-section">
          <h3>Pipelines</h3>
          <button type="button" className="pipeline-btn pipeline-btn-new" onClick={createNewPipeline}>
            + New Pipeline
          </button>
          <div className="pipeline-list">
            {pipelines.map((p) => (
              <button
                type="button"
                key={p.id}
                className={`pipeline-list-item ${activePipeline?.id === p.id ? "pipeline-list-item-active" : ""}`}
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
