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
  imported: "#5c636e",
  qualified: "#8b949e",
  contacted: "#79b8ff",
  replied: "#c8a2ff",
  meeting: "#ffa657",
  won: "#56d364",
  lost: "#ff6b5e",
  unsubscribed: "#3d434c",
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
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300;500;700&family=Space+Mono&display=swap" rel="stylesheet" />
<style>
  :root {
    --bg: #06080c; --panel: rgba(16, 20, 27, 0.72); --line: #232a35;
    --text: #d7dde5; --dim: #8b949e; --faint: #59616d;
    --accent: #79b8ff; --hot: #ff6b4a; --warm: #e3b341; --cold: #79b8ff;
    --good: #56d364; --meet: #ffa657;
  }
  * { box-sizing: border-box; margin: 0; }
  html { background: var(--bg); }
  body {
    background:
      radial-gradient(1200px 500px at 80% -10%, rgba(121, 184, 255, 0.06), transparent 60%),
      radial-gradient(900px 400px at 10% 110%, rgba(200, 162, 255, 0.04), transparent 60%),
      var(--bg);
    color: var(--text);
    font: 14px/1.55 "Space Grotesk", -apple-system, sans-serif;
    min-height: 100vh;
  }
  .hero {
    position: relative;
    padding: 34px 40px 30px;
    border-bottom: 1px solid var(--line);
    background-image: linear-gradient(90deg, rgba(6, 8, 12, 0.94) 0%, rgba(6, 8, 12, 0.55) 45%, rgba(6, 8, 12, 0.25) 100%), url("/assets/crystal-header.webp");
    background-size: cover;
    background-position: center right;
  }
  .hero h1 {
    font-weight: 300; font-size: 30px; letter-spacing: 0.35em; text-transform: uppercase;
    color: #f2f5f9; text-shadow: 0 0 24px rgba(255, 255, 255, 0.18);
  }
  .hero h1 b { font-weight: 700; }
  .hero .sub {
    font-family: "Space Mono", ui-monospace, monospace; font-size: 11px; letter-spacing: 0.2em;
    text-transform: uppercase; color: var(--dim); margin-top: 6px;
  }
  .hero .clock {
    position: absolute; top: 38px; right: 40px;
    font-family: "Space Mono", ui-monospace, monospace; font-size: 12px; color: var(--dim);
    border: 1px solid var(--line); padding: 4px 10px; border-radius: 6px; background: rgba(6, 8, 12, 0.6);
  }
  main { padding: 26px 40px; max-width: 1280px; margin: 0 auto; }
  .funnel { display: grid; grid-template-columns: repeat(8, 1fr); gap: 8px; margin-bottom: 30px; }
  .stage {
    background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 14px 14px 12px;
    backdrop-filter: blur(6px); transition: border-color .15s ease, transform .15s ease;
  }
  .stage:hover { border-color: #38414f; transform: translateY(-1px); }
  .stage .n { font-size: 30px; font-weight: 300; line-height: 1; }
  .stage .label {
    font-family: "Space Mono", ui-monospace, monospace; font-size: 9px; text-transform: uppercase;
    letter-spacing: 0.16em; color: var(--faint); margin-top: 7px;
  }
  .stage .bar { height: 2px; border-radius: 2px; margin-top: 10px; transition: width .4s ease; }
  .section-title {
    font-family: "Space Mono", ui-monospace, monospace; font-size: 10px; letter-spacing: 0.24em;
    text-transform: uppercase; color: var(--faint); margin: 0 0 10px 2px;
  }
  table { width: 100%; border-collapse: collapse; }
  th {
    text-align: left; font-family: "Space Mono", ui-monospace, monospace; font-size: 10px;
    text-transform: uppercase; letter-spacing: 0.18em; color: var(--faint);
    padding: 10px 12px; border-bottom: 1px solid var(--line);
  }
  td { padding: 13px 12px; border-bottom: 1px solid rgba(35, 42, 53, 0.55); vertical-align: middle; }
  tr.lead { cursor: pointer; animation: rise .35s ease both; }
  tr.lead:hover td { background: rgba(121, 184, 255, 0.045); }
  @keyframes rise { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
  .who strong { font-weight: 500; font-size: 14.5px; }
  .who .co { color: var(--dim); font-size: 12px; margin-top: 2px; }
  .chip {
    display: inline-block; padding: 3px 11px; border-radius: 99px; font-size: 11px;
    font-family: "Space Mono", ui-monospace, monospace; letter-spacing: 0.06em;
    border: 1px solid var(--line); background: rgba(6, 8, 12, 0.5);
  }
  .ring { display: inline-block; vertical-align: middle; margin-right: 10px; }
  .ring svg { display: block; transform: rotate(-90deg); }
  .ring text { transform: rotate(90deg); }
  .score-num { font-family: "Space Mono", ui-monospace, monospace; font-size: 13px; }
  .tier-hot { color: var(--hot); } .tier-warm { color: var(--warm); } .tier-cold { color: var(--cold); }
  .drafts {
    margin-left: 8px; color: var(--meet); font-family: "Space Mono", ui-monospace, monospace; font-size: 11px;
  }
  aside#thread {
    position: fixed; inset: 0 0 0 auto; width: 480px; max-width: 92vw;
    background: rgba(10, 13, 18, 0.92); backdrop-filter: blur(14px);
    border-left: 1px solid var(--line); transform: translateX(102%);
    transition: transform .22s cubic-bezier(.2, .8, .2, 1); padding: 26px; overflow-y: auto;
  }
  aside#thread.open { transform: none; box-shadow: -30px 0 80px rgba(0, 0, 0, 0.5); }
  aside h2 { font-weight: 500; font-size: 17px; }
  aside .sub {
    color: var(--dim); font-size: 12px; margin: 6px 0 20px;
    font-family: "Space Mono", ui-monospace, monospace;
  }
  .msg {
    border: 1px solid var(--line); border-radius: 10px; padding: 15px; margin-bottom: 14px;
    background: rgba(6, 8, 12, 0.55);
  }
  .msg .meta {
    font-size: 10px; color: var(--faint); margin-bottom: 8px; display: flex; gap: 10px;
    font-family: "Space Mono", ui-monospace, monospace; text-transform: uppercase; letter-spacing: 0.1em;
  }
  .msg .subject { font-weight: 500; margin-bottom: 8px; }
  .msg pre { white-space: pre-wrap; font: 12.5px/1.6 "Space Mono", ui-monospace, monospace; color: var(--text); }
  .status-draft { color: var(--meet); } .status-approved { color: var(--accent); } .status-sent { color: var(--good); }
  button {
    background: linear-gradient(180deg, #9ccbff, #79b8ff); color: #04121f; border: 0;
    border-radius: 7px; padding: 9px 16px; font-weight: 700; cursor: pointer; font-size: 12.5px;
    font-family: "Space Grotesk", sans-serif; letter-spacing: 0.02em; margin-top: 10px;
    box-shadow: 0 0 18px rgba(121, 184, 255, 0.25);
  }
  button.ghost { background: transparent; color: var(--dim); border: 1px solid var(--line); box-shadow: none; }
  button:hover { filter: brightness(1.12); }
  .empty { color: var(--faint); padding: 60px 0; text-align: center; font-family: "Space Mono", monospace; font-size: 12px; }
  @media (max-width: 900px) {
    .funnel { grid-template-columns: repeat(4, 1fr); }
    main, .hero { padding-left: 20px; padding-right: 20px; }
  }
</style>
</head>
<body>
<header class="hero">
  <h1><b>rainmaker</b></h1>
  <div class="sub">mission control · autonomous outbound</div>
  <div class="clock" id="clock"></div>
</header>
<main>
  <div class="section-title">Pipeline</div>
  <div class="funnel" id="funnel"></div>
  <div class="section-title">Leads</div>
  <table>
    <thead><tr><th>Lead</th><th>Stage</th><th>Fit score</th><th>Messages</th></tr></thead>
    <tbody id="leads"></tbody>
  </table>
  <div class="empty" id="empty" hidden>no leads yet — feed the machine a csv</div>
</main>
<aside id="thread">
  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
    <h2 id="t-name"></h2>
    <button class="ghost" onclick="closeThread()">close</button>
  </div>
  <div class="sub" id="t-sub"></div>
  <div id="t-msgs"></div>
</aside>
<script>
const COLORS = ${JSON.stringify(STAGE_COLORS)};
const ORDER = ${JSON.stringify(STAGE_ORDER)};
const TIER_COLOR = { hot: "#ff6b4a", warm: "#e3b341", cold: "#79b8ff" };
let state = null;
let openLead = null;

async function refresh() {
  const res = await fetch("/api/state");
  state = await res.json();
  render();
}
function ring(score, tier) {
  const c = TIER_COLOR[tier] || "#59616d";
  const r = 15, circ = 2 * Math.PI * r, fill = circ * score / 100;
  return \`<span class="ring"><svg width="36" height="36" viewBox="0 0 36 36">
    <circle cx="18" cy="18" r="\${r}" fill="none" stroke="#232a35" stroke-width="2.5"/>
    <circle cx="18" cy="18" r="\${r}" fill="none" stroke="\${c}" stroke-width="2.5"
      stroke-linecap="round" stroke-dasharray="\${fill} \${circ}"/></svg></span>\`;
}
function render() {
  document.getElementById("clock").textContent = new Date().toISOString().slice(11, 19) + "Z";
  document.getElementById("funnel").innerHTML = ORDER.map((s) => {
    const n = state.funnel[s] || 0;
    const max = Math.max(1, ...ORDER.map((x) => state.funnel[x] || 0));
    return \`<div class="stage"><div class="n" style="color:\${COLORS[s]}">\${n}</div>
      <div class="label">\${s}</div>
      <div class="bar" style="background:\${COLORS[s]};width:\${Math.max(4, Math.round((n / max) * 100))}%;opacity:\${n ? 1 : 0.25}"></div></div>\`;
  }).join("");
  document.getElementById("empty").hidden = state.leads.length > 0;
  document.getElementById("leads").innerHTML = state.leads.map((l, i) => {
    const drafts = l.messages.filter((m) => m.status === "draft").length;
    return \`<tr class="lead" style="animation-delay:\${i * 40}ms" onclick="openThread('\${l.id}')">
      <td class="who"><strong>\${l.name || l.email}</strong><div class="co">\${l.company || l.email}</div></td>
      <td><span class="chip" style="color:\${COLORS[l.stage]};border-color:\${COLORS[l.stage]}44">\${l.stage}</span></td>
      <td>\${l.score == null ? '<span style="color:var(--faint)">—</span>' : ring(l.score, l.tier) + \`<span class="score-num tier-\${l.tier}">\${l.score}</span>\`}</td>
      <td><span style="font-family:'Space Mono',monospace">\${l.messages.length}</span>\${drafts ? \`<span class="drafts">● \${drafts} awaiting approval</span>\` : ""}</td></tr>\`;
  }).join("");
  if (openLead) renderThread();
}
function openThread(id) { openLead = id; document.getElementById("thread").classList.add("open"); renderThread(); }
function closeThread() { openLead = null; document.getElementById("thread").classList.remove("open"); }
function renderThread() {
  const l = state.leads.find((x) => x.id === openLead);
  if (!l) return closeThread();
  document.getElementById("t-name").textContent = l.name || l.email;
  document.getElementById("t-sub").textContent = [l.company, l.stage, l.reasoning].filter(Boolean).join(" · ");
  document.getElementById("t-msgs").innerHTML = l.messages.map((m) => \`
    <div class="msg">
      <div class="meta"><span>step \${m.step}</span><span class="status-\${m.status}">\${m.status}</span><span>\${m.sentAt ? "sent " + m.sentAt.slice(0, 10) : m.createdAt.slice(0, 10)}</span></div>
      <div class="subject">\${m.subject}</div>
      <pre>\${m.body.replace(/</g, "&lt;")}</pre>
      \${m.status === "draft" ? \`<button onclick="approve('\${m.id}')">approve &amp; queue</button>\` : ""}
    </div>\`).join("") || '<div class="empty">no messages yet</div>';
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
