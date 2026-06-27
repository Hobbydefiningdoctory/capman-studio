'use strict'

const { c, log, runCapman, confidenceColor, stripAnsi } = require('./shared')

/**
 * suite-runner.js — Single canonical suite execution loop.
 *
 * runSuiteCases() is the one authoritative implementation of the capman eval
 * batch runner. It was previously duplicated (with diverging behaviour) across:
 *   - eval-suite.js   (full suite run — most complete)
 *   - watch.js        (missing query-length guard, missing durationMs)
 *   - ci.js           (missing note/expected sanitisation, wrong query arg order)
 *
 * Callers are responsible for:
 *   - File loading and path validation (each caller has different error-exit policy)
 *   - Header / summary rendering appropriate to their context
 *   - process.exit() decisions (eval/ci exit; watch returns)
 *
 * runCapman() API note:
 *   query must be passed as the `query:` field — runCapman places it AFTER the
 *   POSIX '--' sentinel so a query starting with '-' is never misread as a flag.
 *   Placing the query in `args` (before '--') is incorrect.
 */

const MAX_QUERY_LEN = 512

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Run a loaded suite array through capman explain and return structured results.
 * Renders each case to the terminal as it completes (unless jsonMode is true).
 *
 * @param {object}    opts
 * @param {object[]}  opts.suite          - parsed suite array from JSON
 * @param {string}    [opts.manifestFlag] - --manifest value, or undefined
 * @param {number}    opts.timeoutVal     - ms per capman call (from parseTimeout)
 * @param {boolean}   opts.jsonMode       - suppress terminal rendering
 *
 * @returns {{
 *   results:      object[],   - one entry per executed case (pass and fail)
 *   skippedCases: object[],   - { query, reason } for every skipped case
 *   passed:       number,
 *   failed:       number,
 *   skipped:      number,
 *   total:        number,     - results.length + skipped (honest denominator)
 *   passRate:     number,     - 0–100 integer
 * }}
 */
function runSuiteCases({ suite, manifestFlag, timeoutVal, jsonMode }) {
  const results      = []
  const skippedCases = []
  let passed  = 0
  let failed  = 0
  let skipped = 0

  for (const testCase of suite) {
    const { query } = testCase

    // ── Validate query shape ─────────────────────────────────────────────────
    if (typeof query !== 'string' || query.trim() === '') {
      if (!jsonMode) {
        log.warn(`Skipping invalid case — missing or empty query: ${JSON.stringify(testCase)}`)
        console.log()
      }
      skippedCases.push({ query: '(missing or empty)', reason: 'missing or empty query' })
      skipped++
      continue
    }

    // ── Query length guard ───────────────────────────────────────────────────
    // Prevents argument buffer abuse via crafted suite files.
    if (query.length > MAX_QUERY_LEN) {
      if (!jsonMode) {
        log.warn(`Skipping case — query exceeds ${MAX_QUERY_LEN} chars (${query.length}): "${truncate(query, 40)}"`)
        console.log()
      }
      skippedCases.push({ query: truncate(query, 52), reason: `query exceeds ${MAX_QUERY_LEN} chars (${query.length})` })
      skipped++
      continue
    }

    // ── Sanitise note — type-check, length-limit, ANSI-strip ────────────────
    // A crafted suite file could embed ANSI sequences or flood CI logs.
    const rawNote = testCase.note
    const note    = (typeof rawNote === 'string') ? stripAnsi(rawNote).slice(0, 256) : null

    // ── Type-assert expected — must be string or null ────────────────────────
    // A non-string expected produces [object Object] in output and causes
    // silent comparison failures against string capability IDs.
    const rawExpected = testCase.expected
    if ('expected' in testCase && rawExpected !== null && typeof rawExpected !== 'string') {
      if (!jsonMode) {
        log.warn(`Skipping case — "expected" must be a string or null: ${JSON.stringify(testCase)}`)
        console.log()
      }
      skippedCases.push({ query: truncate(query, 52), reason: '"expected" must be a string or null' })
      skipped++
      continue
    }

    // ── Warn on missing expected field ───────────────────────────────────────
    // An undefined expected would silently fail every case — explicit null is
    // the correct way to assert OUT_OF_SCOPE in a suite file.
    if (!('expected' in testCase)) {
      if (!jsonMode) {
        log.warn(`Case missing "expected" field — treating as null (out-of-scope): "${query}"`)
        console.log()
      }
    }
    const expected = 'expected' in testCase ? rawExpected : null

    // ── Call capman ──────────────────────────────────────────────────────────
    // query is passed as the `query:` field so runCapman places it after the
    // POSIX '--' sentinel — queries starting with '-' are never mistaken for flags.
    const capmanArgs = ['--json']
    if (manifestFlag) capmanArgs.push('--manifest', manifestFlag)

    const result = runCapman({
      command: 'explain',
      query:   query.trim(),
      args:    capmanArgs,
      timeout: timeoutVal,
    })

    // ── Handle subprocess error ──────────────────────────────────────────────
    if (!result.ok) {
      const caseResult = {
        query,
        expected:   expected ?? null,
        got:        null,
        pass:       false,
        confidence: 0,
        durationMs: 0,
        note:       note ?? null,
        error:      result.error,
      }
      results.push(caseResult)
      failed++
      if (!jsonMode) renderCaseError(caseResult)
      continue
    }

    // ── Evaluate result ──────────────────────────────────────────────────────
    const data       = result.data
    const got        = data?.matched?.capability?.id ?? null
    const confidence = data?.matched?.confidence ?? 0
    const durationMs = data?.durationMs ?? 0

    // Pass logic:
    //   expected = null → pass if got is also null (OUT_OF_SCOPE)
    //   expected = id   → pass if got matches id exactly
    const pass = expected === null ? got === null : got === expected

    if (pass) passed++
    else      failed++

    const caseResult = {
      query,
      expected:   expected ?? null,
      got,
      pass,
      confidence,
      durationMs,
      note:       note ?? null,
      error:      null,
    }
    results.push(caseResult)
    if (!jsonMode) renderCase(caseResult)
  }

  // Include skipped in the denominator so malformed cases don't silently
  // inflate the pass rate. A suite with 5 skipped and 4/5 passing reports
  // 40%, not 80% — the honest picture.
  const total    = results.length + skipped
  const passRate = total > 0 ? Math.round((passed / total) * 100) : 0

  return { results, skippedCases, passed, failed, skipped, total, passRate }
}

// ─── Renderers ────────────────────────────────────────────────────────────────

function renderCase(r) {
  const icon      = r.pass ? `${c.green}✓${c.reset}` : `${c.red}✗${c.reset}`
  const confColor = confidenceColor(r.confidence)
  const safeQuery = truncate(stripAnsi(r.query ?? ''), 52)
  const gotLabel  = stripAnsi(r.got ?? 'OUT_OF_SCOPE')
  const expLabel  = r.expected !== null
    ? `  ${c.gray}expected: ${stripAnsi(r.expected ?? '')}${c.reset}`
    : ''

  console.log(`  ${icon}  ${c.gray}"${safeQuery}"${c.reset}`)
  console.log(
    `     ${c.bold}${gotLabel}${c.reset}` +
    `  ${confColor}${r.confidence}%${c.reset}` +
    `  ${c.gray}${r.durationMs}ms${c.reset}` +
    `${expLabel}`
  )
  if (r.note) console.log(`     ${c.gray}# ${r.note}${c.reset}`)
  console.log()
}

function renderCaseError(r) {
  console.log(`  ${c.red}✗${c.reset}  ${c.gray}"${truncate(stripAnsi(r.query ?? ''), 52)}"${c.reset}`)
  console.log(`     ${c.red}error:${c.reset} ${c.gray}${stripAnsi(String(r.error ?? ''))}${c.reset}`)
  if (r.note) console.log(`     ${c.gray}# ${r.note}${c.reset}`)
  console.log()
}

function renderSummary({ total, passed, failed, skipped, passRate, threshold, thresholdMet }) {
  const rateColor = passRate >= 80 ? c.green : passRate >= 60 ? c.yellow : c.red
  const failColor = failed > 0 ? c.red : c.gray
  const skipNote  = skipped > 0 ? `  ${c.gray}${skipped} skipped${c.reset}` : ''

  let thresholdNote = ''
  if (threshold !== null) {
    thresholdNote = thresholdMet
      ? `  ${c.green}✓ threshold ${threshold}% met${c.reset}`
      : `  ${c.red}✗ threshold ${threshold}% not met (got ${passRate}%)${c.reset}`
  }

  console.log(`  ${c.gray}─────────────────────────────────────────${c.reset}`)
  console.log()
  console.log(
    `  ${c.bold}Results${c.reset}` +
    `  ${c.green}${passed} passed${c.reset}` +
    `  ${failColor}${failed} failed${c.reset}` +
    `  ${c.gray}${total} total${c.reset}` +
    `  ${rateColor}${passRate}% pass rate${c.reset}` +
    `${skipNote}` +
    `${thresholdNote}`
  )
  console.log()
}

function renderFailures(results, skippedCases = []) {
  const failures = results.filter(r => !r.pass)
  if (failures.length === 0 && skippedCases.length === 0) return

  if (failures.length > 0) {
    console.log(`  ${c.bold}FAILURES${c.reset}`)
    console.log()

    for (const f of failures) {
      const safeQuery    = truncate(stripAnsi(f.query ?? ''), 52)
      const safeGot      = stripAnsi(f.got ?? 'OUT_OF_SCOPE')
      const safeExpected = stripAnsi(f.expected ?? '(any match)')

      console.log(`  ${c.red}✗${c.reset}  ${c.gray}"${safeQuery}"${c.reset}`)

      if (f.error) {
        console.log(`     ${c.gray}error: ${stripAnsi(f.error)}${c.reset}`)
      } else {
        console.log(
          `     ${c.gray}got ${c.reset}${c.bold}${safeGot}${c.reset}` +
          `${c.gray}, expected ${c.reset}${c.bold}${safeExpected}${c.reset}`
        )
      }

      if (f.note) console.log(`     ${c.gray}# ${f.note}${c.reset}`)
      console.log()
    }
  }

  if (skippedCases.length > 0) {
    console.log(`  ${c.bold}SKIPPED${c.reset}  ${c.gray}${skippedCases.length} case${skippedCases.length !== 1 ? 's' : ''} not run${c.reset}`)
    console.log()

    for (const s of skippedCases) {
      console.log(`  ${c.gray}–${c.reset}  ${c.gray}"${s.query}"${c.reset}`)
      console.log(`     ${c.gray}${s.reason}${c.reset}`)
      console.log()
    }
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function truncate(str, n) {
  return str.length > n ? str.slice(0, n - 1) + '…' : str
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = { runSuiteCases, renderCase, renderCaseError, renderSummary, renderFailures, truncate }
