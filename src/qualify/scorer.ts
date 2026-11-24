import type { Lead, Offer, Qualification, QualificationTier } from "../core/types.js";
import type { LlmClient } from "../llm/client.js";

function tierFor(score: number): QualificationTier {
  if (score >= 70) return "hot";
  if (score >= 40) return "warm";
  return "cold";
}

const SYSTEM = `You are a B2B sales qualification engine.
Score how well a lead fits the seller's ideal customer profile.
Respond with JSON only: {"score": <0-100 integer>, "reasoning": "<one sentence>"}.
Anchor points: 90 = perfect ICP match with buying power, 50 = adjacent fit, 10 = irrelevant.`;

function extractJson(text: string): { score: number; reasoning: string } {
  const match = text.match(/\{[^{}]*"score"[^{}]*\}/s);
  if (!match) throw new Error(`qualification response had no JSON: ${text.slice(0, 120)}`);
  const parsed = JSON.parse(match[0]) as { score: number; reasoning: string };
  if (typeof parsed.score !== "number") throw new Error("qualification JSON missing score");
  return { score: Math.max(0, Math.min(100, Math.round(parsed.score))), reasoning: String(parsed.reasoning ?? "") };
}

export async function qualifyLead(llm: LlmClient, offer: Offer, lead: Lead): Promise<Qualification> {
  const user = [
    `What is being sold: ${offer.name} — ${offer.description}`,
    `Ideal customer: ${offer.idealCustomer}`,
    offer.pricePoint ? `Price point: ${offer.pricePoint}` : "",
    "---",
    `Lead: ${lead.name ?? "unknown"}${lead.role ? `, ${lead.role}` : ""}${lead.company ? ` at ${lead.company}` : ""}`,
    lead.website ? `Website: ${lead.website}` : "",
    lead.notes ? `Notes: ${lead.notes}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const { score, reasoning } = extractJson(await llm.complete(SYSTEM, user));
  return { score, tier: tierFor(score), reasoning };
}
