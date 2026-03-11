/**
 * local-server.ts — Thin local daemon for filesystem, git, and terminal operations.
 *
 * This is the post-Convex-migration daemon entrypoint. It handles ONLY
 * local-machine operations that cannot run in the cloud:
 *
 * KEPT (local-only concerns):
 *   - Filesystem: read, write, list, search
 *   - Git: status, diff, log
 *   - Terminal: PTY create/write/resize/close + WebSocket streaming
 *   - Health check
 *
 * REMOVED (moved to Convex):
 *   - Session state (session-store.ts)        → Convex documents
 *   - SSE event streaming (/events)           → Convex real-time subscriptions
 *   - Settings (/settings)                    → Convex settings table
 *   - Thread / messages (/thread/*)           → Convex thread table
 *   - Board / kanban (/board/*)               → Convex board tables
 *   - Runs (/runs/*)                          → Convex runs table
 *   - Pipelines (/pipelines/*)                → Convex pipelines
 *   - Conversation loop (/conversation/*)     → Convex + cloud agent dispatch
 *   - Memory (/memory/*)                      → Convex memory table
 *   - Feedback (/feedback)                    → Convex feedback table
 *   - Workspace open/create (/workspace/*)    → Convex workspace records
 *   - Document open (/documents/*)            → Convex document snapshots
 *   - AI client (ai-client.ts)                → Cloud-side agent harness
 *   - Conversation loop (conversation-loop.ts)→ Cloud-side orchestrator
 *   - Pipeline engine (pipeline-engine.ts)    → Cloud-side pipeline runner
 *
 * Dependencies: node built-ins only + node-pty for terminal.
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile, writeFile, readdir, stat, mkdir } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { spawn as spawnPty, type IPty } from "node-pty";
import { randomUUID } from "node:crypto";

const execFileAsync = promisify(execFile);

// ── Configuration ───────────────────────────────────────────

const PORT = Number(process.env.LOCAL_DAEMON_PORT ?? process.env.PORT ?? 4317);
const AUTH_TOKEN = process.env.LOCAL_DAEMON_TOKEN ?? "";

// ── Terminal session registry ───────────────────────────────

type TerminalSession = {
  id: string;
  pty: IPty;
  cwd: string;
  shell: string;
  cols: number;
  rows: number;
  buffer: string[];
  subscribers: Set<ServerResponse>;
  status: "running" | "closed";
  exitCode?: number;
};

const terminals = new Map<string, TerminalSession>();

// ── HTTP helpers ────────────────────────────────────────────

const CORS_HEADERS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,OPTIONS",
  "access-control-allow-headers": "content-type, authorization",
  "content-type": "application/json; charset=utf-8",
};

function jsonResponse(res: ServerResponse, body: unknown, status = 200) {
  res.writeHead(status, CORS_HEADERS);
  res.end(JSON.stringify(body, null, 2));
}

function errorResponse(res: ServerResponse, message: string, status = 400) {
  jsonResponse(res, { ok: false, message }, status);
}

async function readBody<T>(req: IncomingMessage): Promise<T> {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
  }
  return raw ? (JSON.parse(raw) as T) : ({} as T);
}

// ── Auth middleware ─────────────────────────────────────────

function checkAuth(req: IncomingMessage, res: ServerResponse): boolean {
  if (!AUTH_TOKEN) return true; // dev mode — no auth required

  const header = req.headers.authorization ?? "";
  if (header === `Bearer ${AUTH_TOKEN}`) return true;

  errorResponse(res, "Unauthorized", 401);
  return false;
}

// ── Filesystem handlers ─────────────────────────────────────

async function handleFilesRead(req: IncomingMessage, res: ServerResponse) {
  const { path: filePath } = await readBody<{ path: string }>(req);
  if (!filePath) return errorResponse(res, "path is required");

  try {
    const content = await readFile(filePath, "utf-8");
    jsonResponse(res, { ok: true, content });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Read failed";
    errorResponse(res, msg, 404);
  }
}

async function handleFilesWrite(req: IncomingMessage, res: ServerResponse) {
  const { path: filePath, content } = await readBody<{ path: string; content: string }>(req);
  if (!filePath) return errorResponse(res, "path is required");
  if (typeof content !== "string") return errorResponse(res, "content is required");

  try {
    // Ensure parent directory exists
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, content, "utf-8");
    jsonResponse(res, { ok: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Write failed";
    errorResponse(res, msg, 500);
  }
}

async function handleFilesList(req: IncomingMessage, res: ServerResponse) {
  const { path: dirPath } = await readBody<{ path: string }>(req);
  if (!dirPath) return errorResponse(res, "path is required");

  try {
    const entries = await readdir(dirPath, { withFileTypes: true });
    const result = entries.map((e) => ({
      name: e.name,
      type: e.isDirectory() ? "directory" : e.isFile() ? "file" : "other",
    }));
    jsonResponse(res, { ok: true, entries: result });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "List failed";
    errorResponse(res, msg, 404);
  }
}

async function handleSearch(req: IncomingMessage, res: ServerResponse) {
  const { path: searchPath, query } = await readBody<{ path: string; query: string }>(req);
  if (!searchPath) return errorResponse(res, "path is required");
  if (!query) return errorResponse(res, "query is required");

  try {
    // Use grep -rn for code search, limit output
    const { stdout } = await execFileAsync(
      "grep",
      ["-rn", "--include=*", "-l", "--max-count=100", query, searchPath],
      { maxBuffer: 1024 * 1024, timeout: 10_000 },
    );
    const files = stdout.trim().split("\n").filter(Boolean);
    jsonResponse(res, { ok: true, files });
  } catch (err: unknown) {
    // grep returns exit code 1 when no matches found — that's not an error
    if (err && typeof err === "object" && "code" in err && (err as { code: number }).code === 1) {
      jsonResponse(res, { ok: true, files: [] });
      return;
    }
    const msg = err instanceof Error ? err.message : "Search failed";
    errorResponse(res, msg, 500);
  }
}

// ── Git handlers ────────────────────────────────────────────

async function runGit(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFileAsync("git", args, {
    cwd,
    maxBuffer: 1024 * 1024,
    timeout: 15_000,
  });
  return stdout;
}

async function handleGitStatus(req: IncomingMessage, res: ServerResponse) {
  const { path: repoPath } = await readBody<{ path: string }>(req);
  if (!repoPath) return errorResponse(res, "path is required");

  try {
    const stdout = await runGit(["status", "--porcelain", "-u"], repoPath);
    jsonResponse(res, { ok: true, output: stdout });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "git status failed";
    errorResponse(res, msg, 500);
  }
}

async function handleGitDiff(req: IncomingMessage, res: ServerResponse) {
  const { path: repoPath } = await readBody<{ path: string }>(req);
  if (!repoPath) return errorResponse(res, "path is required");

  try {
    const stdout = await runGit(["diff"], repoPath);
    jsonResponse(res, { ok: true, output: stdout });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "git diff failed";
    errorResponse(res, msg, 500);
  }
}

async function handleGitLog(req: IncomingMessage, res: ServerResponse) {
  const { path: repoPath, limit } = await readBody<{ path: string; limit?: number }>(req);
  if (!repoPath) return errorResponse(res, "path is required");

  const count = String(Math.min(Math.max(limit ?? 20, 1), 200));

  try {
    const stdout = await runGit(
      ["log", `--max-count=${count}`, "--format=%H%n%an%n%ae%n%ai%n%s%n---"],
      repoPath,
    );
    jsonResponse(res, { ok: true, output: stdout });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "git log failed";
    errorResponse(res, msg, 500);
  }
}

// ── Terminal handlers ───────────────────────────────────────

function handleTerminalCreate(req: IncomingMessage, res: ServerResponse) {
  readBody<{
    cols?: number;
    rows?: number;
    cwd?: string;
    shell?: string;
  }>(req).then((body) => {
    const id = `pty-${randomUUID().slice(0, 8)}`;
    const cols = Math.max(40, body.cols ?? 120);
    const rows = Math.max(12, body.rows ?? 32);
    const cwd = body.cwd?.trim() || process.env.HOME || "/tmp";
    const shell = body.shell?.trim() || process.env.SHELL || "bash";

    const pty = spawnPty(shell, ["-i"], {
      cols,
      rows,
      cwd,
      env: {
        ...process.env,
        COLORTERM: "truecolor",
        TERM: "xterm-256color",
      },
      name: "xterm-256color",
    });

    const session: TerminalSession = {
      id,
      pty,
      cwd,
      shell,
      cols,
      rows,
      buffer: [],
      subscribers: new Set(),
      status: "running",
    };

    terminals.set(id, session);

    pty.onData((data) => {
      session.buffer.push(data);
      // Keep buffer bounded (last 1000 chunks)
      if (session.buffer.length > 1000) {
        session.buffer = session.buffer.slice(-500);
      }
      // Push to all WebSocket-like SSE subscribers
      for (const sub of session.subscribers) {
        try {
          sub.write(`data: ${JSON.stringify({ type: "output", data })}\n\n`);
        } catch {
          session.subscribers.delete(sub);
        }
      }
    });

    pty.onExit(({ exitCode }) => {
      session.status = "closed";
      session.exitCode = exitCode;
      for (const sub of session.subscribers) {
        try {
          sub.write(`data: ${JSON.stringify({ type: "exit", exitCode })}\n\n`);
          sub.end();
        } catch { /* ignore */ }
      }
      session.subscribers.clear();
    });

    jsonResponse(res, {
      ok: true,
      id,
      cols,
      rows,
      cwd,
      shell,
    });
  }).catch((err) => {
    const msg = err instanceof Error ? err.message : "Failed to create terminal";
    errorResponse(res, msg, 500);
  });
}

async function handleTerminalWrite(req: IncomingMessage, res: ServerResponse) {
  const { id, data } = await readBody<{ id: string; data: string }>(req);
  if (!id) return errorResponse(res, "id is required");

  const session = terminals.get(id);
  if (!session || session.status === "closed") {
    return errorResponse(res, "Terminal session not found or closed", 404);
  }

  session.pty.write(data ?? "");
  jsonResponse(res, { ok: true });
}

async function handleTerminalResize(req: IncomingMessage, res: ServerResponse) {
  const { id, cols, rows } = await readBody<{ id: string; cols: number; rows: number }>(req);
  if (!id) return errorResponse(res, "id is required");
  if (typeof cols !== "number" || typeof rows !== "number") {
    return errorResponse(res, "cols and rows are required");
  }

  const session = terminals.get(id);
  if (!session || session.status === "closed") {
    return errorResponse(res, "Terminal session not found or closed", 404);
  }

  session.cols = cols;
  session.rows = rows;
  session.pty.resize(cols, rows);
  jsonResponse(res, { ok: true });
}

async function handleTerminalClose(req: IncomingMessage, res: ServerResponse) {
  const { id } = await readBody<{ id: string }>(req);
  if (!id) return errorResponse(res, "id is required");

  const session = terminals.get(id);
  if (!session) {
    return errorResponse(res, "Terminal session not found", 404);
  }

  session.pty.kill();
  terminals.delete(id);
  jsonResponse(res, { ok: true });
}

function handleTerminalStream(req: IncomingMessage, res: ServerResponse, sessionId: string) {
  const session = terminals.get(sessionId);
  if (!session) {
    errorResponse(res, "Terminal session not found", 404);
    return;
  }

  // SSE stream for terminal output
  res.writeHead(200, {
    ...CORS_HEADERS,
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
  });

  // Replay buffer
  for (const chunk of session.buffer) {
    res.write(`data: ${JSON.stringify({ type: "output", data: chunk })}\n\n`);
  }

  if (session.status === "closed") {
    res.write(`data: ${JSON.stringify({ type: "exit", exitCode: session.exitCode })}\n\n`);
    res.end();
    return;
  }

  session.subscribers.add(res);

  const ping = setInterval(() => {
    try { res.write(": ping\n\n"); } catch { /* ignore */ }
  }, 15_000);

  req.on("close", () => {
    clearInterval(ping);
    session.subscribers.delete(res);
  });
}

// ── Route dispatch ──────────────────────────────────────────

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "127.0.0.1"}`);

  // CORS preflight
  if (req.method === "OPTIONS") {
    res.writeHead(204, CORS_HEADERS);
    res.end();
    return;
  }

  try {
    // Health check — no auth required
    if (req.method === "GET" && url.pathname === "/health") {
      jsonResponse(res, { ok: true, mode: "local", port: PORT });
      return;
    }

    // Auth check for all other endpoints
    if (!checkAuth(req, res)) return;

    // ── Filesystem ────────────────────────────
    if (req.method === "POST" && url.pathname === "/files/read") {
      return await handleFilesRead(req, res);
    }
    if (req.method === "POST" && url.pathname === "/files/write") {
      return await handleFilesWrite(req, res);
    }
    if (req.method === "POST" && url.pathname === "/files/list") {
      return await handleFilesList(req, res);
    }
    if (req.method === "POST" && url.pathname === "/search") {
      return await handleSearch(req, res);
    }

    // ── Git ───────────────────────────────────
    if (req.method === "POST" && url.pathname === "/git/status") {
      return await handleGitStatus(req, res);
    }
    if (req.method === "POST" && url.pathname === "/git/diff") {
      return await handleGitDiff(req, res);
    }
    if (req.method === "POST" && url.pathname === "/git/log") {
      return await handleGitLog(req, res);
    }

    // ── Terminal ──────────────────────────────
    if (req.method === "POST" && url.pathname === "/terminal/create") {
      return handleTerminalCreate(req, res);
    }
    if (req.method === "POST" && url.pathname === "/terminal/write") {
      return await handleTerminalWrite(req, res);
    }
    if (req.method === "POST" && url.pathname === "/terminal/resize") {
      return await handleTerminalResize(req, res);
    }
    if (req.method === "POST" && url.pathname === "/terminal/close") {
      return await handleTerminalClose(req, res);
    }

    // Terminal stream: GET /terminal/stream/:id
    const streamMatch = url.pathname.match(/^\/terminal\/stream\/([^/]+)$/);
    if (req.method === "GET" && streamMatch) {
      return handleTerminalStream(req, res, decodeURIComponent(streamMatch[1]));
    }

    // ── 404 ──────────────────────────────────
    errorResponse(res, `Not found: ${url.pathname}`, 404);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unexpected error";
    errorResponse(res, msg, 500);
  }
});

server.listen(PORT, () => {
  console.log(`local daemon listening on http://127.0.0.1:${PORT}`);
  if (AUTH_TOKEN) {
    console.log("  auth: bearer token required");
  } else {
    console.log("  auth: disabled (dev mode — set LOCAL_DAEMON_TOKEN to enable)");
  }
});
