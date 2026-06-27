'use strict'

const readline = require('readline')
const { c, log, runCapman, getFlag, hasFlag, parseTimeout, confidenceColor, stripAnsi, validateManifestPath } = require('../shared')

/**
 * REPL mode — interactive query loop.
 *
* Each query calls: capman explain <query> --json
 * Renders match result, trace, boost, latency, and top candidates.
 *
 * Called by: cmd-eval.js when --mode=repl
 */
  function runRepl() {
    const manifestFlag = getFlag('--manifest')
    const timeoutVal   = parseTimeout(getFlag('--timeout'))

    // S-3: restrict --manifest to CWD — consistent with --suite protection.
    // Prevents path traversal via a crafted --manifest flag in automated invocations.
    if (manifestFlag) validateManifestPath(manifestFlag)

  printReplHeader()

  const rl = readline.createInterface({
    input:  process.stdin,
    output: process.stdout,
  })

  // ── Graceful exit ──────────────────────────────────────────────────────────
  rl.on('close', () => {
    console.log()
    console.log(`  ${c.gray}Session ended.${c.reset}`)
    console.log()
    process.exit(0)
  })

  // ── Prompt loop ────────────────────────────────────────────────────────────
  function prompt() {
    rl.question(`  ${c.teal}▶${c.reset}  `, (input) => {
      const query = input.trim()

      if (!query) {
        prompt()
        return
      }

      // F-01 partial: guard against oversized input.
      // Prevents argument buffer abuse from paste or scripted input.
      if (query.length > 512) {
        console.log()
        console.log(`  ${c.yellow}⚠${c.reset}  ${c.gray}Query too long (${query.length} chars, max 512). Please shorten it.${c.reset}`)
        console.log()
        prompt()
        return
      }

      // ── REPL commands ──────────────────────────────────────────────────────
      if (query === '.exit' || query === '.quit') {
        rl.close()
        return
      }

      if (query === '.help') {
        printHelp()
        prompt()
        return
      }

      if (query === '.inspect') {
        // Pass manifestFlag explicitly — do not rely on global process.argv.
        // If runInspect() is ever refactored to accept a path parameter,
        // this prevents a silent fallback to the wrong manifest.
        const { runInspect } = require('./eval-inspect')
        runInspect({ manifestOverride: manifestFlag })
        prompt()
        return
      }

      if (query === '.clear') {
        process.stdout.write('\x1Bc')
        printReplHeader()
        prompt()
        return
      }

      // ── Run query ──────────────────────────────────────────────────────────
      const capmanArgs = ['--json']
      if (manifestFlag) capmanArgs.push('--manifest', manifestFlag)

      const result = runCapman({
        command: 'explain',
        query,
        args:    capmanArgs,
        timeout: timeoutVal,
      })

      if (!result.ok) {
        renderError(result.error)
        prompt()
        return
      }

      renderTrace(result.data, query)
      prompt()
    })
  }

  prompt()
}

// ─── Renderers ────────────────────────────────────────────────────────────────

function renderTrace(data, query) {
  if (!data) {
    log.warn('capman returned empty data for this query.')
    console.log()
    return
  }

  console.log()

    // ── Match result ───────────────────────────────────────────────────────────
    // All fields sourced from capman JSON are sanitised via stripAnsi before
    // rendering — prevents terminal injection from a malicious/malformed manifest.
    const matched     = data.matched
    const rawConf     = matched?.confidence
    const confidence  = Number.isFinite(Number(rawConf))
      ? Math.max(0, Math.min(100, Math.round(Number(rawConf))))
      : 0
    const capId       = matched?.capability?.id ? stripAnsi(matched.capability.id) : null
    const intent      = stripAnsi(matched?.intent ?? '')
    const durationMs  = data.durationMs ?? 0
    const resolvedVia = stripAnsi(data.resolvedVia ?? '')

    if (capId) {
      const confColor = confidenceColor(confidence)
      console.log(
        `  ${c.teal}→${c.reset}  ${c.bold}${capId}${c.reset}` +
        `  ${confColor}${confidence}%${c.reset}` +
        `  ${c.gray}${intent}${c.reset}`
      )
  } else {
    console.log(
      `  ${c.yellow}○${c.reset}  ${c.bold}OUT_OF_SCOPE${c.reset}` +
      `  ${c.gray}no capability matched${c.reset}`
    )
  }

  // ── Boost + Latency ────────────────────────────────────────────────────────
  const boost = matched?.boost ?? null
  const boostStr = boost !== null && boost !== undefined
    ? `Boost: ${boost >= 0 ? '+' : ''}${boost}`
    : null

  const latencyStr = `Latency: ${durationMs}ms`
  const via        = resolvedVia ? `· ${c.gray}${resolvedVia}${c.reset}` : ''

  const metaParts = [boostStr, latencyStr].filter(Boolean)
  console.log(`  ${c.gray}${metaParts.join('  ·  ')}  ${via}${c.reset}`)
  console.log()

  // ── Reasoning ─────────────────────────────────────────────────────────────
  if (matched?.reasoning?.length) {
    for (const r of matched.reasoning) {
      console.log(`  ${c.gray}${stripAnsi(r)}${c.reset}`)
    }
    console.log()
  }

  // ── Top candidates ─────────────────────────────────────────────────────────
  const candidates = data.candidates ?? []

  if (candidates.length > 0) {
    console.log(`  ${c.gray}Top matches:${c.reset}`)

    const sorted = [...candidates]
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)

    for (const cand of sorted) {
        const candId     = stripAnsi(cand.capabilityId ?? '')
        const isMatch    = candId === capId
        const marker     = isMatch ? `${c.teal}✓${c.reset}` : `${c.gray}○${c.reset}`
        const idPadded   = candId.padEnd(30)
        const scoreColor = confidenceColor(cand.score ?? 0)
        const score      = String(cand.score ?? 0).padStart(3)
        const expl       = cand.explanation
          ? `  ${c.gray}${stripAnsi(cand.explanation)}${c.reset}`
          : ''

      console.log(
        `  ${marker}  ${idPadded}` +
        `  ${scoreColor}${score}%${c.reset}` +
        `${expl}`
      )
    }

    console.log()
  }

  // ── Would execute ──────────────────────────────────────────────────────────
  const wouldExecute = data.wouldExecute
  if (wouldExecute?.blocked) {
    console.log(`  ${c.yellow}✗${c.reset}  Blocked — ${c.gray}${stripAnsi(wouldExecute.blocked)}${c.reset}`)
    console.log()
  } else if (wouldExecute?.action) {
    const privacy = wouldExecute.privacy
      ? `  ${c.gray}[${stripAnsi(wouldExecute.privacy)}]${c.reset}`
      : ''
    console.log(`  ${c.green}→${c.reset}  ${stripAnsi(wouldExecute.action)}${privacy}`)
    console.log()
  }
}

function renderError(errorMsg) {
  console.log()
  console.log(`  ${c.red}✗${c.reset}  ${stripAnsi(String(errorMsg))}`)
  console.log()
}

// ─── UI ───────────────────────────────────────────────────────────────────────

function printReplHeader() {
  console.log(`  ${c.bold}QUERY REPL${c.reset}`)
  console.log(`  ${c.gray}Type a query and press Enter. Type .help for commands.${c.reset}`)
  console.log()
}

function printHelp() {
  console.log()
  console.log(`  ${c.bold}REPL Commands${c.reset}`)
  console.log()
  console.log(`  ${c.teal}.inspect${c.reset}   Re-print manifest health summary`)
  console.log(`  ${c.teal}.clear${c.reset}     Clear the terminal`)
  console.log(`  ${c.teal}.help${c.reset}      Show this message`)
  console.log(`  ${c.teal}.exit${c.reset}      Exit the REPL`)
  console.log(`  ${c.gray}Ctrl+C${c.reset}     Exit the REPL`)
  console.log()
  console.log(`  ${c.gray}Flags:${c.reset}`)
  console.log(`  ${c.gray}--manifest <path>   Use a non-default manifest${c.reset}`)
  console.log(`  ${c.gray}--timeout <ms>      Override subprocess timeout (default: 5000)${c.reset}`)
  console.log()
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = { runRepl }