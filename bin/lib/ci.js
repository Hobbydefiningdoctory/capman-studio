'use strict'

const { realpathSync } = require('fs')
const fs   = require('fs')
const path = require('path')

const {
  c, log, header,
  getFlag, hasFlag,
  runCapman,
  parseTimeout,
  stripAnsi, confidenceColor,
  validateManifestPath,
} = require('./shared')
const { runSuiteCases } = require('./suite-runner')

/**
 * ci.js — Opinionated CI pipeline command.
 *
 * Runs three stages in sequence:
 *   [1/3]  Validate manifest  — capman validate --manifest <path>
 *   [2/3]  Run suite          — inline suite runner (same as eval-suite)
 *   [3/3]  Check threshold    — pass rate vs required minimum
 *
 * Usage:
 *   capman-studio ci --suite cases.json
 *   capman-studio ci --suite cases.json --threshold=80
 *   capman-studio ci --suite cases.json --manifest other.json
 *   capman-studio ci --suite cases.json --threshold=80 --json
 *
 * Exit codes:
 *   0 — all stages passed
 *   1 — one or more stages failed, or an error occurred
 */

// ─── Entry Point ──────────────────────────────────────────────────────────────

function runCi() {
  header()

  // ── Parse flags ─────────────────────────────────────────────────────────────
  const suiteFlag     = getFlag('--suite')
  const manifestFlag  = getFlag('--manifest')
  const thresholdFlag = getFlag('--threshold')
  const timeoutVal    = parseTimeout(getFlag('--timeout'))
  const jsonMode      = hasFlag('--json')

  const manifestPath = manifestFlag ?? 'manifest.json'

  // ── --suite is required ────────────────────────────────────────────────────
  if (!suiteFlag) {
    log.error('--suite <path> is required for ci mode.')
    log.hint('Example: capman-studio ci --suite eval-suite.json')
    log.hint('Generate a suite first: capman-studio generate-suite')
    process.exit(1)
  }

  // ── Parse threshold ────────────────────────────────────────────────────────
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
  validateManifestPath(manifestPath)
  validateSuitePath(suiteFlag)

  // ── Print CI header ────────────────────────────────────────────────────────
  if (!jsonMode) {
    printCiHeader({ manifestPath, suiteFlag, threshold })
  }

  // ── Stage results tracking ─────────────────────────────────────────────────
  const stages = {
    validate:  null,  // true | false
    suite:     null,
    threshold: null,
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Stage 1 — Validate manifest
  // ─────────────────────────────────────────────────────────────────────────
  if (!jsonMode) {
    console.log(`  ${c.bold}[1/3]${c.reset}  ${c.gray}Validating manifest...${c.reset}`)
    console.log()
  }

  const validateArgs = ['--manifest', manifestPath]
  const validateResult = runCapman({ command: 'validate', args: validateArgs, json: false, raw: true })

  if (validateResult.ok) {
    stages.validate = true
    if (!jsonMode) {
      // Parse capability count from capman validate output
      const countMatch = validateResult.raw.match(/(\d+) capabilities/)
      const capCount   = countMatch ? countMatch[1] : '?'
      console.log(`  ${c.green}✓${c.reset}  ${c.gray}Manifest valid — ${capCount} capabilities${c.reset}`)
      console.log()
    }
  } else {
    stages.validate = false
    if (!jsonMode) {
      // Surface capman's own validation output — sanitised
      const safeOutput = stripAnsi(validateResult.raw || validateResult.error || '').trim()
      if (safeOutput) {
        safeOutput.split('\n').forEach(line => {
          console.log(`  ${c.gray}${line}${c.reset}`)
        })
      }
      console.log(`  ${c.red}✗${c.reset}  ${c.gray}Manifest validation failed${c.reset}`)
      console.log()
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Stage 2 — Run suite
  // ─────────────────────────────────────────────────────────────────────────
  if (!jsonMode) {
    console.log(`  ${c.bold}[2/3]${c.reset}  ${c.gray}Running suite...${c.reset}`)
    console.log()
  }

  const suiteResult = runSuiteStage({ suiteFlag, manifestFlag, timeoutVal, jsonMode })
  stages.suite = suiteResult.failed === 0

  // ─────────────────────────────────────────────────────────────────────────
  // Stage 3 — Check threshold
  // ─────────────────────────────────────────────────────────────────────────
  if (!jsonMode) {
    console.log(`  ${c.bold}[3/3]${c.reset}  ${c.gray}Checking threshold...${c.reset}`)
    console.log()
  }

  const { passRate } = suiteResult

  if (threshold === null) {
    stages.threshold = true
    if (!jsonMode) {
      console.log(`  ${c.gray}–  No threshold set — skipping${c.reset}`)
      console.log()
    }
  } else {
    const met = passRate >= threshold
    stages.threshold = met
    if (!jsonMode) {
      if (met) {
        console.log(`  ${c.green}✓${c.reset}  ${c.gray}threshold ${threshold}% met (got ${passRate}%)${c.reset}`)
      } else {
        console.log(`  ${c.red}✗${c.reset}  ${c.gray}threshold ${threshold}% not met (got ${passRate}%)${c.reset}`)
      }
      console.log()
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Summary + exit
  // ─────────────────────────────────────────────────────────────────────────
  const allPassed = stages.validate && stages.suite && stages.threshold

  if (jsonMode) {
    console.log(JSON.stringify({
      passed:    allPassed,
      stages,
      passRate,
      threshold: threshold ?? null,
      suite:     suiteFlag,
      manifest:  manifestPath,
      cases:     suiteResult.cases,
    }, null, 2))
  } else {
    printCiSummary({ stages, allPassed })
  }

  process.exit(allPassed ? 0 : 1)
}

// ─── Suite Runner ─────────────────────────────────────────────────────────────

/**
 * Run the suite for the CI pipeline.
 * Delegates to the shared suite-runner — the single canonical loop used by
 * eval-suite, watch, and ci. Returns { passed, failed, total, passRate, cases }
 * for use by Stage 3 (threshold check) and the final JSON output.
 */
function runSuiteStage({ suiteFlag, manifestFlag, timeoutVal, jsonMode }) {
  let suite
  try {
    const raw = fs.readFileSync(path.resolve(suiteFlag), 'utf8')
    suite = JSON.parse(raw)
  } catch {
    log.error(`Cannot load suite file: ${suiteFlag}`)
    process.exit(1)
  }

  if (!Array.isArray(suite) || suite.length === 0) {
    log.error('Suite file must be a non-empty JSON array.')
    process.exit(1)
  }

  const { results, passed, failed, skipped, total, passRate } =
    runSuiteCases({ suite, manifestFlag, timeoutVal, jsonMode })

  if (!jsonMode) {
    const rateColor = passRate >= 80 ? c.green : passRate >= 60 ? c.yellow : c.red
    console.log(
      `  ${c.gray}Suite: ${c.reset}${c.green}${passed} passed${c.reset}` +
      `  ${failed > 0 ? c.red : c.gray}${failed} failed${c.reset}` +
      `  ${skipped > 0 ? `${c.gray}${skipped} skipped  ${c.reset}` : ''}` +
      `  ${c.gray}${total} total${c.reset}` +
      `  ${rateColor}${passRate}%${c.reset}`
    )
    console.log()
  }

  return { passed, failed, total, passRate, cases: results }
}

function printCiHeader({ manifestPath, suiteFlag, threshold }) {
  const thresholdNote = threshold !== null
    ? `  ${c.gray}threshold: ${threshold}%${c.reset}`
    : ''

  console.log(
    `  ${c.bold}CI${c.reset}` +
    `  ${c.gray}${manifestPath}${c.reset}` +
    `  ${c.gray}·${c.reset}` +
    `  ${c.gray}${path.basename(suiteFlag)}${c.reset}` +
    `${thresholdNote}`
  )
  console.log(`  ${c.gray}─────────────────────────────────────────${c.reset}`)
  console.log()
}

function printCiSummary({ stages, allPassed }) {
  const stageLabel = (passed, label) =>
    passed
      ? `${c.green}${label} ✓${c.reset}`
      : `${c.red}${label} ✗${c.reset}`

  console.log(`  ${c.gray}─────────────────────────────────────────${c.reset}`)
  console.log()

  if (allPassed) {
    console.log(
      `  ${c.green}${c.bold}CI PASSED${c.reset}` +
      `  ${stageLabel(stages.validate, 'validate')}` +
      `  ${stageLabel(stages.suite, 'suite')}` +
      `  ${stageLabel(stages.threshold, 'threshold')}`
    )
  } else {
    console.log(
      `  ${c.red}${c.bold}CI FAILED${c.reset}` +
      `  ${stageLabel(stages.validate, 'validate')}` +
      `  ${stageLabel(stages.suite, 'suite')}` +
      `  ${stageLabel(stages.threshold, 'threshold')}`
    )
  }

  console.log()
}

// ─── Path Validation ──────────────────────────────────────────────────────────

/**
 * Validate suite path — must exist and be within CWD.
 */
function validateSuitePath(rawPath) {
  const resolved = path.resolve(rawPath)

  let realPath
  try {
    realPath = realpathSync(resolved)
  } catch {
    log.error(`Suite file not found: ${resolved}`)
    log.hint('Generate one with: capman-studio generate-suite')
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

module.exports = { runCi }