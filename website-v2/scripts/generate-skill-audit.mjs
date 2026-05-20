#!/usr/bin/env node
/**
 * Regenerate website-v2/public/skill-audit.json from the live skill library.
 *
 * Runs at build time (wired into npm run prebuild) so every preview and
 * production deploy ships a fresh snapshot of the skill-hygiene audit.
 *
 * Delegates to python3 skills/skill-hygiene/scripts/audit_skill_library.py
 * with --no-persist (CI runs are stateless; the SQLite history is a local
 * developer concern, not a build artifact).
 */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const websiteRoot = resolve(here, '..')
const repoRoot = resolve(websiteRoot, '..')

const auditor = resolve(repoRoot, 'skills/skill-hygiene/scripts/audit_skill_library.py')
const skillsRoot = resolve(repoRoot, 'skills')
const snapshotPath = resolve(websiteRoot, 'public/skill-audit.json')

if (!existsSync(auditor)) {
  console.error(`[generate-skill-audit] auditor missing at ${auditor}`)
  console.error('  Skipping snapshot regeneration. The committed snapshot will be served as-is.')
  process.exit(0)
}

if (!existsSync(skillsRoot)) {
  console.error(`[generate-skill-audit] skills/ root missing at ${skillsRoot}`)
  console.error('  Skipping snapshot regeneration.')
  process.exit(0)
}

console.log(`[generate-skill-audit] regenerating ${snapshotPath}`)

const result = spawnSync(
  'python3',
  [
    auditor,
    '--root',
    skillsRoot,
    '--snapshot',
    snapshotPath,
    '--no-persist',
  ],
  {
    cwd: repoRoot,
    stdio: 'inherit',
  },
)

if (result.error) {
  console.error('[generate-skill-audit] failed to spawn python3:', result.error.message)
  process.exit(1)
}

// Exit code 1 means audit found drift. We still wrote a snapshot — the
// website should ship truth, including bad news. Treat 0 and 1 as success.
// Anything else (2 = malformed bundle, etc.) is a real build failure.
if (result.status !== 0 && result.status !== 1) {
  console.error(`[generate-skill-audit] auditor exited with status ${result.status}`)
  process.exit(result.status ?? 1)
}

console.log('[generate-skill-audit] snapshot regenerated.')
