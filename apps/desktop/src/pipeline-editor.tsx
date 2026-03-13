import { useCallback, useState, useRef } from "react";
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
  MarkerType,
  type Connection,
  type Node,
  type Edge,
  type NodeTypes,
  type NodeProps,
  type OnSelectionChangeParams,
  BackgroundVariant,
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

type NodeType = "trigger" | "agent" | "code" | "condition" | "output";

interface PipelineNodeData {
  id: string;
  type: NodeType;
  label: string;
  agentId?: string;
  condition?: string;
  script?: string;
  description?: string;
  position: { x: number; y: number };
}

interface PipelineEdgeData {
  id: string;
  source: string;
  target: string;
  label?: string;
  sourceHandle?: string;
}

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

// ── Node colors & icons by type ─────────────────────────

const NODE_COLORS: Record<NodeType, string> = {
  trigger: "#2b8a57",
  agent: "#3f78c7",
  code: "#c2853d",
  condition: "#8a50c7",
  output: "#d14d72",
};

const NODE_ICONS: Record<NodeType, string> = {
  trigger: "\u25B6",
  agent: "\u2699",
  code: "\u276F_",
  condition: "\u2B29",
  output: "\u2B24",
};

const NODE_LABELS: Record<NodeType, string> = {
  trigger: "Trigger",
  agent: "Agent Task",
  code: "Code",
  condition: "Condition",
  output: "Output",
};

// ── Custom Node Components ──────────────────────────────

function TriggerNode({ data, selected }: NodeProps) {
  const d = data as { label: string; description?: string };
  return (
    <div className={`pe-node pe-node-trigger ${selected ? "pe-node-selected" : ""}`}>
      <div className="pe-node-header" style={{ background: NODE_COLORS.trigger }}>
        <span className="pe-node-icon">{NODE_ICONS.trigger}</span>
        <span className="pe-node-title">{d.label}</span>
      </div>
      <div className="pe-node-body">
        <span className="pe-node-type-badge">Trigger</span>
        {d.description && <p className="pe-node-desc">{d.description}</p>}
      </div>
      <Handle type="source" position={Position.Right} className="pe-handle pe-handle-source" />
    </div>
  );
}

function AgentNode({ data, selected }: NodeProps) {
  const d = data as { label: string; agentId?: string; agentColor?: string; description?: string };
  const color = d.agentColor || NODE_COLORS.agent;
  return (
    <div className={`pe-node pe-node-agent ${selected ? "pe-node-selected" : ""}`}>
      <Handle type="target" position={Position.Left} className="pe-handle pe-handle-target" />
      <div className="pe-node-header" style={{ background: color }}>
        <span className="pe-node-icon">{NODE_ICONS.agent}</span>
        <span className="pe-node-title">{d.label}</span>
      </div>
      <div className="pe-node-body">
        <span className="pe-node-type-badge">Agent Task</span>
        {d.agentId && <span className="pe-node-agent-id">{d.agentId}</span>}
        {d.description && <p className="pe-node-desc">{d.description}</p>}
      </div>
      <Handle type="source" position={Position.Right} className="pe-handle pe-handle-source" />
    </div>
  );
}

function CodeNode({ data, selected }: NodeProps) {
  const d = data as { label: string; script?: string; description?: string };
  return (
    <div className={`pe-node pe-node-code ${selected ? "pe-node-selected" : ""}`}>
      <Handle type="target" position={Position.Left} className="pe-handle pe-handle-target" />
      <div className="pe-node-header" style={{ background: NODE_COLORS.code }}>
        <span className="pe-node-icon">{NODE_ICONS.code}</span>
        <span className="pe-node-title">{d.label}</span>
      </div>
      <div className="pe-node-body">
        <span className="pe-node-type-badge">Code</span>
        {d.script && <code className="pe-node-script">{d.script.slice(0, 60)}</code>}
        {d.description && <p className="pe-node-desc">{d.description}</p>}
      </div>
      <Handle type="source" position={Position.Right} className="pe-handle pe-handle-source" />
    </div>
  );
}

function ConditionNode({ data, selected }: NodeProps) {
  const d = data as { label: string; condition?: string; description?: string };
  return (
    <div className={`pe-node pe-node-condition ${selected ? "pe-node-selected" : ""}`}>
      <Handle type="target" position={Position.Left} className="pe-handle pe-handle-target" />
      <div className="pe-node-header" style={{ background: NODE_COLORS.condition }}>
        <span className="pe-node-icon">{NODE_ICONS.condition}</span>
        <span className="pe-node-title">{d.label}</span>
      </div>
      <div className="pe-node-body">
        <span className="pe-node-type-badge">Condition</span>
        {d.condition && <span className="pe-node-condition-expr">{d.condition}</span>}
        {d.description && <p className="pe-node-desc">{d.description}</p>}
      </div>
      <Handle
        type="source"
        position={Position.Right}
        id="true"
        className="pe-handle pe-handle-source pe-handle-true"
        style={{ top: "35%" }}
      />
      <Handle
        type="source"
        position={Position.Right}
        id="false"
        className="pe-handle pe-handle-source pe-handle-false"
        style={{ top: "65%" }}
      />
    </div>
  );
}

function OutputNode({ data, selected }: NodeProps) {
  const d = data as { label: string; description?: string };
  return (
    <div className={`pe-node pe-node-output ${selected ? "pe-node-selected" : ""}`}>
      <Handle type="target" position={Position.Left} className="pe-handle pe-handle-target" />
      <div className="pe-node-header" style={{ background: NODE_COLORS.output }}>
        <span className="pe-node-icon">{NODE_ICONS.output}</span>
        <span className="pe-node-title">{d.label}</span>
      </div>
      <div className="pe-node-body">
        <span className="pe-node-type-badge">Output</span>
        {d.description && <p className="pe-node-desc">{d.description}</p>}
      </div>
    </div>
  );
}

const nodeTypes: NodeTypes = {
  trigger: TriggerNode,
  agent: AgentNode,
  code: CodeNode,
  condition: ConditionNode,
  output: OutputNode,
};

// ── Edge defaults ───────────────────────────────────────

const defaultEdgeOptions = {
  type: "smoothstep",
  animated: true,
  markerEnd: {
    type: MarkerType.ArrowClosed,
    width: 16,
    height: 16,
    color: "#3f78c7",
  },
  style: { stroke: "#3f78c7", strokeWidth: 2 },
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
        agentColor: agent?.color ?? "",
        condition: n.condition ?? "",
        script: n.script ?? "",
        description: n.description ?? "",
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
    ...defaultEdgeOptions,
  }));
}

function flowToPipelineNodes(nodes: Node[]): PipelineNodeData[] {
  return nodes.map((n) => ({
    id: n.id,
    type: (n.type ?? "agent") as NodeType,
    agentId: (n.data as Record<string, string>).agentId || undefined,
    condition: (n.data as Record<string, string>).condition || undefined,
    script: (n.data as Record<string, string>).script || undefined,
    description: (n.data as Record<string, string>).description || undefined,
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

function newDefaultPipelineState() {
  return {
    name: "New Pipeline",
    description: "",
    nodes: [
      { id: "trigger-1", type: "trigger" as const, label: "Start", position: { x: 50, y: 200 } },
      { id: "output-1", type: "output" as const, label: "End", position: { x: 600, y: 200 } },
    ],
    edges: [] as PipelineEdgeData[],
  };
}

/** Auto-layout: arrange nodes left-to-right as a DAG. */
function autoLayoutNodes(nodes: Node[], edges: Edge[]): Node[] {
  if (nodes.length === 0) return nodes;

  // Build adjacency from edges
  const inDegree = new Map<string, number>();
  const children = new Map<string, string[]>();
  for (const n of nodes) {
    inDegree.set(n.id, 0);
    children.set(n.id, []);
  }
  for (const e of edges) {
    inDegree.set(e.target, (inDegree.get(e.target) ?? 0) + 1);
    const c = children.get(e.source) ?? [];
    c.push(e.target);
    children.set(e.source, c);
  }

  // Topological sort (Kahn's algorithm)
  const queue: string[] = [];
  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id);
  }

  const layers: string[][] = [];
  const visited = new Set<string>();

  while (queue.length > 0) {
    const layer = [...queue];
    layers.push(layer);
    queue.length = 0;
    for (const id of layer) {
      visited.add(id);
      for (const child of children.get(id) ?? []) {
        const newDeg = (inDegree.get(child) ?? 1) - 1;
        inDegree.set(child, newDeg);
        if (newDeg === 0) queue.push(child);
      }
    }
  }

  // Place orphans (not visited) in last layer
  for (const n of nodes) {
    if (!visited.has(n.id)) {
      if (layers.length === 0) layers.push([]);
      layers[layers.length - 1].push(n.id);
    }
  }

  const LAYER_GAP = 280;
  const NODE_GAP = 120;
  const START_X = 60;
  const START_Y = 60;

  const posMap = new Map<string, { x: number; y: number }>();
  for (let col = 0; col < layers.length; col++) {
    const layer = layers[col];
    const totalHeight = (layer.length - 1) * NODE_GAP;
    const startY = START_Y + Math.max(0, (300 - totalHeight) / 2);
    for (let row = 0; row < layer.length; row++) {
      posMap.set(layer[row], {
        x: START_X + col * LAYER_GAP,
        y: startY + row * NODE_GAP,
      });
    }
  }

  return nodes.map((n) => ({
    ...n,
    position: posMap.get(n.id) ?? n.position,
  }));
}

// ── Property Panel ──────────────────────────────────────

interface PropertyPanelProps {
  node: Node;
  agents: AgentDescriptor[];
  onUpdate: (id: string, data: Record<string, unknown>) => void;
  onDelete: (id: string) => void;
}

function PropertyPanel({ node, agents, onUpdate, onDelete }: PropertyPanelProps) {
  const d = node.data as Record<string, string>;
  const nodeType = node.type as NodeType;

  return (
    <div className="pe-property-panel">
      <div className="pe-prop-header">
        <div className="pe-prop-type-indicator" style={{ background: NODE_COLORS[nodeType] }} />
        <h3>{NODE_LABELS[nodeType]}</h3>
        <button
          type="button"
          className="pe-prop-close"
          onClick={() => onDelete(node.id)}
          title="Delete node"
        >
          &times;
        </button>
      </div>

      <div className="pe-prop-fields">
        <label className="pe-prop-label">
          Name
          <input
            className="pe-prop-input"
            value={d.label ?? ""}
            onChange={(e) => onUpdate(node.id, { ...d, label: e.target.value })}
          />
        </label>

        <label className="pe-prop-label">
          Description
          <textarea
            className="pe-prop-textarea"
            rows={2}
            value={d.description ?? ""}
            onChange={(e) => onUpdate(node.id, { ...d, description: e.target.value })}
          />
        </label>

        {nodeType === "agent" && (
          <label className="pe-prop-label">
            Agent
            <select
              className="pe-prop-select"
              value={d.agentId ?? ""}
              onChange={(e) => {
                const ag = agents.find((a) => a.id === e.target.value);
                onUpdate(node.id, {
                  ...d,
                  agentId: e.target.value,
                  agentColor: ag?.color ?? "",
                  label: d.label || ag?.name || "Agent Task",
                });
              }}
            >
              <option value="">Select agent...</option>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
        )}

        {nodeType === "condition" && (
          <label className="pe-prop-label">
            Condition Expression
            <input
              className="pe-prop-input"
              value={d.condition ?? ""}
              placeholder="e.g. status === 'success'"
              onChange={(e) => onUpdate(node.id, { ...d, condition: e.target.value })}
            />
          </label>
        )}

        {nodeType === "code" && (
          <label className="pe-prop-label">
            Script / Command
            <textarea
              className="pe-prop-textarea pe-prop-code"
              rows={4}
              value={d.script ?? ""}
              placeholder="#!/bin/bash&#10;echo hello"
              onChange={(e) => onUpdate(node.id, { ...d, script: e.target.value })}
            />
          </label>
        )}
      </div>

      <div className="pe-prop-footer">
        <button type="button" className="pe-btn pe-btn-danger" onClick={() => onDelete(node.id)}>
          Delete Node
        </button>
      </div>
    </div>
  );
}

// ── Add Node Menu ───────────────────────────────────────

interface AddNodeMenuProps {
  onAdd: (type: NodeType) => void;
  onClose: () => void;
}

function AddNodeMenu({ onAdd, onClose }: AddNodeMenuProps) {
  const types: NodeType[] = ["trigger", "agent", "code", "condition", "output"];
  return (
    <div className="pe-add-menu-backdrop" onClick={onClose}>
      <div className="pe-add-menu" onClick={(e) => e.stopPropagation()}>
        <h3 className="pe-add-menu-title">Add Node</h3>
        {types.map((t) => (
          <button
            key={t}
            type="button"
            className="pe-add-menu-item"
            onClick={() => {
              onAdd(t);
              onClose();
            }}
          >
            <span className="pe-add-menu-icon" style={{ background: NODE_COLORS[t] }}>
              {NODE_ICONS[t]}
            </span>
            <span className="pe-add-menu-label">{NODE_LABELS[t]}</span>
          </button>
        ))}
      </div>
    </div>
  );
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
  const [isNewUnsaved, setIsNewUnsaved] = useState(false);
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);
  const [showAddMenu, setShowAddMenu] = useState(false);

  const reactFlowWrapper = useRef<HTMLDivElement>(null);

  const onConnect = useCallback(
    (connection: Connection) =>
      setEdges((eds) => addEdge({ ...connection, ...defaultEdgeOptions }, eds)),
    [setEdges],
  );

  const onSelectionChange = useCallback(
    ({ nodes: sel }: OnSelectionChangeParams) => {
      if (sel.length === 1) {
        setSelectedNode(sel[0]);
      } else {
        setSelectedNode(null);
      }
    },
    [],
  );

  function updateNodeData(id: string, newData: Record<string, unknown>) {
    setNodes((nds) =>
      nds.map((n) => (n.id === id ? { ...n, data: newData } : n)),
    );
    if (selectedNode && selectedNode.id === id) {
      setSelectedNode((prev) => (prev ? { ...prev, data: newData } : prev));
    }
  }

  function deleteNode(id: string) {
    setNodes((nds) => nds.filter((n) => n.id !== id));
    setEdges((eds) => eds.filter((e) => e.source !== id && e.target !== id));
    if (selectedNode?.id === id) setSelectedNode(null);
  }

  function addNodeOfType(type: NodeType) {
    const id = `${type}-${Date.now()}`;
    const newNode: Node = {
      id,
      type,
      position: { x: 300 + Math.random() * 100, y: 200 + Math.random() * 100 },
      data: {
        label: NODE_LABELS[type],
        agentId: "",
        agentColor: "",
        condition: "",
        script: "",
        description: "",
      },
    };
    setNodes((nds) => [...nds, newNode]);
  }

  function handleAutoLayout() {
    setNodes((nds) => autoLayoutNodes(nds, edges));
  }

  function loadPipeline(pipeline: ConvexPipeline) {
    setActivePipeline(pipeline);
    setIsNewUnsaved(false);
    setPipelineName(pipeline.name);
    setSelectedNode(null);
    setNodes(pipelineToFlowNodes(pipeline, agents));
    setEdges(pipelineToFlowEdges(pipeline));
  }

  function createNewPipeline() {
    const defaults = newDefaultPipelineState();
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
    setSelectedNode(null);
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
    setSelectedNode(null);
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

    const bounds = reactFlowWrapper.current?.getBoundingClientRect();
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
        agentColor: agent.color,
        condition: "",
        script: "",
        description: "",
      },
    };

    setNodes((nds) => [...nds, newNode]);
  }

  const pipelineList = pipelines ?? [];

  return (
    <div className="pe-editor">
      {/* Left sidebar: pipeline list + agents */}
      <div className="pe-sidebar">
        <div className="pe-sidebar-section">
          <h3>Pipelines</h3>
          <button type="button" className="pe-btn pe-btn-primary pe-btn-full" onClick={createNewPipeline}>
            + New Pipeline
          </button>
          <div className="pe-pipeline-list">
            {pipelineList.map((p) => (
              <button
                type="button"
                key={p._id}
                className={`pe-pipeline-item ${activePipeline?._id === p._id ? "pe-pipeline-item-active" : ""}`}
                onClick={() => loadPipeline(p)}
              >
                <span className="pe-pipeline-item-name">{p.name}</span>
                <span className="pe-pipeline-item-count">{p.nodes.length} nodes</span>
              </button>
            ))}
            {pipelineList.length === 0 && (
              <p className="pe-sidebar-empty">No pipelines yet</p>
            )}
          </div>
        </div>

        <div className="pe-sidebar-section">
          <h3>Agents</h3>
          <p className="pe-sidebar-hint">Drag onto canvas</p>
          {agents.map((agent) => (
            <div
              key={agent.id}
              className="pe-agent-chip"
              draggable
              onDragStart={(event) => {
                event.dataTransfer.setData("application/pipeline-agent", agent.id);
                event.dataTransfer.effectAllowed = "move";
              }}
              style={{ "--agent-color": agent.color } as CSSProperties}
            >
              <span className="pe-agent-dot" />
              <span>{agent.name}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Center: canvas */}
      <div className="pe-canvas-area">
        {/* Toolbar */}
        <div className="pe-toolbar">
          {activePipeline ? (
            <>
              <input
                className="pe-toolbar-name"
                value={pipelineName}
                onChange={(e) => setPipelineName(e.target.value)}
                placeholder="Pipeline name..."
              />
              <div className="pe-toolbar-divider" />
              <button
                type="button"
                className="pe-toolbar-btn"
                onClick={() => setShowAddMenu(true)}
                title="Add node"
              >
                + Node
              </button>
              <button
                type="button"
                className="pe-toolbar-btn"
                onClick={handleAutoLayout}
                title="Auto-layout (DAG)"
              >
                Layout
              </button>
              {selectedNode && (
                <button
                  type="button"
                  className="pe-toolbar-btn pe-toolbar-btn-danger"
                  onClick={() => deleteNode(selectedNode.id)}
                  title="Delete selected node"
                >
                  Delete
                </button>
              )}
              <div className="pe-toolbar-spacer" />
              <button
                type="button"
                className="pe-toolbar-btn pe-toolbar-btn-save"
                onClick={() => void savePipeline()}
                disabled={isSaving}
              >
                {isSaving ? "Saving..." : "Save"}
              </button>
              <button
                type="button"
                className="pe-toolbar-btn pe-toolbar-btn-run"
                onClick={() => void executePipelineHandler()}
                title="Execute pipeline"
              >
                Run
              </button>
              <button
                type="button"
                className="pe-toolbar-btn pe-toolbar-btn-danger"
                onClick={() => void deletePipeline()}
                title="Delete pipeline"
              >
                Delete
              </button>
            </>
          ) : (
            <span className="pe-toolbar-hint">Select or create a pipeline to begin</span>
          )}
        </div>

        {/* ReactFlow canvas */}
        <div className="pe-flow-wrapper" ref={reactFlowWrapper}>
          {activePipeline ? (
            <ReactFlow
              nodes={nodes}
              edges={edges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              onSelectionChange={onSelectionChange}
              onDragOver={onDragOver}
              onDrop={onDrop}
              nodeTypes={nodeTypes}
              defaultEdgeOptions={defaultEdgeOptions}
              fitView
              colorMode="dark"
              snapToGrid
              snapGrid={[20, 20]}
              deleteKeyCode="Delete"
              multiSelectionKeyCode="Shift"
            >
              <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#2a3a4a" />
              <Controls showInteractive={false} />
              <MiniMap
                nodeStrokeWidth={3}
                pannable
                zoomable
                style={{ background: "#0e1525" }}
              />
            </ReactFlow>
          ) : (
            <div className="pe-empty-state">
              <div className="pe-empty-icon">&#x2B13;</div>
              <h3>Pipeline Editor</h3>
              <p>Select an existing pipeline from the sidebar, or create a new one to start building your workflow.</p>
              <button type="button" className="pe-btn pe-btn-primary" onClick={createNewPipeline}>
                Create Pipeline
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Right property panel (when node selected) */}
      {selectedNode && activePipeline && (
        <PropertyPanel
          node={selectedNode}
          agents={agents}
          onUpdate={updateNodeData}
          onDelete={deleteNode}
        />
      )}

      {/* Add-node modal */}
      {showAddMenu && (
        <AddNodeMenu
          onAdd={addNodeOfType}
          onClose={() => setShowAddMenu(false)}
        />
      )}
    </div>
  );
}
