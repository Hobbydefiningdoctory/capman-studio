'use strict'

const { c, log, runCapman, getFlag, hasFlag, resolverColor, privacyColor, stripAnsi, validateManifestPath } = require('../shared')

/**
 * Inspect mode — renders a formatted manifest health summary.
 *
 * Data source: capman eval --json
 * Called by:   cmd-eval.js when --mode=inspect (or no --mode flag)
 */
/**
  * @param {object} [options]
  * @param {string} [options.manifestOverride]  - manifest path forwarded explicitly
  *   from the REPL's .inspect command. Falls back to --manifest flag from argv
  *   when called directly (i.e. --mode=inspect). Explicit always wins.
  */
function runInspect({ manifestOverride } = {}) {
  const manifestFlag = manifestOverride ?? getFlag('--manifest')
  const jsonMode     = hasFlag('--json')

// FIND-03: restrict --manifest to CWD — consistent with eval-suite.js
// and eval-repl.js. Uses realpathSync for symlink-awareness.
  if (manifestFlag) validateManifestPath(manifestFlag)

// ── Call capman ────────────────────────────────────────────────────────────
  const capmanArgs = ['--json']
  if (manifestFlag) capmanArgs.push('--manifest', manifestFlag)

  const result = runCapman({ command: 'eval', args: capmanArgs })

  if (!result.ok) {
    log.error(result.error)
    console.log()
    process.exit(1)
  }

  const data = result.data

// ── Pass-through JSON mode ─────────────────────────────────────────────────
// If the user ran capman-studio eval --json, just forward capman's output
  if (jsonMode) {
    console.log(JSON.stringify(data, null, 2))
    return
  }

// ── Render ─────────────────────────────────────────────────────────────────
  renderInspectData(data)
}

/**
 * Render a parsed inspect data object to the terminal.
 * Exported so watch.js can reuse the same renderer without duplicating logic.
 *
 * @param {object} data - parsed JSON from capman eval --json
 */
function renderInspectData(data) {
  renderHeader(data)
  renderStats(data)
  renderCoverage(data)
  renderValidation(data)
  renderCapabilityTable(data)
}

// ─── Renderers ────────────────────────────────────────────────────────────────

function renderHeader(data) {
  console.log(
    `  ${c.bold}${stripAnsi(data.app ?? 'unknown')}${c.reset}` +
    `  ${c.gray}v${stripAnsi(String(data.version ?? ''))} · generated ${fmtDate(data.generatedAt)}${c.reset}`
  )
  console.log(`  ${c.gray}─────────────────────────────────────────${c.reset}`)
  console.log()
}

function renderStats(data) {
  // type/level keys are sourced from capman JSON — stripAnsi before rendering.
  // capabilityCount coerced to Number to prevent arbitrary string injection.
  const resolverParts = Object.entries(data.resolverBreakdown ?? {})
    .map(([type, count]) => {
      const n = Number.isFinite(Number(count)) ? Number(count) : 0
      return `${resolverColor(type)}${n} ${stripAnsi(type)}${c.reset}`
    })
    .join(' / ') || `${c.gray}(none)${c.reset}`

  const privacyParts = Object.entries(data.privacyBreakdown ?? {})
    .map(([level, count]) => {
      const n = Number.isFinite(Number(count)) ? Number(count) : 0
      return `${privacyColor(level)}${n} ${stripAnsi(level)}${c.reset}`
    })
    .join(' / ') || `${c.gray}(none)${c.reset}`

  const safeCount = Number.isFinite(Number(data.capabilityCount))
    ? Number(data.capabilityCount)
    : '?'

  console.log(
    `  ${c.bold}${safeCount}${c.reset} capabilities` +
    `  ·  ${resolverParts}` +
    `  ·  ${privacyParts}`
  )
  console.log()
}

function renderCoverage(data) {
  const { noExamples = [], apiNoParams = [] } = data.coverage ?? {}
  const total = noExamples.length + apiNoParams.length

  if (total === 0) return

  console.log(`  ${c.bold}COVERAGE${c.reset}  ${c.yellow}${total} issue(s)${c.reset}`)
  console.log()

  for (const id of noExamples) {
    console.log(
      `  ${c.yellow}⚠${c.reset}  ${c.bold}${stripAnsi(id)}${c.reset}` +
      `  ${c.gray}no examples — keyword matching may be weak${c.reset}`
    )
  }

  for (const id of apiNoParams) {
    console.log(
      `  ${c.yellow}⚠${c.reset}  ${c.bold}${stripAnsi(id)}${c.reset}` +
      `  ${c.gray}api resolver with no params defined${c.reset}`
    )
  }

  console.log()
}

function renderValidation(data) {
  // Guard against missing or null validation field —
  // older capman versions or partial error responses may omit it.
  // Array.isArray guards errors/warnings specifically because null is not iterable.
  const validation = data.validation ?? {}
  const valid    = validation.valid ?? true
  const warnings = Array.isArray(validation.warnings) ? validation.warnings : []
  const errors   = Array.isArray(validation.errors)   ? validation.errors   : []

  if (valid && warnings.length === 0) {
    console.log(`  ${c.green}✓${c.reset}  Manifest valid`)
    console.log()
    return
  }

  console.log(`  ${c.bold}VALIDATION${c.reset}`)
  console.log()

  for (const w of warnings) {
    console.log(`  ${c.yellow}⚠${c.reset}  ${stripAnsi(String(w))}`)
  }
  for (const e of errors) {
    console.log(`  ${c.red}✗${c.reset}  ${stripAnsi(String(e))}`)
  }

  console.log()
}

function renderCapabilityTable(data) {
  const caps = data.capabilities

  if (!caps || caps.length === 0) {
    log.warn('No capabilities found in manifest.')
    console.log()
    return
  }

  console.log(`  ${c.bold}CAPABILITIES${c.reset}`)
  console.log()

  // Sanitise id, resolver, privacy at this point so that:
  // 1. maxIdLen is computed from clean text length (no hidden escape sequences
  //    inflating the count and misaligning columns)
  // 2. padEnd() acts on the same clean string that gets rendered
  // 3. All three values are sanitised once, used consistently throughout
  const sanitisedCaps = caps.map(cap => ({
    ...cap,
    safeId:       stripAnsi(cap.id              ?? '(no id)'),
    safeResolver: stripAnsi(cap.resolver?.type  ?? 'unknown'),
    safePrivacy:  stripAnsi(cap.privacy?.level  ?? 'unknown'),
  }))

  // reduce instead of Math.max(...spread) — spread crashes with a RangeError
  // on very large manifests (V8 argument count limit ~65k) and is wasteful.
  const maxIdLen = sanitisedCaps.reduce((max, cap) => Math.max(max, cap.safeId.length), 4)

  for (const cap of sanitisedCaps) {
    const exCount  = Number.isFinite(Number(cap.exampleCount)) ? Number(cap.exampleCount) : 0
    const parCount = Number.isFinite(Number(cap.paramCount))   ? Number(cap.paramCount)   : 0

    const exLabel = exCount > 0
      ? `${c.gray}${exCount} ex${c.reset}`
      : `${c.yellow}0 ex${c.reset}`

    const paramLabel = parCount > 0
      ? `${c.gray}${parCount} param${parCount > 1 ? 's' : ''}${c.reset}`
      : ''

    const idPadded      = cap.safeId.padEnd(maxIdLen)
    const resolverLabel = cap.safeResolver.padEnd(6)
    const privacyLabel  = cap.safePrivacy.padEnd(10)

    // Row 1 — id, resolver, privacy, counts
    console.log(
      `  ${c.bold}${idPadded}${c.reset}` +
      `  ${resolverColor(cap.safeResolver)}${resolverLabel}${c.reset}` +
      `  ${privacyColor(cap.safePrivacy)}${privacyLabel}${c.reset}` +
      `  ${exLabel}` +
      (paramLabel ? `  ${paramLabel}` : '')
    )

    // Row 2 — description
    console.log(
      `  ${pad(maxIdLen)}  ${c.gray}${stripAnsi(cap.description ?? '')}${c.reset}`
    )

    console.log()
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(iso) {
  if (!iso) return 'unknown'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso
  // Manual format using UTC methods — avoids toLocaleString('en-US') which
  // depends on ICU data (unavailable in minimal Node Docker images), and uses
  // UTC so output is consistent regardless of the host machine's timezone.
  const yr  = d.getUTCFullYear()
  const mo  = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  const hr  = String(d.getUTCHours()).padStart(2, '0')
  const min = String(d.getUTCMinutes()).padStart(2, '0')
  return `${yr}-${mo}-${day} ${hr}:${min} UTC`
}

function pad(n) {
  return ' '.repeat(n)
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = { runInspect, renderInspectData }
