import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

export type MemoryEntryType = "decision" | "pattern" | "preference" | "lesson";

export type MemoryEntry = {
  id: string;
  workspaceId: string;
  type: MemoryEntryType;
  content: string;
  createdBy: string;
  createdAt: string;
  sessionId: string;
};

function memoryDir(): string {
  const configRoot =
    process.env.XDG_CONFIG_HOME ??
    (process.env.HOME ? path.join(process.env.HOME, ".config") : "/tmp");
  return path.join(configRoot, "nateide", "memory");
}

function memoryPath(workspaceId: string): string {
  // Sanitize workspace ID for filesystem use
  const safe = workspaceId.replace(/[^a-zA-Z0-9_-]/g, "_");
  return path.join(memoryDir(), `${safe}.json`);
}

export class MemoryStore {
  private cache = new Map<string, MemoryEntry[]>();

  async read(workspaceId: string): Promise<MemoryEntry[]> {
    const cached = this.cache.get(workspaceId);
    if (cached) return structuredClone(cached);

    try {
      const raw = await readFile(memoryPath(workspaceId), "utf8");
      const entries = JSON.parse(raw) as MemoryEntry[];
      this.cache.set(workspaceId, entries);
      return structuredClone(entries);
    } catch {
      this.cache.set(workspaceId, []);
      return [];
    }
  }

  async append(workspaceId: string, entry: Omit<MemoryEntry, "id" | "createdAt">): Promise<MemoryEntry> {
    const entries = await this.read(workspaceId);
    const full: MemoryEntry = {
      ...entry,
      id: `mem-${randomUUID()}`,
      createdAt: new Date().toISOString(),
    };
    entries.push(full);
    this.cache.set(workspaceId, entries);
    await this.persist(workspaceId, entries);
    return full;
  }

  async search(workspaceId: string, query: string, limit = 10): Promise<MemoryEntry[]> {
    const entries = await this.read(workspaceId);
    if (!query.trim()) return entries.slice(-limit);

    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    const scored = entries.map((entry) => {
      const text = entry.content.toLowerCase();
      const matches = terms.filter((t) => text.includes(t)).length;
      return { entry, score: matches };
    });

    return scored
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((s) => s.entry);
  }

  async remove(workspaceId: string, entryId: string): Promise<void> {
    const entries = await this.read(workspaceId);
    const filtered = entries.filter((e) => e.id !== entryId);
    this.cache.set(workspaceId, filtered);
    await this.persist(workspaceId, filtered);
  }

  async clear(workspaceId: string): Promise<void> {
    this.cache.set(workspaceId, []);
    await this.persist(workspaceId, []);
  }

  async summarizeForPrompt(workspaceId: string, limit = 20): Promise<string> {
    const entries = await this.read(workspaceId);
    if (entries.length === 0) return "";

    const recent = entries.slice(-limit);
    const lines = recent.map((e) => `- [${e.type}] ${e.content}`);
    return `## Project Memory\n${lines.join("\n")}`;
  }

  private async persist(workspaceId: string, entries: MemoryEntry[]): Promise<void> {
    const filePath = memoryPath(workspaceId);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, JSON.stringify(entries, null, 2));
  }
}
