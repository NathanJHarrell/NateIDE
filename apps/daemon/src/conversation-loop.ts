import type { TokenUsage } from "@nateide/protocol";
import type { AgentDescriptor } from "@nateide/agents";
import type { AiMessage, ChatCompletionResult, AgentRoleConfig, AiApiKeys } from "./ai-client";
import { chatCompletionWithFallback } from "./ai-client";

// ── Types ──────────────────────────────────────────────────

export type AgentAction = "respond" | "pass" | "satisfied";

export type AgentResponse = {
  agentId: string;
  text: string;
  action: AgentAction;
  confidence?: number;
  delegateTo?: string;
  delegateToAll: string[];   // all @mentioned agent IDs
  dissent?: boolean;
  usage: TokenUsage;
};

export type ConversationRound = {
  roundNumber: number;
  respondingAgentIds: string[];
  responses: Map<string, AgentResponse>;
};

export type ConversationLoopConfig = {
  maxRounds: number;
  generation: number;
  signal: AbortSignal;
};

export type ConversationLoopCallbacks = {
  onRoundStarted(round: number, agentIds: string[]): void;
  onAgentResponse(agentId: string, response: AgentResponse): void;
  onRoundCompleted(round: ConversationRound): void;
  onLoopCompleted(rounds: ConversationRound[], reason: "converged" | "max_rounds" | "user_ended" | "canceled"): void;
  onDelegation(from: string, to: string, question: string): void;
  onChunk(agentId: string, runId: string, text: string): void;
};

export type AgentDispatchContext = {
  agent: AgentDescriptor;
  systemPrompt: string;
  runId: string;
  taskId: string;
  roles?: AgentRoleConfig[];
  fallbacks?: Array<{ provider: "anthropic" | "openai" | "google" | "openrouter"; model: string }>;
};

// ── Response parsing ────────────────────────────────────────

const ACTION_PREFIX = /^\[(RESPOND|PASS|SATISFIED)\]/i;
const CONFIDENCE_PREFIX = /\[CONFIDENCE:(\d{1,3})\]/i;
// Match both @agent-codex style and @Codex/@Gemini/@Kimi/@Claude natural names
const DELEGATE_PATTERN = /@(agent-\w+|[A-Z][a-z]+)/g;
const DISSENT_KEYWORDS = /\b(disagree|incorrect|actually|however|push back|that's wrong|not quite|fundamentally|strongly disagree)\b/i;

// Map natural agent names to agent IDs
const AGENT_NAME_TO_ID: Record<string, string> = {
  claude: "agent-controller",
  codex: "agent-codex",
  gemini: "agent-gemini",
  kimi: "agent-kimi",
  "agent-controller": "agent-controller",
  "agent-codex": "agent-codex",
  "agent-gemini": "agent-gemini",
  "agent-kimi": "agent-kimi",
};

function resolveAgentMention(mention: string): string | undefined {
  return AGENT_NAME_TO_ID[mention.toLowerCase()];
}

export function parseAgentResponse(rawText: string, agentId: string): AgentResponse {
  let text = rawText.trim();
  let action: AgentAction = "respond";
  let confidence: number | undefined;
  let delegateTo: string | undefined;
  const delegateToAll: string[] = [];

  // Extract action prefix
  const actionMatch = text.match(ACTION_PREFIX);
  if (actionMatch) {
    action = actionMatch[1].toLowerCase() as AgentAction;
    text = text.slice(actionMatch[0].length).trim();
  }

  // Extract confidence
  const confMatch = text.match(CONFIDENCE_PREFIX);
  if (confMatch) {
    confidence = Math.min(100, Math.max(0, parseInt(confMatch[1], 10)));
    text = text.replace(CONFIDENCE_PREFIX, "").trim();
  }

  // Detect delegation targets — resolve natural names to agent IDs
  const delegateMatches = [...text.matchAll(DELEGATE_PATTERN)];
  for (const match of delegateMatches) {
    const resolved = resolveAgentMention(match[1]);
    if (resolved && resolved !== agentId && !delegateToAll.includes(resolved)) {
      delegateToAll.push(resolved);
    }
  }
  delegateTo = delegateToAll[0];

  // Detect dissent
  const dissent = DISSENT_KEYWORDS.test(text);

  // If text is empty after stripping prefixes but action was "respond", treat as pass
  if (!text && action === "respond") {
    action = "pass";
  }

  return {
    agentId,
    text,
    action,
    confidence,
    delegateTo,
    delegateToAll,
    dissent,
    usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
  };
}

// ── Dissent detection ────────────────────────────────────────

export type DissentInfo = {
  dissentingAgentId: string;
  agreeingAgentIds: string[];
  topic: string;
  confidence: number;
  isHighConfidence: boolean;
};

export function detectDissent(responses: Map<string, AgentResponse>): DissentInfo | null {
  const active = [...responses.values()].filter((r) => r.action === "respond");
  if (active.length < 2) return null;

  // Check for explicit dissent markers
  const dissenters = active.filter((r) => r.dissent);
  if (dissenters.length === 0) return null;

  // Find the strongest dissenter
  const dissenter = dissenters.reduce((best, r) =>
    (r.confidence ?? 50) > (best.confidence ?? 50) ? r : best,
  );

  const agreeing = active
    .filter((r) => r.agentId !== dissenter.agentId)
    .map((r) => r.agentId);

  // Confidence spread check
  const dissenterConf = dissenter.confidence ?? 50;
  const agreeingConfs = agreeing.map((id) => responses.get(id)?.confidence ?? 50);
  const avgAgreeingConf = agreeingConfs.reduce((a, b) => a + b, 0) / (agreeingConfs.length || 1);

  // High confidence: dissenter has >=40 confidence OR strong keywords with wide spread
  const isHighConfidence =
    dissenterConf >= 40 ||
    (DISSENT_KEYWORDS.test(dissenter.text) && Math.abs(avgAgreeingConf - dissenterConf) > 25);

  return {
    dissentingAgentId: dissenter.agentId,
    agreeingAgentIds: agreeing,
    topic: dissenter.text.slice(0, 100),
    confidence: dissenterConf,
    isHighConfidence,
  };
}

// ── Context windowing ────────────────────────────────────────

const MODEL_CONTEXT_LIMITS: Record<string, number> = {
  "claude-opus-4-6": 200000,
  "gpt-5.4": 128000,
  "gemini-3.1-pro-preview": 1000000,
  "gemini-3-flash-preview": 1000000,
  "moonshotai/kimi-k2.5": 128000,
  "deepseek/deepseek-chat": 128000,
};

export function getContextLimit(model: string): number {
  return MODEL_CONTEXT_LIMITS[model] ?? 128000;
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function buildWindowedMessages(
  agentId: string,
  allMessages: AiMessage[],
  model: string,
  sharedMemory: string,
): AiMessage[] {
  const limit = getContextLimit(model);
  const budget = Math.floor(limit * 0.7); // 70% of context for messages

  // Estimate memory tokens
  const memoryTokens = estimateTokens(sharedMemory);
  const messageBudget = budget - memoryTokens;

  if (messageBudget <= 0) {
    // Memory alone exceeds budget — return just the last few messages
    return allMessages.slice(-3);
  }

  // Build from most recent backward
  const result: AiMessage[] = [];
  let tokenCount = 0;

  for (let i = allMessages.length - 1; i >= 0; i--) {
    const msg = allMessages[i];
    const tokens = estimateTokens(msg.content);
    if (tokenCount + tokens > messageBudget) break;
    result.unshift(msg);
    tokenCount += tokens;
  }

  return result;
}

// ── Message attribution ──────────────────────────────────────

export function buildThreadMessagesForAgent(
  agentId: string,
  userMessages: AiMessage[],
  agentResponses: Map<string, { agentName: string; text: string }>[],
  roundNumber: number,
): AiMessage[] {
  const messages: AiMessage[] = [];

  // Add initial user message(s)
  for (const msg of userMessages) {
    messages.push({
      role: "user",
      content: `[user]: ${msg.content}`,
    });
  }

  // Add prior round responses
  for (let r = 0; r < roundNumber - 1 && r < agentResponses.length; r++) {
    const round = agentResponses[r];
    for (const [id, resp] of round.entries()) {
      if (id === agentId) {
        // Own prior message
        messages.push({ role: "assistant", content: resp.text });
      } else {
        // Other agent's message
        messages.push({
          role: "user",
          content: `[${resp.agentName}]: ${resp.text}`,
        });
      }
    }
  }

  return messages;
}

// ── Conversation loop system prompt ──────────────────────────

export function buildConversationLoopPromptAddition(roundNumber: number, agentNames: string[]): string {
  if (roundNumber <= 1) return "";

  return [
    "",
    "--- CONVERSATION ROUND INSTRUCTIONS ---",
    `This is round ${roundNumber} of a multi-agent conversation. You are seeing messages from other agents above.`,
    `Other agents in this conversation: ${agentNames.join(", ")}.`,
    "",
    "You MUST start your response with exactly one of these prefixes:",
    "- [RESPOND] — You have something substantive to add, correct, or build upon.",
    "- [PASS] — You have nothing to add. The conversation doesn't need your input right now.",
    "- [SATISFIED] — You agree the current state is good and have nothing further to contribute.",
    "",
    "Optionally include [CONFIDENCE:XX] (0-100) to indicate how confident you are.",
    "You may @agent-name to specifically request another agent's input.",
    "",
    "Guidelines:",
    "- Only respond if you have genuine value to add. Passing is fine and expected.",
    "- If you disagree with another agent, say so directly with reasoning.",
    "- Build on other agents' work rather than repeating what's been said.",
    "- Be concise. Earlier rounds provided the detail — now focus on refinement.",
    "--- END ROUND INSTRUCTIONS ---",
    "",
  ].join("\n");
}

// ── Agent action parsing ─────────────────────────────────────

export type AgentActionBlock =
  | { type: "read_file"; path: string }
  | { type: "run_command"; command: string }
  | { type: "write_file"; path: string; content: string };

const ACTION_BLOCK_RE = /\[ACTION:(READ_FILE|RUN_COMMAND|WRITE_FILE)\]([\s\S]*?)\[\/ACTION\]/g;
const ACTION_PATH_RE = /path:\s*(.+)/;
const ACTION_CMD_RE = /command:\s*(.+)/;
const ACTION_CONTENT_RE = /content:\n([\s\S]*)/;

export function parseActionBlocks(text: string): { actions: AgentActionBlock[]; cleanText: string } {
  const actions: AgentActionBlock[] = [];
  let cleanText = text;

  let match;
  while ((match = ACTION_BLOCK_RE.exec(text)) !== null) {
    const actionType = match[1];
    const body = match[2].trim();

    switch (actionType) {
      case "READ_FILE": {
        const pathMatch = body.match(ACTION_PATH_RE);
        if (pathMatch) {
          actions.push({ type: "read_file", path: pathMatch[1].trim() });
        }
        break;
      }
      case "RUN_COMMAND": {
        const cmdMatch = body.match(ACTION_CMD_RE);
        if (cmdMatch) {
          actions.push({ type: "run_command", command: cmdMatch[1].trim() });
        }
        break;
      }
      case "WRITE_FILE": {
        const pathMatch = body.match(ACTION_PATH_RE);
        const contentMatch = body.match(ACTION_CONTENT_RE);
        if (pathMatch && contentMatch) {
          actions.push({ type: "write_file", path: pathMatch[1].trim(), content: contentMatch[1] });
        }
        break;
      }
    }

    cleanText = cleanText.replace(match[0], "").trim();
  }

  return { actions, cleanText };
}

export function buildToolUsePrompt(canEditFiles: boolean, canRunCommands: boolean): string {
  if (!canEditFiles && !canRunCommands) return "";

  const sections = [
    "",
    "--- TOOL USE INSTRUCTIONS ---",
    "You can execute actions in the workspace by including action blocks in your response.",
    "Action blocks will be executed and results fed back to you. You may include multiple action blocks.",
    "",
  ];

  if (canRunCommands) {
    sections.push(
      "To run a terminal command:",
      "[ACTION:RUN_COMMAND]",
      "command: <shell command>",
      "[/ACTION]",
      "",
    );
  }

  sections.push(
    "To read a file:",
    "[ACTION:READ_FILE]",
    "path: <absolute or workspace-relative path>",
    "[/ACTION]",
    "",
  );

  if (canEditFiles) {
    sections.push(
      "To write/create a file:",
      "[ACTION:WRITE_FILE]",
      "path: <absolute or workspace-relative path>",
      "content:",
      "<file content here>",
      "[/ACTION]",
      "",
    );
  }

  sections.push(
    "IMPORTANT:",
    "- Use actions to actually DO work, not just discuss it. Read files before editing. Run commands to build/test.",
    "- After action blocks are executed, you'll receive the results and can continue with more actions or provide your final response.",
    "- When your response has no action blocks, it is treated as your final message for this turn.",
    "- Action blocks are stripped from the displayed message — include any commentary outside the blocks.",
    "--- END TOOL USE INSTRUCTIONS ---",
    "",
  );

  return sections.join("\n");
}

// ── Parallel workstream parsing ──────────────────────────────

export type ParallelDirective = {
  tasks: Array<{ agentId: string; goal: string }>;
  syncGoal: string;
};

const PARALLEL_BLOCK = /\[PARALLEL\]\s*([\s\S]*?)\[SYNC\]\s*(.*)/;
const PARALLEL_TASK = /^-\s*(\S+):\s*(.+)$/gm;

export function parseParallelDirectives(text: string): ParallelDirective | null {
  const match = text.match(PARALLEL_BLOCK);
  if (!match) return null;

  const taskBlock = match[1];
  const syncGoal = match[2].trim();
  const tasks: Array<{ agentId: string; goal: string }> = [];

  let taskMatch;
  while ((taskMatch = PARALLEL_TASK.exec(taskBlock)) !== null) {
    tasks.push({ agentId: taskMatch[1], goal: taskMatch[2].trim() });
  }

  if (tasks.length === 0) return null;
  return { tasks, syncGoal };
}

// ── Main conversation loop ──────────────────────────────────

export async function runConversationLoop(
  initialAssignments: AgentDispatchContext[],
  availableAgents: Map<string, AgentDispatchContext>,
  userMessages: AiMessage[],
  apiKeys: AiApiKeys,
  config: ConversationLoopConfig,
  callbacks: ConversationLoopCallbacks,
  dispatchAgent: (
    context: AgentDispatchContext,
    messages: AiMessage[],
    apiKeys: AiApiKeys,
    onChunk: (text: string) => void,
    signal: AbortSignal,
  ) => Promise<ChatCompletionResult>,
): Promise<ConversationRound[]> {
  const rounds: ConversationRound[] = [];
  // allAgents tracks agents currently IN the conversation loop
  const allAgents = new Map<string, AgentDispatchContext>();
  const roundResponses: Map<string, { agentName: string; text: string }>[] = [];
  // Track which agents have been satisfied/passed for convergence
  const satisfiedAgents = new Set<string>();

  for (const ctx of initialAssignments) {
    allAgents.set(ctx.agent.id, ctx);
  }

  for (let roundNum = 1; roundNum <= config.maxRounds; roundNum++) {
    if (config.signal.aborted) {
      callbacks.onLoopCompleted(rounds, "canceled");
      return rounds;
    }

    // Determine which agents participate this round
    let respondingAgentIds: string[];
    if (roundNum === 1) {
      respondingAgentIds = initialAssignments.map((a) => a.agent.id);
    } else {
      // Include all agents that haven't said "satisfied" yet
      // Plus any agents that were @mentioned in the previous round
      const prevRound = rounds[rounds.length - 1];
      const mentionedAgents = new Set<string>();
      for (const resp of prevRound.responses.values()) {
        // Check ALL delegation targets, not just the first
        for (const targetId of resp.delegateToAll) {
          // If the target is in availableAgents but not yet in allAgents, pull them in
          if (!allAgents.has(targetId) && availableAgents.has(targetId)) {
            allAgents.set(targetId, availableAgents.get(targetId)!);
          }
          if (allAgents.has(targetId)) {
            mentionedAgents.add(targetId);
            callbacks.onDelegation(resp.agentId, targetId, resp.text.slice(0, 200));
          }
        }
      }

      respondingAgentIds = [...allAgents.keys()].filter(
        (id) => !satisfiedAgents.has(id) || mentionedAgents.has(id),
      );

      // Force mentioned agents into this round even if they previously passed
      for (const id of mentionedAgents) {
        if (!respondingAgentIds.includes(id)) {
          respondingAgentIds.push(id);
          satisfiedAgents.delete(id); // Reset their satisfaction since they were called upon
        }
      }

      // If all agents are satisfied, we're done
      if (respondingAgentIds.length === 0) {
        callbacks.onLoopCompleted(rounds, "converged");
        return rounds;
      }
    }

    const observingAgentIds = [...allAgents.keys()].filter(
      (id) => !respondingAgentIds.includes(id),
    );

    callbacks.onRoundStarted(roundNum, respondingAgentIds);

    const round: ConversationRound = {
      roundNumber: roundNum,
      respondingAgentIds,
      responses: new Map(),
    };

    // Build attributed messages for this round
    const agentNames = [...allAgents.values()].map((a) => a.agent.name);

    // Dispatch all agents in this round concurrently
    const dispatches = respondingAgentIds.map(async (agentId) => {
      const ctx = allAgents.get(agentId)!;

      // Build messages with attribution
      let messages: AiMessage[];
      if (roundNum === 1) {
        messages = [...userMessages];
      } else {
        messages = buildThreadMessagesForAgent(
          agentId,
          userMessages,
          roundResponses,
          roundNum,
        );
      }

      // Add conversation loop prompt for round 2+
      const loopPrompt = buildConversationLoopPromptAddition(roundNum, agentNames);
      const fullSystemPrompt = ctx.systemPrompt + loopPrompt;

      // Apply context windowing
      const model = ctx.agent.model;
      const windowedMessages = buildWindowedMessages(agentId, messages, model, "");

      let fullText = "";
      try {
        const result = await dispatchAgent(
          { ...ctx, systemPrompt: fullSystemPrompt },
          windowedMessages,
          apiKeys,
          (text) => {
            fullText += text;
            callbacks.onChunk(agentId, ctx.runId, text);
          },
          config.signal,
        );

        const parsed = parseAgentResponse(result.text, agentId);
        parsed.usage = result.usage;

        round.responses.set(agentId, parsed);
        callbacks.onAgentResponse(agentId, parsed);

        // Track satisfaction
        if (parsed.action === "satisfied") {
          satisfiedAgents.add(agentId);
        } else if (parsed.action === "pass") {
          // Passes don't count as satisfied — they might want to respond later
        } else {
          // Active response clears satisfied state
          satisfiedAgents.delete(agentId);
        }

        return parsed;
      } catch (error) {
        // On error, treat as pass
        const errorResponse: AgentResponse = {
          agentId,
          text: `Error: ${error instanceof Error ? error.message : "Unknown error"}`,
          action: "pass",
          delegateToAll: [],
          usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        };
        round.responses.set(agentId, errorResponse);
        callbacks.onAgentResponse(agentId, errorResponse);
        return errorResponse;
      }
    });

    await Promise.allSettled(dispatches);

    // Store responses for next round's message building
    const roundResponseMap = new Map<string, { agentName: string; text: string }>();
    for (const [id, resp] of round.responses) {
      if (resp.action === "respond") {
        const ctx = allAgents.get(id);
        roundResponseMap.set(id, {
          agentName: ctx?.agent.name ?? id,
          text: resp.text,
        });
      }
    }
    roundResponses.push(roundResponseMap);

    rounds.push(round);
    callbacks.onRoundCompleted(round);

    // Check dissent after each round
    // (dissent info is available via detectDissent() for callers to use)

    // Termination check
    const activeResponders = [...round.responses.values()].filter(
      (r) => r.action === "respond",
    );
    const allPassedOrSatisfied = activeResponders.length === 0;

    if (allPassedOrSatisfied && roundNum > 1) {
      callbacks.onLoopCompleted(rounds, "converged");
      return rounds;
    }
  }

  callbacks.onLoopCompleted(rounds, "max_rounds");
  return rounds;
}
