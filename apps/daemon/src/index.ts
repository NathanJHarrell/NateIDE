import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import type {
  ActorRef,
  KanbanCardPriority,
  KanbanFileTag,
} from "@nateide/protocol";
import type { Pipeline } from "@nateide/protocol";
import { LocalSessionStore } from "./session-store";
import { SettingsStore, type IdeSettingsPatch } from "./settings-store";
import { PipelineStore } from "./pipeline-store";
import { executePipeline, type PipelineCallbacks } from "./pipeline-engine";

const port = Number(process.env.PORT ?? 4317);
const userHome = process.env.HOME ?? process.env.USERPROFILE ?? "";
const defaultWorkspaceRoot = path.resolve(process.cwd(), "../..");
const workspaceRoot = process.env.WORKSPACE_ROOT ?? defaultWorkspaceRoot;
const workspaceRoots = (process.env.WORKSPACE_ROOTS ?? [workspaceRoot, userHome].filter(Boolean).join(path.delimiter))
  .split(path.delimiter)
  .filter(Boolean);
const settingsStore = new SettingsStore();
const pipelineStore = new PipelineStore();
const pipelineAbortControllers = new Map<string, AbortController>();

type JsonReply = {
  body: string;
  headers: Record<string, string>;
  status: number;
};

function statusForWorkspaceError(error: unknown): number {
  if (!(error instanceof Error)) {
    return 500;
  }

  if (
    error.message.includes("no such file or directory") ||
    error.message.includes("ENOENT")
  ) {
    return 404;
  }

  if (
    error.message.includes("not a directory") ||
    error.message.includes("outside the current workspace")
  ) {
    return 400;
  }

  if (
    error.message.includes("permission denied") ||
    error.message.includes("EACCES") ||
    error.message.includes("EPERM")
  ) {
    return 403;
  }

  return 500;
}

function json(body: unknown, status = 200): JsonReply {
  return {
    status,
    body: JSON.stringify(body, null, 2),
    headers: {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET,POST,PATCH,DELETE,OPTIONS",
      "access-control-allow-headers": "content-type",
      "content-type": "application/json; charset=utf-8",
    },
  };
}

function writeJson(response: ServerResponse, payload: JsonReply) {
  response.writeHead(payload.status, payload.headers);
  response.end(payload.body);
}

function writeSse(response: ServerResponse, event: string, data: unknown) {
  response.write(`event: ${event}\n`);
  response.write(`data: ${JSON.stringify(data)}\n\n`);
}

async function readJson<T>(request: IncomingMessage): Promise<T> {
  let raw = "";

  for await (const chunk of request) {
    raw += chunk;
  }

  return raw ? (JSON.parse(raw) as T) : ({} as T);
}

const store = new LocalSessionStore(workspaceRoot, workspaceRoots);

// Load settings and pass API keys to the session store on startup
const initialSettings = await settingsStore.read();
store.setApiKeys(initialSettings.apiKeys);
store.setAgentRoles(initialSettings.agentRoles);
store.setSoulDocuments(initialSettings.soulDocuments);
store.setConversationLoopConfig(initialSettings.conversationLoop);

await store.initialize();

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "127.0.0.1"}`);

  if (request.method === "OPTIONS") {
    writeJson(response, json({ ok: true }, 204));
    return;
  }

  try {
    if (request.method === "GET" && url.pathname === "/health") {
      writeJson(
        response,
        json({
          ok: true,
          mode: "local",
          port,
          platform: process.platform,
          userHome,
          workspaceRoot,
          workspaceRoots,
        }),
      );
      return;
    }

    if (request.method === "GET" && url.pathname === "/workspaces") {
      writeJson(response, json(await store.listWorkspaces()));
      return;
    }

    if (request.method === "GET" && url.pathname === "/session") {
      const state = store.getState();

      if (!state) {
        writeJson(response, json({ ok: false, message: "No session open." }, 404));
        return;
      }

      writeJson(response, json(state));
      return;
    }

    if (request.method === "GET" && url.pathname === "/settings") {
      writeJson(response, json(await settingsStore.read()));
      return;
    }

    if (request.method === "GET" && url.pathname === "/board") {
      writeJson(response, json(store.getBoard()));
      return;
    }

    if (request.method === "GET" && url.pathname === "/events") {
      response.writeHead(200, {
        "access-control-allow-origin": "*",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        "content-type": "text/event-stream; charset=utf-8",
      });

      writeSse(response, "ready", { ok: true });

      const current = store.getState();

      if (current) {
        writeSse(response, "state", current);
      }

      const unsubscribe = store.subscribe((snapshot, latestEvent) => {
        writeSse(response, "state", snapshot);

        if (latestEvent) {
          writeSse(response, "event", latestEvent);
        }
      });
      const ping = setInterval(() => {
        response.write(": ping\n\n");
      }, 15_000);

      request.on("close", () => {
        clearInterval(ping);
        unsubscribe();
      });

      return;
    }

    if (request.method === "POST" && url.pathname === "/workspace/open") {
      const body = await readJson<{ path?: string }>(request);
      const targetPath = body.path?.trim();

      if (!targetPath) {
        writeJson(response, json({ ok: false, message: "Workspace path is required." }, 400));
        return;
      }

      try {
        writeJson(response, json(await store.openWorkspace(targetPath)));
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unexpected error";
        writeJson(response, json({ ok: false, message }, statusForWorkspaceError(error)));
      }
      return;
    }

    if (request.method === "POST" && url.pathname === "/workspace/create") {
      const body = await readJson<{ path?: string }>(request);
      const rawPath = body.path?.trim();

      if (!rawPath) {
        writeJson(response, json({ ok: false, message: "Workspace path is required." }, 400));
        return;
      }

      // Expand ~ to $HOME and resolve to absolute path
      const home = userHome;
      let resolvedPath = rawPath;
      if (resolvedPath === "~") {
        resolvedPath = home;
      } else if (home && (resolvedPath.startsWith("~/") || resolvedPath.startsWith("~\\"))) {
        resolvedPath = path.join(home, resolvedPath.slice(2));
      }
      resolvedPath = path.resolve(resolvedPath);

      try {
        await mkdir(resolvedPath, { recursive: true });
        writeJson(response, json(await store.openWorkspace(resolvedPath)));
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unexpected error";
        writeJson(response, json({ ok: false, message }, statusForWorkspaceError(error)));
      }
      return;
    }

    if (request.method === "POST" && url.pathname === "/documents/open") {
      const body = await readJson<{ path?: string }>(request);
      const targetPath = body.path?.trim();

      if (!targetPath) {
        writeJson(response, json({ ok: false, message: "Document path is required." }, 400));
        return;
      }

      await store.openDocument(targetPath);
      writeJson(response, json(store.getState()));
      return;
    }

    if (request.method === "POST" && url.pathname === "/thread/messages") {
      const body = await readJson<{ content?: string; requestedAgentIds?: string[] }>(request);
      const content = body.content?.trim();

      if (!content) {
        writeJson(response, json({ ok: false, message: "Message content is required." }, 400));
        return;
      }

      writeJson(
        response,
        json(await store.appendUserMessage(content, body.requestedAgentIds ?? [])),
      );
      return;
    }

    if (request.method === "POST" && url.pathname === "/board/lanes") {
      const body = await readJson<{ color?: string; name?: string }>(request);
      const name = body.name?.trim();

      if (!name) {
        writeJson(response, json({ ok: false, message: "Lane name is required." }, 400));
        return;
      }

      writeJson(
        response,
        json(store.createBoardLane({ color: body.color, name })),
      );
      return;
    }

    const laneMatch = url.pathname.match(/^\/board\/lanes\/([^/]+)$/);

    if (request.method === "PATCH" && laneMatch) {
      const body = await readJson<{ color?: string; name?: string }>(request);
      writeJson(
        response,
        json(store.updateBoardLane(decodeURIComponent(laneMatch[1]), body)),
      );
      return;
    }

    if (request.method === "POST" && url.pathname === "/board/cards") {
      const body = await readJson<{
        assignedAgentId?: string;
        description?: string;
        fileTags?: KanbanFileTag[];
        laneId?: string;
        priority?: KanbanCardPriority;
        title?: string;
      }>(request);
      const title = body.title?.trim();

      if (!title) {
        writeJson(response, json({ ok: false, message: "Card title is required." }, 400));
        return;
      }

      writeJson(
        response,
        json(
          store.createBoardCard({
            assignedAgentId: body.assignedAgentId,
            description: body.description,
            fileTags: body.fileTags,
            laneId: body.laneId,
            priority: body.priority,
            title,
          }),
        ),
      );
      return;
    }

    const runCancelMatch = url.pathname.match(/^\/runs\/([^/]+)\/cancel$/);

    if (request.method === "POST" && runCancelMatch) {
      store.cancelRun(decodeURIComponent(runCancelMatch[1]));
      writeJson(response, json({ ok: true }));
      return;
    }

    if (request.method === "POST" && url.pathname === "/runs/cancel-all") {
      store.cancelAllRuns();
      writeJson(response, json({ ok: true }));
      return;
    }

    if (request.method === "PATCH" && url.pathname === "/settings") {
      const body = await readJson<IdeSettingsPatch>(request);
      const updated = await settingsStore.update(body);
      store.setApiKeys(updated.apiKeys);
      store.setAgentRoles(updated.agentRoles);
      store.setSoulDocuments(updated.soulDocuments);
      store.setConversationLoopConfig(updated.conversationLoop);
      writeJson(response, json(updated));
      return;
    }

    const cardMatch = url.pathname.match(/^\/board\/cards\/([^/]+)$/);

    if (request.method === "PATCH" && cardMatch) {
      const body = await readJson<{
        assignedAgentId?: string;
        description?: string;
        fileTags?: KanbanFileTag[];
        laneId?: string;
        priority?: KanbanCardPriority;
        title?: string;
      }>(request);
      writeJson(
        response,
        json(store.updateBoardCard(decodeURIComponent(cardMatch[1]), body)),
      );
      return;
    }

    if (request.method === "POST" && url.pathname === "/terminal/sessions") {
      const body = await readJson<{
        cols?: number;
        cwd?: string;
        id?: string;
        initiatedBy?: ActorRef;
        rows?: number;
        shell?: string;
      }>(request);
      writeJson(
        response,
        json(
          store.openTerminalSession(
            {
              cols: body.cols,
              cwd: body.cwd,
              id: body.id,
              rows: body.rows,
              shell: body.shell,
            },
            body.initiatedBy,
          ),
        ),
      );
      return;
    }

    const terminalInputMatch = url.pathname.match(/^\/terminal\/sessions\/([^/]+)\/input$/);

    if (request.method === "POST" && terminalInputMatch) {
      const body = await readJson<{ data?: string }>(request);
      store.writeTerminalInput(decodeURIComponent(terminalInputMatch[1]), body.data ?? "");
      writeJson(response, json({ ok: true }));
      return;
    }

    const terminalResizeMatch = url.pathname.match(/^\/terminal\/sessions\/([^/]+)\/resize$/);

    if (request.method === "PATCH" && terminalResizeMatch) {
      const body = await readJson<{ cols?: number; rows?: number }>(request);

      if (typeof body.cols !== "number" || typeof body.rows !== "number") {
        writeJson(response, json({ ok: false, message: "cols and rows are required." }, 400));
        return;
      }

      try {
        writeJson(
          response,
          json(
            store.resizeTerminalSession(
              decodeURIComponent(terminalResizeMatch[1]),
              body.cols,
              body.rows,
            ),
          ),
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unexpected error";
        const status = statusForWorkspaceError(error);
        writeJson(response, json({ ok: false, message }, status));
      }
      return;
    }

    if (request.method === "POST" && url.pathname === "/terminal/commands") {
      const body = await readJson<{
        command?: string;
        cwd?: string;
        initiatedBy?: ActorRef;
        runId?: string;
        shell?: string;
      }>(request);
      const command = body.command?.trim();

      if (!command) {
        writeJson(response, json({ ok: false, message: "Command is required." }, 400));
        return;
      }

      writeJson(
        response,
        json(
          await store.runCommand(command, body.initiatedBy, body.runId, {
            cwd: body.cwd,
            shell: body.shell,
          }),
        ),
      );
      return;
    }

    // ── Pipeline endpoints ──────────────────────────────────

    if (request.method === "GET" && url.pathname === "/pipelines") {
      writeJson(response, json(await pipelineStore.list()));
      return;
    }

    if (request.method === "POST" && url.pathname === "/pipelines") {
      const body = await readJson<Pipeline>(request);
      if (!body.id || !body.name) {
        writeJson(response, json({ ok: false, message: "Pipeline id and name are required." }, 400));
        return;
      }
      writeJson(response, json(await pipelineStore.save(body)));
      return;
    }

    const pipelineDeleteMatch = url.pathname.match(/^\/pipelines\/([^/]+)$/);

    if (request.method === "DELETE" && pipelineDeleteMatch) {
      await pipelineStore.remove(decodeURIComponent(pipelineDeleteMatch[1]));
      writeJson(response, json({ ok: true }));
      return;
    }

    const pipelineExecMatch = url.pathname.match(/^\/pipelines\/([^/]+)\/execute$/);

    if (request.method === "POST" && pipelineExecMatch) {
      const pipelineId = decodeURIComponent(pipelineExecMatch[1]);
      const pipeline = await pipelineStore.get(pipelineId);

      if (!pipeline) {
        writeJson(response, json({ ok: false, message: "Pipeline not found." }, 404));
        return;
      }

      const body = await readJson<{ content?: string }>(request);
      const content = body.content?.trim() ?? "";
      const currentSettings = await settingsStore.read();

      const abortController = new AbortController();
      const callbacks: PipelineCallbacks = {
        onNodeStarted: () => {},
        onNodeCompleted: () => {},
        onChunk: () => {},
        onExecutionCompleted: (executionId) => {
          pipelineAbortControllers.delete(executionId);
        },
      };

      // Start execution and respond immediately
      const executionPromise = executePipeline(pipeline, content, {
        apiKeys: currentSettings.apiKeys,
        agentRoles: currentSettings.agentRoles,
        signal: abortController.signal,
      }, callbacks);

      executionPromise.then((exec) => {
        pipelineAbortControllers.delete(exec.id);
      }).catch(() => {});

      // Store the abort controller
      const execId = `exec-${Date.now()}`;
      pipelineAbortControllers.set(execId, abortController);

      writeJson(response, json({ ok: true, executionId: execId }));
      return;
    }

    const pipelineExecCancelMatch = url.pathname.match(/^\/pipelines\/executions\/([^/]+)\/cancel$/);

    if (request.method === "POST" && pipelineExecCancelMatch) {
      const execId = decodeURIComponent(pipelineExecCancelMatch[1]);
      const controller = pipelineAbortControllers.get(execId);
      if (controller) {
        controller.abort();
        pipelineAbortControllers.delete(execId);
      }
      writeJson(response, json({ ok: true }));
      return;
    }

    // ── Conversation loop endpoints ──────────────────────────

    if (request.method === "POST" && url.pathname === "/conversation/end") {
      store.endConversationLoop();
      writeJson(response, json({ ok: true }));
      return;
    }

    // ── Thread management endpoints ──────────────────────────

    if (request.method === "POST" && url.pathname === "/thread/clear") {
      store.clearThread();
      writeJson(response, json({ ok: true }));
      return;
    }

    // ── Memory endpoints ─────────────────────────────────────

    if (request.method === "GET" && url.pathname === "/memory") {
      const state = store.getState();
      if (!state) {
        writeJson(response, json([]));
        return;
      }
      writeJson(response, json(await store.getMemoryStore().read(state.workspace.id)));
      return;
    }

    const memoryDeleteMatch = url.pathname.match(/^\/memory\/([^/]+)$/);

    if (request.method === "DELETE" && memoryDeleteMatch) {
      const state = store.getState();
      if (state) {
        await store.getMemoryStore().remove(state.workspace.id, decodeURIComponent(memoryDeleteMatch[1]));
      }
      writeJson(response, json({ ok: true }));
      return;
    }

    if (request.method === "DELETE" && url.pathname === "/memory") {
      const state = store.getState();
      if (state) {
        await store.getMemoryStore().clear(state.workspace.id);
      }
      writeJson(response, json({ ok: true }));
      return;
    }

    // ── Feedback endpoint ────────────────────────────────────

    if (request.method === "POST" && url.pathname === "/feedback") {
      const body = await readJson<{
        agentId?: string;
        type?: "positive" | "negative";
        messageId?: string;
        content?: string;
      }>(request);

      if (!body.agentId || !body.type || !body.content) {
        writeJson(response, json({ ok: false, message: "agentId, type, and content are required." }, 400));
        return;
      }

      await store.handleFeedback(body.agentId, body.type, body.content);

      // Persist learned preferences to settings
      const currentSettings = await settingsStore.read();
      const soul = currentSettings.soulDocuments[body.agentId];
      if (soul) {
        const pref = body.type === "positive"
          ? `User liked: ${body.content}`
          : `User disliked: ${body.content}`;
        soul.learnedPreferences.push(pref);
        await settingsStore.update({
          soulDocuments: { [body.agentId]: { learnedPreferences: soul.learnedPreferences } },
        });
      }

      writeJson(response, json({ ok: true }));
      return;
    }

    writeJson(
      response,
      json(
        {
          ok: false,
          message: "Not found",
          path: url.pathname,
        },
        404,
      ),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    writeJson(response, json({ ok: false, message }, 500));
  }
});

server.listen(port, () => {
  console.log(`daemon listening on http://127.0.0.1:${port}`);
});
