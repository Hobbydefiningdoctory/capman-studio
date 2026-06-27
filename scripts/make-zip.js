#!/usr/bin/env node
const AdmZip = require('adm-zip');
const fs     = require('fs');
const path   = require('path');

// ── Exclusion list ─────────────────────────────────────────────────────────────

const EXCLUDE_NAMES = new Set([
  'node_modules',
  '.git',
  '.cache',
  '.local',
  '.agents',
  'exports',
]);

// Pattern-based exclusion for common secret-bearing files.
// Checked against BOTH the filename and the full relative path —
// catches cases like infra/prod_credentials.yaml where the filename
// alone would not match but the path segment would.
const SECRET_PATTERNS = [
  /^\.env(\.|$)/i,            // .env, .env.local, .env.production, .env.test
  /\.(pem|key|p12|pfx|p8)$/i, // TLS certs, SSH keys, PKCS keystores, Apple APNs
  /^secrets?\./i,              // secrets.json, secret.yaml, secrets.toml
  /^\.netrc$/,                 // curl / git credential store
  /^\.npmrc$/,                 // npm auth tokens
  /credentials(\.|$)/i,      // credentials.json, credentials.yaml, credentials (no ext)
  /gcp.*key/i,                 // GCP service account key files
  /firebase.*sdk/i,            // Firebase SDK config files
  /serviceaccount/i,           // service account JSON files
];

function shouldExclude(name, relPath) {
  if (EXCLUDE_NAMES.has(name)) return true;
  // Check both filename and full relative path so patterns fire on
  // path segments like infra/prod_credentials.yaml
  for (const pattern of SECRET_PATTERNS) {
    if (pattern.test(name) || pattern.test(relPath)) {
      console.warn(`  [warn] Skipping likely secret file: ${relPath}`);
      return true;
    }
  }
  return false;
}

// ── Build archive ──────────────────────────────────────────────────────────────

const OUT          = path.join('exports', 'capman-studio.zip');
const ROOT_IN_ZIP  = 'capman-studio';

fs.mkdirSync('exports', { recursive: true });
if (fs.existsSync(OUT)) fs.unlinkSync(OUT);

const zip = new AdmZip();

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    const rel  = path.relative('.', full);
    // Pass both filename and relative path — shouldExclude checks both
    if (shouldExclude(entry.name, rel)) continue;
    if (entry.isDirectory()) walk(full);
    else if (entry.isFile()) {
      zip.addLocalFile(full, path.join(ROOT_IN_ZIP, path.dirname(rel)));
    }
  }
}

walk('.');
zip.writeZip(OUT);

const size = fs.statSync(OUT).size;
console.log(`Wrote ${OUT} (${size} bytes, ${zip.getEntries().length} files)`);