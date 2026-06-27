'use strict'

const { realpathSync, watchFile, unwatchFile } = require('fs')
const path = require('path')

const { c, log, header, getFlag, hasFlag, validateManifestPath, parseTimeout } = require('./shared')
const { runSuiteCases, renderSummary } = require('./suite-runner')

/**
 * watch.js — Watch manifest.json for changes and re-run inspect or suite.
 *
 * Closes the inner dev loop:
 *   edit capman.config.js → capman generate → manifest changes → auto re-run
 *
 * Uses fs.watchFile (polling, 500ms interval) — no external dependencies.
 * Reliable across macOS, Linux (Replit), and Windows.
 *
 * Modes:
 *   capman-studio watch                        re-run inspect on change
 *   capman-studio watch --suite cases.json     re-run suite on change
 *   capman-studio watch --manifest other.json  watch a non-default manifest
 *   capman-studio watch --threshold=80         suite mode with quality gate
 *
 * Does NOT clear the terminal between runs — developers can scroll up
 * to compare before/after states.
 */

// ─── Constants ────────────────────────────────────────────────────────────────

const POLL_INTERVAL_MS = 500   // fs.watchFile polling interval
const DEBOUNCE_MS      = 300   // ignore rapid successive change events

// ─── Entry Point ──────────────────────────────────────────────────────────────

function runWatch() {
  header()

  // ── Parse flags ─────────────────────────────────────────────────────────────
  const manifestFlag  = getFlag('--manifest')
  const suiteFlag     = getFlag('--suite')
  const thresholdFlag = getFlag('--threshold')
  const timeoutVal    = parseTimeout(getFlag('--timeout'))
  const jsonMode      = hasFlag('--json')

  const manifestPath = manifestFlag ?? 'manifest.json'
  const suiteMode    = suiteFlag !== undefined

  // ── Validate --threshold ────────────────────────────────────────────────────
  // Validated once here, before the watcher starts — not re-parsed on every
  // change event. An invalid value (e.g. "abc") previously produced Number.NaN,
  // which made `passRate >= threshold` always false and silently reported
  // "not met" on every run regardless of actual pass rate, with no error shown.
  let threshold = null
  if (thresholdFlag !== undefined) {
    const n = Number(thresholdFlag)
    if (!Number.isInteger(n) || n < 1 || n > 100) {
      log.error(`Invalid --threshold value: "${thresholdFlag}". Must be an integer between 1 and 100.`)
      log.hint('Example: --threshold=80')
      process.exit(1)
    }
    threshold = n
  }

  // ── Validate paths ─────────────────────────────────────────────────────────
  // manifest path — validateManifestPath exits with clean error if not found/outside CWD
  const realManifestPath = validateManifestPath(manifestPath)

  // suite path — if provided, validate it within CWD too
  if (suiteFlag) validateSuitePath(suiteFlag)

  // ── Print watch header ─────────────────────────────────────────────────────
  printWatchHeader({ manifestPath, suiteFlag, threshold })

  // ── Initial run ────────────────────────────────────────────────────────────
  // Run immediately on start so developer sees the current state
  // without having to make a change first.
  runOnce({ manifestFlag, suiteFlag, threshold, timeoutVal, jsonMode, suiteMode })

  // ── Start watcher ──────────────────────────────────────────────────────────
  startWatcher({
    realManifestPath,
    manifestFlag,
    suiteFlag,
    threshold,
    timeoutVal,
    jsonMode,
    suiteMode,
  })
}

// ─── Watcher ──────────────────────────────────────────────────────────────────

function startWatcher({ realManifestPath, manifestFlag, suiteFlag, threshold, timeoutVal, jsonMode, suiteMode }) {
  let debounceTimer = null
  let running       = false
  let pendingRerun  = false   // queue instead of drop

  const triggerRun = () => {
    running = true
    printTimestamp()
    console.log(
      `  ${c.gray}${path.basename(realManifestPath)} changed` +
      ` — re-running ${suiteMode ? 'suite' : 'inspect'}...${c.reset}`
    )
    printDivider()

    runOnce({ manifestFlag, suiteFlag, threshold, timeoutVal, jsonMode, suiteMode })
    running = false

    // If a change arrived while this run was in progress, run once more
    // immediately rather than silently losing that change's effects.
    if (pendingRerun) {
      pendingRerun = false
      triggerRun()
    }
  }

  // ── fs.watchFile — polling, reliable cross-platform ───────────────────────
  watchFile(realManifestPath, { interval: POLL_INTERVAL_MS }, (curr, prev) => {
    // Only fire when the file was actually modified
    // mtime (modified time) changes on content write
    // ctime (change time) changes on metadata changes — we ignore those
    if (curr.mtime.getTime() === prev.mtime.getTime()) return

    // Debounce — some editors write in multiple passes
    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => {
      // Guard against concurrent runs — if a slow capman call is still
      // running when the next change fires, queue one follow-up run
      // rather than dropping this change's effects entirely.
      if (running) {
        pendingRerun = true
        printTimestamp()
        console.log(`  ${c.gray}Change detected — previous run still in progress, queued.${c.reset}`)
        console.log()
        return
      }

      triggerRun()
    }, DEBOUNCE_MS)
  })

  // ── Ctrl+C — clean exit ────────────────────────────────────────────────────
  process.on('SIGINT', () => {
    if (debounceTimer) clearTimeout(debounceTimer)
    unwatchFile(realManifestPath)
    console.log()
    console.log(`  ${c.gray}Watch stopped.${c.reset}`)
    console.log()
    process.exit(0)
  })
}

// ─── Run Once ─────────────────────────────────────────────────────────────────

/**
 * Execute one inspect or suite run.
 * Delegates to the existing eval sub-modules — no subprocess logic duplication.
 *
 * process.argv is temporarily patched so getFlag() and hasFlag() inside
 * eval-inspect / eval-suite read the correct flags for this run.
 * The original argv is restored immediately after.
 */
function runOnce({ manifestFlag, suiteFlag, threshold, timeoutVal, jsonMode, suiteMode }) {
  // Build a synthetic argv that the eval sub-modules will read via shared.js
  // shared.js reads process.argv.slice(2) at module load time — argv is already
  // frozen in the cached module. We work around this by passing flags directly
  // to the functions rather than patching argv.
  //
  // Both runInspect() and runSuite() read flags via getFlag()/hasFlag() from
  // the frozen shared.js argv — we cannot re-inject flags that way.
  //
  // Solution: call runCapman() directly with the correct args for each mode,
  // then render using the shared renderer functions. This is cleaner and avoids
  // patching global state.

  if (suiteMode) {
    runSuiteOnce({ manifestFlag, suiteFlag, threshold, timeoutVal, jsonMode })
  } else {
    runInspectOnce({ manifestFlag, jsonMode })
  }
}

// ─── Inspect Run ──────────────────────────────────────────────────────────────

function runInspectOnce({ manifestFlag, jsonMode }) {
  const { runCapman, stripAnsi, c, log, resolverColor, privacyColor } = require('./shared')

  const capmanArgs = ['--json']
  if (manifestFlag) capmanArgs.push('--manifest', manifestFlag)

  const result = runCapman({ command: 'eval', args: capmanArgs })

  if (!result.ok) {
    log.error(result.error)
    console.log()
    return
  }

  if (jsonMode) {
    console.log(JSON.stringify(result.data, null, 2))
    return
  }

  // Delegate to eval-inspect renderer
  const { renderInspectData } = require('./eval/eval-inspect')
  renderInspectData(result.data)
}

// ─── Suite Run ────────────────────────────────────────────────────────────────

function runSuiteOnce({ manifestFlag, suiteFlag, threshold, timeoutVal, jsonMode }) {
  const fs = require('fs')

  // Re-validate the suite path on every call, not just once at watch startup.
  // watch is a long-lived process — a symlink swap after start would not be
  // caught by the one-time validation in runWatch(). Cheap: runs once per
  // manifest-change event, not once per test case.
  validateSuitePath(suiteFlag)

  // ── Load suite file ────────────────────────────────────────────────────────
  let suite
  try {
    const raw = fs.readFileSync(path.resolve(suiteFlag), 'utf8')
    suite = JSON.parse(raw)
  } catch {
    log.error(`Cannot load suite file: ${suiteFlag}`)
    console.log()
    return
  }

  if (!Array.isArray(suite) || suite.length === 0) {
    log.error('Suite file must be a non-empty JSON array.')
    console.log()
    return
  }

  // ── Run cases — shared canonical loop ─────────────────────────────────────
  const { passed, failed, skipped, total, passRate } =
    runSuiteCases({ suite, manifestFlag, timeoutVal, jsonMode })

  const thresholdMet = threshold === null || passRate >= threshold

  if (jsonMode) {
    console.log(JSON.stringify({ total, passed, failed, skipped, passRate, threshold, thresholdMet }))
    return
  }

  renderSummary({ total, passed, failed, skipped, passRate, threshold, thresholdMet })
}

// ─── UI ───────────────────────────────────────────────────────────────────────

function printWatchHeader({ manifestPath, suiteFlag, threshold }) {
  const mode = suiteFlag ? `suite (${path.basename(suiteFlag)})` : 'inspect'
  const thresholdNote = threshold !== null ? `  ${c.gray}threshold: ${threshold}%${c.reset}` : ''

  console.log(
    `  ${c.bold}WATCH${c.reset}` +
    `  ${c.gray}${manifestPath}${c.reset}` +
    `  ${c.gray}mode: ${mode}${c.reset}` +
    thresholdNote
  )
  printDivider()
  console.log(`  ${c.gray}Watching for changes. Ctrl+C to stop.${c.reset}`)
  console.log()
  printDivider()
}

function printTimestamp() {
  const now = new Date()
  const hh  = String(now.getHours()).padStart(2, '0')
  const mm  = String(now.getMinutes()).padStart(2, '0')
  const ss  = String(now.getSeconds()).padStart(2, '0')
  console.log(`  ${c.gray}[${hh}:${mm}:${ss}]${c.reset}`)
}

function printDivider() {
  console.log(`  ${c.gray}─────────────────────────────────────────${c.reset}`)
}

// ─── Path Validation ──────────────────────────────────────────────────────────

/**
 * Validate a suite file path — must be within CWD.
 * File must exist (we need to read it).
 */
function validateSuitePath(rawPath) {
  const resolved = path.resolve(rawPath)

  let realPath
  try {
    realPath = realpathSync(resolved)
  } catch {
    log.error(`Suite file not found: ${resolved}`)
    log.hint(`Create one with: capman-studio generate-suite`)
    process.exit(1)
  }

  const realCwd = realpathSync(process.cwd())
  const guard   = realCwd.endsWith(path.sep) ? realCwd : realCwd + path.sep

  if (!realPath.startsWith(guard) && realPath !== realCwd) {
    log.error('Suite path must be within the current directory.')
    log.hint(`Resolved to: ${realPath}`)
    log.hint(`CWD is:      ${realCwd}`)
    process.exit(1)
  }
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = { runWatch }
