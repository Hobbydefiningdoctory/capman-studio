# capman-studio — Command Reference

Complete usage documentation for capman-studio.  
Read this file first. You should not need to read source code to use this tool.

**Version:** 0.1.0  
**capman contract validated against:** 0.6.2

---

## Table of Contents

1. [Quick Start](#1-quick-start)
2. [How It Works](#2-how-it-works)
3. [Global Flags](#3-global-flags)
4. [Command: eval](#4-command-eval)
   - [Mode: inspect](#41-mode-inspect-default)
   - [Mode: repl](#42-mode-repl)
   - [Mode: suite](#43-mode-suite)
5. [Command: diff](#5-command-diff)
6. [Command: generate-suite](#6-command-generate-suite)
7. [Command: watch](#7-command-watch)
8. [Command: ci](#8-command-ci)
9. [Suite File Format](#9-suite-file-format)
10. [REPL Commands](#10-repl-commands)
11. [JSON Output](#11-json-output)
12. [Error Reference](#12-error-reference)
13. [Flags Reference](#13-flags-reference)

---

## 1. Quick Start

```bash
# Prerequisite — capman must be installed globally
pnpm add -g capman

# Install capman-studio
git clone [(https://github.com/Hobbydefiningdoctory/capman-studio.git)](https://github.com/Hobbydefiningdoctory/capman-studio.git)

cd capman-studio
pnpm install

# Inspect your manifest
node bin/studio.js eval

# Interactive query testing
node bin/studio.js eval --mode=repl

# Run a regression suite
node bin/studio.js eval --mode=suite --suite cases.json
```

Once installed globally via `pnpm link` or `pnpm add -g`:

```bash
capman-studio eval
capman-studio eval --mode=repl
capman-studio eval --mode=suite --suite cases.json
```

---

## 2. How It Works

capman-studio is an **external tool**. It never imports capman as a library.  
Every operation works by running a capman CLI command as a subprocess and reading its JSON output.

```
capman-studio eval
    └── runs: capman eval --json
    └── parses: stdout as JSON
    └── renders: formatted terminal output

capman-studio eval --mode=repl
    └── for each query runs: capman explain <query> --json
    └── parses: stdout as JSON
    └── renders: match result, trace, top candidates

capman-studio eval --mode=suite
    └── for each case runs: capman explain <query> --json
    └── compares: result against expected capability id
    └── reports: pass / fail / skipped summary
```

capman must be on `PATH`. The command name is configurable in `package.json`:

```json
"capman": {
  "command": "capman"
}
```

Change `"command"` if your capman binary has a different name or path.  
Only plain command names and safe paths are accepted — no spaces or shell characters.

---

## 3. Global Flags

These flags work across all commands and modes.

| Flag | Short | Description |
|---|---|---|
| `--help` | `-h` | Print command reference and exit |
| `--version` | `-v` | Print version number and exit |

```bash
capman-studio --help
capman-studio --version   # prints: 0.1.0
```

---

## 4. Command: `eval`

The manifest workbench. Three modes — inspect, repl, and suite.

```bash
capman-studio eval [--mode=<mode>] [options]
```

Default mode when `--mode` is omitted: **inspect**.

---

### 4.1 Mode: `inspect` (default)

Calls `capman eval --json` and renders a formatted manifest health summary.

```bash
capman-studio eval
capman-studio eval --mode=inspect
capman-studio eval --mode=inspect --manifest path/to/manifest.json
capman-studio eval --mode=inspect --json
```

**What it shows:**

```
  my-app  v1.0.0 · generated Apr 26, 2026, 10:30 AM
  ─────────────────────────────────────────

  12 capabilities  ·  8 api / 3 nav / 1 hybrid  ·  10 public / 2 user_owned

  COVERAGE  2 issue(s)

  ⚠  search_products   no examples — keyword matching may be weak
  ⚠  admin_reset       api resolver with no params defined

  ✓  Manifest valid

  CAPABILITIES

  check_product_availability  api     public      2 ex  2 params
                              Check if a product is in stock
  ...
```

**Coverage warnings:**

| Warning | Meaning |
|---|---|
| `no examples — keyword matching may be weak` | Capability has no example queries. The keyword matcher has less signal to work with. Add examples in `capman.config.js`. |
| `api resolver with no params defined` | An `api` type resolver has no `params` defined. This may be intentional but is worth reviewing. |

**Resolver colours:**

| Colour | Resolver type |
|---|---|
| Teal | `api` |
| Green | `nav` |
| Yellow | `hybrid` |
| Gray | unknown |

**Privacy colours:**

| Colour | Privacy level |
|---|---|
| Green | `public` |
| Yellow | `user_owned` |
| Red | `admin` |
| Gray | unknown |

---

### 4.2 Mode: `repl`

Interactive query loop. Each query runs `capman explain <query> --json` and renders the trace.

```bash
capman-studio eval --mode=repl
capman-studio eval --mode=repl --manifest path/to/manifest.json
capman-studio eval --mode=repl --timeout=10000
```

**What a query result looks like:**

```
  ▶  pause the timer

  →  pause_timer  87%  retrieval
  Boost: +3  ·  Latency: 12ms  · keyword

  Top matches:
  ✓  pause_timer              87%
  ○  start_timer              72%
  ○  cancel_timer             38%

  →  POST /api/timer/pause  [user_owned]
```

**Result line explained:**

| Part | Meaning |
|---|---|
| `→` / `○` | Match found / no match (OUT_OF_SCOPE) |
| `pause_timer` | Matched capability id |
| `87%` | Confidence score — green ≥70%, yellow ≥40%, red <40% |
| `retrieval` | Intent classification |
| `Boost: +3` | Score boost applied by the learning index |
| `Latency: 12ms` | Time capman took to resolve the query |
| `keyword` / `llm` / `cache` | How the match was resolved |

**Would-execute line:**

| Output | Meaning |
|---|---|
| `→  POST /api/...  [public]` | Action that would run, with privacy level |
| `✗  Blocked — <reason>` | Capability matched but blocked from executing |

**Query limits:**

- Maximum query length: **512 characters**. Longer input is rejected with a warning and the REPL returns to prompt.
- The REPL session never terminates on bad input — always returns to the `▶` prompt.

---

### 4.3 Mode: `suite`

Batch regression runner. Reads a JSON suite file, runs every case, reports pass/fail.

```bash
capman-studio eval --mode=suite --suite cases.json
capman-studio eval --mode=suite --suite cases.json --json
capman-studio eval --mode=suite --suite cases.json --manifest other.json
capman-studio eval --mode=suite --suite cases.json --threshold=80
```

**`--suite` is required in suite mode.** The path must be within the current working directory — absolute paths and `../` traversal are rejected.

**What the output looks like:**

```
  SUITE RUNNER  cases.json  ·  8 cases
  ─────────────────────────────────────────

  ✓  "Is the blue jacket in stock?"
     check_product_availability  87%  12ms

  ✗  "Track my order"
     OUT_OF_SCOPE  0%  8ms  expected: get_order_status

  ─────────────────────────────────────────

  Results  6 passed  2 failed  8 total  75% pass rate

  FAILURES

  ✗  "Track my order"
     got OUT_OF_SCOPE, expected get_order_status
```

**Pass rate colour:**

| Colour | Pass rate |
|---|---|
| Green | ≥ 80% |
| Yellow | ≥ 60% |
| Red | < 60% |

**`--threshold` flag:**

Set a minimum pass rate. If the final pass rate falls below this value the suite exits 1, even if no individual case explicitly failed. Accepts integers 1–100.

```bash
# Fail CI if matching quality drops below 80%
capman-studio eval --mode=suite --suite cases.json --threshold=80
```

Threshold result appears inline in the Results line:

```
# Met
Results  8 passed  0 failed  8 total  100% pass rate  ✓ threshold 80% met

# Not met
Results  6 passed  2 failed  8 total  75% pass rate  ✗ threshold 80% not met (got 75%)
```

**Exit codes:**

| Code | Meaning |
|---|---|
| `0` | All cases passed and threshold met (if set) |
| `1` | One or more cases failed, or pass rate below threshold |

**CI example — GitHub Actions:**

```yaml
- name: capman-studio suite
  run: capman-studio eval --mode=suite --suite cases.json --threshold=80 --json
```

Exit code 1 on threshold miss will fail the step automatically. Use `--json` to capture the result as an artefact.

---

## 5. Command: `diff`

Compare two manifest versions and see exactly what changed — capabilities added, removed, modified, or renamed.

```bash
capman-studio diff <old-manifest> <new-manifest>
capman-studio diff <old-manifest> <new-manifest> --verbose
capman-studio diff <old-manifest> <new-manifest> --unchanged
capman-studio diff <old-manifest> <new-manifest> --json
```

Both paths must be within the current working directory — absolute paths and `../` traversal are rejected.

**What the output looks like:**

```
  DIFF  my-app v1.0.0  →  my-app v1.1.0
  ─────────────────────────────────────────

  +  track_shipment  added      Track Shipment
  ~  get_order       modified   Get Order
                     fields: params
  ↻  nav_to_basket   renamed    Nav Basket  (nav_cart → nav_to_basket)
  -  cancel_sub      removed    Cancel Sub

  ─────────────────────────────────────────

  4 changes  +1 added  -1 removed  ~1 modified  ↻1 renamed  =1 unchanged
```

**Change type symbols:**

| Symbol | Type | Colour | Meaning |
|---|---|---|---|
| `+` | added | Green | Capability exists in new manifest, not in old |
| `-` | removed | Red | Capability exists in old manifest, not in new |
| `~` | modified | Yellow | Same id, one or more fields changed |
| `↻` | renamed | Blue | Old id gone, new id added — description and resolver match |
| `=` | unchanged | Gray | Identical in both (shown with `--unchanged` only) |

**Fields compared for `modified`:**

| Field | Notes | Added |
|---|---|---|
| `name` | Exact match | v0.4+ |
| `description` | Exact match | v0.4+ |
| `resolver.type` | `api`, `nav`, `hybrid` | v0.4+ |
| `privacy.level` | `public`, `user_owned`, `admin` | v0.4+ |
| `examples` | Order-insensitive — reordering does not trigger a diff | v0.4+ |
| `params` | Names only, order-insensitive | v0.4+ |
| `returns` | Order-insensitive. Absent in pre-v0.6 manifests — treated as empty, no false diff when both sides are absent | v0.6+ |
| `lifecycle.status` | `stable`, `beta`, `experimental`, `deprecated`. Absent treated as `null` — a capability going from absent to `deprecated` is surfaced explicitly | v0.6+ |

**Rename detection:**

A capability is classified as renamed when its old id disappears from the new manifest and a new id appears with an identical `description` and `resolver.type`. This is a conservative heuristic — if descriptions differ, the change is classified as removed + added, not renamed.

**`--verbose` flag:**

Shows the old and new values for every modified field.

```
  ~  get_order  modified  Get Order
                params
                  - orderId
                  + orderId, includeHistory
```

**`--unchanged` flag:**

Include unchanged capabilities in the output. Useful for auditing the full manifest state alongside changes.

**Exit codes:**

| Code | Meaning |
|---|---|
| `0` | Manifests are identical — no changes |
| `1` | Manifests differ, or an error occurred |

**CI usage — detect unexpected manifest changes:**

```yaml
- name: Detect manifest changes
  run: capman-studio diff manifest-baseline.json manifest.json
  # Exits 1 if anything changed — fails the step
```

```bash
# Change-aware CI: fail only if capabilities were removed or modified
capman-studio diff baseline.json manifest.json --json | \
  node -e "const r=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); process.exit(r.removed+r.modified > 0 ? 1 : 0)"
```

**JSON output shape:**

```bash
capman-studio diff old.json new.json --json
```

```json
{
  "oldMeta": { "app": "my-app", "version": "1.0.0", "generatedAt": "...", "capabilityCount": 4, "schemaVersion": "" },
  "newMeta": { "app": "my-app", "version": "1.1.0", "generatedAt": "...", "capabilityCount": 4, "schemaVersion": "1" },
  "capabilities": [
    {
      "type": "added",
      "id": "track_shipment",
      "name": "Track Shipment",
      "changes": []
    },
    {
      "type": "modified",
      "id": "get_order",
      "name": "Get Order",
      "changes": [
        { "field": "params", "oldValue": ["orderId"], "newValue": ["orderId", "includeHistory"] }
      ]
    },
    {
      "type": "renamed",
      "id": "nav_to_basket",
      "oldId": "nav_cart",
      "name": "Nav Basket",
      "changes": []
    },
    {
      "type": "removed",
      "id": "cancel_sub",
      "name": "Cancel Sub",
      "changes": []
    }
  ],
  "added": 1,
  "removed": 1,
  "modified": 1,
  "renamed": 1,
  "unchanged": 1,
  "hasChanges": true
}
```

---

## 6. Command: `generate-suite`

Scaffold a starter eval suite file from your manifest. Generates one test case per capability, ready to edit and run.

```bash
capman-studio generate-suite
capman-studio generate-suite --out my-suite.json
capman-studio generate-suite --manifest other.json
capman-studio generate-suite --overwrite
capman-studio generate-suite --json
```

The manifest path must be within the current working directory. Output path defaults to `eval-suite.json` in the current directory.

**What the output looks like:**

```
  capman-studio  v0.1.0
  ─────────────────────────────────────────

  ✓  Generated eval-suite.json

  4 capability cases  +  1 out-of-scope sentinel

  ⚠  2 cases generated without examples — review queries before running the suite

  Next steps:
  1. Review and edit queries in eval-suite.json
  2. Run: capman-studio eval --mode=suite --suite eval-suite.json
```

**Query selection — how queries are chosen per capability:**

| Priority | Condition | Query used | Note |
|---|---|---|---|
| 1 | Has `examples` | First example string | Best signal — used as-is |
| 2 | No examples, has `description` | Description (trimmed to 120 chars) | Good fallback — review before use |
| 3 | Neither | Capability `name` | Last resort — always edit before use |

**Generated suite format:**

```json
[
  {
    "query": "is the blue jacket available?",
    "expected": "check_product_availability",
    "note": "auto-generated from examples"
  },
  {
    "query": "Retrieve order status by order ID",
    "expected": "get_order",
    "note": "no examples — query generated from description, edit before use"
  },
  {
    "query": "what is the weather like today in tokyo",
    "expected": null,
    "note": "out-of-scope sentinel — this query should NOT match any capability. Edit if it conflicts with your app domain."
  }
]
```

Every generated suite includes one `expected: null` out-of-scope sentinel as the last case. It ensures OUT_OF_SCOPE matching is tested from day one and teaches the suite file format.

**Deprecated capabilities (v0.6+):**

If a capability has `lifecycle.status: "deprecated"`, its case note is flagged:

```json
{
  "query": "use old feature",
  "expected": "old_feature",
  "note": "auto-generated from examples [DEPRECATED → new_feature]"
}
```

The case is still generated — decide whether to keep testing it.

**`--overwrite` flag:**

Without `--overwrite`, the command exits with an error if the output file already exists. This prevents silently overwriting a suite file you have been editing.

```bash
# First run — creates eval-suite.json
capman-studio generate-suite

# Later — add new capabilities and regenerate
capman-studio generate-suite --overwrite
```

**`--json` flag:**

Prints the generated suite to stdout instead of writing to a file. Useful for piping or inspection.

```bash
capman-studio generate-suite --json
capman-studio generate-suite --json | jq '.[0]'
```

**Recommended workflow:**

```bash
# 1. Generate starter suite
capman-studio generate-suite

# 2. Inspect manifest health
capman-studio eval

# 3. Edit eval-suite.json — review and improve auto-generated queries

# 4. Run the suite
capman-studio eval --mode=suite --suite eval-suite.json

# 5. Set a quality gate in CI
capman-studio eval --mode=suite --suite eval-suite.json --threshold=80
```

---

## 7. Command: `watch`

Watch `manifest.json` for changes and automatically re-run inspect or suite on every save. Closes the inner dev loop — edit `capman.config.js`, run `capman generate`, and the studio updates immediately.

```bash
capman-studio watch
capman-studio watch --manifest other.json
capman-studio watch --suite cases.json
capman-studio watch --suite cases.json --threshold=80
```

The manifest path must be within the current working directory.

**What the output looks like:**

```
  capman-studio  v0.1.0
  ─────────────────────────────────────────

  WATCH  manifest.json  mode: inspect
  ─────────────────────────────────────────
  Watching for changes. Ctrl+C to stop.
  ─────────────────────────────────────────

  [10:32:14]  manifest.json changed — re-running inspect...
  ─────────────────────────────────────────

  my-app  v1.1.0 · generated 2026-05-01 10:32:13
  ...

  [10:33:02]  manifest.json changed — re-running inspect...
  ─────────────────────────────────────────
  ...
```

An initial run fires immediately on start — you see the current state before making any changes.

**How it watches:**

Uses Node.js `fs.watchFile` with a 500ms polling interval. No external dependencies. Reliable on macOS, Linux (including Replit), and Windows.

A 300ms debounce prevents double-fires when editors write files in multiple passes (e.g. VS Code, Vim swap files). If a re-run is already in progress when the next change fires, the queued run is skipped with a message.

The terminal is **not cleared between runs** — scroll up to compare before/after states.

**Modes:**

| Mode | Command | What re-runs |
|---|---|---|
| Inspect (default) | `capman-studio watch` | Manifest health summary |
| Suite | `capman-studio watch --suite cases.json` | Full suite pass/fail report |
| Suite + threshold | `capman-studio watch --suite cases.json --threshold=80` | Suite with quality gate |

**`--suite` flag:**

When `--suite` is set, every change re-runs the suite against the updated manifest. Results are shown inline — pass/fail per case plus a summary line.

```
  [10:32:14]  manifest.json changed — re-running suite...
  ─────────────────────────────────────────

  ✓  "is the blue jacket available?"
     check_product_availability  94%

  ✗  "track order 1234"
     OUT_OF_SCOPE  0%  expected: get_order_status

  ─────────────────────────────────────────

  Results  7 passed  1 failed  8 total  87% pass rate
```

**`--threshold` flag:**

When `--threshold` is set alongside `--suite`, each re-run shows whether the quality gate is met:

```
  Results  8 passed  0 failed  8 total  100% pass rate  ✓ threshold 80% met
```

```
  Results  6 passed  2 failed  8 total  75% pass rate  ✗ threshold 80% not met (got 75%)
```

**Stopping:**

Press `Ctrl+C`. The watcher cleans up and exits cleanly:

```
  Watch stopped.
```

**Recommended workflow:**

```bash
# Terminal 1 — run capman generate on config changes
nodemon --watch capman.config.js --exec "capman generate"

# Terminal 2 — watch the manifest
capman-studio watch --suite eval-suite.json --threshold=80
```

Every time you edit `capman.config.js`, `capman generate` regenerates the manifest, and capman-studio immediately shows the updated health summary and suite results.

---

## 8. Command: `ci`

Opinionated CI pipeline command. Runs three stages in sequence — validate, suite, threshold — and exits 1 if any stage fails. One line in a GitHub Actions YAML.

```bash
capman-studio ci --suite cases.json
capman-studio ci --suite cases.json --threshold=80
capman-studio ci --suite cases.json --manifest other.json
capman-studio ci --suite cases.json --threshold=80 --json
```

`--suite` is required. Without a suite there is no quality signal — use `capman validate` directly if you only want manifest validation.

**What the output looks like:**

```
  capman-studio  v0.1.0
  ─────────────────────────────────────────

  CI  manifest.json  ·  cases.json  threshold: 80%
  ─────────────────────────────────────────

  [1/3]  Validating manifest...

  ✓  Manifest valid — 12 capabilities

  [2/3]  Running suite...

  ✓  "is the blue jacket available?"
     check_product_availability  94%

  ✗  "track order 1234"
     OUT_OF_SCOPE  0%  expected: get_order_status

  Suite: 7 passed  1 failed  8 total  87%

  [3/3]  Checking threshold...

  ✗  threshold 80% not met (got 87%)

  ─────────────────────────────────────────
  CI FAILED  validate ✓  suite ✗  threshold ✗
```

**Three stages:**

| Stage | What runs | Passes when |
|---|---|---|
| `[1/3] validate` | `capman validate --manifest <path>` | Manifest is schema-valid |
| `[2/3] suite` | Runs every case in the suite file | Zero cases fail |
| `[3/3] threshold` | Compares pass rate to `--threshold` | Pass rate ≥ threshold (or no threshold set) |

All three stages always run — you see the full picture in one pass, not just the first failure.

**Exit codes:**

| Code | Meaning |
|---|---|
| `0` | All stages passed |
| `1` | One or more stages failed, or an error occurred |

**`--threshold` flag:**

Optional. When set, the CI run fails if the suite pass rate falls below this value even if no individual case failed.

```bash
# Fail if matching quality drops below 80%
capman-studio ci --suite cases.json --threshold=80
```

Without `--threshold`, stage 3 always passes and shows "skipping".

**`--json` flag:**

Outputs a structured JSON report — useful for GitHub Actions artefacts or downstream tooling.

```json
{
  "passed": false,
  "stages": {
    "validate": true,
    "suite": false,
    "threshold": false
  },
  "passRate": 75,
  "threshold": 80,
  "suite": "cases.json",
  "manifest": "manifest.json",
  "cases": [
    {
      "query": "is the blue jacket available?",
      "expected": "check_product_availability",
      "got": "check_product_availability",
      "pass": true,
      "confidence": 94,
      "error": null
    }
  ]
}
```

**GitHub Actions — full example:**

```yaml
name: capman-studio CI

on: [push, pull_request]

jobs:
  capman:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Install capman globally
        run: pnpm add -g capman

      - name: Generate manifest
        run: capman generate

      - name: Run capman-studio CI
        run: capman-studio ci --suite eval-suite.json --threshold=80 --json
```

The step exits 1 if validation fails, any suite case fails, or pass rate is below threshold — failing the GitHub Actions job automatically.

**Recommended workflow:**

```bash
# 1. Generate your manifest
capman generate

# 2. Scaffold a starter suite
capman-studio generate-suite

# 3. Edit eval-suite.json — review auto-generated queries

# 4. Run CI locally before pushing
capman-studio ci --suite eval-suite.json --threshold=80

# 5. Add to CI pipeline
#    capman-studio ci --suite eval-suite.json --threshold=80 --json
```

---

## 9. Suite File Format

A suite file is a JSON array of test case objects.

```json
[
  {
    "query": "Is the blue jacket in stock?",
    "expected": "check_product_availability",
    "note": "core product lookup"
  },
  {
    "query": "Track order 1234",
    "expected": "get_order_status"
  },
  {
    "query": "What is the weather today?",
    "expected": null,
    "note": "should be OUT_OF_SCOPE"
  }
]
```

**Fields:**

| Field | Type | Required | Description |
|---|---|---|---|
| `query` | string | Yes | The query to run against capman |
| `expected` | string \| null | Yes | Expected capability id. Use `null` to assert OUT_OF_SCOPE |
| `note` | string | No | Human-readable annotation — printed in output, ignored in pass/fail logic |

**Pass logic:**

| `expected` | Passes when |
|---|---|
| `"capability_id"` | capman returns that exact capability id |
| `null` | capman returns OUT_OF_SCOPE (no match) |

**Edge cases:**

| Situation | Behaviour |
|---|---|
| `expected` field missing entirely | Treated as `null` with a warning — use explicit `null` instead |
| `query` empty or missing | Case is skipped — counted in pass rate denominator |
| `query` longer than 512 chars | Case is skipped — counted in pass rate denominator |
| Subprocess error on a case | Case is marked failed — suite continues to next case |

**Skipped cases count against the pass rate.** A suite with 5 skipped cases and 4 of 5 remaining cases passing reports 40% — not 80%.

---

## 10. REPL Commands

Typed at the `▶` prompt. All start with `.`.

| Command | Description |
|---|---|
| `.inspect` | Re-print the manifest health summary without leaving the REPL. Honours the `--manifest` flag from the original session. |
| `.clear` | Clear the terminal and reprint the REPL header |
| `.help` | Print this command list |
| `.exit` | Exit the REPL cleanly |
| `.quit` | Alias for `.exit` |
| `Ctrl+C` | Exit the REPL cleanly |

Any other input starting with `.` is treated as an unknown command — the REPL prints a warning and returns to prompt.

---

## 11. JSON Output

All modes support `--json` for machine-readable output. Use this for scripting, CI artefacts, or feeding a future web dashboard.

### Inspect JSON

```bash
capman-studio eval --json
```

```json
{
  "app": "my-app",
  "version": "1.0.0",
  "generatedAt": "2026-04-26T10:30:00.000Z",
  "capabilityCount": 12,
  "resolverBreakdown": { "api": 8, "nav": 3, "hybrid": 1 },
  "privacyBreakdown": { "public": 10, "user_owned": 2 },
  "validation": {
    "valid": true,
    "errors": [],
    "warnings": []
  },
  "coverage": {
    "noExamples": ["search_products"],
    "apiNoParams": ["admin_reset"]
  },
  "capabilities": [
    {
      "id": "check_product_availability",
      "name": "Check Product Availability",
      "description": "Check if a product is in stock",
      "resolver": "api",
      "privacy": "public",
      "exampleCount": 2,
      "paramCount": 2
    }
  ]
}
```

### Suite JSON

```bash
capman-studio eval --mode=suite --suite cases.json --json
```

```json
{
  "suite": "cases.json",
  "total": 8,
  "passed": 6,
  "failed": 2,
  "skipped": 0,
  "passRate": 75,
  "threshold": 80,
  "thresholdMet": false,
  "cases": [
    {
      "query": "Is the blue jacket in stock?",
      "expected": "check_product_availability",
      "got": "check_product_availability",
      "pass": true,
      "confidence": 87,
      "durationMs": 12,
      "note": "core product lookup",
      "error": null
    }
  ]
}
```

`threshold` is `null` when `--threshold` was not passed. `thresholdMet` is `true` when no threshold was set.

---

## 12. Error Reference

| Error message | Cause | Fix |
|---|---|---|
| `capman is not installed or not on PATH` | capman binary not found | Run `pnpm add -g capman` |
| `Unsafe capman.command in package.json: "..."` | `capman.command` in `package.json` contains spaces or shell characters | Set `"command"` to a plain binary name or safe path |
| `capman did not respond within Xms` | subprocess timed out | Pass `--timeout=10000` or check if capman is hanging |
| `Invalid --timeout value: "..."` | `--timeout` is not a positive integer | Pass a number e.g. `--timeout=10000` |
| `--timeout capped at 60000ms` | `--timeout` exceeded the 60s maximum | Maximum is 60000ms — use a value within range |
| `--suite <path> is required in suite mode` | Suite mode called without `--suite` | Add `--suite cases.json` |
| `Suite path must be within the current directory` | `--suite` path resolves outside CWD | Move suite file into your project directory |
| `File not found: <path>` | Suite file does not exist at resolved path | Check the path is correct |
| `Could not read or parse suite file: <name>` | Suite file exists but is not valid JSON | Validate your JSON — check for trailing commas |
| `Unknown eval mode: "..."` | `--mode` value is not inspect/repl/suite | Use one of: `--mode=inspect`, `--mode=repl`, `--mode=suite` |
| `Query too long (N chars, max 512)` | REPL query exceeded 512 characters | Shorten the query |
| `Invalid --threshold value: "..."` | `--threshold` is not an integer between 1 and 100 | Pass an integer e.g. `--threshold=80` |
| `✗ threshold X% not met (got Y%)` | Pass rate fell below the required threshold | Review failures, improve manifest, or lower threshold |
| `Two manifest paths are required` | `diff` called without two path arguments | `capman-studio diff old.json new.json` |
| `<old/new> manifest not found: <path>` | Manifest file does not exist at resolved path | Check the path is correct |
| `<old/new> manifest path must be within the current directory` | Manifest path resolves outside CWD | Move manifest into your project directory |
| `<old/new> manifest is not valid JSON: <name>` | Manifest file exists but is not valid JSON | Run `capman validate --manifest <path>` to diagnose |
| `<old/new> manifest is missing a "capabilities" array` | File is valid JSON but not a capman manifest | Ensure the file was generated by `capman generate` |
| `Manifest file not found: <path>` | `generate-suite` manifest does not exist | Check path or run `capman generate` first |
| `Manifest path must be within the current directory` | `generate-suite --manifest` path resolves outside CWD | Move manifest into your project directory |
| `Manifest is not valid JSON: <name>` | Manifest exists but is not valid JSON | Run `capman validate --manifest <path>` to diagnose |
| `Manifest has no capabilities: <name>` | Manifest is valid but empty | Add capabilities in `capman.config.js` then run `capman generate` |
| `Output file already exists: <name>` | `generate-suite` output file exists and `--overwrite` not set | Pass `--overwrite` or choose a different path with `--out` |
| `Output directory does not exist: <path>` | Parent directory of `--out` path does not exist | Create the directory first |
| `Output path must be within the current directory` | `--out` path resolves outside CWD | Use a path within your project directory |
| `Suite file not found: <path>` | `watch --suite` file does not exist | Create one with `capman-studio generate-suite` |
| `Suite path must be within the current directory` | `watch --suite` path resolves outside CWD | Move suite file into your project directory |
| `--suite <path> is required for ci mode` | `ci` called without `--suite` | Add `--suite eval-suite.json` |
| `Cannot load suite file: <path>` | `ci --suite` file cannot be read or parsed | Check path is correct and file is valid JSON |

---

## 13. Flags Reference

Full list of all supported flags across all modes.

| Flag | Mode(s) | Description | Default |
|---|---|---|---|
| `--mode=<mode>` | `eval` | Select eval mode: `inspect`, `repl`, `suite` | `inspect` |
| `--manifest=<path>` | `eval` (all modes), `generate-suite`, `watch`, `ci` | Path to manifest JSON file. Must be within CWD. | `manifest.json` |
| `--suite=<path>` | `eval --mode=suite`, `watch`, `ci` | Path to suite JSON file. Must be within CWD. Required for `ci`. | — |
| `--out=<path>` | `generate-suite` | Output path for generated suite file. Must be within CWD. | `eval-suite.json` |
| `--timeout=<ms>` | `eval --mode=repl`, `eval --mode=suite`, `ci` | Subprocess timeout in milliseconds. Max 60000. | `5000` |
| `--threshold=<1-100>` | `eval --mode=suite`, `watch`, `ci` | Fail if pass rate drops below this integer value | off |
| `--overwrite` | `generate-suite` | Replace existing output file without error | off |
| `--verbose` | `diff` | Show per-field old/new values for modified capabilities | off |
| `--unchanged` | `diff` | Include unchanged capabilities in output | off |
| `--json` | `eval` (all modes), `diff`, `generate-suite`, `ci` | Output machine-readable JSON instead of formatted text | off |
| `--help` / `-h` | any | Print help and exit | — |
| `--version` / `-v` | any | Print version and exit | — |

---

*This document is maintained alongside the source. When a new flag, command, or behaviour is added, this file is updated in the same step.*