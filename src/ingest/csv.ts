import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import type { Lead } from "../core/types.js";

function leadId(email: string): string {
  return createHash("sha256").update(email.toLowerCase()).digest("hex").slice(0, 12);
}

/** Minimal CSV row splitter: handles quoted fields and commas inside quotes. */
function splitRow(row: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < row.length; i++) {
    const ch = row[i];
    if (inQuotes) {
      if (ch === '"' && row[i + 1] === '"') {
        current += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      fields.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  fields.push(current.trim());
  return fields;
}

const COLUMN_ALIASES: Record<keyof Omit<Lead, "id">, string[]> = {
  email: ["email", "e-mail", "mail"],
  name: ["name", "full name", "contact"],
  company: ["company", "organization", "org", "business"],
  role: ["role", "title", "position", "job title"],
  website: ["website", "site", "url", "web"],
  notes: ["notes", "note", "comment"],
  source: ["source", "origin"],
};

export function parseCsv(text: string): Lead[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];

  const headers = splitRow(lines[0]!).map((h) => h.toLowerCase());
  const columnFor = new Map<keyof Omit<Lead, "id">, number>();
  for (const [field, aliases] of Object.entries(COLUMN_ALIASES) as [keyof Omit<Lead, "id">, string[]][]) {
    const idx = headers.findIndex((h) => aliases.includes(h));
    if (idx >= 0) columnFor.set(field, idx);
  }
  const emailIdx = columnFor.get("email");
  if (emailIdx === undefined) throw new Error("CSV needs an email column");

  const leads: Lead[] = [];
  for (const line of lines.slice(1)) {
    const fields = splitRow(line);
    const email = fields[emailIdx];
    if (!email || !email.includes("@")) continue;
    const lead: Lead = { id: leadId(email), email };
    for (const [field, idx] of columnFor) {
      if (field === "email") continue;
      const value = fields[idx];
      if (value) lead[field] = value;
    }
    leads.push(lead);
  }
  return leads;
}

export async function ingestCsv(path: string): Promise<Lead[]> {
  return parseCsv(await readFile(path, "utf8"));
}
