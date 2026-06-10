#!/usr/bin/env node
/**
 * `review-pr` — invoke a Port Daddy fleet review on a pull request and post the
 * findings AS the app (`port-daddy[bot]`), one comment per ship, each carrying
 * its `[pd-<ship>]` identity, EDITED IN PLACE on re-run.
 *
 * This is the missing entrypoint between `lib/post-as.ts` (a library) and the
 * operator: post-as could already render a ship's identity, but nothing shipped
 * a way to actually *invoke* it, and `postAs` only ever *creates* a comment.
 * Re-running it would flood the PR with duplicate bot comments — violating the
 * fleet contract ("one comment per PR, edited in place; never N comments",
 * fleet/ships/code-reviewer.md). This binary closes both gaps.
 *
 * The review BODY for each ship is supplied by the caller (`--body-file`); the
 * fleet engine or an operator produces the findings, this binary frames +
 * posts them. Backend-agnostic by construction.
 *
 * Auth (see lib/auth.ts): GITHUB_APP_ID, GITHUB_APP_INSTALLATION_ID, and the
 * private key. The key may be supplied inline as GITHUB_APP_PRIVATE_KEY *or* as
 * a file path in GITHUB_PRIVATE_KEY_PATH (this runner bridges the latter to the
 * former). Values are never logged.
 *
 * Usage:
 *   review-pr --repo curiositech/port-daddy --pr 123 \
 *             --ship reviewer --body-file ./reviewer.md \
 *             --ship redteam  --body-file ./redteam.md
 *   review-pr ... --dry-run     # frame + print, no GitHub calls, no creds
 */

import { readFileSync } from 'node:fs'
import { DEFAULT_PORT_DADDY_SHIPS, frameBody, type ShipMeta } from '../lib/post-as.js'

/** GitHub hard-caps a comment at 65536 chars; leave headroom for framing. */
const MAX_BODY_CHARS = 60_000

interface Pair { shipHandle: string; bodyFile: string }

function parseArgs(argv: string[]): { repo: string; pr: number; pairs: Pair[]; dryRun: boolean } {
  let repo = ''
  let pr = 0
  let dryRun = false
  const ships: string[] = []
  const bodyFiles: string[] = []
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--repo') repo = argv[++i]
    else if (a === '--pr') pr = Number(argv[++i])
    else if (a === '--ship') ships.push(argv[++i])
    else if (a === '--body-file') bodyFiles.push(argv[++i])
    else if (a === '--dry-run') dryRun = true
    else throw new Error(`unknown arg: ${a}`)
  }
  if (!repo.includes('/')) throw new Error('--repo must be owner/name')
  if (!Number.isInteger(pr) || pr <= 0) throw new Error('--pr must be a positive integer')
  if (ships.length === 0) throw new Error('at least one --ship is required')
  if (ships.length !== bodyFiles.length) {
    throw new Error(`each --ship needs a --body-file (${ships.length} ships, ${bodyFiles.length} bodies)`)
  }
  return { repo, pr, dryRun, pairs: ships.map((s, i) => ({ shipHandle: s, bodyFile: bodyFiles[i] })) }
}

function resolveShip(handle: string): ShipMeta {
  const ship = DEFAULT_PORT_DADDY_SHIPS[handle]
  if (!ship) {
    throw new Error(
      `unknown ship '${handle}'. Known: ${Object.keys(DEFAULT_PORT_DADDY_SHIPS).join(', ')}. ` +
        `For a custom ship, extend the per-repo pd-fleet.yml roster.`,
    )
  }
  return ship
}

/**
 * Pre-read + validate EVERY body before any network call (atomic: a bad file
 * on ship #2 must not leave ship #1 already posted). Caps length so a runaway
 * body can never carry the app's identity onto a PR.
 */
function loadBodies(pairs: Pair[]): Array<{ ship: ShipMeta; body: string }> {
  return pairs.map(({ shipHandle, bodyFile }) => {
    const ship = resolveShip(shipHandle)
    let body: string
    try {
      body = readFileSync(bodyFile, 'utf8')
    } catch (e) {
      throw new Error(`--body-file for pd-${shipHandle} not readable: ${bodyFile} (${(e as Error).message})`)
    }
    if (!body.trim()) throw new Error(`--body-file for pd-${shipHandle} is empty: ${bodyFile}`)
    if (body.length > MAX_BODY_CHARS) {
      throw new Error(`--body-file for pd-${shipHandle} is ${body.length} chars (cap ${MAX_BODY_CHARS}); trim it`)
    }
    return { ship, body }
  })
}

/**
 * Fail closed on creds BEFORE touching GitHub, with messages that name the
 * exact missing var. Bridges GITHUB_PRIVATE_KEY_PATH → GITHUB_APP_PRIVATE_KEY
 * so an operator who stores the PEM as a file (the common case) just works.
 */
async function ensureCreds(): Promise<number> {
  const appId = process.env.GITHUB_APP_ID
  if (!appId || !/^\d+$/.test(appId)) throw new Error('GITHUB_APP_ID must be set to the numeric App ID')

  const installRaw = process.env.GITHUB_APP_INSTALLATION_ID
  const installationId = Number(installRaw)
  if (!installRaw || !Number.isInteger(installationId) || installationId <= 0) {
    throw new Error('GITHUB_APP_INSTALLATION_ID must be set to the numeric installation ID')
  }

  if (!process.env.GITHUB_APP_PRIVATE_KEY) {
    const path = process.env.GITHUB_PRIVATE_KEY_PATH
    if (!path) {
      throw new Error('Set GITHUB_APP_PRIVATE_KEY (inline PEM) or GITHUB_PRIVATE_KEY_PATH (file path to the PEM)')
    }
    try {
      process.env.GITHUB_APP_PRIVATE_KEY = readFileSync(path, 'utf8')
    } catch (e) {
      throw new Error(`GITHUB_PRIVATE_KEY_PATH set but unreadable: ${path} (${(e as Error).message})`)
    }
  }
  return installationId
}

/** Find this ship's existing comment by its rendered `**[pd-<handle>]**` header. */
function headerOf(ship: ShipMeta): string { return `**[pd-${ship.handle}]**` }

async function main() {
  const { repo, pr, pairs, dryRun } = parseArgs(process.argv.slice(2))
  const [owner, name] = repo.split('/')
  const loaded = loadBodies(pairs) // atomic: throws before any post

  if (dryRun) {
    for (const { ship, body } of loaded) {
      console.log(`\n===== WOULD UPSERT as pd-${ship.handle} on ${repo}#${pr} =====`)
      console.log(frameBody(ship, body))
    }
    return
  }

  const installationId = await ensureCreds()
  // Imported lazily so --dry-run needs neither creds nor the @octokit/* deps.
  const { getOctokitForInstallation } = await import('../lib/auth.js')
  const octokit = await getOctokitForInstallation(installationId)

  const existing: Array<{ id: number; body?: string }> = await octokit.paginate(
    octokit.issues.listComments,
    { owner, repo: name, issue_number: pr, per_page: 100 },
  )

  for (const { ship, body } of loaded) {
    const framed = frameBody(ship, body)
    const header = headerOf(ship)
    const prior = existing.find((c) => (c.body ?? '').startsWith(header))
    if (prior) {
      const r = await octokit.issues.updateComment({ owner, repo: name, comment_id: prior.id, body: framed })
      console.log(`edited  pd-${ship.handle} → ${r.data.html_url}`)
    } else {
      const r = await octokit.issues.createComment({ owner, repo: name, issue_number: pr, body: framed })
      console.log(`posted  pd-${ship.handle} → ${r.data.html_url}`)
    }
  }
}

main().catch((err) => {
  console.error(`[review-pr] ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
})
