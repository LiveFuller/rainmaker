import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Message } from "../core/types.js";

export interface SendResult {
  /** Provider-side id, or the outbox filename in dev. */
  reference: string;
  sentAt: string;
}

export interface Sender {
  send(to: string, from: { name: string; email: string }, message: Message): Promise<SendResult>;
}

/** Dev adapter: drops emails as files in .rainmaker/outbox/. Nothing leaves the machine. */
export class OutboxSender implements Sender {
  constructor(private readonly dir: string) {}

  async send(to: string, from: { name: string; email: string }, message: Message): Promise<SendResult> {
    await mkdir(this.dir, { recursive: true });
    const reference = `${message.id}.eml`;
    const contents = [
      `From: ${from.name} <${from.email}>`,
      `To: ${to}`,
      `Subject: ${message.subject}`,
      `Date: ${new Date().toUTCString()}`,
      "",
      message.body,
      "",
    ].join("\r\n");
    await writeFile(path.join(this.dir, reference), contents, "utf8");
    return { reference, sentAt: new Date().toISOString() };
  }
}

/** Live adapter: Resend HTTPS API. Zero dependencies — plain fetch. */
export class ResendSender implements Sender {
  constructor(private readonly apiKey: string) {}

  async send(to: string, from: { name: string; email: string }, message: Message): Promise<SendResult> {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        from: `${from.name} <${from.email}>`,
        to: [to],
        subject: message.subject,
        text: message.body,
      }),
    });
    if (!res.ok) {
      throw new Error(`Resend send failed: ${res.status} ${await res.text()}`);
    }
    const data = (await res.json()) as { id?: string };
    return { reference: data.id ?? "unknown", sentAt: new Date().toISOString() };
  }
}
