'use strict'

const { realpathSync, existsSync } = require('fs')
const fs   = require('fs')
const path = require('path')

const { c, log, header, getFlag, hasFlag, stripAnsi, validateManifestPath } = require('./shared')

/**
 * generate-suite.js — Scaffold a starter eval suite file from a manifest.
 *
 * Reads manifest.json directly (same ADR-005 justification as diff —
 * no capman command outputs structured capability JSON in v0.6.2).
 * Generates one test case per capability plus an out-of-scope sentinel.
 * Writes to eval-suite.json (or --out path) within CWD.
 *
 * Usage:
 *   capman-studio generate-suite
 *   capman-studio generate-suite --out my-suite.json
 *   capman-studio generate-suite --manifest other.json
 *   capman-studio generate-suite --overwrite
 *   capman-studio generate-suite --json
 */

// ─── Out-of-scope sentinel ────────────────────────────────────────────────────
// Appended to every generated suite. Teaches the format, ensures OUT_OF_SCOPE
// matching is tested from day one. Query chosen to be universally off-topic
// for any application domain.
const SENTINEL_CASE = {
  query:    'what is the weather like today in tokyo',
  expected: null,
  note:     'out-of-scope sentinel — this query should NOT match any capability. Edit if it conflicts with your app domain.',
}

// ─── Entry Point ──────────────────────────────────────────────────────────────

function runGenerateSuite() {
  header()

  // ── Parse flags ─────────────────────────────────────────────────────────────
  const manifestFlag = getFlag('--manifest')
  const outFlag      = getFlag('--out')
  const overwrite    = hasFlag('--overwrite')
  const jsonMode     = hasFlag('--json')

  const manifestPath = manifestFlag ?? 'manifest.json'
  const outPath      = outFlag      ?? 'eval-suite.json'

  // ── Validate manifest path ───────────────────────────────────────────────────
  const realManifestPath = validateManifestPath(manifestPath)

  // ── Validate output path ─────────────────────────────────────────────────────
  // Only validate in non-json mode — stdout output has no path to guard.
  if (!jsonMode) {
    validateOutputPath(outPath, overwrite)
  }

  // ── Load manifest ─────────────────────────────────────────────────────────────
  const manifest = loadManifest(realManifestPath, manifestPath)

  // ── Generate cases ────────────────────────────────────────────────────────────
  const cases = generateCases(manifest)

  // ── Write or print ────────────────────────────────────────────────────────────
  writeOrPrint({ cases, outPath, jsonMode, overwrite, manifest })
}

// ─── Path Validation ──────────────────────────────────────────────────────────

/**
 * Validate the output path — must be within CWD.
 * If the file exists and --overwrite is not set, exits with a clear error.
 *
 * Output path does not need to exist yet — we check the parent directory.
 * Parent must be within CWD and must exist.
 */
function validateOutputPath(rawPath, overwrite) {
  const resolved = path.resolve(rawPath)
  const { realCwd, guard } = getCwdGuard()

  // Resolve parent directory — output file may not exist yet
  const parentDir = path.dirname(resolved)
  let realParent
  try {
    realParent = realpathSync(parentDir)
  } catch {
    log.error(`Output directory does not exist: ${parentDir}`)
    log.hint(`Create it first or use a path within the current directory.`)
    process.exit(1)
  }

  // Ensure parent is within CWD
  if (!realParent.startsWith(guard) && realParent !== realCwd) {
    log.error('Output path must be within the current directory.')
    log.hint(`Resolved to: ${resolved}`)
    log.hint(`CWD is:      ${realCwd}`)
    process.exit(1)
  }

  // Ensure output path itself is within CWD (not just its parent)
  if (!resolved.startsWith(guard) && resolved !== realCwd) {
    log.error('Output path must be within the current directory.')
    log.hint(`Resolved to: ${resolved}`)
    process.exit(1)
  }

  // Check for existing file — require --overwrite to proceed
  if (existsSync(resolved) && !overwrite) {
    log.error(`Output file already exists: ${path.basename(rawPath)}`)
    log.hint(`Use --overwrite to replace it, or choose a different path with --out <name>.json`)
    process.exit(1)
  }
}

// ─── Manifest Loading ─────────────────────────────────────────────────────────

/**
 * Read and parse a manifest JSON file.
 * Never surfaces raw JSON parse errors — prevents content leaking.
 */
function loadManifest(realPath, rawPath) {
  let raw
  try {
    raw = fs.readFileSync(realPath, 'utf8')
  } catch (e) {
    log.error(`Could not read manifest: ${stripAnsi(e.code ?? 'unknown error')}`)
    log.hint(`Path: ${realPath}`)
    process.exit(1)
  }

  let manifest
  try {
    manifest = JSON.parse(raw)
  } catch {
    // Do not surface e.message — may include partial file content
    log.error(`Manifest is not valid JSON: ${path.basename(rawPath)}`)
    log.hint(`Validate it with: capman validate --manifest ${rawPath}`)
    process.exit(1)
  }

  if (!manifest || typeof manifest !== 'object' || !Array.isArray(manifest.capabilities)) {
    log.error(`Manifest is missing a "capabilities" array: ${path.basename(rawPath)}`)
    log.hint(`A valid manifest.json is generated by: capman generate`)
    process.exit(1)
  }

  if (manifest.capabilities.length === 0) {
    log.error(`Manifest has no capabilities: ${path.basename(rawPath)}`)
    log.hint(`Add capabilities in capman.config.js then run: capman generate`)
    process.exit(1)
  }

  return manifest
}

// ─── Case Generation ──────────────────────────────────────────────────────────

/**
 * Generate one test case per capability, plus an out-of-scope sentinel.
 *
 * Query selection priority per capability:
 *   1. First example string (best signal for the matcher)
 *   2. Description trimmed to 120 chars (next best)
 *   3. Capability name (last resort)
 *
 * Every case includes:
 *   query    — the query string
 *   expected — the capability id (string) or null for out-of-scope
 *   note     — generation hint so developers know what to edit
 */
function generateCases(manifest) {
  const cases = []

  for (const cap of manifest.capabilities) {
    // Guard against malformed capability entries
    if (!cap || typeof cap.id !== 'string' || cap.id.trim() === '') continue

    const safeId   = cap.id.trim()
    const examples = Array.isArray(cap.examples) ? cap.examples.filter(e => typeof e === 'string' && e.trim() !== '') : []
    const desc     = typeof cap.description === 'string' ? cap.description.trim() : ''
    const name     = typeof cap.name        === 'string' ? cap.name.trim()        : safeId

    let query
    let note

    if (examples.length > 0) {
      // Best case — use the first example exactly as written
      query = examples[0].trim()
      note  = 'auto-generated from examples'
    } else if (desc) {
      // Good fallback — description gives semantic signal
      query = desc.length > 120 ? desc.slice(0, 119) + '…' : desc
      note  = 'no examples — query generated from description, edit before use'
    } else {
      // Last resort — capability name is better than nothing
      query = name
      note  = 'no examples or description — edit this query before use'
    }

    // Lifecycle warning — deprecated capabilities still get a case but are
    // flagged so developers decide whether to keep testing them.
    if (cap.lifecycle?.status === 'deprecated') {
      note += ` [DEPRECATED${cap.lifecycle.successor ? ` → ${cap.lifecycle.successor}` : ''}]`
    }

    cases.push({
      query:    stripAnsi(query),
      expected: safeId,
      note:     stripAnsi(note),
    })
  }

  // Append out-of-scope sentinel as the last case
  cases.push(SENTINEL_CASE)

  return cases
}

// ─── Output ───────────────────────────────────────────────────────────────────

/**
 * Either write the suite to a file or print to stdout (--json mode).
 */
function writeOrPrint({ cases, outPath, jsonMode, manifest }) {
  const json = JSON.stringify(cases, null, 2)

  if (jsonMode) {
    console.log(json)
    return
  }

  const resolvedOut = path.resolve(outPath)

  try {
    fs.writeFileSync(resolvedOut, json, 'utf8')
  } catch (e) {
    log.error(`Could not write suite file: ${stripAnsi(e.message ?? 'unknown error')}`)
    log.hint(`Path: ${resolvedOut}`)
    process.exit(1)
  }

  // ── Success output ─────────────────────────────────────────────────────────
  const capCount    = cases.length - 1  // subtract sentinel
  const noExamples  = cases.filter(c => c.note?.includes('no examples')).length
  const deprecated  = cases.filter(c => c.note?.includes('DEPRECATED')).length

  console.log(`  ${c.green}✓${c.reset}  Generated ${c.bold}${outPath}${c.reset}`)
  console.log()
  console.log(`  ${c.gray}${capCount} capability case${capCount !== 1 ? 's' : ''}${c.reset}` +
              `  +  ${c.gray}1 out-of-scope sentinel${c.reset}`)

  if (noExamples > 0) {
    console.log()
    console.log(`  ${c.yellow}⚠${c.reset}  ${noExamples} case${noExamples !== 1 ? 's' : ''} ${c.gray}generated without examples — review queries before running the suite${c.reset}`)
  }

  if (deprecated > 0) {
    console.log()
    console.log(`  ${c.yellow}⚠${c.reset}  ${deprecated} deprecated ${deprecated !== 1 ? 'capabilities' : 'capability'}${c.gray} — decide whether to keep their cases${c.reset}`)
  }

  console.log()
  console.log(`  ${c.gray}Next steps:${c.reset}`)
  console.log(`  ${c.gray}1. Review and edit queries in ${outPath}${c.reset}`)
  console.log(`  ${c.gray}2. Run: capman-studio eval --mode=suite --suite ${outPath}${c.reset}`)
  console.log()

  if (manifest?.app) {
    console.log(`  ${c.gray}Manifest: ${stripAnsi(String(manifest.app))} · ${capCount} capabilities${c.reset}`)
    console.log()
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Get real CWD and guard string — used by both path validators.
 * Centralised so both always use the same CWD snapshot.
 */
function getCwdGuard() {
  const realCwd = realpathSync(process.cwd())
  const guard   = realCwd.endsWith(path.sep) ? realCwd : realCwd + path.sep
  return { realCwd, guard }
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = { runGenerateSuite }