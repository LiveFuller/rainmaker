import type { ReplyIntent } from "../core/types.js";
import type { LlmClient } from "../llm/client.js";

const INTENTS: ReplyIntent[] = [
  "interested",
  "question",
  "not_interested",
  "unsubscribe",
  "out_of_office",
  "unknown",
];

const SYSTEM = `You classify replies to cold outreach.
Respond with exactly one word: interested, question, not_interested, unsubscribe, out_of_office, or unknown.
interested = wants to talk or buy. question = engaged but needs an answer first.
unsubscribe = asks to be removed or threatens spam reports. out_of_office = automatic away message.`;

export async function classifyReply(llm: LlmClient, replyText: string): Promise<ReplyIntent> {
  const raw = (await llm.complete(SYSTEM, replyText)).trim().toLowerCase();
  const intent = INTENTS.find((i) => raw.startsWith(i));
  return intent ?? "unknown";
}
