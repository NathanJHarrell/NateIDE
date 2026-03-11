import Anthropic from "@anthropic-ai/sdk";
import type { TokenUsage } from "@nateide/protocol";

export type AiProvider = "anthropic" | "openai" | "google" | "openrouter";

export type AiMessage = {
  role: "user" | "assistant";
  content: string;
};

export type AiStreamChunk = {
  type: "text_delta" | "done";
  text: string;
};

export type AiApiKeys = {
  anthropic: string;
  google: string;
  openai: string;
  openrouter: string;
};

export type AgentRoleConfig = {
  id: string;
  name: string;
  provider: AiProvider;
  model: string;
  systemPrompt: string;
  triggerKeywords: string[];
  isQuickReply?: boolean;
  fallbackProviders?: Array<{ provider: AiProvider; model: string }>;
};

const DEFAULT_ROLES: AgentRoleConfig[] = [
  { id: "planner", name: "Planner", provider: "anthropic", model: "claude-opus-4-6", systemPrompt: "", triggerKeywords: [] },
  { id: "executor", name: "Executor", provider: "openai", model: "gpt-5.4", systemPrompt: "", triggerKeywords: [] },
  { id: "reviewer", name: "Reviewer", provider: "google", model: "gemini-3.1-pro-preview", systemPrompt: "", triggerKeywords: [] },
  { id: "generalist", name: "Generalist", provider: "openrouter", model: "moonshotai/kimi-k2.5", systemPrompt: "", triggerKeywords: [] },
  { id: "quick-reply", name: "Quick Reply", provider: "google", model: "gemini-3-flash-preview", systemPrompt: "", triggerKeywords: [], isQuickReply: true },
];

const AGENT_ID_TO_ROLE: Record<string, string> = {
  "agent-controller": "planner",
  "agent-codex": "executor",
  "agent-gemini": "reviewer",
  "agent-kimi": "generalist",
  "quick-reply": "quick-reply",
};

function resolveAgent(agentId: string, roles?: AgentRoleConfig[]): { provider: AiProvider; model: string } {
  const roleId = AGENT_ID_TO_ROLE[agentId] ?? "quick-reply";
  const configs = roles ?? DEFAULT_ROLES;
  const match = configs.find((r) => r.id === roleId);
  if (match) return { provider: match.provider as AiProvider, model: match.model };
  const fallback = configs.find((r) => r.isQuickReply) ?? DEFAULT_ROLES[4];
  return { provider: fallback.provider as AiProvider, model: fallback.model };
}

function providerLabel(provider: AiProvider): string {
  switch (provider) {
    case "anthropic":
      return "Anthropic";
    case "openai":
      return "OpenAI";
    case "google":
      return "Google";
    case "openrouter":
      return "OpenRouter";
    default:
      return provider;
  }
}

function extractApiErrorMessage(provider: string, status: number, body: string): string {
  try {
    const parsed = JSON.parse(body);
    const msg =
      parsed?.error?.message ??
      parsed?.error?.status ??
      parsed?.message ??
      "";

    if (typeof msg === "string" && msg.length > 0) {
      // Take first sentence (period-terminated) or first line, cap at 120 chars
      const firstLine = msg.split(/[\n\r]/)[0];
      const firstSentence = firstLine.split(/\.\s/)[0];
      const short = (firstSentence.length < firstLine.length ? firstSentence + "." : firstLine).slice(0, 120);
      return `${provider} error (${status}): ${short}`;
    }
  } catch {
    // not JSON — extract just a brief snippet
  }

  // Fallback: strip any JSON/HTML noise
  const snippet = body.replace(/[{}\[\]"]/g, " ").replace(/\s+/g, " ").trim().slice(0, 100);
  return `${provider} error (${status}): ${snippet || "Unknown error"}`;
}

// Cost per 1M tokens: [input, output]
const MODEL_COSTS: Record<string, [number, number]> = {
  "claude-opus-4-6": [15, 75],
  "gpt-5.4": [2.5, 10],
  "gemini-3.1-pro-preview": [1.25, 5],
  "gemini-3-flash-preview": [0.075, 0.3],
  "moonshotai/kimi-k2.5": [0.5, 2],
};

function estimateCost(model: string, inputTokens: number, outputTokens: number): number {
  const costs = MODEL_COSTS[model] ?? [1, 4];
  return (inputTokens * costs[0] + outputTokens * costs[1]) / 1_000_000;
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// ── Context limits per model ─────────────────────────────────

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

export type ChatCompletionResult = {
  text: string;
  usage: TokenUsage;
};

function getApiKey(keys: AiApiKeys, provider: AiProvider): string {
  switch (provider) {
    case "anthropic":
      return keys.anthropic;
    case "openai":
      return keys.openai;
    case "google":
      return keys.google;
    case "openrouter":
      return keys.openrouter;
    default:
      return "";
  }
}

export async function chatCompletion(
  agentId: string,
  systemPrompt: string,
  messages: AiMessage[],
  apiKeys: AiApiKeys,
  onChunk: (chunk: AiStreamChunk) => void,
  roles?: AgentRoleConfig[],
  signal?: AbortSignal,
): Promise<ChatCompletionResult> {
  const { provider, model } = resolveAgent(agentId, roles);
  const apiKey = getApiKey(apiKeys, provider);

  if (!apiKey) {
    const label = providerLabel(provider);
    throw new Error(
      `No API key configured for ${label}. Add your ${label} key in Settings.`,
    );
  }

  let result: ChatCompletionResult;

  switch (provider) {
    case "anthropic":
      result = await streamAnthropic(apiKey, model, systemPrompt, messages, onChunk, signal);
      break;
    case "openai":
      result = await streamOpenAi(apiKey, model, systemPrompt, messages, onChunk, "https://api.openai.com/v1/chat/completions", signal);
      break;
    case "google":
      result = await streamGoogle(apiKey, model, systemPrompt, messages, onChunk, signal);
      break;
    case "openrouter":
      result = await streamOpenAi(apiKey, model, systemPrompt, messages, onChunk, "https://openrouter.ai/api/v1/chat/completions", signal);
      break;
    default:
      throw new Error(`Unsupported provider: ${provider}`);
  }

  // Fill in cost estimate
  result.usage.estimatedCostUsd = estimateCost(model, result.usage.inputTokens, result.usage.outputTokens);

  return result;
}

export async function chatCompletionWithFallback(
  agentId: string,
  systemPrompt: string,
  messages: AiMessage[],
  apiKeys: AiApiKeys,
  onChunk: (chunk: AiStreamChunk) => void,
  roles?: AgentRoleConfig[],
  signal?: AbortSignal,
  fallbacks?: Array<{ provider: AiProvider; model: string }>,
  onFallback?: (fromProvider: string, toProvider: string, error: string) => void,
): Promise<ChatCompletionResult> {
  try {
    return await chatCompletion(agentId, systemPrompt, messages, apiKeys, onChunk, roles, signal);
  } catch (primaryError) {
    // Don't retry if aborted
    if (signal?.aborted) throw primaryError;

    const errors: string[] = [primaryError instanceof Error ? primaryError.message : String(primaryError)];

    if (fallbacks && fallbacks.length > 0) {
      const { provider: primaryProvider } = resolveAgent(agentId, roles);

      for (const fb of fallbacks) {
        if (signal?.aborted) throw primaryError;

        const fbKey = getApiKey(apiKeys, fb.provider);
        if (!fbKey) continue;

        try {
          onFallback?.(providerLabel(primaryProvider), providerLabel(fb.provider), errors[errors.length - 1]);

          let result: ChatCompletionResult;
          switch (fb.provider) {
            case "anthropic":
              result = await streamAnthropic(fbKey, fb.model, systemPrompt, messages, onChunk, signal);
              break;
            case "openai":
              result = await streamOpenAi(fbKey, fb.model, systemPrompt, messages, onChunk, "https://api.openai.com/v1/chat/completions", signal);
              break;
            case "google":
              result = await streamGoogle(fbKey, fb.model, systemPrompt, messages, onChunk, signal);
              break;
            case "openrouter":
              result = await streamOpenAi(fbKey, fb.model, systemPrompt, messages, onChunk, "https://openrouter.ai/api/v1/chat/completions", signal);
              break;
            default:
              continue;
          }
          result.usage.estimatedCostUsd = estimateCost(fb.model, result.usage.inputTokens, result.usage.outputTokens);
          return result;
        } catch (fbError) {
          errors.push(fbError instanceof Error ? fbError.message : String(fbError));
        }
      }
    }

    throw primaryError;
  }
}

async function streamAnthropic(
  apiKey: string,
  model: string,
  systemPrompt: string,
  messages: AiMessage[],
  onChunk: (chunk: AiStreamChunk) => void,
  signal?: AbortSignal,
): Promise<ChatCompletionResult> {
  const client = new Anthropic({ apiKey });
  let full = "";

  const stream = client.messages.stream({
    model,
    max_tokens: 4096,
    system: systemPrompt,
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
  });

  // Wire up abort
  if (signal) {
    const onAbort = () => stream.abort();
    signal.addEventListener("abort", onAbort, { once: true });
  }

  try {
    for await (const event of stream) {
      if (
        event.type === "content_block_delta" &&
        event.delta.type === "text_delta"
      ) {
        full += event.delta.text;
        onChunk({ type: "text_delta", text: event.delta.text });
      }
    }
  } catch (error) {
    // If aborted, return what we have so far
    if (signal?.aborted) {
      onChunk({ type: "done", text: "" });
      return {
        text: full,
        usage: {
          inputTokens: estimateTokens(systemPrompt + messages.map((m) => m.content).join("")),
          outputTokens: estimateTokens(full),
          totalTokens: 0,
        },
      };
    }
    throw error;
  }

  // Extract real usage from final message
  let inputTokens = 0;
  let outputTokens = 0;
  try {
    const finalMsg = await stream.finalMessage();
    inputTokens = finalMsg.usage?.input_tokens ?? 0;
    outputTokens = finalMsg.usage?.output_tokens ?? 0;
  } catch {
    inputTokens = estimateTokens(systemPrompt + messages.map((m) => m.content).join(""));
    outputTokens = estimateTokens(full);
  }

  onChunk({ type: "done", text: "" });
  return {
    text: full,
    usage: {
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
    },
  };
}

async function streamOpenAi(
  apiKey: string,
  model: string,
  systemPrompt: string,
  messages: AiMessage[],
  onChunk: (chunk: AiStreamChunk) => void,
  baseUrl = "https://api.openai.com/v1/chat/completions",
  signal?: AbortSignal,
): Promise<ChatCompletionResult> {
  const isOpenRouter = baseUrl.includes("openrouter.ai");

  // Newer OpenAI models (gpt-5.x, o-series) require max_completion_tokens
  const isNativeOpenAi = !isOpenRouter && baseUrl.includes("openai.com");
  const useNewTokenParam = isNativeOpenAi && (model.startsWith("gpt-5") || model.startsWith("o"));

  const payload: Record<string, unknown> = {
    model,
    stream: true,
    messages: [
      { role: "system", content: systemPrompt },
      ...messages.map((m) => ({ role: m.role, content: m.content })),
    ],
    ...(useNewTokenParam
      ? { max_completion_tokens: 4096 }
      : { max_tokens: 4096 }),
  };

  // Only request stream usage from native OpenAI — OpenRouter may not support it
  if (isNativeOpenAi) {
    payload.stream_options = { include_usage: true };
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };

  if (isOpenRouter) {
    headers["HTTP-Referer"] = "https://nateide.local";
    headers["X-Title"] = "nateide";
  }

  const response = await fetch(baseUrl, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
    signal,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(extractApiErrorMessage("OpenAI", response.status, errorText));
  }

  let full = "";
  let reasoning = "";
  let usageData: { prompt_tokens?: number; completion_tokens?: number } | undefined;
  const reader = response.body?.getReader();

  if (!reader) {
    throw new Error("No response body from OpenAI");
  }

  const decoder = new TextDecoder();
  let buffer = "";
  let sseError: Error | null = null;

  try {
    outer: while (true) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();

        if (!trimmed.startsWith("data: ")) {
          continue;
        }

        const data = trimmed.slice(6);

        if (data === "[DONE]") {
          continue;
        }

        try {
          const parsed = JSON.parse(data);

          // OpenRouter may return errors inline as SSE chunks
          if (parsed.error) {
            const errMsg = parsed.error.message ?? JSON.stringify(parsed.error);
            console.error("[streamOpenAi] SSE error:", errMsg);
            sseError = new Error(errMsg);
            break outer;
          }

          const choice = parsed.choices?.[0];
          const delta =
            choice?.delta?.content
            ?? choice?.delta?.text
            ?? choice?.text
            ?? "";

          if (delta) {
            full += delta;
            onChunk({ type: "text_delta", text: delta });
          }

          // Some OpenRouter providers (e.g. Fireworks) put ALL output
          // including the final answer in delta.reasoning with content
          // always empty. Collect reasoning as a fallback.
          const reasoningDelta = choice?.delta?.reasoning;
          if (reasoningDelta) {
            reasoning += reasoningDelta;
          }

          // Capture usage from final chunk
          if (parsed.usage) {
            usageData = parsed.usage;
          }
        } catch {
          // skip malformed JSON chunks
        }
      }
    }
  } catch (error) {
    if (signal?.aborted) {
      onChunk({ type: "done", text: "" });
      return {
        text: full,
        usage: {
          inputTokens: estimateTokens(systemPrompt + messages.map((m) => m.content).join("")),
          outputTokens: estimateTokens(full),
          totalTokens: 0,
        },
      };
    }
    throw error;
  }

  if (sseError) {
    throw sseError;
  }

  // Some providers (e.g. Fireworks via OpenRouter) put the entire response
  // in reasoning with content always empty. Fall back to reasoning text.
  if (!full && reasoning) {
    full = reasoning;
    onChunk({ type: "text_delta", text: full });
  }

  const inputTokens = usageData?.prompt_tokens ?? estimateTokens(systemPrompt + messages.map((m) => m.content).join(""));
  const outputTokens = usageData?.completion_tokens ?? estimateTokens(full);

  onChunk({ type: "done", text: "" });
  return {
    text: full,
    usage: {
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
    },
  };
}

async function streamGoogle(
  apiKey: string,
  model: string,
  systemPrompt: string,
  messages: AiMessage[],
  onChunk: (chunk: AiStreamChunk) => void,
  signal?: AbortSignal,
): Promise<ChatCompletionResult> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${apiKey}`;

  const contents = messages.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));

  const body = JSON.stringify({
    system_instruction: { parts: [{ text: systemPrompt }] },
    contents,
    generationConfig: { maxOutputTokens: 4096 },
  });

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    signal,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(extractApiErrorMessage("Google", response.status, errorText));
  }

  let full = "";
  let usageMeta: { promptTokenCount?: number; candidatesTokenCount?: number } | undefined;
  const reader = response.body?.getReader();

  if (!reader) {
    throw new Error("No response body from Google AI");
  }

  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();

        if (!trimmed.startsWith("data: ")) {
          continue;
        }

        try {
          const parsed = JSON.parse(trimmed.slice(6));
          const text = parsed.candidates?.[0]?.content?.parts?.[0]?.text;

          if (text) {
            full += text;
            onChunk({ type: "text_delta", text });
          }

          // Capture usage metadata from chunks
          if (parsed.usageMetadata) {
            usageMeta = parsed.usageMetadata;
          }
        } catch {
          // skip malformed chunks
        }
      }
    }
  } catch (error) {
    if (signal?.aborted) {
      onChunk({ type: "done", text: "" });
      return {
        text: full,
        usage: {
          inputTokens: estimateTokens(systemPrompt + messages.map((m) => m.content).join("")),
          outputTokens: estimateTokens(full),
          totalTokens: 0,
        },
      };
    }
    throw error;
  }

  const inputTokens = usageMeta?.promptTokenCount ?? estimateTokens(systemPrompt + messages.map((m) => m.content).join(""));
  const outputTokens = usageMeta?.candidatesTokenCount ?? estimateTokens(full);

  onChunk({ type: "done", text: "" });
  return {
    text: full,
    usage: {
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
    },
  };
}
