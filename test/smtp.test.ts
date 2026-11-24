import { test } from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import { SmtpSender } from "../src/outreach/smtp.js";
import type { Message } from "../src/core/types.js";

/** Minimal plaintext SMTP server that records the dialogue. */
async function fakeSmtpServer(): Promise<{ port: number; transcript: string[]; close: () => void }> {
  const transcript: string[] = [];
  const sockets: net.Socket[] = [];
  const server = net.createServer((socket) => {
    sockets.push(socket);
    let inData = false;
    let buffer = "";
    socket.write("220 fake.local ESMTP ready\r\n");
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      for (;;) {
        if (inData) {
          const end = buffer.indexOf("\r\n.\r\n");
          if (end < 0) return;
          transcript.push("DATA-BODY:" + buffer.slice(0, end));
          buffer = buffer.slice(end + 5);
          inData = false;
          socket.write("250 queued as fake1\r\n");
          continue;
        }
        const nl = buffer.indexOf("\r\n");
        if (nl < 0) return;
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 2);
        transcript.push(line);

        if (line.startsWith("EHLO")) socket.write("250-fake.local\r\n250 AUTH LOGIN\r\n");
        else if (line === "AUTH LOGIN") socket.write("334 VXNlcm5hbWU6\r\n");
        else if (line === Buffer.from("u@x.cz").toString("base64")) socket.write("334 UGFzc3dvcmQ6\r\n");
        else if (line === Buffer.from("secret").toString("base64")) socket.write("235 authenticated\r\n");
        else if (line.startsWith("MAIL FROM")) socket.write("250 ok\r\n");
        else if (line.startsWith("RCPT TO")) socket.write("250 ok\r\n");
        else if (line === "DATA") {
          inData = true;
          socket.write("354 end with dot\r\n");
        } else if (line === "QUIT") socket.write("221 bye\r\n");
      }
    });
  });
  server.unref();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as net.AddressInfo).port;
  return {
    port,
    transcript,
    close: () => {
      for (const s of sockets) s.destroy();
      server.close();
    },
  };
}

const message: Message = {
  id: "msg123",
  leadId: "l1",
  step: 1,
  channel: "email",
  subject: "quick question",
  body: "Hi there.\n\nWorth ten minutes?\n\n.PS dot-stuffing test",
  createdAt: "2026-01-01T00:00:00Z",
  status: "approved",
};

test("SMTP client runs the full dialogue and dot-stuffs the body", async () => {
  const fake = await fakeSmtpServer();
  const sender = new SmtpSender({ host: "127.0.0.1", port: fake.port, security: "none", user: "u@x.cz", pass: "secret" });
  const result = await sender.send("lead@shop.cz", { name: "Seller", email: "seller@example.com" }, message);
  assert.equal(result.reference, "msg123");
  fake.close();

  const t = fake.transcript;
  assert.ok(t.some((l) => l.startsWith("EHLO")));
  assert.ok(t.includes("AUTH LOGIN"));
  assert.ok(t.some((l) => l === "MAIL FROM:<seller@example.com>"));
  assert.ok(t.some((l) => l === "RCPT TO:<lead@shop.cz>"));
  const body = t.find((l) => l.startsWith("DATA-BODY:"))!;
  assert.match(body, /Subject: quick question/);
  assert.match(body, /\r?\n\.\.PS/, "leading dots are doubled");
});

test("SMTP client surfaces server refusals", async () => {
  const server = net.createServer((socket) => {
    socket.write("554 relaying denied\r\n", () => socket.destroy());
  });
  server.unref();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as net.AddressInfo).port;
  const sender = new SmtpSender({ host: "127.0.0.1", port, security: "none", user: "u", pass: "p" });
  await assert.rejects(() => sender.send("a@b.cz", { name: "S", email: "s@x.cz" }, message), /bad greeting/);
  server.close();
});
