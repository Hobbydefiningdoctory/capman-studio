'use strict'

const { c, log, getFlag } = require('./shared')

/**
 * eval command router.
 *
 * Reads --mode flag and dispatches to the correct eval sub-module.
 * Contains no logic of its own.
 *
 * Modes:
 *   inspect (default)  →  eval/eval-inspect.js
 *   repl               →  eval/eval-repl.js
 *   suite              →  eval/eval-suite.js
 *
 * Called by: bin/studio.js
 */
function cmdEval() {
  const mode = getFlag('--mode') ?? 'inspect'

  switch (mode) {
    case 'inspect':
      require('./eval/eval-inspect').runInspect()
      break

    case 'repl':
      require('./eval/eval-repl').runRepl()
      break

    case 'suite':
      require('./eval/eval-suite').runSuite()
      break

    default:
      log.error(`Unknown eval mode: "${mode}"`)
      console.log()
      console.log(`  ${c.gray}Available modes:${c.reset}`)
      console.log(`  ${c.teal}--mode=inspect${c.reset}  ${c.gray}Manifest health summary (default)${c.reset}`)
      console.log(`  ${c.teal}--mode=repl${c.reset}     ${c.gray}Interactive query REPL${c.reset}`)
      console.log(`  ${c.teal}--mode=suite${c.reset}    ${c.gray}Batch suite runner  (requires --suite <path>)${c.reset}`)
      console.log()
      process.exit(1)
  }
}

module.exports = { cmdEval }