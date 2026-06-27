'use strict'

const { realpathSync, readFileSync } = require('fs')
const path = require('path')

const { c, log, getFlag, hasFlag, parseTimeout, validateManifestPath } = require('../shared')
const { runSuiteCases, renderSummary, renderFailures } = require('../suite-runner')

/**
 * Suite mode — batch regression runner.
 *
 * Reads a JSON file of { query, expected, note? } test cases.
 * Runs each query via: capman explain <query> --json
 * Compares result against expected capability id.
 * Prints a pass/fail report and exits 1 on any failure.
 *
 * Called by: cmd-eval.js when --mode=suite
 *
 * The core case-execution loop lives in suite-runner.js and is shared with
 * watch.js and ci.js. This file handles only what is specific to the
 * standalone eval-suite command: flag parsing, path validation, file loading,
 * header printing, and process.exit() decisions.
 */
function runSuite() {
  const suitePath    = getFlag('--suite')
  const manifestFlag = getFlag('--manifest')
  const timeoutVal   = parseTimeout(getFlag('--timeout'))
  const jsonMode     = hasFlag('--json')

  // S-3: restrict --manifest to CWD — uses shared validateManifestPath which
  // applies realpathSync for symlink-awareness, matching the suite path guard.
  if (manifestFlag) validateManifestPath(manifestFlag)

  // ── Parse --threshold ──────────────────────────────────────────────────────
  // Optional. When set, suite exits 1 if pass rate falls below this value
  // even if no individual case failed. Range: 1–100 integers only.
  const thresholdRaw = getFlag('--threshold')
  let threshold = null

  if (thresholdRaw !== undefined) {
    const n = Number(thresholdRaw)
    if (!Number.isInteger(n) || n < 1 || n > 100) {
      log.error(`Invalid --threshold value: "${thresholdRaw}". Must be an integer between 1 and 100.`)
      log.hint('Example: --threshold=80')
      process.exit(1)
    }
    threshold = n
  }

  // ── Validate suite path ────────────────────────────────────────────────────
  if (!suitePath) {
    log.error('--suite <path> is required in suite mode.')
    log.hint('Example: capman-studio eval --mode=suite --suite cases.json')
    process.exit(1)
  }

  // ── Restrict suite path to CWD ─────────────────────────────────────────────
  // Three layers of protection:
  // 1. path.resolve() — normalises separators and collapses ../ traversal
  // 2. realpathSync() — resolves symlinks so a ./cases.json -> ../../etc/passwd
  //    symlink is caught rather than silently passing the startsWith check
  // 3. guard uses realCwd + sep — prevents /home/user/project-evil matching
  //    /home/user/project, and handles the CWD-is-root edge case correctly
  const resolvedPath = path.resolve(suitePath)

  let realSuitePath
  try {
    realSuitePath = realpathSync(resolvedPath)
  } catch {
    log.error(`Suite file not found: ${resolvedPath}`)
    process.exit(1)
  }

  const realCwd = realpathSync(process.cwd())
  const guard   = realCwd.endsWith(path.sep) ? realCwd : realCwd + path.sep

  if (!realSuitePath.startsWith(guard) && realSuitePath !== realCwd) {
    log.error('Suite path must be within the current directory.')
    log.hint(`Resolved to: ${realSuitePath}`)
    log.hint(`CWD is:      ${realCwd}`)
    process.exit(1)
  }

  // ── Load suite file ────────────────────────────────────────────────────────
  let suite
  try {
    const raw = readFileSync(realSuitePath, 'utf8')
    suite = JSON.parse(raw)
  } catch (e) {
    // Do not surface e.message directly — a failed JSON.parse includes partial
    // file content in the message, which could leak secrets from a misdirected path.
    const errMsg = e.code === 'ENOENT'
      ? `File not found: ${resolvedPath}`
      : `Could not read or parse suite file: ${suitePath}`
    log.error(errMsg)
    console.log()
    console.log(`  ${c.gray}Expected format:${c.reset}`)
    console.log(`  ${c.gray}[${c.reset}`)
    console.log(`  ${c.gray}  { "query": "Is the blue jacket in stock?", "expected": "check_product_availability" },${c.reset}`)
    console.log(`  ${c.gray}  { "query": "What is the weather?", "expected": null }${c.reset}`)
    console.log(`  ${c.gray}]${c.reset}`)
    console.log()
    process.exit(1)
  }

  if (!Array.isArray(suite) || suite.length === 0) {
    log.error('Suite file must be a non-empty JSON array.')
    console.log()
    process.exit(1)
  }

  // ── Print header ───────────────────────────────────────────────────────────
  if (!jsonMode) {
    console.log(
      `  ${c.bold}SUITE RUNNER${c.reset}` +
      `  ${c.gray}${suitePath}  ·  ${suite.length} case${suite.length !== 1 ? 's' : ''}${c.reset}`
    )
    console.log(`  ${c.gray}─────────────────────────────────────────${c.reset}`)
    console.log()
  }

  // ── Run cases ──────────────────────────────────────────────────────────────
  // Delegates to the shared suite-runner — single canonical implementation
  // used by eval-suite (here), watch.js, and ci.js.
  const { results, skippedCases, passed, failed, skipped, total, passRate } =
    runSuiteCases({ suite, manifestFlag, timeoutVal, jsonMode })

  // ── Threshold check ────────────────────────────────────────────────────────
  const thresholdMet  = threshold === null || passRate >= threshold
  const thresholdFail = threshold !== null && !thresholdMet

  if (jsonMode) {
    console.log(JSON.stringify({
      suite:        suitePath,
      total,
      passed,
      failed,
      skipped,
      passRate,
      threshold:    threshold ?? null,
      thresholdMet,
      cases:        results,
      skippedCases,
    }, null, 2))
    if (failed > 0 || thresholdFail) process.exit(1)
    return
  }

  renderSummary({ total, passed, failed, skipped, passRate, threshold, thresholdMet })
  renderFailures(results, skippedCases)

  if (failed > 0 || thresholdFail) process.exit(1)
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = { runSuite }
