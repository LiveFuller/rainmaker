import type { LeadRecord, PipelineStage } from "./types.js";

/** Legal forward moves. Terminal stages have no outgoing edges. */
const TRANSITIONS: Record<PipelineStage, PipelineStage[]> = {
  imported: ["qualified", "unsubscribed"],
  qualified: ["contacted", "lost", "unsubscribed"],
  contacted: ["replied", "lost", "unsubscribed"],
  replied: ["meeting", "contacted", "lost", "unsubscribed"],
  meeting: ["won", "lost"],
  won: [],
  lost: [],
  unsubscribed: [],
};

export function canTransition(from: PipelineStage, to: PipelineStage): boolean {
  return TRANSITIONS[from].includes(to);
}

/** Move a record to a new stage, stamping the time. Throws on illegal moves. */
export function advance(record: LeadRecord, to: PipelineStage, now = new Date()): LeadRecord {
  if (!canTransition(record.stage, to)) {
    throw new Error(`Illegal pipeline move: ${record.stage} -> ${to}`);
  }
  return {
    ...record,
    stage: to,
    stageHistory: { ...record.stageHistory, [to]: now.toISOString() },
  };
}

export function newRecord(lead: LeadRecord["lead"], now = new Date()): LeadRecord {
  return {
    lead,
    stage: "imported",
    messages: [],
    stageHistory: { imported: now.toISOString() },
  };
}
