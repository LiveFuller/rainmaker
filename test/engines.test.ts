import { test } from "node:test";
import assert from "node:assert/strict";
import { qualifyLead } from "../src/qualify/scorer.js";
import { writeFirstTouch, writeFollowup } from "../src/outreach/sequence.js";
import { classifyReply } from "../src/reply/classifier.js";
import { validateConfig } from "../src/core/config.js";
import { DemoLlm } from "../src/llm/demo.js";
import type { Lead, Offer } from "../src/core/types.js";

const offer: Offer = {
  name: "Test Widget",
  description: "A widget for test-driven teams.",
  idealCustomer: "Engineering managers at SaaS companies.",
  sender: { name: "Seller", email: "seller@example.com" },
};

const lead: Lead = {
  id: "lead01",
  email: "vp@saasco.com",
  name: "Vera",
  role: "VP Engineering",
  company: "SaaSCo",
};

test("qualifyLead returns a bounded score and tier", async () => {
  const q = await qualifyLead(new DemoLlm(), offer, lead);
  assert.ok(q.score >= 0 && q.score <= 100);
  assert.ok(["hot", "warm", "cold"].includes(q.tier));
  assert.ok(q.reasoning.length > 0);
});

test("first touch produces subject and body with a question", async () => {
  const q = await qualifyLead(new DemoLlm(), offer, lead);
  const m = await writeFirstTouch(new DemoLlm(), offer, lead, q);
  assert.ok(m.subject.length > 0);
  assert.match(m.body, /\?/);
  assert.equal(m.step, 1);
  assert.equal(m.leadId, lead.id);
});

test("followup increments the step and keeps the thread subject", async () => {
  const q = await qualifyLead(new DemoLlm(), offer, lead);
  const first = await writeFirstTouch(new DemoLlm(), offer, lead, q);
  const second = await writeFollowup(new DemoLlm(), offer, lead, first);
  assert.equal(second.step, 2);
  assert.equal(second.subject, `Re: ${first.subject}`);
});

test("reply classifier routes obvious replies", async () => {
  const llm = new DemoLlm();
  assert.equal(await classifyReply(llm, "Sounds good, let's talk Thursday"), "interested");
  assert.equal(await classifyReply(llm, "Unsubscribe me immediately"), "unsubscribe");
  assert.equal(await classifyReply(llm, "I am out of office until June"), "out_of_office");
  assert.equal(await classifyReply(llm, "How much does it cost?"), "question");
});

test("config validation rejects nonsense and fills defaults", () => {
  assert.throws(() => validateConfig({}));
  const config = validateConfig({
    offer: { ...offer },
    llm: { baseUrl: "http://x", model: "m", apiKeyEnv: "KEY" },
  });
  assert.equal(config.mode, "approval");
  assert.equal(config.dailySendLimit, 20);
  assert.deepEqual(config.followupCadenceHours, [48, 96, 168]);
});
