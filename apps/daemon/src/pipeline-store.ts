import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Pipeline } from "@nateide/protocol";

function pipelinesPath(): string {
  const configRoot =
    process.env.XDG_CONFIG_HOME ??
    (process.env.HOME ? path.join(process.env.HOME, ".config") : "/tmp");
  return path.join(configRoot, "nateide", "pipelines.json");
}

export class PipelineStore {
  private cache: Pipeline[] | null = null;

  async list(): Promise<Pipeline[]> {
    if (this.cache) return structuredClone(this.cache);

    try {
      const raw = await readFile(pipelinesPath(), "utf8");
      this.cache = JSON.parse(raw) as Pipeline[];
    } catch {
      this.cache = [];
    }

    return structuredClone(this.cache);
  }

  async get(id: string): Promise<Pipeline | undefined> {
    const all = await this.list();
    return all.find((p) => p.id === id);
  }

  async save(pipeline: Pipeline): Promise<Pipeline> {
    const all = await this.list();
    const index = all.findIndex((p) => p.id === pipeline.id);

    pipeline.updatedAt = new Date().toISOString();
    if (index >= 0) {
      all[index] = pipeline;
    } else {
      pipeline.createdAt = pipeline.createdAt || new Date().toISOString();
      all.push(pipeline);
    }

    await this.persist(all);
    return structuredClone(pipeline);
  }

  async remove(id: string): Promise<void> {
    const all = await this.list();
    const filtered = all.filter((p) => p.id !== id);
    await this.persist(filtered);
  }

  private async persist(pipelines: Pipeline[]): Promise<void> {
    this.cache = pipelines;
    await mkdir(path.dirname(pipelinesPath()), { recursive: true });
    await writeFile(pipelinesPath(), JSON.stringify(pipelines, null, 2));
  }
}
