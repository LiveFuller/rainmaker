import { createHash } from "node:crypto";
import type { Lead, Message, Offer, ReplyIntent } from "../core/types.js";
import type { LlmClient } from "../llm/client.js";

const SYSTEM = `You write replies for a salesperson whose cold outreach got an answer.
Short, human, no hype. 60 words max. End with exactly one clear next step.
Respond with JSON only: {"body": "<reply body>"}.`;

function extractBody(text: string): string {
  const match = text.match(/\{[^{}]*"body"[^{}]*\}/s);
  if (!match) throw new Error(`responder produced no JSON: ${text.slice(0, 120)}`);
  return String((JSON.parse(match[0]) as { body: string }).body ?? "");
}

/** Draft the answer to a lead's reply, shaped by what the reply means. */
export async function draftReply(
  llm: LlmClient,
  offer: Offer,
  lead: Lead,
  intent: ReplyIntent,
  replyText: string,
  thread: Message[],
  now = new Date(),
): Promise<Message> {
  const step = (thread.at(-1)?.step ?? 0) + 1;
  const steer =
    intent === "interested"
      ? `They want to move. Propose the calendar link directly: ${offer.calendarUrl ?? "(no calendar configured — propose a call time instead)"}.`
      : `They asked a question. Answer it using only facts from the offer description, then offer a short call.`;

  const user = [
    `Seller: ${offer.sender.name}. Offer: ${offer.name} — ${offer.description}`,
    offer.pricePoint ? `Price point: ${offer.pricePoint}` : "",
    offer.tone ? `Tone: ${offer.tone}` : "",
    `Lead: ${lead.name ?? "there"}${lead.company ? ` at ${lead.company}` : ""}`,
    "---",
    "Their reply:",
    replyText,
    "---",
    steer,
  ]
    .filter(Boolean)
    .join("\n");

  const body = extractBody(await llm.complete(SYSTEM, user));
  const id = createHash("sha256").update(`${lead.id}:${step}:${now.toISOString()}`).digest("hex").slice(0, 12);
  const subject = thread.length > 0 ? `Re: ${thread[0]!.subject}` : `Re: ${offer.name}`;
  return { id, leadId: lead.id, step, channel: "email", subject, body, createdAt: now.toISOString(), status: "draft" };
}
