import type { LlmClient } from "./client.js";

/**
 * Deterministic offline brain for `rainmaker demo`.
 * Recognizes each engine's system prompt and answers in its exact contract,
 * so the whole pipeline runs end-to-end with no API key and no network.
 */
export class DemoLlm implements LlmClient {
  async complete(system: string, user: string): Promise<string> {
    if (system.startsWith("You are a B2B sales qualification engine.")) {
      return this.qualify(user);
    }
    if (system.startsWith("You write short first-touch sales emails")) {
      return this.write(user);
    }
    if (system.startsWith("You write replies for a salesperson")) {
      return this.answer(user);
    }
    if (system.startsWith("You classify replies to cold outreach.")) {
      return this.classify(user);
    }
    return '{"score": 50, "reasoning": "demo mode"}';
  }

  private qualify(user: string): string {
    // Only scan the lead half of the prompt — the ICP text would self-match.
    const leadPart = user.split("---").pop() ?? user;
    const lower = leadPart.toLowerCase();
    const hotSignals = ["owner", "founder", "ceo", "director", "hotel", "manager"];
    const coldSignals = ["student", "unemployed", "no company"];
    const hits = hotSignals.filter((s) => lower.includes(s)).length;
    const misses = coldSignals.filter((s) => lower.includes(s)).length;
    const score = Math.max(5, Math.min(95, 45 + hits * 25 - misses * 35));
    const reasoning =
      score >= 70
        ? "Senior buyer at an organization matching the ideal customer profile."
        : score >= 40
          ? "Adjacent fit; worth a careful first touch."
          : "Little overlap with the ideal customer profile.";
    return JSON.stringify({ score, reasoning });
  }

  private write(user: string): string {
    const recipient = /Recipient: ([^,\n]+)/.exec(user)?.[1]?.trim() ?? "there";
    const company = / at ([^\n]+)/.exec(user)?.[1]?.trim();
    const sellingMatch = /Selling: (.+?)(?: — |\n)/s.exec(user);
    const product = sellingMatch?.[1]?.trim() ?? "our product";
    const isFollowup = user.startsWith("Write follow-up");
    const subject = isFollowup ? "" : `quick question${company ? ` for ${company}` : ""}`;
    const body = isFollowup
      ? `Hi ${recipient},\n\nOne more thought: most teams see value from ${product} within the first week. Worth ten minutes?\n\nIf not, a quick "no" is completely fine.`
      : `Hi ${recipient},\n\nNoticed ${company ?? "your team"} and figured this might land: ${product} is built exactly for teams like yours.\n\nOpen to a quick look? Happy to keep it to ten minutes.`;
    return JSON.stringify({ subject, body });
  }

  private answer(user: string): string {
    const recipient = (/Lead: ([^,\n]+)/.exec(user)?.[1]?.trim() ?? "there").replace(/ at .+$/, "");
    const calendar = /calendar link directly: (\S+)/.exec(user)?.[1]?.replace(/[.,]+$/, "");
    const body = calendar
      ? `Hi ${recipient},\n\nGreat to hear. Easiest is to grab a slot directly: ${calendar} — fifteen minutes is plenty.\n\nIf nothing fits, tell me a time and I'll make it work.`
      : `Hi ${recipient},\n\nGood question. Short answer: yes — happy to walk you through it on a quick call so you can judge it in ten minutes.\n\nDoes Thursday suit you?`;
    return JSON.stringify({ body });
  }

  private classify(user: string): string {
    const lower = user.toLowerCase();
    if (/unsubscribe|remove me|stop email/.test(lower)) return "unsubscribe";
    if (/out of office|away until|automatic reply/.test(lower)) return "out_of_office";
    if (/not interested|no thanks|pass/.test(lower)) return "not_interested";
    if (/sounds good|let's talk|can we talk|book|interest|send me/.test(lower)) return "interested";
    if (/how much|what does|can it|does it/.test(lower)) return "question";
    return "unknown";
  }
}
