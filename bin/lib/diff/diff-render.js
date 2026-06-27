'use strict'

const { c, stripAnsi } = require('../shared')

/**
 * diff-render.js — Terminal renderer for DiffResult objects.
 *
 * Three modes:
 *   renderDiff(result)                  → summary (default)
 *   renderDiff(result, { verbose })     → full field changes
 *   renderDiffJson(result)              → machine-readable JSON to stdout
 *
 * No file I/O. No process.exit(). No capman calls.
 * Accepts a DiffResult from diff-engine.js and renders to terminal.
 */

// ─── Change type display config ───────────────────────────────────────────────

const CHANGE_CONFIG = {
  added:     { symbol: '+', color: c.green,  label: 'added'    },
  removed:   { symbol: '-', color: c.red,    label: 'removed'  },
  modified:  { symbol: '~', color: c.yellow, label: 'modified' },
  renamed:   { symbol: '↻', color: c.blue,   label: 'renamed'  },
  unchanged: { symbol: '=', color: c.gray,   label: 'unchanged'},
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Render a DiffResult to the terminal.
 *
 * @param {import('./diff-engine').DiffResult} result
 * @param {object}  [options]
 * @param {boolean} [options.verbose=false]          - show per-field changes
 * @param {boolean} [options.includeUnchanged=false] - show unchanged capabilities
 */
function renderDiff(result, { verbose = false, includeUnchanged = false } = {}) {
  renderHeader(result)

  if (!result.hasChanges && !includeUnchanged) {
    console.log(`  ${c.green}✓${c.reset}  ${c.gray}Manifests are identical — no capabilities changed.${c.reset}`)
    console.log()
    return
  }

  renderCapabilityList(result.capabilities, { verbose, includeUnchanged })
  renderSummaryLine(result)
}

/**
 * Render a DiffResult as machine-readable JSON.
 * Outputs to stdout only — caller decides what to do with process.exit.
 *
 * @param {import('./diff-engine').DiffResult} result
 */
function renderDiffJson(result) {
  console.log(JSON.stringify(result, null, 2))
}

// ─── Renderers ────────────────────────────────────────────────────────────────

function renderHeader(result) {
  const { oldMeta, newMeta } = result

  const oldLabel = `${stripAnsi(oldMeta.app)} v${stripAnsi(String(oldMeta.version ?? ''))}`
  const newLabel = `${stripAnsi(newMeta.app)} v${stripAnsi(String(newMeta.version ?? ''))}`

  console.log()
  console.log(
    `  ${c.bold}DIFF${c.reset}` +
    `  ${c.gray}${oldLabel}${c.reset}` +
    `  ${c.gray}→${c.reset}` +
    `  ${c.gray}${newLabel}${c.reset}`
  )

  // Warn when schema versions differ — signals a pre-v0.6 → v0.6+ upgrade.
  // schemaVersion '' = pre-v0.6, '1' = v0.6+
  const oldSchema = oldMeta.schemaVersion ?? ''
  const newSchema = newMeta.schemaVersion ?? ''
  if (oldSchema !== newSchema) {
    const oldSchemaLabel = oldSchema || 'pre-v0.6'
    const newSchemaLabel = newSchema || 'pre-v0.6'
    console.log(
      `  ${c.yellow}⚠${c.reset}` +
      `  ${c.gray}Schema version changed: ${oldSchemaLabel} → ${newSchemaLabel}` +
      ` — new fields (returns, lifecycle) may appear as additions${c.reset}`
    )
  }

  console.log(`  ${c.gray}─────────────────────────────────────────${c.reset}`)
  console.log()
}

function renderCapabilityList(capabilities, { verbose, includeUnchanged }) {
  // Filter out unchanged if not requested
  const toRender = includeUnchanged
    ? capabilities
    : capabilities.filter(cap => cap.type !== 'unchanged')

  if (toRender.length === 0) {
    console.log(`  ${c.gray}No changes to display.${c.reset}`)
    console.log()
    return
  }

  // Compute column widths from sanitised values for alignment
  const maxIdLen = toRender.reduce((max, cap) => {
    const id = stripAnsi(cap.id ?? '')
    return Math.max(max, id.length)
  }, 4)

  for (const cap of toRender) {
    renderCapabilityRow(cap, maxIdLen, verbose)
  }
}

function renderCapabilityRow(cap, maxIdLen, verbose) {
  const cfg    = CHANGE_CONFIG[cap.type] ?? CHANGE_CONFIG.modified
  const safeId = stripAnsi(cap.id    ?? '(no id)')
  const safeName = stripAnsi(cap.name ?? '')

  // ── Main row ───────────────────────────────────────────────────────────────
  const idPadded   = safeId.padEnd(maxIdLen)
  const typeLabel  = cap.type.padEnd(9)
  const renameNote = cap.oldId
    ? `  ${c.gray}(${stripAnsi(cap.oldId)} → ${safeId})${c.reset}`
    : ''

  console.log(
    `  ${cfg.color}${cfg.symbol}${c.reset}` +
    `  ${c.bold}${idPadded}${c.reset}` +
    `  ${cfg.color}${typeLabel}${c.reset}` +
    `  ${c.gray}${safeName}${c.reset}` +
    `${renameNote}`
  )

  // ── Field changes (verbose or modified) ───────────────────────────────────
  if (cap.changes && cap.changes.length > 0) {
    if (verbose) {
      renderFieldChanges(cap.changes, maxIdLen)
    } else {
      // Summary: show just the field names that changed
      const fieldNames = cap.changes.map(ch => ch.field).join(', ')
      console.log(
        `  ${c.gray}${' '.repeat(maxIdLen + 4)}fields: ${fieldNames}${c.reset}`
      )
    }
  }
}

function renderFieldChanges(changes, maxIdLen) {
  const indent = ' '.repeat(maxIdLen + 4)

  for (const change of changes) {
    const field    = stripAnsi(String(change.field ?? ''))
    const oldValue = formatFieldValue(change.oldValue)
    const newValue = formatFieldValue(change.newValue)

    console.log(
      `  ${c.gray}${indent}${field}${c.reset}`
    )
    console.log(
      `  ${c.red}${indent}  - ${oldValue}${c.reset}`
    )
    console.log(
      `  ${c.green}${indent}  + ${newValue}${c.reset}`
    )
  }
}

function renderSummaryLine(result) {
  const { added, removed, modified, renamed, unchanged, hasChanges } = result

  console.log(`  ${c.gray}─────────────────────────────────────────${c.reset}`)
  console.log()

  if (!hasChanges) {
    console.log(`  ${c.green}✓${c.reset}  ${c.gray}No changes${c.reset}`)
    console.log()
    return
  }

  const parts = []

  if (added    > 0) parts.push(`${c.green}+${added} added${c.reset}`)
  if (removed  > 0) parts.push(`${c.red}-${removed} removed${c.reset}`)
  if (modified > 0) parts.push(`${c.yellow}~${modified} modified${c.reset}`)
  if (renamed  > 0) parts.push(`${c.blue}↻${renamed} renamed${c.reset}`)
  if (unchanged > 0) parts.push(`${c.gray}=${unchanged} unchanged${c.reset}`)

  const total = added + removed + modified + renamed
  console.log(
    `  ${c.bold}${total} change${total !== 1 ? 's' : ''}${c.reset}` +
    `  ${parts.join('  ')}`
  )
  console.log()
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Format a field value for display in verbose mode.
 * Arrays are joined, long strings are truncated, nulls shown explicitly.
 */
function formatFieldValue(value) {
  if (value === null || value === undefined) return '(none)'
  if (Array.isArray(value)) {
    if (value.length === 0) return '(empty)'
    const joined = value.map(v => String(v ?? '')).join(', ')
    return truncate(stripAnsi(joined), 80)
  }
  return truncate(stripAnsi(String(value)), 80)
}

function truncate(str, n) {
  return str.length > n ? str.slice(0, n - 1) + '…' : str
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = { renderDiff, renderDiffJson }