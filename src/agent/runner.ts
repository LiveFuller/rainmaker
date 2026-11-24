import type { RainmakerConfig } from "../core/config.js";
import { advance, newRecord } from "../core/pipeline.js";
import type { Store } from "../core/store.js";
import type { Lead, LeadRecord, Message } from "../core/types.js";
import type { LlmClient } from "../llm/client.js";
import { qualifyLead } from "../qualify/scorer.js";
import { writeFirstTouch, writeFollowup } from "../outreach/sequence.js";
import type { Sender } from "../outreach/sender.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

export interface TickReport {
  qualified: number;
  drafted: number;
  sent: number;
  skippedForLimit: number;
}

function sentWithin(records: Iterable<LeadRecord>, since: number): number {
  let n = 0;
  for (const r of records) {
    for (const m of r.messages) {
      if (m.sentAt && Date.parse(m.sentAt) >= since) n++;
    }
  }
  return n;
}

function lastSent(record: LeadRecord): Message | undefined {
  return record.messages.filter((m) => m.status === "sent").at(-1);
}

function nextStepDue(record: LeadRecord, cadenceHours: number[], now: number): boolean {
  const sent = lastSent(record);
  if (!sent?.sentAt) return false;
  const interval = cadenceHours[Math.min(sent.step, cadenceHours.length) - 1]!;
  return now - Date.parse(sent.sentAt) >= interval * HOUR_MS;
}

function sequenceExhausted(record: LeadRecord, cadenceHours: number[]): boolean {
  const sent = lastSent(record);
  return sent !== undefined && sent.step > cadenceHours.length;
}

/**
 * One pass over the pipeline. Qualifies new leads, drafts first touches,
 * sends approved/-autopilot mail inside the daily limit, writes due follow-ups.
 */
export async function tick(
  config: RainmakerConfig,
  llm: LlmClient,
  sender: Sender,
  store: Store,
  newLeads: Lead[] = [],
  now = new Date(),
): Promise<TickReport> {
  const records = await store.load();
  const report: TickReport = { qualified: 0, drafted: 0, sent: 0, skippedForLimit: 0 };
  const nowMs = now.getTime();

  for (const lead of newLeads) {
    if (!records.has(lead.id)) records.set(lead.id, newRecord(lead, now));
  }

  let sentToday = sentWithin(records.values(), nowMs - DAY_MS);

  const trySend = async (record: LeadRecord, message: Message): Promise<LeadRecord> => {
    if (message.status === "draft" && config.mode === "autopilot") {
      message = { ...message, status: "approved" };
    }
    if (message.status !== "approved") return record;
    if (sentToday >= config.dailySendLimit) {
      report.skippedForLimit++;
      return record;
    }
    const result = await sender.send(record.lead.email, config.offer.sender, message);
    const stamped: Message = { ...message, status: "sent", sentAt: result.sentAt, reference: result.reference };
    sentToday++;
    report.sent++;
    const messages = record.messages.map((m) => (m.id === stamped.id ? stamped : m));
    return { ...record, messages };
  };

  for (const [id, record] of records) {
    let next = record;

    if (next.stage === "imported") {
      const qualification = await qualifyLead(llm, config.offer, next.lead);
      next = advance({ ...next, qualification }, "qualified", now);
      report.qualified++;
    }

    const qualification = next.qualification;
    if (next.stage === "qualified" && qualification && qualification.tier !== "cold" && next.messages.length === 0) {
      const first = await writeFirstTouch(llm, config.offer, next.lead, qualification, now);
      next = advance({ ...next, messages: [first] }, "contacted", now);
      report.drafted++;
    }

    if (next.stage === "contacted" || next.stage === "replied" || next.stage === "meeting") {
      const pending = next.messages.find((m) => m.status !== "sent");
      if (pending) {
        next = await trySend(next, pending);
      } else if (
        next.stage === "contacted" &&
        !sequenceExhausted(next, config.followupCadenceHours) &&
        nextStepDue(next, config.followupCadenceHours, nowMs)
      ) {
        const followup = await writeFollowup(llm, config.offer, next.lead, lastSent(next)!, now);
        next = { ...next, messages: [...next.messages, followup] };
        report.drafted++;
        next = await trySend(next, followup);
      }
    }

    if (next !== record) records.set(id, next);
  }

  await store.save(records.values());
  return report;
}

/** Runs tick forever. This is the daemon. */
export async function runForever(
  config: RainmakerConfig,
  llm: LlmClient,
  sender: Sender,
  store: Store,
  intervalMinutes = 15,
): Promise<never> {
  for (;;) {
    const report = await tick(config, llm, sender, store);
    console.log(
      `[${new Date().toISOString()}] tick: qualified=${report.qualified} drafted=${report.drafted} ` +
        `sent=${report.sent} limited=${report.skippedForLimit}`,
    );
    await new Promise((resolve) => setTimeout(resolve, intervalMinutes * 60 * 1000));
  }
}
