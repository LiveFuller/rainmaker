# rainmaker

**The open-source AI salesman.** Plug in your offer and a list of leads — rainmaker qualifies them against your ideal customer profile, writes personalized outreach in your voice, follows up on a cadence, routes replies by intent and hands you meetings.

```
leads.csv ──▶ qualify ──▶ first touch ──▶ follow-up cadence ──▶ reply routing ──▶ booked call
              (0–100        in your        48h / 96h / 168h     interested?        calendar link
              vs. ICP)      voice                             question? opt-out?   in your inbox
```

[![CI](https://github.com/LiveFuller/rainmaker/actions/workflows/ci.yml/badge.svg)](https://github.com/LiveFuller/rainmaker/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![Node ≥ 22](https://img.shields.io/badge/node-%E2%89%A5%2022-339933)

## Why

Every small business dies or lives on outbound. The existing options are either \$100+/month black-box SaaS or glue-your-own scripts. rainmaker is the middle ground: a real codebase you can read end-to-end, self-host, bend to your niche — and point at a revenue problem the same afternoon.

## Try it in one minute — no keys, no network

```sh
git clone https://github.com/LiveFuller/rainmaker
cd rainmaker
npm install
npm run demo
```

Demo mode runs the entire loop offline against five sample Czech service-business leads:

```
=== Pipeline ===
  contacted    4
  qualified    1

=== Leads ===
  Jitka Nováková         contacted  score  70 (hot)  — Senior buyer matching the ideal profile
  Pavel Malý             contacted  score  70 (hot)  — Senior buyer matching the ideal profile
  Lena Krúpová           contacted  score  70 (hot)  — Senior buyer matching the ideal profile
  Tomáš Hájek            qualified  score  35 (cold) — Little overlap with the ideal profile
  Martina Říhová         contacted  score  70 (hot)  — Senior buyer matching the ideal profile

=== Sample first touch ===
To: jitka@vycistene.cz
Subject: quick question for Vyčištěné s.r.o.

Hi Jitka Nováková,

Noticed Vyčištěné s.r.o. and figured this might land: SiteSpot Websites is built
exactly for teams like yours.

Open to a quick look? Happy to keep it to ten minutes.
```

The demo brain is deterministic and offline. Swap in a real LLM and the same pipeline runs live.

## Go live

`rainmaker.config.json`:

```json
{
  "offer": {
    "name": "Your product",
    "description": "One honest paragraph about what you sell.",
    "idealCustomer": "Who buys it, in plain language.",
    "pricePoint": "EUR 2k/mo",
    "tone": "direct, warm, no fluff",
    "sender": { "name": "You", "email": "you@yourcompany.com" },
    "calendarUrl": "https://cal.com/you/15min"
  },
  "mode": "approval",
  "dailySendLimit": 20,
  "followupCadenceHours": [48, 96, 168],
  "llm": {
    "baseUrl": "https://api.openai.com/v1",
    "model": "gpt-5.2",
    "apiKeyEnv": "OPENAI_API_KEY"
  }
}
```

```sh
export OPENAI_API_KEY=…
rainmaker run --leads leads.csv
```

Any OpenAI-compatible endpoint works — point `baseUrl` at a local model and the whole thing runs self-contained.

`leads.csv` needs only an `email` column; `name`, `company`, `role`, `website` and `notes` are picked up automatically under common aliases.

## How it thinks

| Stage | File | Job |
| :--- | :--- | :--- |
| Ingest | <sub>`src/ingest/csv.ts`</sub> | CSV → typed leads, quoted-field safe |
| Qualify | <sub>`src/qualify/scorer.ts`</sub> | LLM scores each lead 0–100 against your ICP, in writing |
| Write | <sub>`src/outreach/sequence.ts`</sub> | First touch ≤ 80 words, one idea, one question; follow-ups get shorter |
| Route | <sub>`src/reply/classifier.ts`</sub> | Replies classified: interested / question / opt-out / OOO |
| Pipeline | <sub>`src/core/pipeline.ts`</sub> | State machine — no illegal jumps, every move timestamped |
| Memory | <sub>`src/core/store.ts`</sub> | Flat JSON under `.rainmaker/`, zero database required |

Two hard rules baked in:

1. **`approval` mode is the default.** Nothing sends without a human yes. `autopilot` exists, but it's opt-in.
2. **`unsubscribed` is terminal.** A lead that opts out can never be touched again — the state machine makes it impossible, not just unlikely.

## Roadmap

- [ ] Sending adapters — Resend, SMTP, Gmail API
- [ ] Inbox listener — IMAP polling + webhook ingestion for real replies
- [ ] Mission-control dashboard — live pipeline web UI
- [ ] MCP server — expose qualify/write/route as tools for any agent host
- [ ] Calendar booking — offer slots and write events directly
- [ ] Enrichment adapters — pull public company data before scoring

## Contributing

Issues and PRs welcome. The test suite is `node:test` only — no framework, `npm test` and you're running.

## License

[MIT](LICENSE) — use it to make money. That's the point.
