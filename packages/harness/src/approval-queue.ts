import type { ApprovalDecision, ApprovalRequest, ApprovalResult, ToolAction } from "./types";

/** Default timeout for approval requests (5 minutes) */
const APPROVAL_TIMEOUT_MS = 5 * 60 * 1000;

type PendingApproval = {
  request: ApprovalRequest;
  resolve: (result: ApprovalResult) => void;
  timer: ReturnType<typeof setTimeout>;
};

/**
 * ApprovalQueue holds pending tool calls that need user confirmation.
 *
 * When a tool call needs approval (based on ToolRegistry.needsApproval),
 * the harness runtime submits it here. The queue creates a promise that
 * the runtime awaits. The UI subscribes to pending approvals and shows
 * confirmation cards. When the user clicks approve/deny, the queue resolves
 * the promise.
 *
 * Timeout: if no response in 5 minutes, auto-deny and feed a timeout
 * message back to the agent.
 */
export class ApprovalQueue {
  private pending: Map<string, PendingApproval> = new Map();
  private idCounter = 0;
  private readonly timeoutMs: number;

  /** Called when a new approval is queued — wire this to the UI layer */
  onApprovalRequested?: (request: ApprovalRequest) => void;
  /** Called when an approval is resolved (approved/denied/timed out) */
  onApprovalResolved?: (result: ApprovalResult) => void;

  constructor(options?: { timeoutMs?: number }) {
    this.timeoutMs = options?.timeoutMs ?? APPROVAL_TIMEOUT_MS;
  }

  /**
   * Submit an action for user approval. Returns a promise that resolves
   * when the user approves or denies, or rejects on timeout.
   */
  async requestApproval(harnessId: string, action: ToolAction): Promise<ApprovalResult> {
    const requestId = `approval-${++this.idCounter}-${Date.now()}`;

    const request: ApprovalRequest = {
      id: requestId,
      harnessId,
      action,
      description: this.describeAction(action),
      createdAt: Date.now(),
    };

    return new Promise<ApprovalResult>((resolve) => {
      const timer = setTimeout(() => {
        this.resolveRequest(requestId, "denied", "timeout");
      }, this.timeoutMs);

      this.pending.set(requestId, { request, resolve, timer });

      // Notify listeners
      this.onApprovalRequested?.(request);
    });
  }

  /**
   * Called by the UI when the user approves or denies a pending request.
   */
  resolve(requestId: string, decision: ApprovalDecision, decidedBy?: string): void {
    this.resolveRequest(requestId, decision, decidedBy);
  }

  /**
   * Get all pending approval requests.
   */
  getPending(): ApprovalRequest[] {
    return [...this.pending.values()].map((p) => p.request);
  }

  /**
   * Get a specific pending request.
   */
  getRequest(requestId: string): ApprovalRequest | undefined {
    return this.pending.get(requestId)?.request;
  }

  /**
   * Check if there are any pending approvals.
   */
  hasPending(): boolean {
    return this.pending.size > 0;
  }

  /**
   * Cancel all pending approvals (e.g., when the harness run is aborted).
   */
  cancelAll(): void {
    for (const [id] of this.pending) {
      this.resolveRequest(id, "denied", "canceled");
    }
  }

  /**
   * Number of pending approvals.
   */
  get size(): number {
    return this.pending.size;
  }

  // ── Private ──────────────────────────────────────────────────

  private resolveRequest(requestId: string, decision: ApprovalDecision, decidedBy?: string): void {
    const entry = this.pending.get(requestId);
    if (!entry) return;

    clearTimeout(entry.timer);
    this.pending.delete(requestId);

    const result: ApprovalResult = {
      requestId,
      decision,
      decidedBy,
      decidedAt: Date.now(),
    };

    // Notify listeners
    this.onApprovalResolved?.(result);

    // Resolve the promise so the harness runtime can continue
    entry.resolve(result);
  }

  /**
   * Create a human-readable description of a tool action for the approval card.
   */
  private describeAction(action: ToolAction): string {
    switch (action.tool) {
      case "write_file":
        return `Write file: ${action.path} (${action.content.length} chars)`;
      case "run_command":
        return `Run command: ${action.command}${action.cwd ? ` in ${action.cwd}` : ""}`;
      case "git":
        return `Git ${action.operation}${action.args ? ` ${action.args.join(" ")}` : ""}`;
      case "terminal_session":
        return `Terminal: ${action.command}`;
      case "custom":
        return `Custom tool: ${action.toolId}`;
      case "mcp":
        return `MCP tool: ${action.serverId}/${action.toolName}`;
      default:
        return `Tool call: ${action.tool}`;
    }
  }
}
