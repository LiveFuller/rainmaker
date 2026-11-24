import type { LeadRecord, PipelineStage } from "../core/types.js";

export const STAGE_ORDER: PipelineStage[] = [
  "imported",
  "qualified",
  "contacted",
  "replied",
  "meeting",
  "won",
  "lost",
  "unsubscribed",
];

const STAGE_COLORS: Record<PipelineStage, string> = {
  imported: "#6e7681",
  qualified: "#8b949e",
  contacted: "#58a6ff",
  replied: "#d2a8ff",
  meeting: "#ffa657",
  won: "#3fb950",
  lost: "#f85149",
  unsubscribed: "#484f58",
};

export function stateJson(records: LeadRecord[]): unknown {
  const funnel = Object.fromEntries(
    STAGE_ORDER.map((s) => [s, records.filter((r) => r.stage === s).length]),
  );
  return {
    generatedAt: new Date().toISOString(),
    funnel,
    leads: records.map((r) => ({
      id: r.lead.id,
      email: r.lead.email,
      name: r.lead.name ?? null,
      company: r.lead.company ?? null,
      stage: r.stage,
      score: r.qualification?.score ?? null,
      tier: r.qualification?.tier ?? null,
      reasoning: r.qualification?.reasoning ?? null,
      messages: r.messages.map((m) => ({
        id: m.id,
        step: m.step,
        subject: m.subject,
        body: m.body,
        status: m.status,
        createdAt: m.createdAt,
        sentAt: m.sentAt ?? null,
      })),
    })),
  };
}

export function dashboardHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>rainmaker — mission control</title>
<style>
  :root {
    --bg: #0b0e13; --panel: #11151c; --line: #21262e;
    --text: #c9d1d9; --dim: #8b949e; --faint: #6e7681;
    --accent: #58a6ff; --good: #3fb950; --bad: #f85149; --warn: #ffa657;
  }
  * { box-sizing: border-box; margin: 0; }
  body { background: var(--bg); color: var(--text); font: 14px/1.5 -apple-system, "Segoe UI", sans-serif; }
  header { padding: 18px 24px; border-bottom: 1px solid var(--line); display: flex; align-items: baseline; gap: 12px; }
  header h1 { font-size: 18px; letter-spacing: 0.5px; }
  header h1 span { color: var(--dim); font-weight: 400; }
  header .clock { margin-left: auto; color: var(--faint); font-family: ui-monospace, monospace; font-size: 12px; }
  main { padding: 20px 24px; max-width: 1200px; margin: 0 auto; }
  .funnel { display: flex; gap: 6px; margin-bottom: 22px; }
  .stage { flex: 1; background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 10px 12px; }
  .stage .n { font-size: 22px; font-weight: 650; }
  .stage .label { font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: var(--dim); }
  .stage .bar { height: 3px; border-radius: 2px; margin-top: 8px; }
  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: var(--faint); padding: 8px 10px; border-bottom: 1px solid var(--line); }
  td { padding: 10px; border-bottom: 1px solid var(--line); vertical-align: middle; }
  tr.lead { cursor: pointer; }
  tr.lead:hover td { background: var(--panel); }
  .chip { display: inline-block; padding: 2px 9px; border-radius: 99px; font-size: 11px; border: 1px solid var(--line); }
  .scorebar { width: 90px; height: 5px; background: var(--line); border-radius: 3px; overflow: hidden; display: inline-block; vertical-align: middle; margin-right: 8px; }
  .scorebar i { display: block; height: 100%; }
  .tier-hot { color: var(--bad); } .tier-warm { color: var(--warn); } .tier-cold { color: var(--accent); }
  aside#thread { position: fixed; inset: 0 0 0 auto; width: 440px; background: var(--panel); border-left: 1px solid var(--line);
    transform: translateX(100%); transition: transform .18s ease; padding: 20px; overflow-y: auto; }
  aside#thread.open { transform: none; }
  aside h2 { font-size: 15px; margin-bottom: 4px; }
  aside .sub { color: var(--dim); font-size: 12px; margin-bottom: 16px; }
  .msg { border: 1px solid var(--line); border-radius: 8px; padding: 12px; margin-bottom: 12px; background: var(--bg); }
  .msg .meta { font-size: 11px; color: var(--faint); margin-bottom: 6px; display: flex; gap: 8px; }
  .msg .subject { font-weight: 600; margin-bottom: 6px; }
  .msg pre { white-space: pre-wrap; font: 12px/1.5 ui-monospace, monospace; color: var(--text); }
  .status-draft { color: var(--warn); } .status-approved { color: var(--accent); } .status-sent { color: var(--good); }
  button { background: var(--accent); color: #06121f; border: 0; border-radius: 6px; padding: 7px 14px; font-weight: 650; cursor: pointer; }
  button.ghost { background: transparent; color: var(--dim); border: 1px solid var(--line); }
  button:hover { filter: brightness(1.1); }
  .empty { color: var(--faint); padding: 40px 0; text-align: center; }
</style>
</head>
<body>
<header>
  <h1>rainmaker <span>· mission control</span></h1>
  <div class="clock" id="clock"></div>
</header>
<main>
  <div class="funnel" id="funnel"></div>
  <table>
    <thead><tr><th>Lead</th><th>Stage</th><th>Score</th><th>Messages</th><th></th></tr></thead>
    <tbody id="leads"></tbody>
  </table>
  <div class="empty" id="empty" hidden>No leads yet — feed the machine a CSV.</div>
</main>
<aside id="thread">
  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
    <h2 id="t-name"></h2>
    <button class="ghost" onclick="closeThread()">close</button>
  </div>
  <div class="sub" id="t-sub"></div>
  <div id="t-msgs"></div>
</aside>
<script>
const COLORS = ${JSON.stringify(STAGE_COLORS)};
const ORDER = ${JSON.stringify(STAGE_ORDER)};
let state = null;
let openLead = null;

async function refresh() {
  const res = await fetch("/api/state");
  state = await res.json();
  render();
}
function render() {
  document.getElementById("clock").textContent = new Date().toISOString().slice(11, 19) + "Z";
  const funnel = document.getElementById("funnel");
  funnel.innerHTML = ORDER.map((s) => {
    const n = state.funnel[s] || 0;
    const max = Math.max(1, ...ORDER.map((x) => state.funnel[x] || 0));
    return \`<div class="stage"><div class="n" style="color:\${COLORS[s]}">\${n}</div>
      <div class="label">\${s}</div>
      <div class="bar" style="background:\${COLORS[s]};width:\${Math.round((n / max) * 100)}%"></div></div>\`;
  }).join("");
  const tbody = document.getElementById("leads");
  document.getElementById("empty").hidden = state.leads.length > 0;
  tbody.innerHTML = state.leads.map((l) => {
    const drafts = l.messages.filter((m) => m.status === "draft").length;
    return \`<tr class="lead" onclick="openThread('\${l.id}')">
      <td><strong>\${l.name || l.email}</strong><br><span style="color:var(--dim);font-size:12px">\${l.company || l.email}</span></td>
      <td><span class="chip" style="color:\${COLORS[l.stage]};border-color:\${COLORS[l.stage]}33">\${l.stage}</span></td>
      <td>\${l.score == null ? "—" : \`<span class="scorebar"><i style="width:\${l.score}%;background:\${l.tier === "hot" ? "var(--bad)" : l.tier === "warm" ? "var(--warn)" : "var(--accent)"}"></i></span><span class="tier-\${l.tier}">\${l.score}</span>\`}</td>
      <td>\${l.messages.length}\${drafts ? \` <span class="chip status-draft">\${drafts} draft\${drafts > 1 ? "s" : ""}</span>\` : ""}</td>
      <td></td></tr>\`;
  }).join("");
  if (openLead) renderThread();
}
function openThread(id) { openLead = id; document.getElementById("thread").classList.add("open"); renderThread(); }
function closeThread() { openLead = null; document.getElementById("thread").classList.remove("open"); }
function renderThread() {
  const l = state.leads.find((x) => x.id === openLead);
  if (!l) return closeThread();
  document.getElementById("t-name").textContent = l.name || l.email;
  document.getElementById("t-sub").textContent =
    [l.company, l.stage, l.reasoning].filter(Boolean).join(" · ");
  document.getElementById("t-msgs").innerHTML = l.messages.map((m) => \`
    <div class="msg">
      <div class="meta"><span>step \${m.step}</span><span class="status-\${m.status}">\${m.status}</span><span>\${m.createdAt.slice(0, 10)}</span></div>
      <div class="subject">\${m.subject}</div>
      <pre>\${m.body.replace(/</g, "&lt;")}</pre>
      \${m.status === "draft" ? \`<button onclick="approve('\${m.id}')">approve &amp; queue</button>\` : ""}
    </div>\`).join("") || '<div class="empty">No messages yet.</div>';
}
async function approve(id) {
  await fetch("/approve", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ messageId: id }) });
  await refresh();
}
refresh();
setInterval(refresh, 5000);
</script>
</body>
</html>`;
}
