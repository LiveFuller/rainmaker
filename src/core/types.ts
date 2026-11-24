export interface Offer {
  /** What you are selling, in one sentence. */
  name: string;
  /** Longer pitch the agent draws from when writing. */
  description: string;
  /** Ideal customer profile, plain language. */
  idealCustomer: string;
  /** Rough price point, used to qualify budget fit. */
  pricePoint?: string;
  /** Voice the agent writes in, e.g. "direct, warm, no fluff". */
  tone?: string;
  /** Name and email outreach is sent from. */
  sender: { name: string; email: string };
  /** Link the agent offers when a lead wants to talk. */
  calendarUrl?: string;
}

export interface Lead {
  id: string;
  email: string;
  name?: string;
  company?: string;
  role?: string;
  website?: string;
  notes?: string;
  source?: string;
}

export type QualificationTier = "hot" | "warm" | "cold";

export interface Qualification {
  /** 0–100 fit score. */
  score: number;
  tier: QualificationTier;
  /** Why the score landed where it did. */
  reasoning: string;
}

export type MessageStatus = "draft" | "approved" | "sent";

export interface Message {
  id: string;
  leadId: string;
  /** 1-based position in the follow-up sequence. */
  step: number;
  channel: "email";
  subject: string;
  body: string;
  createdAt: string;
  status: MessageStatus;
  /** When the message left the door. */
  sentAt?: string;
  /** Provider reference or outbox filename. */
  reference?: string;
}

export type PipelineStage =
  | "imported"
  | "qualified"
  | "contacted"
  | "replied"
  | "meeting"
  | "won"
  | "lost"
  | "unsubscribed";

export type ReplyIntent =
  | "interested"
  | "question"
  | "not_interested"
  | "unsubscribe"
  | "out_of_office"
  | "unknown";

export interface LeadRecord {
  lead: Lead;
  stage: PipelineStage;
  qualification?: Qualification;
  messages: Message[];
  /** ISO timestamps of when each stage was entered. */
  stageHistory: Partial<Record<PipelineStage, string>>;
}
