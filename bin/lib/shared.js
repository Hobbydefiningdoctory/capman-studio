'use strict'

const { spawnSync }    = require('child_process')
const { realpathSync } = require('fs')
const path             = require('path')

// ─── Args ─────────────────────────────────────────────────────────────────────

const args    = process.argv.slice(2)
const command = args[0]
const flags   = args.slice(1)

/**
 * Get the value of a named flag.
 * Supports both --flag=value and --flag value forms.
 * Returns undefined if flag is not present.
 * Exits with error if flag is present but has no value.
 */
function getFlag(name) {
  // Duplicate check runs FIRST — before any early return — so both
  // --flag=value and --flag value forms are caught equally.
  // A duplicate in eq-form would silently return the first match
  // if the check only ran in the space-form branch.
  const spaceCount = flags.filter(f => f === name).length
  const eqCount    = flags.filter(f => f.startsWith(`${name}=`)).length
  if (spaceCount + eqCount > 1) {
    console.error(`\x1b[33m⚠\x1b[0m Flag "${name}" specified more than once. Using first value.`)
  }

  // --flag=value form
  const eqForm = flags.find(f => f.startsWith(`${name}=`))
  if (eqForm) return eqForm.slice(name.length + 1)

  // --flag value form
  const i = flags.indexOf(name)
  if (i === -1) return undefined

  const value = flags[i + 1]
  // Treat any token starting with '-' as a flag boundary — not just '--'.
  // Prevents --manifest -v silently returning '-v' as the manifest path,
  // and guards against paths starting with a dash (e.g. -.hidden).
  if (value === undefined || value.startsWith('-')) {
    console.error(`${c.red}✗${c.reset} Flag "${name}" requires a value. Example: ${name} <value>`)
    process.exit(1)
  }

  return value
}

/**
 * Check if a boolean flag is present.
 */
function hasFlag(name) {
  return flags.includes(name)
}

// ─── Colors ───────────────────────────────────────────────────────────────────

const c = {
  reset:  '\x1b[0m',
  bold:   '\x1b[1m',
  teal:   '\x1b[36m',
  yellow: '\x1b[33m',
  red:    '\x1b[31m',
  green:  '\x1b[32m',
  gray:   '\x1b[90m',
  blue:   '\x1b[34m',
}

// ─── Logger ───────────────────────────────────────────────────────────────────

const log = {
  info:    (...a) => console.log(`${c.teal}i${c.reset}`, ...a),
  success: (...a) => console.log(`${c.green}✓${c.reset}`, ...a),
  warn:    (...a) => console.log(`${c.yellow}⚠${c.reset}`, ...a),
  error:   (...a) => console.error(`${c.red}✗${c.reset}`, ...a),
  // hint — for lines that follow an error. Always goes to stderr so shell
  // pipelines and CI log capture do not mix error-context with stdout data.
  hint:    (...a) => process.stderr.write(`  ${c.gray}${a.join(' ')}${c.reset}\n`),
  blank:   ()     => console.log(),
}

// ─── Header ───────────────────────────────────────────────────────────────────

function header() {
  const pkg = require(path.join(__dirname, '..', '..', 'package.json'))
  console.log()
  console.log(`${c.bold}${c.teal}  capman-studio${c.reset} ${c.gray}v${pkg.version}${c.reset}`)
  console.log(`${c.gray}  ─────────────────────────────────────────${c.reset}`)
  console.log()
}

// ─── capmanCmd — module-level init ────────────────────────────────────────────
// Resolved and validated once at load time, not on every runCapman() call.
// require() is cached by Node so the file read is free after the first call,
// but the path.join and regex validation were redundantly repeated per-call.
// Exiting at module load gives a clear startup error rather than a per-call error.

const capmanCmd = (() => {
  try {
    const pkg    = require(path.join(__dirname, '..', '..', 'package.json'))
    const rawCmd = pkg.capman?.command
    if (rawCmd !== undefined) {
      if (typeof rawCmd !== 'string' || !/^[a-zA-Z0-9_.\/\-]+$/.test(rawCmd)) {
        console.error(`\x1b[31m✗\x1b[0m Unsafe capman.command in package.json: "${rawCmd}". Must be a plain command name or path (no spaces or shell characters).`)
        process.exit(1)
      }
      return rawCmd
    }
  } catch {
  // package.json unreadable — fall through to default
  }
  return 'capman'
})()

/**
  * Run a capman CLI command as a subprocess and return the result.
  *
  * @param {object} options
  * @param {string}   options.command   - capman subcommand e.g. 'eval', 'explain'
  * @param {string}   [options.query]   - free-text query for commands like 'explain'.
  *                                       Placed AFTER the POSIX '--' sentinel so a query
  *                                       that starts with '-' is never misread as a flag.
  * @param {string[]} options.args      - flag-form args e.g. ['--manifest', 'cases.json', '--json']
  * @param {boolean}  options.json      - parse stdout as JSON (default: true)
  * @param {number}   options.timeout   - ms before killing the process (default: 5000)
  * @param {boolean}  options.raw       - return raw stdout string, skip JSON parse (default: false)
  *
  * @returns {{ ok: boolean, data: any, raw: string, error: string|null }}
  */
  function runCapman({
    command,
    query,
    args    = [],
    json    = true,
    timeout = 5000,
    raw     = false,
  } = {}) {

    // ADR-003 resolved: capman v0.5.5 now honours POSIX '--' sentinel.
    // Real capman reads flags via getFlag() from everything BEFORE '--', and
    // reads the free-text query via posArgs[0] from everything AFTER '--'.
    // The sentinel must therefore sit between the flags and the query — never
    // before the flags, or every flag (--manifest, --json, etc.) silently
    // lands in posArgs and is invisible to capman's own getFlag(), causing
    // capman to fall back to its own defaults with no error.
    //
    // Commands with no free-text query (eval, validate) get no sentinel at all.
      const fullArgs = query !== undefined
      ? [command, ...args, '--', query].filter(a => a !== undefined)
      : [command, ...args].filter(Boolean)

    let result
    try {
      result = spawnSync(capmanCmd, fullArgs, {
        encoding: 'utf8',
        timeout,
      })
  } catch (e) {
    return {
      ok:    false,
      data:  null,
      raw:   '',
      error: `Failed to spawn capman: ${e.message}`,
    }
  }

  // ── Timeout ──────────────────────────────────────────────────────────────
  // Check ETIMEDOUT first (authoritative on all platforms).
  // Fall back to signal check for environments where error.code is not set.
  if (
    result.error?.code === 'ETIMEDOUT' ||
    (result.status === null && result.signal === 'SIGTERM')
  ) {
    return {
      ok:    false,
      data:  null,
      raw:   result.stdout ?? '',
      error: `capman did not respond within ${timeout}ms. Try passing --timeout=10000`,
    }
  }

  // ── capman not found ─────────────────────────────────────────────────────
  if (result.error?.code === 'ENOENT') {
    return {
      ok:    false,
      data:  null,
      raw:   '',
      error: `capman is not installed or not on PATH.\n  Run: pnpm add -g capman`,
    }
  }

  const stdout = result.stdout ?? ''
  // Sanitise stderr before it ever reaches an error message or terminal output.
  // Strips ANSI sequences and truncates to 1000 chars — prevents a compromised
  // or verbose capman binary from flooding logs or injecting terminal sequences.
  const stderr = stripAnsi(result.stderr ?? '').slice(0, 1000)

  // ── capman exited with error ─────────────────────────────────────────────
  if (result.status !== 0) {
      // Some capman error messages go to stdout rather than stderr.
      // When stderr is empty but stdout has content, include it so the
      // developer sees what actually went wrong instead of a bare exit code.
      const safeStdout = stripAnsi(stdout).slice(0, 500)
      const errorMsg = stderr
        || (safeStdout ? `capman exited with code ${result.status}. Output:\n${safeStdout}` : `capman exited with code ${result.status}`)
      return {
        ok:    false,
        data:  null,
        raw:   stdout,
        error: errorMsg,
      }
    }

  // ── Raw mode — skip JSON parse ───────────────────────────────────────────
  if (raw || !json) {
    return { ok: true, data: null, raw: stdout, error: null }
  }

  // ── JSON parse ───────────────────────────────────────────────────────────
  try {
    const data = JSON.parse(stdout)
    return { ok: true, data, raw: stdout, error: null }
  } catch {
    // JSON parse failed — return raw with a warning.
    // stripAnsi + slice: stdout is external data and may be large or contain
    // escape sequences — sanitise before including in error messages.
    const safePreview = stripAnsi(stdout).slice(0, 500)
    return {
      ok:    false,
      data:  null,
      raw:   stdout,
      error: `capman returned output that could not be parsed as JSON.\n  Raw output:\n${safePreview}`,
    }
  }
  }

// ─── stripAnsi() ─────────────────────────────────────────────────────────────

/**
 * Strip ANSI escape sequences from a string sourced from external data.
 * Applied to all subprocess output (stderr, manifest fields, capability data)
 * before rendering to the terminal or including in error messages.
 *
 * Covers: CSI sequences (colors, cursor), OSC sequences (title injection),
 * and other common escape codes.
 *
 * @param {any} str - value to sanitise (non-strings are coerced to string)
 * @returns {string}
 */
function stripAnsi(str) {
  if (typeof str !== 'string') return String(str ?? '')
  return str
    .replace(/\x1b\[[0-9;:]*[a-zA-Z]/g, '')        // CSI sequences — [0-9;:] covers both
                                                     // semicolon (standard) and colon
                                                     // (sub-parameter, e.g. \x1b[38:2:255:0:0m
                                                     // for 24-bit colour used by some terminals)
    .replace(/\x1b\][^\x07\x1b]*[\x07\x1b]/g, '')  // OSC sequences e.g. \x1b]0;title\x07
    .replace(/\x1b[^[\]]/g, '')                     // other two-char escapes
}

// ─── parseTimeout() ───────────────────────────────────────────────────────────

/**
 * Parse and validate a --timeout flag value.
 * Replaces raw parseInt() calls in eval-repl and eval-suite.
 * - Returns defaultMs if raw is undefined
 * - Exits with a clear error if the value is not a finite positive number
 * - Caps at 60 000ms to prevent indefinite hangs from typos
 * @param {string|undefined} raw        - raw string from getFlag('--timeout')
 * @param {number}           defaultMs  - fallback value (default: 5000)
 * @returns {number}
 */
function parseTimeout(raw, defaultMs = 5000) {
  if (raw === undefined) return defaultMs
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) {
    log.error(`Invalid --timeout value: "${raw}". Must be a positive integer (ms).`)
    log.hint('Example: --timeout=10000')
    process.exit(1)
  }
  const floored = Math.floor(n)
  const capped  = Math.min(floored, 60_000)
  // Warn explicitly — silent clamping causes confusing subprocess kills
  // that look like a capman bug rather than a capman-studio limit.
  if (capped < floored) {
    log.warn(`--timeout capped at 60000ms (you passed ${floored}ms). Maximum allowed is 60s.`)
  }
  return capped
}

// ─── Color helpers ────────────────────────────────────────────────────────────
// Centralised here so all eval sub-modules share the same thresholds.
// Previously duplicated across eval-repl.js and eval-suite.js.

/**
 * Color for a confidence/score percentage.
 * green >= 70  |  yellow >= 40  |  red < 40
 */
function confidenceColor(score) {
  if (score >= 70) return c.green
  if (score >= 40) return c.yellow
  return c.red
}

/**
 * Color for a capability resolver type.
 * teal = api  |  green = nav  |  yellow = hybrid  |  gray = unknown
 */
function resolverColor(type) {
  if (type === 'api')    return c.teal
  if (type === 'nav')    return c.green
  if (type === 'hybrid') return c.yellow
  return c.gray
}

/**
 * Color for a capability privacy level.
 * green = public  |  yellow = user_owned  |  red = admin  |  gray = unknown
 */
function privacyColor(level) {
  if (level === 'public')     return c.green
  if (level === 'user_owned') return c.yellow
  if (level === 'admin')      return c.red
  return c.gray
}

// ─── validateManifestPath() ───────────────────────────────────────────────────

/**
 * Validate a --manifest path — must exist and be within CWD.
 * Uses realpathSync for symlink-awareness, consistent with --suite path guard.
 * Exits with a clean error if the file is missing or outside CWD.
 * Returns the resolved real path on success.
 *
 * @param {string} rawPath - path as supplied by user or default
 * @returns {string} resolved real path
 */
function validateManifestPath(rawPath) {
  const resolved = path.resolve(rawPath)

  let realManifest
  try {
    realManifest = realpathSync(resolved)
  } catch {
    log.error(`Manifest file not found: ${resolved}`)
    log.hint('Run: capman generate')
    log.hint(`Or specify a path: --manifest path/to/manifest.json`)
    process.exit(1)
  }

  const realCwd = realpathSync(process.cwd())
  const guard   = realCwd.endsWith(path.sep) ? realCwd : realCwd + path.sep

  if (!realManifest.startsWith(guard) && realManifest !== realCwd) {
    log.error('Manifest path must be within the current directory.')
    log.hint(`Resolved to: ${realManifest}`)
    log.hint(`CWD is:      ${realCwd}`)
    process.exit(1)
  }

  return realManifest
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  args,
  command,
  flags,
  getFlag,
  hasFlag,
  c,
  log,
  header,
  runCapman,
  stripAnsi,
  parseTimeout,
  confidenceColor,
  resolverColor,
  privacyColor,
  validateManifestPath,
}