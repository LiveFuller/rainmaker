import tls from "node:tls";
import type { InboundEmail } from "../server/http.js";

export interface ImapSettings {
  host: string;
  port: number;
  user: string;
  pass: string;
}

class ImapError extends Error {}

/**
 * Minimal IMAP4rev1 client: enough to poll an inbox for unseen mail,
 * read it, and mark it seen. Sequential tagged commands only.
 */
class ImapSession {
  private buffer = "";
  private tagCounter = 0;
  private pendingLines: string[] = [];
  private waiters: ((tag: string) => void)[] = [];

  constructor(private socket: tls.TLSSocket) {
    socket.on("data", (chunk: Buffer) => {
      this.buffer += chunk.toString("utf8");
      let idx: number;
      while ((idx = this.buffer.indexOf("\r\n")) >= 0) {
        const line = this.buffer.slice(0, idx);
        this.buffer = this.buffer.slice(idx + 2);
        this.pendingLines.push(line);
        // Tagged completion: "a12 OK ..." / "a12 NO ..." / "a12 BAD ..."
        const m = /^(a\d+) (OK|NO|BAD)/i.exec(line);
        if (m) {
          const waiter = this.waiters.shift();
          if (waiter) waiter(m[1]!);
        }
      }
    });
    socket.on("error", () => {
      const waiter = this.waiters.shift();
      if (waiter) waiter("ERROR");
    });
  }

  private nextTag(): string {
    return `a${++this.tagCounter}`;
  }

  /** Send a tagged command and collect every line until the tag completes. */
  async command(cmd: string): Promise<string[]> {
    const tag = this.nextTag();
    const done = new Promise<string>((resolve) => this.waiters.push(resolve));
    this.socket.write(`${tag} ${cmd}\r\n`);
    const completed = await done;
    if (completed === "ERROR" || completed !== tag) {
      throw new ImapError(`command failed: ${cmd.split(" ")[0]}`);
    }
    const lines = this.pendingLines.splice(0, this.pendingLines.length);
    const status = lines.at(-1) ?? "";
    if (!status.startsWith(`${tag} OK`)) throw new ImapError(`${cmd.split(" ")[0]} -> ${status}`);
    return lines.slice(0, -1);
  }

  async readGreeting(): Promise<void> {
    await new Promise<void>((resolve) => {
      const check = () => {
        if (this.pendingLines.some((l) => l.startsWith("* OK"))) resolve();
        else setTimeout(check, 25);
      };
      check();
    });
    this.pendingLines = [];
  }
}

function parseAddressList(header: string): string {
  const match = /<([^>]+)>/.exec(header);
  return (match?.[1] ?? header).trim();
}

/** Split a raw RFC822 message into headers and body text. */
function parseMessage(raw: string): { from: string; subject: string; text: string } {
  const splitAt = raw.indexOf("\r\n\r\n");
  const head = splitAt >= 0 ? raw.slice(0, splitAt) : raw;
  const body = splitAt >= 0 ? raw.slice(splitAt + 4) : "";
  // Unfold continuation lines.
  const unfolded = head.replace(/\r\n[ \t]+/g, " ");
  const from = /^From:\s*(.+)$/im.exec(unfolded)?.[1] ?? "";
  const subject = /^Subject:\s*(.+)$/im.exec(unfolded)?.[1] ?? "";
  // Best-effort plaintext extraction: drop MIME parts we can't use.
  const text = body
    .replace(/Content-Type:[^\r\n]*(\r\n[^\r\n:]*)*\r\n\r\n/g, "\n")
    .replace(/[=0-9A-F]{2}/g, (m) => (m.startsWith("=") ? String.fromCharCode(parseInt(m.slice(1), 16)) : m));
  return { from: parseAddressList(from), subject, text: text.trim().slice(0, 8000) };
}

/** Fetch all unseen messages, then mark them seen. */
export async function pollOnce(settings: ImapSettings): Promise<InboundEmail[]> {
  const socket = tls.connect({
    host: settings.host,
    port: settings.port,
    servername: settings.host,
  });
  await new Promise<void>((resolve, reject) => {
    socket.once("secureConnect", resolve);
    socket.once("error", reject);
  });
  socket.unref();

  const session = new ImapSession(socket);
  try {
    await session.readGreeting();
    await session.command(`LOGIN "${settings.user}" "${settings.pass}"`);
    await session.command("SELECT INBOX");

    const search = await session.command("UID SEARCH UNSEEN");
    const uidLine = search.find((l) => l.startsWith("* SEARCH"));
    const uids = uidLine ? uidLine.slice(8).trim().split(/\s+/).filter(Boolean) : [];
    if (uids.length === 0) return [];

    const out: InboundEmail[] = [];
    for (const uid of uids.slice(0, 20)) {
      const fetched = await session.command(`UID FETCH ${uid} (BODY.PEEK[])`);
      const raw = fetched.join("\r\n");
      const parsed = parseMessage(raw);
      if (parsed.from && parsed.text) {
        out.push({ from: parsed.from, subject: parsed.subject, text: parsed.text });
      }
      await session.command(`UID STORE ${uid} +FLAGS (\\Seen)`);
    }
    return out;
  } finally {
    try {
      await session.command("LOGOUT");
    } catch {
      // half-dead sockets are fine at this point
    }
    socket.destroy();
  }
}

/** Endless polling loop; each new message is handed to the router. */
export async function listenForever(
  settings: ImapSettings,
  onMessage: (email: InboundEmail) => Promise<void>,
  intervalMinutes = 5,
): Promise<never> {
  for (;;) {
    try {
      const emails = await pollOnce(settings);
      for (const email of emails) {
        console.log(`[inbox] ${email.from}: ${(email.subject ?? "").slice(0, 60)}`);
        await onMessage(email);
      }
    } catch (err) {
      console.error(`[inbox] poll failed: ${err instanceof Error ? err.message : err}`);
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMinutes * 60 * 1000));
  }
}
