import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { SoulDocument } from "@nateide/agents";
import { defaultSoulDocuments } from "@nateide/agents";

export type AgentRoleConfig = {
  id: string;
  name: string;
  provider: "anthropic" | "openai" | "google" | "openrouter";
  model: string;
  systemPrompt: string;
  triggerKeywords: string[];
  isQuickReply?: boolean;
  fallbackProviders?: Array<{ provider: "anthropic" | "openai" | "google" | "openrouter"; model: string }>;
};

export type IdeSettings = {
  apiKeys: {
    anthropic: string;
    openrouter: string;
    google: string;
    openai: string;
  };
  agentRoles: AgentRoleConfig[];
  soulDocuments: Record<string, SoulDocument>;
  conversationLoop: {
    maxRounds: number;
    enabled: boolean;
  };
  appearance: {
    density: "comfortable" | "compact";
    showBoardHints: boolean;
    theme: string;
  };
  terminal: {
    fontSize: number;
    shell: string;
  };
};

export type IdeSettingsPatch = {
  apiKeys?: Partial<IdeSettings["apiKeys"]>;
  agentRoles?: AgentRoleConfig[];
  soulDocuments?: Record<string, Partial<SoulDocument>>;
  conversationLoop?: Partial<IdeSettings["conversationLoop"]>;
  appearance?: Partial<IdeSettings["appearance"]>;
  terminal?: Partial<IdeSettings["terminal"]>;
};

const DEFAULT_SETTINGS: IdeSettings = {
  apiKeys: {
    anthropic: "",
    openrouter: "",
    google: "",
    openai: "",
  },
  agentRoles: [
    {
      id: "planner",
      name: "Planner",
      provider: "anthropic",
      model: "claude-opus-4-6",
      systemPrompt: "You are the orchestration planner. Decompose work, plan execution strategy, route tasks to other agents, and keep thread state coherent.",
      triggerKeywords: [],
    },
    {
      id: "executor",
      name: "Executor",
      provider: "openai",
      model: "gpt-5.4",
      systemPrompt: "You are the executor agent. Implement code changes, run terminal commands, and deliver working solutions. Be precise and action-oriented.",
      triggerKeywords: ["build", "implement", "code", "fix", "refactor", "scaffold", "wire", "terminal", "daemon", "editor", "ide", "api"],
    },
    {
      id: "reviewer",
      name: "Reviewer",
      provider: "google",
      model: "gemini-3.1-pro-preview",
      systemPrompt: "You are the reviewer agent. Review code for correctness, design frontend UI, and validate integration and visual quality. Call out risks and regressions.",
      triggerKeywords: ["review", "test", "validate", "risk", "audit", "check", "regression", "ui", "ux", "frontend", "design", "layout", "css"],
    },
    {
      id: "generalist",
      name: "Generalist",
      provider: "openrouter",
      model: "moonshotai/kimi-k2.5",
      systemPrompt: "You are a general-purpose reasoning agent. Brainstorm approaches, analyze problems, and provide thorough multimodal analysis.",
      triggerKeywords: ["brainstorm", "analyze", "reason", "think", "research", "explain"],
    },
    {
      id: "quick-reply",
      name: "Quick Reply",
      provider: "google",
      model: "gemini-3-flash-preview",
      systemPrompt: "You are a helpful assistant in a multi-agent orchestration IDE. The user is chatting casually — this is not a task. Be friendly, concise, and conversational.",
      triggerKeywords: [],
      isQuickReply: true,
    },
    {
      id: "memory",
      name: "Memory",
      provider: "openrouter",
      model: "deepseek/deepseek-chat",
      systemPrompt: "You extract key decisions, patterns, preferences, and lessons from agent conversations. Output each memory as a JSON array of objects with fields: type (decision|pattern|preference|lesson), content (a concise one-sentence summary). Extract only genuinely useful information — skip pleasantries, obvious statements, and temporary implementation details. Focus on things the team would want to remember for future conversations.",
      triggerKeywords: [],
    },
  ],
  soulDocuments: structuredClone(defaultSoulDocuments),
  conversationLoop: {
    maxRounds: 10,
    enabled: true,
  },
  appearance: {
    density: "comfortable",
    showBoardHints: true,
    theme: "default",
  },
  terminal: {
    fontSize: 14,
    shell: process.env.SHELL ?? "bash",
  },
};

function settingsPath(): string {
  const configRoot =
    process.env.XDG_CONFIG_HOME ??
    (process.env.HOME ? path.join(process.env.HOME, ".config") : "/tmp");
  return path.join(configRoot, "nateide", "settings.json");
}

export class SettingsStore {
  private cache: IdeSettings | null = null;

  async read(): Promise<IdeSettings> {
    if (this.cache) {
      return structuredClone(this.cache);
    }

    try {
      const raw = await readFile(settingsPath(), "utf8");
      const parsed = JSON.parse(raw) as IdeSettingsPatch;
      // Merge soul documents: start with defaults, overlay saved values field-by-field
      const mergedSouls = structuredClone(DEFAULT_SETTINGS.soulDocuments);
      if (parsed.soulDocuments) {
        for (const [agentId, overrides] of Object.entries(parsed.soulDocuments)) {
          const base = mergedSouls[agentId];
          if (base && overrides) {
            mergedSouls[agentId] = {
              ...base,
              ...overrides,
              learnedPreferences: [
                ...(base.learnedPreferences ?? []),
                ...(overrides.learnedPreferences ?? []),
              ],
            };
          } else if (overrides) {
            mergedSouls[agentId] = overrides as SoulDocument;
          }
        }
      }

      this.cache = {
        apiKeys: {
          ...DEFAULT_SETTINGS.apiKeys,
          ...parsed.apiKeys,
        },
        agentRoles: parsed.agentRoles ?? structuredClone(DEFAULT_SETTINGS.agentRoles),
        soulDocuments: mergedSouls,
        conversationLoop: {
          ...DEFAULT_SETTINGS.conversationLoop,
          ...(parsed.conversationLoop ?? {}),
        },
        appearance: {
          ...DEFAULT_SETTINGS.appearance,
          ...parsed.appearance,
        },
        terminal: {
          ...DEFAULT_SETTINGS.terminal,
          ...parsed.terminal,
        },
      };
    } catch {
      this.cache = structuredClone(DEFAULT_SETTINGS);
    }

    return structuredClone(this.cache);
  }

  async update(patch: IdeSettingsPatch): Promise<IdeSettings> {
    const current = await this.read();
    // Merge soul document patches field-by-field
    let mergedSouls = current.soulDocuments;
    if (patch.soulDocuments) {
      mergedSouls = structuredClone(current.soulDocuments);
      for (const [agentId, overrides] of Object.entries(patch.soulDocuments)) {
        const base = mergedSouls[agentId];
        if (base && overrides) {
          mergedSouls[agentId] = {
            ...base,
            ...overrides,
            learnedPreferences: overrides.learnedPreferences ?? base.learnedPreferences,
          };
        }
      }
    }

    const next: IdeSettings = {
      apiKeys: {
        ...current.apiKeys,
        ...patch.apiKeys,
      },
      agentRoles: patch.agentRoles ?? current.agentRoles,
      soulDocuments: mergedSouls,
      conversationLoop: {
        ...current.conversationLoop,
        ...patch.conversationLoop,
      },
      appearance: {
        ...current.appearance,
        ...patch.appearance,
      },
      terminal: {
        ...current.terminal,
        ...patch.terminal,
      },
    };

    await mkdir(path.dirname(settingsPath()), { recursive: true });
    await writeFile(settingsPath(), JSON.stringify(next, null, 2));
    this.cache = next;
    return structuredClone(next);
  }
}
