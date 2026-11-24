import { readFile } from "node:fs/promises";
import type { Offer } from "./types.js";

export interface RainmakerConfig {
  offer: Offer;
  /** Max first-touch emails sent per day. Protects sender reputation. */
  dailySendLimit: number;
  /** Hours between follow-up steps. */
  followupCadenceHours: number[];
  /**
   * approval: every message waits for a human yes.
   * autopilot: qualified leads are written to and followed up automatically.
   */
  mode: "approval" | "autopilot";
  llm: {
    /** Any OpenAI-compatible endpoint. */
    baseUrl: string;
    model: string;
    apiKeyEnv: string;
  };
  /** How email leaves the machine. Defaults to the dev outbox. */
  transport: {
    kind: "outbox" | "resend";
    /** Required when kind is resend. */
    apiKeyEnv?: string;
  };
}

export class ConfigError extends Error {}

function requireString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new ConfigError(`${path} must be a non-empty string`);
  }
  return value;
}

export function validateConfig(raw: unknown): RainmakerConfig {
  if (typeof raw !== "object" || raw === null) throw new ConfigError("config must be an object");
  const c = raw as Record<string, unknown>;

  const offer = c.offer as Record<string, unknown> | undefined;
  if (!offer) throw new ConfigError("offer is required");
  requireString(offer.name, "offer.name");
  requireString(offer.description, "offer.description");
  requireString(offer.idealCustomer, "offer.idealCustomer");
  const sender = offer.sender as Record<string, unknown> | undefined;
  if (!sender) throw new ConfigError("offer.sender is required");
  requireString(sender.name, "offer.sender.name");
  requireString(sender.email, "offer.sender.email");

  const llm = c.llm as Record<string, unknown> | undefined;
  if (!llm) throw new ConfigError("llm is required");
  requireString(llm.baseUrl, "llm.baseUrl");
  requireString(llm.model, "llm.model");
  requireString(llm.apiKeyEnv, "llm.apiKeyEnv");

  const mode = c.mode ?? "approval";
  if (mode !== "approval" && mode !== "autopilot") {
    throw new ConfigError('mode must be "approval" or "autopilot"');
  }

  const dailySendLimit = c.dailySendLimit ?? 20;
  if (typeof dailySendLimit !== "number" || dailySendLimit < 1) {
    throw new ConfigError("dailySendLimit must be a positive number");
  }

  const cadence = c.followupCadenceHours ?? [48, 96, 168];
  if (!Array.isArray(cadence) || cadence.some((h) => typeof h !== "number" || h <= 0)) {
    throw new ConfigError("followupCadenceHours must be an array of positive numbers");
  }

  const transport = (c.transport ?? { kind: "outbox" }) as Record<string, unknown>;
  const kind = transport.kind ?? "outbox";
  if (kind !== "outbox" && kind !== "resend") {
    throw new ConfigError('transport.kind must be "outbox" or "resend"');
  }
  if (kind === "resend") requireString(transport.apiKeyEnv, "transport.apiKeyEnv");

  return {
    offer: offer as unknown as Offer,
    dailySendLimit,
    followupCadenceHours: cadence as number[],
    mode,
    llm: {
      baseUrl: llm.baseUrl as string,
      model: llm.model as string,
      apiKeyEnv: llm.apiKeyEnv as string,
    },
    transport: {
      kind,
      ...(typeof transport.apiKeyEnv === "string" ? { apiKeyEnv: transport.apiKeyEnv } : {}),
    },
  };
}

export async function loadConfig(path: string): Promise<RainmakerConfig> {
  const text = await readFile(path, "utf8");
  try {
    return validateConfig(JSON.parse(text));
  } catch (err) {
    if (err instanceof SyntaxError) throw new ConfigError(`${path}: invalid JSON`);
    throw err;
  }
}
