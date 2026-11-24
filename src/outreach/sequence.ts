import { createHash } from "node:crypto";
import type { Lead, Message, Offer, Qualification } from "../core/types.js";
import type { LlmClient } from "../llm/client.js";

const SYSTEM = `You write short first-touch sales emails that get replies.
Rules: 80 words max, one idea, one low-friction question at the end, no hype words,
no "I hope this finds you well", reference something specific about the lead.
Respond with JSON only: {"subject": "<subject line>", "body": "<email body>"}.`;

function extractJson(text: string): { subject: string; body: string } {
  const match = text.match(/\{[^{}]*"subject"[^{}]*\}/s);
  if (!match) throw new Error(`sequence response had no JSON: ${text.slice(0, 120)}`);
  const parsed = JSON.parse(match[0]) as { subject: string; body: string };
  return { subject: String(parsed.subject ?? ""), body: String(parsed.body ?? "") };
}

export async function writeFirstTouch(
  llm: LlmClient,
  offer: Offer,
  lead: Lead,
  qualification: Qualification,
  now = new Date(),
): Promise<Message> {
  const user = [
    `Seller: ${offer.sender.name} (${offer.sender.email})`,
    `Selling: ${offer.name} — ${offer.description}`,
    offer.tone ? `Tone: ${offer.tone}` : "",
    `Recipient: ${lead.name ?? "there"}${lead.role ? `, ${lead.role}` : ""}${lead.company ? ` at ${lead.company}` : ""}`,
    lead.notes ? `Context: ${lead.notes}` : "",
    `Why they were qualified: ${qualification.reasoning}`,
    offer.calendarUrl ? `If they bite, the next step is a call booked at ${offer.calendarUrl} — but do not paste the link yet.` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const { subject, body } = extractJson(await llm.complete(SYSTEM, user));
  const id = createHash("sha256")
    .update(`${lead.id}:1:${now.toISOString()}`)
    .digest("hex")
    .slice(0, 12);
  return { id, leadId: lead.id, step: 1, channel: "email", subject, body, createdAt: now.toISOString() };
}

/** Follow-up nudge for step N>1: short, references the previous touch, new angle. */
export async function writeFollowup(
  llm: LlmClient,
  offer: Offer,
  lead: Lead,
  previous: Message,
  now = new Date(),
): Promise<Message> {
  const step = previous.step + 1;
  const user = [
    `Write follow-up #${step - 1} to this unanswered email:`,
    `Subject: ${previous.subject}`,
    previous.body,
    "---",
    `Seller: ${offer.sender.name}. Selling: ${offer.name}.`,
    `Recipient: ${lead.name ?? "there"}${lead.company ? ` at ${lead.company}` : ""}.`,
    "Even shorter than the original. One sentence of new value, one question. JSON only.",
  ].join("\n");

  const { subject, body } = extractJson(await llm.complete(SYSTEM, user));
  const id = createHash("sha256")
    .update(`${lead.id}:${step}:${now.toISOString()}`)
    .digest("hex")
    .slice(0, 12);
  return {
    id,
    leadId: lead.id,
    step,
    channel: "email",
    subject: subject || `Re: ${previous.subject}`,
    body,
    createdAt: now.toISOString(),
  };
}
