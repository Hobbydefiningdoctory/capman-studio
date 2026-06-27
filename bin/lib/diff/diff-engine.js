'use strict'

/**
 * diff-engine.js — Pure manifest comparison logic.
 *
 * Takes two manifest objects (old, new) and returns a structured DiffResult.
 * No file I/O. No rendering. No process.exit(). Fully synchronous.
 * Safe to call from tests, web UI, or CLI renderers.
 *
* ADR-005: diff reads manifest JSON directly via fs.readFileSync + JSON.parse
 * in cmd-diff.js. This does not violate Option B — we are not importing capman
 * internals. manifest.json is a stable data format. Reading a JSON file is pure
 * Node.js with no capman dependency.
 *
 * capman v0.6.2 additions handled here:
 *   - `returns`          required string[] — compared order-insensitive
 *   - `lifecycle.status` optional string   — compared as scalar
 *   - `schemaVersion`    required string   — included in ManifestMeta
 */

// ─── Change Types ─────────────────────────────────────────────────────────────

/**
 * @typedef {'added' | 'removed' | 'modified' | 'renamed' | 'unchanged'} ChangeType
 */

/**
 * @typedef {Object} FieldChange
 * @property {string} field       - field name e.g. 'description', 'resolver.type'
 * @property {any}    oldValue    - value in old manifest
 * @property {any}    newValue    - value in new manifest
 */

/**
 * @typedef {Object} CapabilityDiff
 * @property {ChangeType}    type         - change classification
 * @property {string}        id           - capability id (new id for renamed)
 * @property {string}        [oldId]      - old id (renamed only)
 * @property {string}        name         - capability name
 * @property {FieldChange[]} changes      - list of modified fields (modified only)
 */

/**
 * @typedef {Object} ManifestMeta
 * @property {string} app
 * @property {string} version
 * @property {string} generatedAt
 * @property {number} capabilityCount
 * @property {string} schemaVersion  - '1' for v0.6+ manifests, '' for older
 */

/**
 * @typedef {Object} DiffResult
 * @property {ManifestMeta}    oldMeta
 * @property {ManifestMeta}    newMeta
 * @property {CapabilityDiff[]} capabilities  - one entry per change (excludes unchanged by default)
 * @property {number}           added
 * @property {number}           removed
 * @property {number}           modified
 * @property {number}           renamed
 * @property {number}           unchanged
 * @property {boolean}          hasChanges
 */

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Compare two manifest objects and return a structured DiffResult.
 *
 * @param {object} oldManifest  - the baseline manifest
 * @param {object} newManifest  - the manifest to compare against
 * @param {object} [options]
 * @param {boolean} [options.includeUnchanged=false] - include unchanged capabilities in result
 * @returns {DiffResult}
 */
function diffManifests(oldManifest, newManifest, { includeUnchanged = false } = {}) {
  const oldCaps = normaliseCaps(oldManifest.capabilities ?? [])
  const newCaps = normaliseCaps(newManifest.capabilities ?? [])

  // Build lookup maps by id for O(1) access
  const oldById = new Map(oldCaps.map(c => [c.id, c]))
  const newById = new Map(newCaps.map(c => [c.id, c]))

  const capabilities = []
  let added     = 0
  let removed   = 0
  let modified  = 0
  let renamed   = 0
  let unchanged = 0

  // ── Pass 1: classify capabilities that exist in new manifest ──────────────
  for (const newCap of newCaps) {
    if (oldById.has(newCap.id)) {
      // Same id exists in both — check if anything changed
      const oldCap  = oldById.get(newCap.id)
      const changes = getFieldChanges(oldCap, newCap)

      if (changes.length === 0) {
        unchanged++
        if (includeUnchanged) {
          capabilities.push({
            type:    'unchanged',
            id:      newCap.id,
            name:    newCap.name,
            changes: [],
          })
        }
      } else {
        modified++
        capabilities.push({
          type:    'modified',
          id:      newCap.id,
          name:    newCap.name,
          changes,
        })
      }
    } else {
      // id not in old — could be added or renamed
      const renamedFrom = findRenamedMatch(newCap, oldCaps, newById)

      if (renamedFrom) {
        // Mark as renamed — will be removed from removed set in Pass 2
        renamed++
        capabilities.push({
          type:  'renamed',
          id:    newCap.id,
          oldId: renamedFrom.id,
          name:  newCap.name,
          changes: [],
        })
      } else {
        added++
        capabilities.push({
          type:    'added',
          id:      newCap.id,
          name:    newCap.name,
          changes: [],
        })
      }
    }
  }

  // ── Pass 2: find removed capabilities ─────────────────────────────────────
  // A capability is removed if its id is not in new AND it was not matched
  // as the source of a rename in Pass 1.
  const renamedOldIds = new Set(
    capabilities
      .filter(d => d.type === 'renamed')
      .map(d => d.oldId)
  )

  for (const oldCap of oldCaps) {
    if (!newById.has(oldCap.id) && !renamedOldIds.has(oldCap.id)) {
      removed++
      capabilities.push({
        type:    'removed',
        id:      oldCap.id,
        name:    oldCap.name,
        changes: [],
      })
    }
  }

  // ── Sort: added → modified → renamed → removed → unchanged ───────────────
  const ORDER = { added: 0, modified: 1, renamed: 2, removed: 3, unchanged: 4 }
  capabilities.sort((a, b) => (ORDER[a.type] ?? 5) - (ORDER[b.type] ?? 5))

  return {
    oldMeta:  extractMeta(oldManifest),
    newMeta:  extractMeta(newManifest),
    capabilities,
    added,
    removed,
    modified,
    renamed,
    unchanged,
    hasChanges: added + removed + modified + renamed > 0,
  }
}

// ─── Field Comparison ─────────────────────────────────────────────────────────

/**
 * Compare two capability objects field by field.
 * Returns an array of FieldChange for every field that differs.
 *
 * Fields compared:
 *   name, description, resolver.type, privacy.level,
 *   examples (order-insensitive), params (names, order-insensitive),
 *   returns (order-insensitive, v0.6+), lifecycle.status (v0.6+)
 */
function getFieldChanges(oldCap, newCap) {
  const changes = []

  const scalarFields = [
    ['name',             oldCap.name,                   newCap.name],
    ['description',      oldCap.description,            newCap.description],
    ['resolver.type',    oldCap.resolver?.type,          newCap.resolver?.type],
    ['privacy.level',    oldCap.privacy?.level,          newCap.privacy?.level],
    // lifecycle.status — optional in v0.6+. Absent treated as 'stable'.
    // A change from absent/stable → deprecated is surfaced explicitly so
    // developers see breaking deprecations in the diff output.
    ['lifecycle.status', oldCap.lifecycle?.status ?? null, newCap.lifecycle?.status ?? null],
  ]

  for (const [field, oldVal, newVal] of scalarFields) {
    if (normaliseScalar(oldVal) !== normaliseScalar(newVal)) {
      changes.push({ field, oldValue: oldVal ?? null, newValue: newVal ?? null })
    }
  }

  // Examples — compare as sorted arrays so order changes don't trigger a diff
  const oldExamples = sortedStrings(oldCap.examples)
  const newExamples = sortedStrings(newCap.examples)
  if (oldExamples !== newExamples) {
    changes.push({
      field:    'examples',
      oldValue: oldCap.examples ?? [],
      newValue: newCap.examples ?? [],
    })
  }

  // Params — compare names only, order-insensitive
  const oldParams = sortedStrings((oldCap.params ?? []).map(p => p.name))
  const newParams = sortedStrings((newCap.params ?? []).map(p => p.name))
  if (oldParams !== newParams) {
    changes.push({
      field:    'params',
      oldValue: (oldCap.params ?? []).map(p => p.name),
      newValue: (newCap.params ?? []).map(p => p.name),
    })
  }

  // Returns — required in v0.6+, order-insensitive.
  // Absent in pre-v0.6 manifests — treated as empty array, not a change.
  // Only fires when one side has returns and the other has different values.
  const oldReturns = sortedStrings(oldCap.returns ?? [])
  const newReturns = sortedStrings(newCap.returns ?? [])
  if (oldReturns !== newReturns) {
    changes.push({
      field:    'returns',
      oldValue: oldCap.returns ?? [],
      newValue: newCap.returns ?? [],
    })
  }

  return changes
}

// ─── Rename Detection ─────────────────────────────────────────────────────────

/**
 * Determine if a new capability is a rename of an old one.
 *
 * A rename is detected when all of these hold:
 *   1. The old capability's id is NOT in the new manifest (it disappeared)
 *   2. description matches exactly (strongest signal)
 *   3. resolver.type matches
 *
 * We intentionally use a conservative heuristic — a partial description
 * match would produce false positives on capabilities like "Navigate to cart"
 * and "Navigate to checkout".
 *
 * @param {object}   newCap   - the new capability with an unmatched id
 * @param {object[]} oldCaps  - full list of old capabilities
 * @param {Map}      newById  - new capabilities by id (to confirm old id is gone)
 * @returns {object|null} the matched old capability, or null
 */
function findRenamedMatch(newCap, oldCaps, newById) {
  for (const oldCap of oldCaps) {
    // Old id must not exist in new manifest — otherwise it's not renamed
    if (newById.has(oldCap.id)) continue

    const descriptionMatches = normaliseScalar(oldCap.description) ===
                               normaliseScalar(newCap.description)
    const resolverMatches    = oldCap.resolver?.type === newCap.resolver?.type

    if (descriptionMatches && resolverMatches) {
      return oldCap
    }
  }
  return null
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Normalise a manifest's capabilities array — filter invalid entries,
 * ensure required fields exist with safe defaults.
 */
function normaliseCaps(caps) {
  if (!Array.isArray(caps)) return []
  return caps
    .filter(c => c && typeof c.id === 'string' && c.id.trim() !== '')
    .map(c => ({
      id:          c.id.trim(),
      name:        c.name        ?? '',
      description: c.description ?? '',
      examples:    Array.isArray(c.examples) ? c.examples : [],
      params:      Array.isArray(c.params)   ? c.params   : [],
      returns:     Array.isArray(c.returns)  ? c.returns  : [],
      resolver:    c.resolver    ?? { type: 'unknown' },
      privacy:     c.privacy     ?? { level: 'unknown' },
      lifecycle:   c.lifecycle   ?? null,
    }))
}

/**
 * Extract manifest-level metadata for display.
 * schemaVersion: '1' for v0.6+ manifests, '' for pre-v0.6 (field absent).
 */
function extractMeta(manifest) {
  return {
    app:              manifest.app             ?? 'unknown',
    version:          manifest.version         ?? '',
    generatedAt:      manifest.generatedAt     ?? '',
    capabilityCount:  (manifest.capabilities ?? []).length,
    schemaVersion:    manifest.schemaVersion   ?? '',
  }
}

/**
 * Normalise a scalar value for comparison — trims strings, coerces null/undefined.
 */
function normaliseScalar(val) {
  if (val === null || val === undefined) return ''
  return String(val).trim()
}

/**
 * Serialise a string array to a canonical form for equality comparison.
 * Sorts alphabetically then joins with pipe.
 */
function sortedStrings(arr) {
  if (!Array.isArray(arr) || arr.length === 0) return ''
  return [...arr].map(s => String(s ?? '').trim()).sort().join('|')
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = { diffManifests }