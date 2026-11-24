#!/usr/bin/env node
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { loadConfig, validateConfig, type RainmakerConfig } from "./core/config.js";
import { advance, newRecord } from "./core/pipeline.js";
import { Store } from "./core/store.js";
import type { LeadRecord } from "./core/types.js";
import { ingestCsv } from "./ingest/csv.js";
import { qualifyLead } from "./qualify/scorer.js";
import { writeFirstTouch } from "./outreach/sequence.js";
import { classifyReply } from "./reply/classifier.js";
import { DemoLlm } from "./llm/demo.js";
import { OpenAiCompatibleLlm, type LlmClient } from "./llm/client.js";
import { OutboxSender, ResendSender, type Sender } from "./outreach/sender.js";
import { SmtpSender } from "./outreach/smtp.js";
import { tick, runForever } from "./agent/runner.js";
import { createHttpServer } from "./server/http.js";
import { serveMcp } from "./mcp/server.js";

const DEMO_CONFIG = {
  offer: {
    name: "SiteSpot Websites",
    description:
      "Hand-built marketing websites for Prague service businesses, delivered in two weeks with copywriting included.",
    idealCustomer:
      "Owner or manager of a small service business in Czechia — clearance, moving, renovation, salons — whose current site is outdated or missing.",
    pricePoint: "CZK 25k–60k one-off",
    tone: "direct, warm, no fluff",
    sender: { name: "Oliver", email: "oliver@example.com" },
    calendarUrl: "https://cal.example.com/oliver/15min",
  },
  dailySendLimit: 20,
  followupCadenceHours: [48, 96, 168],
  mode: "approval" as const,
  llm: { baseUrl: "http://localhost", model: "demo", apiKeyEnv: "NONE" },
};

function printPipeline(records: Iterable<LeadRecord>): void {
  const counts = new Map<string, number>();
  const rows: LeadRecord[] = [...records];
  for (const r of rows) counts.set(r.stage, (counts.get(r.stage) ?? 0) + 1);
  console.log("\n=== Pipeline ===");
  for (const [stage, n] of counts) console.log(`  ${stage.padEnd(12)} ${n}`);
  console.log("\n=== Leads ===");
  for (const r of rows) {
    const q = r.qualification;
    console.log(
      `  ${(r.lead.name ?? r.lead.email).padEnd(22)} ${r.stage.padEnd(10)} ` +
        (q ? `score ${String(q.score).padStart(3)} (${q.tier}) — ${q.reasoning}` : ""),
    );
  }
}

async function runDemo(): Promise<void> {
  const config = validateConfig(DEMO_CONFIG);
  const llm = new DemoLlm();
  const csvPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "examples", "demo-leads.csv");
  const leads = await ingestCsv(csvPath);
  console.log(`Loaded ${leads.length} demo leads. Qualifying…\n`);

  const records: LeadRecord[] = [];
  for (const lead of leads) {
    let record = newRecord(lead);
    const qualification = await qualifyLead(llm, config.offer, lead);
    record = { ...record, qualification };
    record = advance(record, "qualified");
    if (qualification.tier !== "cold") {
      const message = await writeFirstTouch(llm, config.offer, lead, qualification);
      record = { ...record, messages: [message] };
      record = advance(record, "contacted");
    }
    records.push(record);
  }
  printPipeline(records);

  const first = records.find((r) => r.messages.length > 0);
  if (first) {
    const m = first.messages[0]!;
    console.log("\n=== Sample first touch ===");
    console.log(`To: ${first.lead.email}\nSubject: ${m.subject}\n\n${m.body}`);
  }

  console.log("\n=== Reply routing demo ===");
  for (const sample of [
    "This sounds good — can we talk Thursday?",
    "Please remove me from your list.",
    "I'm out of office until Monday.",
  ]) {
    console.log(`  "${sample}" -> ${await classifyReply(llm, sample)}`);
  }
  console.log("\nDemo mode uses an offline scripted brain. Point config at a real LLM to go live.");
  console.log("Try the live machine: rainmaker agent --demo   (dashboard + webhook on :3000)");
}

function buildRuntime(config: RainmakerConfig, demo: boolean): { llm: LlmClient; sender: Sender; store: Store } {
  const llm = demo
    ? new DemoLlm()
    : (() => {
        const apiKey = process.env[config.llm.apiKeyEnv];
        if (!apiKey) throw new Error(`Set ${config.llm.apiKeyEnv} in your environment`);
        return new OpenAiCompatibleLlm(config.llm.baseUrl, config.llm.model, apiKey);
      })();
  let sender: Sender;
  if (config.transport.kind === "resend") {
    sender = new ResendSender(process.env[config.transport.apiKeyEnv ?? ""] ?? missingKey(config.transport.apiKeyEnv));
  } else if (config.transport.kind === "smtp" && config.transport.smtp) {
    const s = config.transport.smtp;
    sender = new SmtpSender({
      host: s.host,
      port: s.port,
      security: s.security,
      user: s.user,
      pass: process.env[s.passEnv] ?? missingKey(s.passEnv),
    });
  } else {
    sender = new OutboxSender(".rainmaker/outbox");
  }
  return { llm, sender, store: new Store(".rainmaker") };
}

function missingKey(env: string | undefined): never {
  throw new Error(`Set ${env ?? "the transport key env var"} in your environment`);
}

async function runTick(leadsPath: string, configPath: string, demo: boolean): Promise<void> {
  const config = demo ? validateConfig(DEMO_CONFIG) : await loadConfig(configPath);
  const { llm, sender, store } = buildRuntime(config, demo);
  const leads = await ingestCsv(leadsPath);
  const report = await tick(config, llm, sender, store, leads);
  console.log(
    `tick: qualified=${report.qualified} drafted=${report.drafted} sent=${report.sent} limited=${report.skippedForLimit}`,
  );
  printPipeline([...(await store.load()).values()]);
}

async function runAgent(configPath: string, demo: boolean, port: number): Promise<void> {
  const config = demo ? validateConfig(DEMO_CONFIG) : await loadConfig(configPath);
  const { llm, sender, store } = buildRuntime(config, demo);
  const server = createHttpServer(config, llm, store);
  server.listen(port);
  console.log(`mission control: http://localhost:${port}`);
  console.log(`inbound webhook: http://localhost:${port}/inbound`);
  if (demo) {
    const csvPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "examples", "demo-leads.csv");
    const leads = await ingestCsv(csvPath);
    const report = await tick(config, llm, sender, store, leads);
    console.log(`seeded demo leads: qualified=${report.qualified} drafted=${report.drafted}`);
  }
  await runForever(config, llm, sender, store);
}

async function runMcp(configPath: string, demo: boolean): Promise<void> {
  const config = demo ? validateConfig(DEMO_CONFIG) : await loadConfig(configPath);
  const { llm, store } = buildRuntime(config, demo);
  await serveMcp(config, llm, store);
}

async function main(): Promise<void> {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      config: { type: "string", default: "rainmaker.config.json" },
      leads: { type: "string" },
      demo: { type: "boolean", default: false },
      port: { type: "string", default: "3000" },
    },
  });
  const command = positionals[0];
  const port = Number(values.port);
  if (command === "demo") {
    await runDemo();
  } else if (command === "run") {
    if (!values.leads) throw new Error("rainmaker run --leads <csv>");
    await runTick(values.leads, values.config, values.demo);
  } else if (command === "agent") {
    await runAgent(values.config, values.demo, port);
  } else if (command === "mcp") {
    await runMcp(values.config, values.demo);
  } else {
    console.log("rainmaker — the open-source AI salesman\n");
    console.log("  rainmaker demo                        the whole loop offline, no keys needed");
    console.log("  rainmaker agent --demo                mission control + webhook on :3000, scripted brain");
    console.log("  rainmaker agent --config cfg.json     live daemon: qualifies, writes, sends, answers");
    console.log("  rainmaker mcp --demo                  serve rainmaker's tools over MCP (stdio)");
    console.log("  rainmaker run --leads leads.csv       one tick against a real LLM");
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
