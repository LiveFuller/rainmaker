import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

/** Drive the compiled MCP server over its stdio transport. */
async function mcpRoundtrip(messages: object[]): Promise<object[]> {
  const child = spawn("node", ["dist/cli.js", "mcp", "--demo"], { stdio: ["pipe", "pipe", "inherit"] });
  const responses: object[] = [];
  const rl = createInterface({ input: child.stdout });
  rl.on("line", (line) => responses.push(JSON.parse(line) as object));
  for (const m of messages) child.stdin.write(JSON.stringify(m) + "\n");
  await new Promise((resolve) => setTimeout(resolve, 500));
  child.stdin.end();
  await new Promise((resolve) => child.on("close", resolve));
  return responses;
}

test("MCP handshake, tool listing and a tool call", async () => {
  const responses = (await mcpRoundtrip([
    { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
    { jsonrpc: "2.0", id: 2, method: "tools/list" },
    { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "classify_reply", arguments: { text: "Sounds good, let's talk" } } },
    { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "pipeline_status", arguments: {} } },
  ])) as {
    id: number;
    result?: { serverInfo?: { name: string }; tools?: unknown[]; content?: { text: string }[] };
  }[];

  const byId = new Map(responses.map((r) => [r.id, r]));
  assert.equal(byId.get(1)?.result?.serverInfo?.name, "rainmaker");
  assert.equal(byId.get(2)?.result?.tools?.length, 4);
  const classify = JSON.parse(byId.get(3)?.result?.content?.[0]?.text ?? "{}") as { intent: string };
  assert.equal(classify.intent, "interested");
  const status = JSON.parse(byId.get(4)?.result?.content?.[0]?.text ?? "{}") as { total: number };
  assert.equal(typeof status.total, "number");
});
