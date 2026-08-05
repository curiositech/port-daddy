#!/usr/bin/env node
/**
 * Relay migration gate (ADR-0119): staging-first, enforced.
 *
 * The staging ledger (apps/relay/migrations/applied-staging.json) is the
 * CI-owned record of which migration files have been applied to the STAGING
 * D1 database. This script has two modes:
 *
 *   --check (default)  Exit 0 iff EVERY .sql file in apps/relay/migrations/
 *                      appears in the ledger; exit 1 (listing the missing
 *                      files) otherwise. Run by deploy-relay-prod.yml BEFORE
 *                      anything touches production — a migration that has not
 *                      been applied to staging cannot ship to prod.
 *
 *   --record           Add every not-yet-recorded .sql file to the ledger
 *                      (with an appliedAt timestamp) and write it back. Run
 *                      by deploy-relay.yml AFTER a successful
 *                      `wrangler d1 migrations apply … --env latest --remote`,
 *                      then committed to main by the workflow. Idempotent:
 *                      prints "ledger unchanged" and exits 0 when there is
 *                      nothing new.
 *
 * Both modes are pure filesystem — no Cloudflare API calls — so the gate is
 * exactly as honest as the ledger. The ledger is CI-owned by convention
 * (see apps/relay/migrations/README.md): hand-edits are how you lie to this
 * gate, so don't.
 *
 * Tests: scripts/check-migrations-gate.test.mjs (node --test). The core is
 * exported as pure functions over (migrationFiles, ledgerObject) so the tests
 * never touch the real tree.
 */

import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

export const MIGRATIONS_DIR = 'apps/relay/migrations'
export const LEDGER_FILE = 'applied-staging.json'

/** List the migration .sql files (sorted — lexicographic = application order). */
export function listMigrationFiles(dir) {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
}

/**
 * Parse the ledger object into the set of recorded filenames. Tolerates a
 * missing/empty `applied` array (=> empty set) but throws on a structurally
 * wrong document — a corrupt ledger must FAIL the gate, not pass it.
 */
export function ledgerFiles(ledger) {
  if (ledger === null || typeof ledger !== 'object' || Array.isArray(ledger)) {
    throw new Error('ledger is not an object')
  }
  const applied = ledger.applied ?? []
  if (!Array.isArray(applied)) throw new Error('ledger "applied" is not an array')
  const files = new Set()
  for (const entry of applied) {
    if (entry === null || typeof entry !== 'object' || typeof entry.file !== 'string') {
      throw new Error('ledger "applied" entry is malformed (expected { file: string, ... })')
    }
    files.add(entry.file)
  }
  return files
}

/**
 * The gate: which migration files are NOT recorded in the ledger?
 * Empty array ⇒ prod deploy may proceed.
 */
export function missingFromLedger(migrationFiles, ledger) {
  const recorded = ledgerFiles(ledger)
  return migrationFiles.filter((f) => !recorded.has(f))
}

/**
 * --record: return a new ledger object with every missing file appended
 * (stable order: existing entries first, new files in sorted order), or null
 * when nothing is missing (ledger unchanged).
 */
export function recordMissing(migrationFiles, ledger, now = new Date()) {
  const missing = missingFromLedger(migrationFiles, ledger)
  if (missing.length === 0) return null
  const appliedAt = now.toISOString().replace(/\.\d{3}Z$/, 'Z')
  return {
    ...ledger,
    applied: [
      ...(ledger.applied ?? []),
      ...missing.map((file) => ({ file, appliedAt })),
    ],
  }
}

function main() {
  const mode = process.argv.includes('--record') ? 'record' : 'check'
  // Repo root = two levels up from scripts/ regardless of cwd.
  const root = join(dirname(fileURLToPath(import.meta.url)), '..')
  const dir = join(root, MIGRATIONS_DIR)
  const ledgerPath = join(dir, LEDGER_FILE)

  const migrationFiles = listMigrationFiles(dir)

  let ledger
  try {
    ledger = JSON.parse(readFileSync(ledgerPath, 'utf8'))
  } catch (err) {
    console.error(`✗ MIGRATION GATE — cannot read ledger ${ledgerPath}: ${err.message}`)
    process.exit(1)
  }

  let missing
  try {
    missing = missingFromLedger(migrationFiles, ledger)
  } catch (err) {
    console.error(`✗ MIGRATION GATE — malformed ledger ${ledgerPath}: ${err.message}`)
    process.exit(1)
  }

  if (mode === 'record') {
    const updated = recordMissing(migrationFiles, ledger)
    if (updated === null) {
      console.log('migration-gate: ledger unchanged (all migrations already recorded)')
      return
    }
    writeFileSync(ledgerPath, JSON.stringify(updated, null, 2) + '\n')
    console.log(`migration-gate: recorded ${missing.length} migration(s) in ${LEDGER_FILE}:`)
    for (const f of missing) console.log(`  + ${f}`)
    return
  }

  if (missing.length > 0) {
    console.error('✗ MIGRATION GATE — prod deploy blocked (ADR-0119: staging first).')
    console.error(`  ${missing.length} migration(s) in ${MIGRATIONS_DIR}/ have not been applied to staging:`)
    for (const f of missing) console.error(`    - ${f}`)
    console.error('  Merge to main first: deploy-relay.yml applies them to the staging D1 and')
    console.error(`  records them in ${MIGRATIONS_DIR}/${LEDGER_FILE}. Then re-tag the release.`)
    process.exit(1)
  }
  console.log(
    `✓ migration-gate: all ${migrationFiles.length} migration(s) recorded as applied to staging`,
  )
}

// Run main() only when executed directly (not when imported by the tests).
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main()
}
