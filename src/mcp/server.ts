import { createInterface } from "node:readline";
import type { RainmakerConfig } from "../core/config.js";
import type { Store } from "../core/store.js";
import type { Lead } from "../core/types.js";
import type { LlmClient } from "../llm/client.js";
import { qualifyLead } from "../qualify/scorer.js";
import { writeFirstTouch } from "../outreach/sequence.js";
import { classifyReply } from "../reply/classifier.js";
import { STAGE_ORDER } from "../server/dashboard.js";

const PROTOCOL_VERSION = "2024-11-05";

const TOOLS = [
  {
    name: "qualify_lead",
    description: "Score a lead 0–100 against the configured ideal customer profile.",
    inputSchema: {
      type: "object",
      properties: {
        email: { type: "string" },
        name: { type: "string" },
        company: { type: "string" },
        role: { type: "string" },
        notes: { type: "string" },
      },
      required: ["email"],
    },
  },
  {
    name: "draft_outreach",
    description: "Qualify a lead and write the first-touch email in the sender's voice.",
    inputSchema: {
      type: "object",
      properties: {
        email: { type: "string" },
        name: { type: "string" },
        company: { type: "string" },
        role: { type: "string" },
        notes: { type: "string" },
      },
      required: ["email"],
    },
  },
  {
    name: "classify_reply",
    description: "Classify a reply to outreach: interested, question, not_interested, unsubscribe, out_of_office, unknown.",
    inputSchema: {
      type: "object",
      properties: { text: { type: "string" } },
      required: ["text"],
    },
  },
  {
    name: "pipeline_status",
    description: "Funnel counts per stage across the whole pipeline.",
    inputSchema: { type: "object", properties: {} },
  },
] as const;

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: string | number;
  method: string;
  params?: Record<string, unknown>;
}

function leadFrom(args: Record<string, unknown>): Lead {
  const email = String(args.email ?? "");
  const lead: Lead = { id: email.toLowerCase(), email };
  for (const key of ["name", "company", "role", "notes"] as const) {
    if (typeof args[key] === "string" && args[key]) lead[key] = args[key] as string;
  }
  return lead;
}

function textResult(value: unknown): { content: { type: "text"; text: string }[] } {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

/** Minimal MCP server over stdio: newline-delimited JSON-RPC 2.0. */
export async function serveMcp(config: RainmakerConfig, llm: LlmClient, store: Store): Promise<void> {
  const rl = createInterface({ input: process.stdin, terminal: false });

  const callTool = async (name: string, args: Record<string, unknown>): Promise<unknown> => {
    switch (name) {
      case "qualify_lead": {
        const q = await qualifyLead(llm, config.offer, leadFrom(args));
        return textResult(q);
      }
      case "draft_outreach": {
        const lead = leadFrom(args);
        const q = await qualifyLead(llm, config.offer, lead);
        const m = await writeFirstTouch(llm, config.offer, lead, q);
        return textResult({ qualification: q, message: { subject: m.subject, body: m.body } });
      }
      case "classify_reply": {
        const intent = await classifyReply(llm, String(args.text ?? ""));
        return textResult({ intent });
      }
      case "pipeline_status": {
        const records = [...(await store.load()).values()];
        const funnel = Object.fromEntries(
          STAGE_ORDER.map((s) => [s, records.filter((r) => r.stage === s).length]),
        );
        return textResult({ funnel, total: records.length });
      }
      default:
        throw new Error(`unknown tool: ${name}`);
    }
  };

  rl.on("line", (line) => {
    void (async () => {
      let request: JsonRpcRequest;
      try {
        request = JSON.parse(line) as JsonRpcRequest;
      } catch {
        return;
      }
      const reply = (result: unknown) => {
        if (request.id !== undefined) {
          process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: request.id, result }) + "\n");
        }
      };
      const replyError = (code: number, message: string) => {
        if (request.id !== undefined) {
          process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: request.id, error: { code, message } }) + "\n");
        }
      };

      try {
        switch (request.method) {
          case "initialize":
            reply({
              protocolVersion: PROTOCOL_VERSION,
              capabilities: { tools: {} },
              serverInfo: { name: "rainmaker", version: "0.1.0" },
            });
            break;
          case "notifications/initialized":
          case "initialized":
            break;
          case "ping":
            reply({});
            break;
          case "tools/list":
            reply({ tools: TOOLS });
            break;
          case "tools/call": {
            const params = request.params ?? {};
            const result = await callTool(String(params.name), (params.arguments ?? {}) as Record<string, unknown>);
            reply(result);
            break;
          }
          default:
            replyError(-32601, `method not found: ${request.method}`);
        }
      } catch (err) {
        replyError(-32603, err instanceof Error ? err.message : String(err));
      }
    })();
  });

  await new Promise<void>((resolve) => rl.on("close", resolve));
}
