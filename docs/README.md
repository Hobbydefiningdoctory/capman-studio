# capman-studio

Developer tooling for [capman](https://www.npmjs.com/package/capman) — inspect manifests, test queries, diff versions, and run CI quality gates.

**capman** gives AI agents a structured map of what your app can do.  
**capman-studio** gives *developers* the feedback loop to build and maintain that map well.

> New to capman? Start with [QUICK-START.md](./QUICK-START.md) — no prior knowledge required.  
> Full command reference: [COMMANDS.md](./COMMANDS.md)

---

## Install

```bash
# 1. capman must be installed globally
pnpm add -g capman

# 2. Clone and install capman-studio
git clone [(https://github.com/Hobbydefiningdoctory/capman-studio.git)](https://github.com/Hobbydefiningdoctory/capman-studio.git)

cd capman-studio
pnpm install

# 3. Run
node bin/studio.js --help
```

---

## Commands

| Command | What it does |
|---|---|
| `eval` | Manifest workbench — inspect health, query REPL, batch suite runner |
| `diff` | Compare two manifest versions — show added, removed, modified, renamed |
| `generate-suite` | Scaffold a starter eval suite file from the manifest |
| `watch` | Watch manifest for changes, re-run inspect or suite automatically |
| `ci` | Validate + suite + threshold in one CI pipeline command |

### Quick reference

```bash
# Inspect manifest health
capman-studio eval

# Interactive query REPL
capman-studio eval --mode=repl

# Run a suite of test queries
capman-studio eval --mode=suite --suite eval-suite.json

# Compare two manifest versions
capman-studio diff manifest-old.json manifest-new.json

# Scaffold a starter suite
capman-studio generate-suite

# Watch for changes
capman-studio watch
capman-studio watch --suite eval-suite.json

# CI pipeline — validate + suite + threshold
capman-studio ci --suite eval-suite.json --threshold=80
```

---

## Architecture

capman-studio is an **independent external tool**. It never imports capman as a library.

```
capman-studio
    └── runs  → capman <command> [args]
    └── reads → stdout as JSON
    └── never → imports capman internals
```

This means capman's internals can change freely — capman-studio keeps working as long as the CLI interface is stable. See [ADR-001 in STRUCTURE.md](./STRUCTURE.md) for the full rationale.

**capman version contract last validated against:** 0.6.2

---

## Typical developer workflow

```bash
# 1. Write capabilities in capman.config.js
# 2. Generate manifest
capman generate

# 3. Inspect health
capman-studio eval

# 4. Generate a test suite
capman-studio generate-suite

# 5. Run the suite
capman-studio eval --mode=suite --suite eval-suite.json

# 6. Add to CI
capman-studio ci --suite eval-suite.json --threshold=80
```

---

## Phase plan

### Phase 1 — CLI ✅ Complete
All commands shipped: `eval`, `diff`, `generate-suite`, `watch`, `ci`.

### Phase 2 — Web Dashboard (planned)
A local web dashboard served from `capman-studio serve`. Same codebase — grows into it after Phase 1 is validated in real use.

### Phase 3 — capman-agent (strategic)
Turn capman from a developer tool into agent-native infrastructure:
- `capman headless` — serve the manifest over HTTP so any AI agent can use your app
- Manifest registry — publish and discover manifests (npm for capabilities)
- `capman audit` — governance and compliance layer over `ExecutionTrace`

See [ROADMAP.md](./ROADMAP.md) for the full plan.

---

## Docs

| File | What it covers |
|---|---|
| [QUICK-START.md](./QUICK-START.md) | Non-developer intro — what is this, how to try it |
| [COMMANDS.md](./COMMANDS.md) | Full command reference — every flag, every error, every example |
| [STRUCTURE.md](./STRUCTURE.md) | Living file tree — every file documented, ADRs, changelog |
| [ROADMAP.md](./ROADMAP.md) | Phase 1/2/3 plan, capman-agent vision |

---

## License

MIT