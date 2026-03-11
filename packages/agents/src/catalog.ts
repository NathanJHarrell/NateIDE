import type { AgentProfile } from "@nateide/protocol";

export type AgentDescriptor = AgentProfile & {
  color: string;
  specialty: string;
};

export const defaultAgentProfiles: AgentDescriptor[] = [
  {
    id: "agent-controller",
    name: "Claude",
    role: "planner",
    provider: "anthropic",
    model: "claude-opus-4-6",
    canEditFiles: false,
    canRunCommands: false,
    canApprove: true,
    color: "#ff6b2c",
    specialty: "decomposes work, plans execution strategy, routes tasks, and keeps thread state coherent",
  },
  {
    id: "agent-codex",
    name: "Codex",
    role: "executor",
    provider: "openai",
    model: "gpt-5.4",
    canEditFiles: true,
    canRunCommands: true,
    canApprove: false,
    color: "#147a6a",
    specialty: "executes code changes, runs terminal commands, and implements planned tasks",
  },
  {
    id: "agent-gemini",
    name: "Gemini",
    role: "reviewer",
    provider: "google",
    model: "gemini-3.1-pro-preview",
    canEditFiles: true,
    canRunCommands: true,
    canApprove: true,
    color: "#0067b8",
    specialty: "reviews code, designs frontend UI, and validates integration and visual quality",
  },
  {
    id: "agent-kimi",
    name: "Kimi",
    role: "generalist",
    provider: "openrouter",
    model: "moonshotai/kimi-k2.5",
    canEditFiles: true,
    canRunCommands: false,
    canApprove: false,
    color: "#8a5028",
    specialty: "general-purpose reasoning, chat, brainstorming, and multimodal analysis",
  },
];

export function getAgentById(agentId: string): AgentDescriptor | undefined {
  return defaultAgentProfiles.find((agent) => agent.id === agentId);
}
