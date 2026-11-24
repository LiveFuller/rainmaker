import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { tick } from "../src/agent/runner.js";
import { validateConfig } from "../src/core/config.js";
import { Store } from "../src/core/store.js";
import { OutboxSender } from "../src/outreach/sender.js";
import { DemoLlm } from "../src/llm/demo.js";
import type { Lead } from "../src/core/types.js";

const config = validateConfig({
  offer: {
    name: "Widget",
    description: "A fine widget.",
    idealCustomer: "Owners of small businesses.",
    sender: { name: "Seller", email: "seller@example.com" },
  },
  mode: "autopilot",
  dailySendLimit: 2,
  followupCadenceHours: [48, 96],
  llm: { baseUrl: "http://x", model: "m", apiKeyEnv: "K" },
});

const hotLead: Lead = { id: "h1", email: "owner@shop.cz", name: "Owner", role: "Owner" };
const coldLead: Lead = { id: "c1", email: "student@school.cz", name: "Student", notes: "student film club" };

async function freshStore(): Promise<Store> {
  return new Store(await mkdtemp(path.join(tmpdir(), "rainmaker-")));
}

test("tick qualifies, drafts and sends within the daily limit", async () => {
  const store = await freshStore();
  const sender = new OutboxSender(await mkdtemp(path.join(tmpdir(), "outbox-")));
  const leads: Lead[] = [
    hotLead,
    coldLead,
    { ...hotLead, id: "h2", email: "owner2@shop.cz" },
    { ...hotLead, id: "h3", email: "owner3@shop.cz" },
  ];
  const report = await tick(config, new DemoLlm(), sender, store, leads);
  assert.equal(report.qualified, 4);
  assert.equal(report.drafted, 3);
  assert.equal(report.sent, 2, "daily limit caps autopilot sends");
  assert.equal(report.skippedForLimit, 1);

  const records = [...(await store.load()).values()];
  const cold = records.find((r) => r.lead.id === "c1")!;
  assert.equal(cold.stage, "qualified", "cold leads are never contacted");
  assert.equal(cold.messages.length, 0);
});

test("follow-ups land only after their cadence interval", async () => {
  const store = await freshStore();
  const sender = new OutboxSender(await mkdtemp(path.join(tmpdir(), "outbox-")));
  const llm = new DemoLlm();
  const t0 = new Date("2026-01-01T09:00:00Z");

  await tick(config, llm, sender, store, [hotLead], t0);
  const before = [...(await store.load()).values()][0]!;
  assert.equal(before.messages.length, 1);

  // 12h later: nothing due yet.
  await tick(config, llm, sender, store, [], new Date(t0.getTime() + 12 * 3600_000));
  const mid = [...(await store.load()).values()][0]!;
  assert.equal(mid.messages.length, 1, "no follow-up before 48h");

  // 50h later: follow-up due, drafted and auto-sent.
  await tick(config, llm, sender, store, [], new Date(t0.getTime() + 50 * 3600_000));
  const after = [...(await store.load()).values()][0]!;
  assert.equal(after.messages.length, 2);
  assert.equal(after.messages[1]!.step, 2);
  assert.equal(after.messages[1]!.status, "sent");
});

test("sequence exhausts after the configured cadence", async () => {
  const store = await freshStore();
  const sender = new OutboxSender(await mkdtemp(path.join(tmpdir(), "outbox-")));
  const llm = new DemoLlm();
  let now = new Date("2026-01-01T09:00:00Z");

  await tick(config, llm, sender, store, [hotLead], now);
  for (const hours of [50, 100, 200, 400]) {
    now = new Date(now.getTime() + hours * 3600_000 / 4);
    await tick(config, llm, sender, store, [], now);
  }
  const record = [...(await store.load()).values()][0]!;
  assert.equal(record.messages.length, 3, "first touch + 2 follow-ups and no more");
});
