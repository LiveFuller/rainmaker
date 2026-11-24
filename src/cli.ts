#!/usr/bin/env node
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { loadConfig, validateConfig } from "./core/config.js";
import { advance, canTransition, newRecord } from "./core/pipeline.js";
import { Store } from "./core/store.js";
import type { LeadRecord } from "./core/types.js";
import { ingestCsv } from "./ingest/csv.js";
import { qualifyLead } from "./qualify/scorer.js";
import { writeFirstTouch } from "./outreach/sequence.js";
import { classifyReply } from "./reply/classifier.js";
import { DemoLlm } from "./llm/demo.js";
import { OpenAiCompatibleLlm } from "./llm/client.js";

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
}

async function runReal(leadsPath: string, configPath: string): Promise<void> {
  const config = await loadConfig(configPath);
  const apiKey = process.env[config.llm.apiKeyEnv];
  if (!apiKey) throw new Error(`Set ${config.llm.apiKeyEnv} in your environment`);
  const llm = new OpenAiCompatibleLlm(config.llm.baseUrl, config.llm.model, apiKey);
  const store = new Store(".rainmaker");
  const records = await store.load();

  const leads = await ingestCsv(leadsPath);
  console.log(`Loaded ${leads.length} leads.`);
  for (const lead of leads) {
    let record = records.get(lead.id) ?? newRecord(lead);
    if (record.stage === "imported") {
      const qualification = await qualifyLead(llm, config.offer, lead);
      record = { ...record, qualification };
      record = advance(record, "qualified");
    }
    if (record.stage === "qualified" && record.qualification?.tier !== "cold") {
      if (config.mode === "approval") {
        const message = await writeFirstTouch(llm, config.offer, lead, record.qualification);
        record = { ...record, messages: [message] };
        console.log(`Draft for ${lead.email} needs approval before sending.`);
        if (canTransition(record.stage, "contacted")) record = advance(record, "contacted");
      }
    }
    records.set(lead.id, record);
  }
  await store.save(records.values());
  printPipeline(records.values());
}

async function main(): Promise<void> {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      config: { type: "string", default: "rainmaker.config.json" },
      leads: { type: "string" },
    },
  });
  const command = positionals[0];
  if (command === "demo") {
    await runDemo();
  } else if (command === "run") {
    if (!values.leads) throw new Error("rainmaker run --leads <csv>");
    await runReal(values.leads, values.config);
  } else {
    console.log("rainmaker — the open-source AI salesman\n");
    console.log("  rainmaker demo                     run the full loop offline, no keys needed");
    console.log("  rainmaker run --leads leads.csv    qualify and draft against a real LLM");
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
