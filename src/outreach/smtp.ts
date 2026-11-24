import net from "node:net";
import tls from "node:tls";
import type { Message } from "../core/types.js";
import type { SendResult, Sender } from "./sender.js";

export interface SmtpSettings {
  host: string;
  port: number;
  user: string;
  pass: string;
  /** tls = implicit TLS (465), starttls = upgrade after EHLO (587), none = plaintext (local dev). */
  security: "tls" | "starttls" | "none";
}

class SmtpError extends Error {}

/** Line-oriented SMTP dialogue over a socket. */
class SmtpSession {
  private buffer = "";
  private waiters: ((lines: string[]) => void)[] = [];
  private pending: string[] = [];

  constructor(private socket: net.Socket) {
    socket.on("data", (chunk: Buffer) => {
      this.buffer += chunk.toString("utf8");
      let idx: number;
      while ((idx = this.buffer.indexOf("\r\n")) >= 0) {
        const line = this.buffer.slice(0, idx);
        this.buffer = this.buffer.slice(idx + 2);
        this.pending.push(line);
        this.flush();
      }
    });
    socket.on("error", (err) => {
      this.pending.push(`500 ${err.message}`);
      this.flush();
    });
  }

  private flush(): void {
    // A response is complete when its last line has a space after the code,
    // continuation lines use a dash: "250-PIPELINING" then "250 AUTH LOGIN".
    const last = this.pending.at(-1);
    if (last && /^\d{3} /.test(last) && this.waiters.length > 0) {
      const resolve = this.waiters.shift()!;
      resolve(this.pending.splice(0));
    }
  }

  /** Read one complete (possibly multiline) response. Returns the final code. */
  expect(): Promise<{ code: number; lines: string[] }> {
    return new Promise((resolve) => {
      this.waiters.push((lines) => {
        resolve({ code: Number(lines.at(-1)?.slice(0, 3) ?? 0), lines });
      });
      this.flush();
    });
  }

  async command(cmd: string): Promise<{ code: number; lines: string[] }> {
    this.socket.write(cmd + "\r\n");
    return this.expect();
  }

  async expectCode(cmd: string, wanted: number[]): Promise<string[]> {
    const { code, lines } = await this.command(cmd);
    if (!wanted.includes(code)) throw new SmtpError(`${cmd.split(" ")[0]} -> ${code}: ${lines.join(" | ")}`);
    return lines;
  }
}

function dotStuff(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) => (line.startsWith(".") ? "." + line : line))
    .join("\r\n");
}

/** SMTP sender with no dependencies — Gmail/Workspace, any provider, even a local server. */
export class SmtpSender implements Sender {
  constructor(private readonly settings: SmtpSettings) {}

  async send(to: string, from: { name: string; email: string }, message: Message): Promise<SendResult> {
    const { host, port, user, pass, security } = this.settings;
    let socket: net.Socket;

    if (security === "tls") {
      socket = tls.connect({ host, port, servername: host });
    } else {
      socket = net.connect({ host, port });
    }
    await new Promise<void>((resolve, reject) => {
      socket.once("connect", resolve);
      socket.once("error", reject);
    });

    const session = new SmtpSession(socket);
    const greeting = await session.expect();
    if (greeting.code !== 220) throw new SmtpError(`bad greeting: ${greeting.lines.join(" | ")}`);

    await session.expectCode(`EHLO rainmaker.local`, [250]);

    if (security === "starttls") {
      await session.expectCode("STARTTLS", [220]);
      const upgraded = tls.connect({ socket, servername: host });
      await new Promise<void>((resolve, reject) => {
        upgraded.once("secureConnect", resolve);
        upgraded.once("error", reject);
      });
      socket = upgraded;
      const secureSession = new SmtpSession(socket);
      await secureSession.expectCode(`EHLO rainmaker.local`, [250]);
      return this.deliver(secureSession, socket, to, from, message, user, pass);
    }
    return this.deliver(session, socket, to, from, message, user, pass);
  }

  private async deliver(
    session: SmtpSession,
    socket: net.Socket,
    to: string,
    from: { name: string; email: string },
    message: Message,
    user: string,
    pass: string,
  ): Promise<SendResult> {
    try {
      await session.expectCode("AUTH LOGIN", [334]);
      await session.expectCode(Buffer.from(user).toString("base64"), [334]);
      await session.expectCode(Buffer.from(pass).toString("base64"), [235]);

      await session.expectCode(`MAIL FROM:<${from.email}>`, [250]);
      await session.expectCode(`RCPT TO:<${to}>`, [250, 251]);
      await session.expectCode("DATA", [354]);

      const wire = [
        `From: ${from.name} <${from.email}>`,
        `To: ${to}`,
        `Subject: ${message.subject}`,
        `Date: ${new Date().toUTCString()}`,
        `Message-ID: <${message.id}@rainmaker.local>`,
        "MIME-Version: 1.0",
        'Content-Type: text/plain; charset="utf-8"',
        "",
        dotStuff(message.body),
        ".",
      ].join("\r\n");
      await session.expectCode(wire, [250]);
      await session.command("QUIT");
      return { reference: message.id };
    } finally {
      socket.destroy();
    }
  }
}
