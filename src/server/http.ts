import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { RainmakerConfig } from "../core/config.js";
import { advance } from "../core/pipeline.js";
import type { Store } from "../core/store.js";
import type { LeadRecord } from "../core/types.js";
import type { LlmClient } from "../llm/client.js";
import { classifyReply } from "../reply/classifier.js";
import { draftReply } from "../reply/responder.js";

export interface InboundEmail {
  from: string;
  subject?: string;
  text: string;
}

export interface WebhookOutcome {
  lead?: string;
  intent?: string;
  action: "drafted" | "parked" | "closed" | "ignored";
  detail?: string;
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

function json(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(data));
}

function extractEmail(from: string): string {
  const match = /<([^>]+)>/.exec(from);
  return (match?.[1] ?? from).trim().toLowerCase();
}

/** Apply the right pipeline move for a classified reply. */
export async function handleInbound(
  email: InboundEmail,
  config: RainmakerConfig,
  llm: LlmClient,
  store: Store,
  now = new Date(),
): Promise<WebhookOutcome> {
  const records = await store.load();
  const senderAddress = extractEmail(email.from);
  const record = [...records.values()].find((r) => r.lead.email.toLowerCase() === senderAddress);
  if (!record) return { action: "ignored", detail: "unknown sender" };
  if (record.stage === "unsubscribed") return { action: "ignored", lead: record.lead.id, detail: "terminal" };

  const intent = await classifyReply(llm, email.text);
  let next: LeadRecord = record;

  switch (intent) {
    case "unsubscribe": {
      next = advance(record, "unsubscribed", now);
      records.set(record.lead.id, next);
      await store.save(records.values());
      return { lead: record.lead.id, intent, action: "closed", detail: "opted out — never touched again" };
    }
    case "not_interested": {
      next = advance(record, "lost", now);
      records.set(record.lead.id, next);
      await store.save(records.values());
      return { lead: record.lead.id, intent, action: "closed" };
    }
    case "out_of_office":
      return { lead: record.lead.id, intent, action: "parked", detail: "awaits their return" };
    case "interested":
    case "question":
    case "unknown": {
      if (next.stage === "contacted") next = advance(next, "replied", now);
      const draft = await draftReply(llm, config.offer, next.lead, intent, email.text, next.messages, now);
      const approved = config.mode === "autopilot" ? { ...draft, status: "approved" as const } : draft;
      next = { ...next, messages: [...next.messages, approved] };
      if (intent === "interested" && next.stage === "replied") next = advance(next, "meeting", now);
      records.set(record.lead.id, next);
      await store.save(records.values());
      return {
        lead: record.lead.id,
        intent,
        action: "drafted",
        detail: config.mode === "autopilot" ? "auto-approved" : "awaits human approval",
      };
    }
  }
}

/** The rainmaker HTTP surface: inbound webhook + health check. Dashboard mounts separately. */
export function createHttpServer(config: RainmakerConfig, llm: LlmClient, store: Store): Server {
  return createServer(async (req, res) => {
    try {
      if (req.method === "GET" && req.url === "/health") {
        json(res, 200, { ok: true });
        return;
      }
      if (req.method === "POST" && req.url === "/inbound") {
        const payload = JSON.parse(await readBody(req)) as InboundEmail;
        if (!payload.from || !payload.text) {
          json(res, 400, { error: "need from and text" });
          return;
        }
        json(res, 200, await handleInbound(payload, config, llm, store));
        return;
      }
      json(res, 404, { error: "not found" });
    } catch (err) {
      json(res, 500, { error: err instanceof Error ? err.message : String(err) });
    }
  });
}
