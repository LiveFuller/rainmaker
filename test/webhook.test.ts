import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { handleInbound, approveMessage } from "../src/server/http.js";
import { validateConfig } from "../src/core/config.js";
import { advance, newRecord } from "../src/core/pipeline.js";
import { Store } from "../src/core/store.js";
import { DemoLlm } from "../src/llm/demo.js";
import type { Lead } from "../src/core/types.js";

const config = validateConfig({
  offer: {
    name: "Widget",
    description: "A fine widget.",
    idealCustomer: "Owners of small businesses.",
    sender: { name: "Seller", email: "seller@example.com" },
    calendarUrl: "https://cal.example.com/15",
  },
  mode: "approval",
  llm: { baseUrl: "http://x", model: "m", apiKeyEnv: "K" },
});

const lead: Lead = { id: "h1", email: "owner@shop.cz", name: "Owner", role: "Owner" };

async function storeWithContactedLead(): Promise<Store> {
  const store = new Store(await mkdtemp(path.join(tmpdir(), "rainmaker-")));
  let record = newRecord(lead);
  record = advance(record, "qualified");
  record = advance(record, "contacted");
  await store.save([record]);
  return store;
}

test("interested replies advance to meeting and draft a calendar reply", async () => {
  const store = await storeWithContactedLead();
  const outcome = await handleInbound(
    { from: "Owner <owner@shop.cz>", text: "Sounds good, let's talk this week" },
    config,
    new DemoLlm(),
    store,
  );
  assert.equal(outcome.intent, "interested");
  assert.equal(outcome.action, "drafted");
  const record = [...(await store.load()).values()][0]!;
  assert.equal(record.stage, "meeting");
  const draft = record.messages.at(-1)!;
  assert.equal(draft.status, "draft", "approval mode keeps humans in charge");
  assert.match(draft.body, /cal\.example\.com/);
});

test("unsubscribe is terminal and untouchable", async () => {
  const store = await storeWithContactedLead();
  const outcome = await handleInbound(
    { from: "owner@shop.cz", text: "Remove me from your list immediately" },
    config,
    new DemoLlm(),
    store,
  );
  assert.equal(outcome.action, "closed");
  const record = [...(await store.load()).values()][0]!;
  assert.equal(record.stage, "unsubscribed");

  const again = await handleInbound({ from: "owner@shop.cz", text: "Actually wait, I'm interested" }, config, new DemoLlm(), store);
  assert.equal(again.action, "ignored", "terminal means terminal");
});

test("not_interested closes as lost; unknown senders are ignored", async () => {
  const store = await storeWithContactedLead();
  const lost = await handleInbound({ from: "owner@shop.cz", text: "No thanks, not interested" }, config, new DemoLlm(), store);
  assert.equal(lost.action, "closed");
  const ghost = await handleInbound({ from: "stranger@elsewhere.com", text: "hi" }, config, new DemoLlm(), store);
  assert.equal(ghost.action, "ignored");
});

test("approving a draft flips exactly one message", async () => {
  const store = await storeWithContactedLead();
  await handleInbound({ from: "owner@shop.cz", text: "Sounds good, let's talk" }, config, new DemoLlm(), store);
  const record = [...(await store.load()).values()][0]!;
  const draft = record.messages.at(-1)!;
  assert.equal(await approveMessage(store, draft.id), true);
  assert.equal(await approveMessage(store, draft.id), false, "second approve is a no-op");
  const after = [...(await store.load()).values()][0]!;
  assert.equal(after.messages.at(-1)!.status, "approved");
});
