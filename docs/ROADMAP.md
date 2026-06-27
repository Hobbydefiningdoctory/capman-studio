# capman-studio — Product Roadmap

**Last updated:** June 2026 — Phase 1 CLI complete  
**Status:** Phase 1 complete. Phase 2 (web dashboard) planned.  
**Context:** All CLI commands shipped and documented. capman v0.6.2 contract validated.

---

## The Thesis

Software built for humans has a **UI** as its primary interface.  
Software built for AI agents has a **capability manifest** as its primary interface.

capman is the library that writes that manifest, routes intent to it, enforces privacy on it, and learns from it over time.

capman-studio is the developer tooling layer that sits above capman — giving developers the feedback loop, validation, and observability they need to build and maintain manifests well.

The shift is not coming. Salesforce shipped Headless 360 on April 15, 2026 — their entire CRM decomposed into MCP tools and CLI commands, accessible to agents without a UI. They spent 2.5 years and hundreds of engineers to do manually what capman does with a manifest file. The window is open.

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│ AI Agents / LLMs │
└─────────────────────┬───────────────────────────────┘
                      │ natural language intent
                      ▼
┌─────────────────────────────────────────────────────┐
│ capman Engine (library) │
│ manifest.json → match → resolve → execute │
│ Privacy enforced · Params validated · Learning │
└─────────────────────┬───────────────────────────────┘
                      │ typed API calls
                      ▼
┌─────────────────────────────────────────────────────┐
│ Your Application APIs │
└─────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────┐
│ capman-studio (developer tooling) │
│ inspect · eval · diff · watch · ci · agent │
│ CLI Phase 1 → Web Dashboard Phase 2 │
└─────────────────────────────────────────────────────┘
```

---

## Current State — What Is Built

All items below are shipped, reviewed, and audit-clean.

| Feature | Command | Status |
|---|---|---|
| Manifest health summary | `capman-studio eval` | ✅ Shipped |
| Interactive query REPL | `capman-studio eval --mode=repl` | ✅ Shipped |
| Batch suite runner | `capman-studio eval --mode=suite` | ✅ Shipped |
| CI quality gate | `capman-studio eval --threshold=80` | ✅ Shipped |
| POSIX `--` sentinel | internal | ✅ Shipped (Step 9.1, capman 0.5.5) |
| Full ANSI injection protection | all modes | ✅ Shipped |
| Path traversal guards | all modes | ✅ Shipped |
| `make-zip` secret exclusion | dev utility | ✅ Shipped |

---

## Phase 1 — CLI ✅ Complete

All CLI commands shipped, reviewed, and documented.

---

### `capman-studio diff` ✅ Shipped

Compares two manifest versions and shows exactly what changed — capabilities added, removed, modified, or renamed. Rename detection uses a conservative heuristic (description + resolver type must match) to avoid false positives.

Reads `manifest.json` files directly via `fs.readFileSync` rather than a capman subprocess — a justified exception to Option B, since no capman command exposes structured capability JSON (ADR-005).

Fields compared: `name`, `description`, `resolver.type`, `privacy.level`, `examples`, `params`, `returns` (v0.6+), `lifecycle.status` (v0.6+). All array comparisons are order-insensitive.

```bash
capman-studio diff manifest-old.json manifest-new.json
capman-studio diff manifest-old.json manifest-new.json --verbose
capman-studio diff manifest-old.json manifest-new.json --json
```

Exit code 1 when manifests differ — usable as a CI change-detection gate.

---

### `capman-studio generate-suite` ✅ Shipped

Scaffolds a starter eval suite file from the manifest. Generates one test case per capability using a 3-tier query selection strategy (examples → description → name), appends an out-of-scope sentinel, and flags deprecated capabilities in the case notes.

Eliminates the friction of writing the first suite file by hand — the most common reason developers skip regression testing entirely.

```bash
capman-studio generate-suite
capman-studio generate-suite --out my-suite.json
capman-studio generate-suite --manifest other.json
capman-studio generate-suite --overwrite   # replace existing file
capman-studio generate-suite --json        # print to stdout instead of writing
```

---

### `capman-studio watch` ✅ Shipped

Watches `manifest.json` for changes and automatically re-runs inspect or suite on every save. Closes the inner dev loop: edit `capman.config.js` → `capman generate` → studio updates immediately.

Implemented with `fs.watchFile` (500ms polling, no external dependencies). Includes a 300ms debounce and a concurrency guard — if a run is still in progress when the next change fires, the follow-up is queued rather than dropped.

```bash
capman-studio watch
capman-studio watch --suite cases.json          # re-run suite on change
capman-studio watch --suite cases.json --threshold=80
```

---

### `capman-studio ci` ✅ Shipped

Opinionated three-stage CI pipeline in a single command: [1] `capman validate` for manifest validation, [2] suite runner, [3] threshold check. All stages always run — a full picture in one pass. Exit code 1 if any stage fails.

```bash
capman-studio ci --suite cases.json
capman-studio ci --suite cases.json --threshold=80
capman-studio ci --suite cases.json --threshold=80 --json
```

```yaml
# GitHub Actions — one line drops into any workflow
- name: capman-studio CI
  run: capman-studio ci --suite cases.json --threshold=80 --json
```

---

## Phase 2 — Web Dashboard (Planned, after Phase 1 complete)

A local web dashboard served from `capman-studio serve`. Same Node.js codebase — grows into it.

**Not started. Begins only after all Phase 1 CLI commands are shipped and validated in real use.**

| Feature | Route | Notes |
|---|---|---|
| Manifest health view | `/` | Consumes `eval --json` output |
| Query playground | `/playground` | Streams REPL output |
| Suite runner | `/suite` | Visual pass/fail grid |
| Diff viewer | `/diff` | Compares two manifest versions |
| Capability detail | `/capability/:id` | Examples, params, resolver, privacy |

---

## Phase 3 — capman-agent (New — Strategic)

This phase is the most significant. It is the answer to the question: **Can capman's manifest replace software specifically designed for AI agents?**

The answer is yes — and the argument is already proven by Salesforce Headless 360.

Phase 3 turns capman from a developer tool into **agent-native infrastructure**.

---

### What capman-agent is

Three new capabilities that together make any application directly operable by AI agents, without a UI, without hallucination, without trial-and-error API guessing:

---

#### 3.1 — `capman headless` — The Agent-Native App Server

**What:** A thin HTTP server that serves the manifest over HTTP and executes matched capabilities on behalf of agents. Any app that adds `capman headless` to its deployment becomes immediately agent-accessible.

```bash
capman headless --port 3000
```

**Agent interaction:**
```
POST /intent
{ "query": "check if blue jacket is in stock" }

→ 200 OK
{
  "capability": "check_product_availability",
  "confidence": 94,
  "action": "GET /api/products/blue-jacket/availability",
  "privacy": "public"
}
```

**Why this matters:** Today an AI agent trying to use your app has three bad options — scrape the UI (brittle), guess at API endpoints (hallucination risk), or read 300 pages of OpenAPI docs (verbose, not intent-optimised). `capman headless` is the fourth option: a structured, intent-optimised, privacy-aware capability server that answers in <1ms.

**This is what Salesforce spent 2.5 years building. capman does it in an afternoon.**

---

#### 3.2 — Manifest Registry — npm for Capabilities

**What:** A public registry where developers publish and discover capability manifests. Standard manifests for common platforms (Stripe, GitHub, Notion, Linear, etc.).

**Why:** An agent working with a Stripe-powered app shouldn't generate a Stripe manifest from scratch — it should pull the published Stripe manifest and start. This is the network effect play: every published manifest makes every agent smarter.

```bash
capman registry publish
capman registry pull stripe/v1
capman registry search "payment processing"
```

**This is the npm moment for AI capability contracts.**

---

#### 3.3 — `capman audit` — The Governance Layer

**What:** Generate a structured audit trail from `ExecutionTrace` showing which agent called which capability, with what params, at what time, with what auth context.

```bash
capman audit --since 24h
capman audit --capability check_product_availability
capman audit --export audit-report.json
```

**Why enterprises need this:** Regulators and compliance teams need to answer "what did the AI do to our system and why." The `ExecutionTrace` capman already generates is the raw material. `capman audit` makes it queryable and exportable.

**This is the difference between a toy and enterprise-grade infrastructure.**

---

### The Displacement Map — Where capman-agent Has Real Impact

| Software Category | Displacement Potential | capman Role |
|---|---|---|
| CRM (Salesforce, HubSpot) | 🔴 High | Manifest over CRM API → agents handle tickets, updates, escalations |
| Internal ops tools | 🔴 High | Task status, approvals, reports — all high-frequency, well-structured |
| E-commerce backends | 🔴 High | Order, inventory, shipping, refunds — keyword matching at zero LLM cost |
| Customer support tools | 🔴 High | Case lookup, escalation, follow-up — 50 capabilities = 90% of agent actions |
| HR / Finance systems | 🟡 Medium | Timesheets, approvals, reporting — good candidates, compliance matters |
| Internal dashboards | 🟡 Medium | Replaced by generated summaries, not visual BI |
| Creative tools | 🟢 Low | Require real-time visual feedback loops agents can't close reliably |
| Medical / Engineering CAD | 🟢 Low | Regulatory and precision requirements — not appropriate for autonomous agents |

---

### What capman-agent is NOT

capman does not:
- Orchestrate multi-step agent workflows (that's LangGraph, LangChain, CrewAI)
- Replace the agent itself (that's the LLM + reasoning layer)
- Handle real-time visual feedback loops
- Build the human UI (human UI continues alongside the manifest)

capman does:
- Give agents a structured, queryable, privacy-aware map of what one application can do
- Route natural language intent to the correct API action in <1ms
- Enforce authorization at the capability level
- Learn and improve routing over time

---

## Full Roadmap — Ordered

```
✅ Step 1–5 Scaffold + CLI foundation
✅ Step 6 eval --threshold (CI quality gate)
✅ Step 7–8 Bug fixes, security audit fixes
✅ Step 9.1 capman v0.5.5 update (POSIX -- sentinel)

── Phase 1: CLI (active) ──────────────────────────────

✅ Step 9.2 diff Compare two manifest versions
✅ Step 10 generate-suite Scaffold starter suite from manifest
✅ Step 11 watch Re-run inspect on manifest change
✅ Step 12 ci Opinionated CI pipeline command

── Phase 2: Web Dashboard (planned, after Phase 1) ────

   Step 13 serve Local web dashboard
   Step 14 playground Query playground (web)
   Step 15 suite UI Visual suite runner
   Step 16 diff UI Visual diff viewer

── Phase 3: capman-agent (strategic) ──────────────────

   Step 17 capman headless Agent-native app server
   Step 18 Registry Manifest registry (npm for capabilities)
   Step 19 audit Governance + compliance layer
```

---

## Decision Gates

Phase 2 starts only when:
- All Phase 1 commands are shipped
- At least one real project has used `eval --suite` in CI
- `diff` has been used on at least one real manifest change

Phase 3 starts only when:
- Phase 2 dashboard is validated in real use
- capman MCP adapter is available (opens the registry use case)
- At least one partner app has tried `capman headless`

---

## Why the Order Matters

The original priority list (--threshold → diff → generate-suite → watch → ci) remains correct for Phase 1. Those five features are the minimum for a developer to say "capman-studio is part of my workflow."

Phase 3 is the reason the whole thing exists — but it lands on a foundation, not a hope. Without developers trusting capman-studio's inspect, eval, and diff results, there's no reason to trust a headless server executing capabilities on behalf of agents. The CLI builds the trust. The agent layer expands it.

---

## Open Items

| Item | Status | Notes |
|---|---|---|
| POSIX `--` in capman-studio REPL for user queries | ✅ Done (Step 9.1) | |
| capman MCP adapter | ⏳ capman team roadmap | Unblocks registry use case |
| `capman headless` spec | 📝 Needs design | Phase 3 Step 17 |
| Manifest registry domain + auth | 📝 Needs design | Phase 3 Step 18 |
| `ExecutionTrace` audit format spec | 📝 Needs design | Phase 3 Step 19 |
| Phase 2 web framework decision | 📝 Pending | After Phase 1 complete |

---

*This document is the single source of truth for capman-studio product direction. Updated at each major step milestone.*