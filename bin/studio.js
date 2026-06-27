#!/usr/bin/env node
'use strict'

const path = require('path')
const { command, c, log, header } = require('./lib/shared')

// ─── Router ───────────────────────────────────────────────────────────────────

switch (command) {
  case 'eval':
    // header() only prints when a valid command is actually running
    header()
    require('./lib/cmd-eval').cmdEval()
    break
  
  case 'diff':
    require('./lib/cmd-diff').cmdDiff()
    break
    
  case 'generate-suite':
    require('./lib/generate-suite').runGenerateSuite()
    break

  case 'watch':
    require('./lib/watch').runWatch()
    break

  case 'ci':
    require('./lib/ci').runCi()
    break

  case undefined:
  case '--help':
  case '-h':
    header()
    printHelp()
    break

  case '--version':
  case '-v': {
    const pkg = require(path.join(__dirname, '..', 'package.json'))
    console.log(pkg.version)
    process.exit(0)
  }

  default:
    // No header() on error — avoids banner noise before the error message
    log.error(`Unknown command: "${command}"`)
    log.hint('Run: capman-studio --help')
    process.exit(1)
}

// ─── Help ─────────────────────────────────────────────────────────────────────

function printHelp() {
  console.log(`  ${c.bold}Usage${c.reset}`)
  console.log()
  console.log(`  ${c.teal}capman-studio <command> [options]${c.reset}`)
  console.log()
  console.log(`  ${c.bold}Commands${c.reset}`)
  console.log()
  console.log(
    `  ${c.teal}eval${c.reset}` +
    `                        Manifest workbench`
  )
  console.log(
    `  ${c.gray}    --mode=inspect${c.reset}` +
    `         ${c.gray}Health summary (default)${c.reset}`
  )
  console.log(
    `  ${c.gray}    --mode=repl${c.reset}` +
    `            ${c.gray}Interactive query REPL${c.reset}`
  )
  console.log(
    `  ${c.gray}    --mode=suite${c.reset}` +
    `           ${c.gray}Batch suite runner${c.reset}`
  )
  console.log()
  console.log(
    `  ${c.teal}diff${c.reset}` +
    `                        Compare two manifest versions`
  )
  console.log(
    `  ${c.gray}    --verbose${c.reset}` +
    `              ${c.gray}Show per-field changes${c.reset}`
  )
  console.log(
    `  ${c.gray}    --unchanged${c.reset}` +
    `            ${c.gray}Include unchanged capabilities${c.reset}`
  )
  console.log()
  console.log(
    `  ${c.teal}generate-suite${c.reset}` +
    `              Scaffold a starter suite file from manifest`
  )
  console.log(
    `  ${c.gray}    --out <path>${c.reset}` +
    `           ${c.gray}Output path (default: eval-suite.json)${c.reset}`
  )
  console.log(
    `  ${c.gray}    --overwrite${c.reset}` +
    `            ${c.gray}Replace existing output file${c.reset}`
  )
  console.log()
  console.log(
    `  ${c.teal}watch${c.reset}` +
    `                       Watch manifest for changes, re-run on edit`
  )
  console.log(
    `  ${c.gray}    --suite <path>${c.reset}` +
    `         ${c.gray}Re-run suite instead of inspect${c.reset}`
  )
  console.log(
    `  ${c.gray}    --threshold <1-100>${c.reset}` +
    `    ${c.gray}Quality gate for suite mode${c.reset}`
  )
  console.log()
  console.log(
    `  ${c.teal}ci${c.reset}` +
    `                          Validate + suite + threshold in one command`
  )
  console.log(
    `  ${c.gray}    --suite <path>${c.reset}` +
    `         ${c.gray}Suite file to run (required)${c.reset}`
  )
  console.log(
    `  ${c.gray}    --threshold <1-100>${c.reset}` +
    `    ${c.gray}Fail if pass rate drops below this value${c.reset}`
  )
  console.log()
  console.log(`  ${c.bold}Meta${c.reset}`)
  console.log()
  console.log(`  ${c.teal}--version${c.reset}  ${c.gray}-v   Print version and exit${c.reset}`)
  console.log(`  ${c.teal}--help${c.reset}     ${c.gray}-h   Show this message${c.reset}`)
  console.log()
  console.log(`  ${c.bold}Options${c.reset}`)
  console.log()
  console.log(`  ${c.gray}--manifest <path>    Use a non-default manifest.json${c.reset}`)
  console.log(`  ${c.gray}--suite <path>       Suite file path (required for --mode=suite)${c.reset}`)
  console.log(`  ${c.gray}--out <path>         Output path for generate-suite (default: eval-suite.json)${c.reset}`)
  console.log(`  ${c.gray}--timeout <ms>       Subprocess timeout in ms (default: 5000)${c.reset}`)
  console.log(`  ${c.gray}--threshold <1-100>  Fail if pass rate drops below this value (suite only)${c.reset}`)
  console.log(`  ${c.gray}--overwrite          Replace existing output file (generate-suite only)${c.reset}`)
  console.log(`  ${c.gray}--json               Machine-readable JSON output${c.reset}`)
  console.log()
  console.log(`  ${c.bold}Examples${c.reset}`)
  console.log()
  console.log(`  ${c.gray}$ capman-studio eval${c.reset}`)
  console.log(`  ${c.gray}$ capman-studio eval --mode=repl${c.reset}`)
  console.log(`  ${c.gray}$ capman-studio eval --mode=suite --suite cases.json${c.reset}`)
  console.log(`  ${c.gray}$ capman-studio eval --json${c.reset}`)
  console.log(`  ${c.gray}$ capman-studio eval --manifest other-manifest.json${c.reset}`)
  console.log(`  ${c.gray}$ capman-studio eval --mode=suite --suite cases.json --threshold=80${c.reset}`)
  console.log()
  console.log(`  ${c.gray}$ capman-studio diff manifest-v1.json manifest-v2.json${c.reset}`)
  console.log(`  ${c.gray}$ capman-studio diff manifest-v1.json manifest-v2.json --verbose${c.reset}`)
  console.log(`  ${c.gray}$ capman-studio diff manifest-v1.json manifest-v2.json --json${c.reset}`)
  console.log()
  console.log(`  ${c.gray}$ capman-studio generate-suite${c.reset}`)
  console.log(`  ${c.gray}$ capman-studio generate-suite --out my-suite.json${c.reset}`)
  console.log(`  ${c.gray}$ capman-studio generate-suite --manifest other.json --overwrite${c.reset}`)
  console.log()
  console.log(`  ${c.gray}$ capman-studio watch${c.reset}`)
  console.log(`  ${c.gray}$ capman-studio watch --suite cases.json${c.reset}`)
  console.log(`  ${c.gray}$ capman-studio watch --suite cases.json --threshold=80${c.reset}`)
  console.log()
  console.log(`  ${c.gray}$ capman-studio ci --suite cases.json${c.reset}`)
  console.log(`  ${c.gray}$ capman-studio ci --suite cases.json --threshold=80${c.reset}`)
  console.log(`  ${c.gray}$ capman-studio ci --suite cases.json --threshold=80 --json${c.reset}`)
  console.log()
}