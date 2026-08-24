#!/usr/bin/env node
/**
 * fleet-citation-scoreboard.mjs — per-ship citation accuracy, measured from the
 * comments the fleet actually posted, never from what ships claim about
 * themselves.
 *
 * WHY. A 2026-08-23 hand audit of 268 findings across five PRs measured 36
 * citations of paths that exist on no ref and 84 of 120 line citations landing
 * on unrelated code — and the two failure modes cluster by ship (qa and
 * code-reviewer emit real paths with wrong lines; the ideation ships emit
 * fabricated paths). apps/fleet-executor/src/citation-audit.ts now withholds
 * fabricated-path findings at post time; THIS script is the measurement half:
 * re-runnable, per ship, from primary sources, so citation reliability is a
 * number on a table rather than an impression re-derived by hand.
 *
 * WHAT IT CHECKS (objective only — same boundary as check-doc-citations.mjs):
 *   path-missing : the cited path exists nowhere in the checkout
 *   line-past-eof: the cited path exists and the cited line exceeds its length
 * Wrong-line-inside-the-file needs symbol-level judgement and stays a human
 * (or agent) task; this table is the floor, not the whole audit.
 *
 * USAGE
 *   node scripts/fleet-citation-scoreboard.mjs --pr 9224 --pr 9333 [--repo o/r]
 *   GH_TOKEN=... required. Run from a checkout containing the cited trees; for
 *   exactness check out each PR's head first — against another ref the table
 *   overcounts path-missing and says so in its caveat line.
 *
 * The pd-findings-json / pd-proposals-json machine blocks and the pd-ship
 * markers are the fleet's own posting format (findings-render.ts,
 * proposals.ts); this reads what they wrote verbatim.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const REPO_ROOT = process.cwd()

/**
 * Parse a machine block's payload. The stored form is plain JSON with `<`/`>`
 * as \u-escapes (machine-block.ts), which JSON.parse decodes natively — so
 * parse verbatim first. Some transports re-encode braces as HTML entities on
 * top; the fallback undoes exactly that, and only runs when the verbatim parse
 * failed, so a body string legitimately containing `&#123;` is never mangled.
 */
export function parseMachinePayload(raw) {
  try {
    return JSON.parse(raw)
  } catch {
    try {
      return JSON.parse(raw.replaceAll('&#123;', '{').replaceAll('&#125;', '}'))
    } catch {
      return null
    }
  }
}

/** Pull `{ ship, findings[], proposals[] }` records out of one comment body. */
export function extractShipRecords(body) {
  const shipMatch = body.match(/<!--\s*pd-ship:([a-z0-9-]+)\s*-->/i)
  if (!shipMatch) return null
  const ship = shipMatch[1]
  const records = { ship, findings: [], proposals: [] }
  const grab = (marker) => {
    const m = body.match(new RegExp(`<!--\\s*${marker}\\n([\\s\\S]*?)\\n-->`))
    return m ? parseMachinePayload(m[1]) : null
  }
  const findings = grab('pd-findings-json')
  if (Array.isArray(findings)) records.findings = findings
  const proposals = grab('pd-proposals-json')
  if (Array.isArray(proposals)) records.proposals = proposals
  return records
}

/** Path-shaped test, mirroring citation-audit.ts::isPathShaped. */
export function isPathShaped(cited) {
  const c = String(cited ?? '').trim()
  if (!c || /\s/.test(c)) return false
  if (c.includes('*') || c.includes('<') || c.includes('>')) return false
  return c.includes('/') || /\.[A-Za-z0-9]{1,8}$/.test(c)
}

export function bareCitedPath(cited) {
  return String(cited).trim().replace(/:\d+(?:-\d+)?$/, '')
}

/** Audit one ship's records against the local checkout. */
export function auditRecords(records, root = REPO_ROOT) {
  const row = {
    ship: records.ship,
    findings: records.findings.length,
    proposalCitations: 0,
    pathMissing: 0,
    linePastEof: 0,
    examples: [],
  }
  const note = (kind, detail) => {
    if (row.examples.length < 5) row.examples.push(`${kind}: ${detail}`)
  }
  for (const f of records.findings) {
    const p = String(f.path ?? '')
    if (!isPathShaped(p)) continue
    const abs = join(root, bareCitedPath(p))
    if (!existsSync(abs)) {
      row.pathMissing += 1
      note('path-missing', p)
      continue
    }
    const line = Number(f.line)
    if (Number.isFinite(line) && line > 0) {
      try {
        const count = readFileSync(abs, 'utf8').split('\n').length
        if (line > count) {
          row.linePastEof += 1
          note('line-past-eof', `${p}:${line} (file has ${count} lines)`)
        }
      } catch {
        /* unreadable file: not evidence either way */
      }
    }
  }
  for (const prop of records.proposals) {
    for (const cited of Array.isArray(prop.evidence) ? prop.evidence : []) {
      if (!isPathShaped(cited)) continue
      row.proposalCitations += 1
      if (!existsSync(join(root, bareCitedPath(cited)))) {
        row.pathMissing += 1
        note('path-missing', `${cited} (proposal "${String(prop.title ?? '').slice(0, 40)}")`)
      }
    }
  }
  return row
}

export function mergeRows(rows) {
  const byShip = new Map()
  for (const r of rows) {
    const agg = byShip.get(r.ship) ?? {
      ship: r.ship, findings: 0, proposalCitations: 0, pathMissing: 0, linePastEof: 0, examples: [],
    }
    agg.findings += r.findings
    agg.proposalCitations += r.proposalCitations
    agg.pathMissing += r.pathMissing
    agg.linePastEof += r.linePastEof
    agg.examples.push(...r.examples.slice(0, 5 - agg.examples.length))
    byShip.set(r.ship, agg)
  }
  return [...byShip.values()].sort((a, b) => b.pathMissing + b.linePastEof - (a.pathMissing + a.linePastEof))
}

function ghJson(url, token) {
  const out = execFileSync('curl', ['-sf', '-H', `Authorization: Bearer ${token}`, '-H', 'Accept: application/vnd.github+json', url], { encoding: 'utf8' })
  return JSON.parse(out)
}

function main() {
  const args = process.argv.slice(2)
  const prs = []
  let repo = null
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--pr') prs.push(Number(args[++i]))
    else if (args[i] === '--repo') repo = args[++i]
  }
  if (prs.length === 0) {
    console.error('usage: fleet-citation-scoreboard.mjs --pr <n> [--pr <n>...] [--repo owner/name]')
    process.exit(2)
  }
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN
  if (!token) {
    console.error('GH_TOKEN (or GITHUB_TOKEN) is required')
    process.exit(2)
  }
  if (!repo) {
    const url = execFileSync('git', ['remote', 'get-url', 'origin'], { encoding: 'utf8' }).trim()
    const m = url.match(/github\.com[:/]([^/]+\/[^/.]+)/)
    if (!m) { console.error('could not derive --repo from origin'); process.exit(2) }
    repo = m[1]
  }
  const rows = []
  for (const pr of prs) {
    for (let page = 1; page <= 5; page++) {
      const comments = ghJson(`https://api.github.com/repos/${repo}/issues/${pr}/comments?per_page=100&page=${page}`, token)
      for (const c of comments) {
        const rec = extractShipRecords(String(c.body ?? ''))
        if (rec) rows.push(auditRecords(rec))
      }
      if (comments.length < 100) break
    }
  }
  const merged = mergeRows(rows)
  console.log('\nFleet citation scoreboard — measured from posted comments')
  console.log('(caveat: paths are checked against THIS checkout; check out each PR head for exactness)\n')
  console.log('ship'.padEnd(22), 'findings', 'prop-cites', 'path-missing', 'line-past-eof')
  for (const r of merged) {
    console.log(r.ship.padEnd(22), String(r.findings).padEnd(8), String(r.proposalCitations).padEnd(10), String(r.pathMissing).padEnd(12), String(r.linePastEof))
  }
  const worst = merged.filter(r => r.pathMissing > 0)
  if (worst.length) {
    console.log('\nExamples:')
    for (const r of worst) for (const e of r.examples) console.log(`  [${r.ship}] ${e}`)
  }
}

// Import-safe: the CLI runs only when executed directly, so tests can import
// the audit functions without needing a token or network.
if (import.meta.url === `file://${process.argv[1]}`) main()
