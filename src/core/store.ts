import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { LeadRecord } from "./types.js";

/** Flat JSON-file persistence under .rainmaker/. */
export class Store {
  constructor(private readonly dir: string) {}

  private get file(): string {
    return path.join(this.dir, "pipeline.json");
  }

  async load(): Promise<Map<string, LeadRecord>> {
    try {
      const raw = JSON.parse(await readFile(this.file, "utf8")) as LeadRecord[];
      return new Map(raw.map((r) => [r.lead.id, r]));
    } catch {
      return new Map();
    }
  }

  async save(records: Iterable<LeadRecord>): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    await writeFile(this.file, JSON.stringify([...records], null, 2) + "\n", "utf8");
  }
}
