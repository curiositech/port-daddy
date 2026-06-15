#!/usr/bin/env node
/**
 * `harbor-pilot` — sweep every open PR in a repo and execute the pilot's
 * decisions (see lib/harbor-pilot.ts for the rules and their rationale).
 *
 * Auth: prefers the Fleet GitHub App (GITHUB_APP_ID + private key +
 * installation id, via lib/auth.ts) so every action is attributed to the App
 * identity, not a personal token. Falls back to GH_TOKEN / GITHUB_TOKEN for
 * local runs and dry-runs.
 *
 * Supersession probe: for each file the PR changes, compare the git blob SHA
 * at the PR head against the blob SHA at the base head. Equal SHA means
 * byte-identical content. A file the PR deletes counts as identical when the
 * path is absent on base. Any probe failure (truncated file list, API error)
 * yields parity=null, which the decision layer treats as "leave it alone" —
 * uncertainty never demotes.
 *
 * Usage:
 *   harbor-pilot --repo curiositech/port-daddy            # execute
 *   harbor-pilot --repo curiositech/port-daddy --dry-run  # decide + print only
 */

import { Octokit } from '@octokit/rest'
import {
  HARBOR_PILOT_SHIP,
  PILOT_COMMENT_MARKER,
  SUPERSEDED_LABEL,
  conflictComment,
  decide,
  renderDigest,
  supersededComment,
  type FileParity,
  type PilotResult,
  type PRSnapshot,
} from '../lib/harbor-pilot.js'
import { frameBody } from '../lib/post-as.js'

/** Above this many changed files the parity probe is skipped (parity=null). */
const MAX_PARITY_FILES = 300

function parseArgs(argv: string[]): { repo: string; dryRun: boolean } {
  let repo = ''
  let dryRun = false
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--repo') repo = argv[++i] ?? ''
    else if (argv[i] === '--dry-run') dryRun = true
    else {
      console.error(`unknown argument: ${argv[i]}`)
      process.exit(2)
    }
  }
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) {
    console.error('usage: harbor-pilot --repo <owner>/<name> [--dry-run]')
    process.exit(2)
  }
  return { repo, dryRun }
}

async function makeOctokit(): Promise<Octokit> {
  if (process.env.GITHUB_APP_ID) {
    const { getOctokitForInstallation } = await import('../lib/auth.js')
    return getOctokitForInstallation()
  }
  const token = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN
  if (!token) {
    throw new Error('no auth: set GITHUB_APP_ID (+ key, installation) or GH_TOKEN')
  }
  return new Octokit({ auth: token })
}

/** Blob SHA of `path` at `ref`, or null when the path does not exist there. */
async function blobShaAt(
  octokit: Octokit,
  owner: string,
  repo: string,
  path: string,
  ref: string,
): Promise<string | null> {
  try {
    const { data } = await octokit.repos.getContent({ owner, repo, path, ref })
    if (Array.isArray(data)) return null // path is a directory — not a file change we can compare
    return data.sha
  } catch (err: any) {
    if (err?.status === 404) return null
    throw err
  }
}

async function computeParity(
  octokit: Octokit,
  owner: string,
  repo: string,
  prNumber: number,
  headRef: string,
  baseRef: string,
): Promise<FileParity | null> {
  try {
    const files = await octokit.paginate(octokit.pulls.listFiles, {
      owner,
      repo,
      pull_number: prNumber,
      per_page: 100,
    })
    if (files.length === 0 || files.length > MAX_PARITY_FILES) return null
    let identical = 0
    for (const f of files) {
      if (f.status === 'removed') {
        // The PR deletes this path. It is "already applied" iff base also lacks it.
        const baseSha = await blobShaAt(octokit, owner, repo, f.filename, baseRef)
        if (baseSha === null) identical++
        continue
      }
      // For renames the new path carries the content; previous_filename's
      // disappearance is implied when the new path matches on base.
      const baseSha = await blobShaAt(octokit, owner, repo, f.filename, baseRef)
      if (baseSha !== null && baseSha === f.sha) identical++
    }
    return { total: files.length, identical }
  } catch {
    return null // uncertainty never demotes
  }
}

/** Create-or-edit the pilot's single comment on a PR (never stacks). */
async function upsertPilotComment(
  octokit: Octokit,
  owner: string,
  repo: string,
  prNumber: number,
  body: string,
): Promise<void> {
  const framed = frameBody(HARBOR_PILOT_SHIP, body)
  const comments = await octokit.paginate(octokit.issues.listComments, {
    owner,
    repo,
    issue_number: prNumber,
    per_page: 100,
  })
  const existing = comments.find((c) => c.body?.includes(PILOT_COMMENT_MARKER))
  if (existing) {
    await octokit.issues.updateComment({ owner, repo, comment_id: existing.id, body: framed })
  } else {
    await octokit.issues.createComment({ owner, repo, issue_number: prNumber, body: framed })
  }
}

async function enableMergeWhenReady(octokit: Octokit, prNodeId: string): Promise<void> {
  await octokit.graphql(
    `mutation($prId: ID!) {
      enablePullRequestAutoMerge(input: { pullRequestId: $prId, mergeMethod: SQUASH }) {
        pullRequest { number }
      }
    }`,
    { prId: prNodeId },
  )
}

async function convertToDraft(octokit: Octokit, prNodeId: string): Promise<void> {
  await octokit.graphql(
    `mutation($prId: ID!) {
      convertPullRequestToDraft(input: { pullRequestId: $prId }) {
        pullRequest { number }
      }
    }`,
    { prId: prNodeId },
  )
}

async function main(): Promise<void> {
  const { repo: repoFull, dryRun } = parseArgs(process.argv.slice(2))
  const [owner, repo] = repoFull.split('/')
  const octokit = await makeOctokit()

  const prs = await octokit.paginate(octokit.pulls.list, {
    owner,
    repo,
    state: 'open',
    per_page: 100,
  })

  const results: PilotResult[] = []
  for (const pr of prs) {
    // pulls.list omits mergeable_state; fetch the full object per PR.
    const { data: full } = await octokit.pulls.get({ owner, repo, pull_number: pr.number })
    const labels = (full.labels ?? []).map((l) => (typeof l === 'string' ? l : (l.name ?? '')))
    const isDraft = Boolean(full.draft)
    const needsParity = !isDraft && !labels.includes(SUPERSEDED_LABEL)
    const snapshot: PRSnapshot = {
      number: full.number,
      title: full.title,
      isDraft,
      mergeableState: full.mergeable_state ?? 'unknown',
      autoMergeEnabled: full.auto_merge != null,
      labels,
      fileParity: needsParity
        ? await computeParity(octokit, owner, repo, full.number, full.head.sha, full.base.ref)
        : null,
    }
    const action = decide(snapshot)
    const result: PilotResult = { number: full.number, title: full.title, action, executed: false }

    if (!dryRun && action.kind !== 'leave') {
      try {
        if (action.kind === 'arm') {
          await enableMergeWhenReady(octokit, full.node_id)
        } else if (action.kind === 'flag-conflict') {
          await upsertPilotComment(octokit, owner, repo, full.number, conflictComment())
        } else if (action.kind === 'demote-superseded') {
          await convertToDraft(octokit, full.node_id)
          await octokit.issues.addLabels({
            owner,
            repo,
            issue_number: full.number,
            labels: [SUPERSEDED_LABEL],
          })
          await upsertPilotComment(
            octokit,
            owner,
            repo,
            full.number,
            supersededComment(snapshot.fileParity!),
          )
        }
        result.executed = true
      } catch (err: any) {
        result.error = err?.message ?? String(err)
      }
    }
    results.push(result)
  }

  console.log(renderDigest(repoFull, results, dryRun))
  const failed = results.filter((r) => !dryRun && r.action.kind !== 'leave' && !r.executed)
  process.exit(failed.length > 0 ? 1 : 0)
}

main().catch((err) => {
  console.error(`[harbor-pilot] fatal: ${err?.message ?? err}`)
  process.exit(1)
})
