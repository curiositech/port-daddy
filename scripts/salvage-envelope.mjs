#!/usr/bin/env node
// Prototype: build a salvage "resume envelope" for a dead agent.
//
// Joins the salvage entry (sparse) with its session row (rich), claimed files,
// timestamped notes, and (where present) the last known git ref + worktree.
// Writes a self-contained packet to .scratch/salvage-envelope-<agentId>/ and
// prints a gap report listing the fields that have no source today.
//
// Usage:
//   node scripts/salvage-envelope.mjs <agentId>
//   node scripts/salvage-envelope.mjs --first   # pick the first pending salvage
//   node scripts/salvage-envelope.mjs --gap-report   # gap report across all 331 entries

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
// Run under tsx so this resolver import resolves: npx tsx scripts/salvage-envelope.mjs
import { resolveDaemonUrl } from '../shared/daemon-discovery.js';

const DAEMON = process.env.PD_URL || resolveDaemonUrl();

async function fetchJson(path) {
  const res = await fetch(`${DAEMON}${path}`);
  if (!res.ok) throw new Error(`${path} -> ${res.status}`);
  return res.json();
}

function gapsForEntry(entry, session, files, notes) {
  const gaps = [];
  const have = (label, present) => present || gaps.push(label);

  have('telos (session.purpose non-null)', !!session?.purpose);
  have('worktreeId (session.worktreeId)', !!session?.worktreeId);
  have('claimed files with symbol granularity', files.some(f => f.symbol || f.startLine));
  have('any claimed files', files.length > 0);
  have('any timestamped notes', notes.length > 0);
  have('last action / breadcrumb (most recent note within 30s of death)', (() => {
    if (!notes.length) return false;
    const lastNoteTs = Math.max(...notes.map(n => n.createdAt ?? 0));
    return Math.abs((entry.staleSince ?? 0) - lastNoteTs) < 30_000;
  })());
  have('git ref at death (NOT IN SCHEMA)', false);
  have('stash/diff snapshot at death (NOT IN SCHEMA)', false);
  have('transcript / conversation log (HARNESS-SIDE, NOT IN PD)', false);
  have('adjacency: overlapping live sessions at death (NOT IN SCHEMA)', false);
  have('cause of death: timeout vs crash vs displaced (NOT EXPLICIT)', !!session?.terminationReason);
  return gaps;
}

function buildEnvelope(entry, session, files, notes) {
  return {
    agentId: entry.id,
    capturedAt: Date.now(),
    identity: {
      project: entry.identityProject,
      stack: entry.identityStack,
      context: entry.identityContext,
    },
    telos: session?.purpose ?? entry.name ?? null,
    sessionId: entry.sessionId,
    sessionPhase: session?.phase ?? null,
    sessionStatus: session?.status ?? null,
    worktreeId: session?.worktreeId ?? null,
    lastHeartbeat: entry.lastHeartbeat,
    staleSince: entry.staleSince,
    secondsSinceDeath: Math.round((Date.now() - (entry.staleSince ?? Date.now())) / 1000),
    claims: files.map(f => ({
      file: f.filePath,
      startLine: f.startLine,
      endLine: f.endLine,
      symbol: f.symbol,
      symbolPath: f.symbolPath,
      claimedAt: f.claimedAt,
      releasedAt: f.releasedAt,
    })),
    notes: notes.map(n => ({
      ts: n.createdAt,
      kind: n.kind ?? 'note',
      content: n.content,
    })),
    inferredBreadcrumb: notes.length
      ? notes.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))[0].content
      : null,
    resumeContract: {
      telosNonNull: !!session?.purpose,
      breadcrumbExists: notes.length > 0,
      diffReplayable: false,
      adjacencyKnown: false,
    },
    contractCompliant: false,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const wantGapReport = args.includes('--gap-report');
  const wantFirst = args.includes('--first');
  const targetId = args.find(a => a.startsWith('agent-'));

  const pending = await fetchJson('/resurrection/pending');
  const agents = pending.agents ?? [];

  if (wantGapReport) {
    const summary = { total: agents.length, gapsByLabel: {} };
    for (const e of agents) {
      let session = null, files = [], notes = [];
      try {
        const s = await fetchJson(`/sessions/${e.sessionId}`);
        session = s.session;
        files = s.files ?? [];
        notes = s.notes ?? [];
      } catch {}
      const gaps = gapsForEntry(e, session, files, notes);
      for (const g of gaps) {
        summary.gapsByLabel[g] = (summary.gapsByLabel[g] ?? 0) + 1;
      }
    }
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  let entry;
  if (targetId) entry = agents.find(a => a.id === targetId);
  else if (wantFirst) entry = agents[0];
  if (!entry) {
    console.error('Specify agent-XXXX or --first or --gap-report');
    process.exit(2);
  }

  let session = null, files = [], notes = [];
  try {
    const s = await fetchJson(`/sessions/${entry.sessionId}`);
    session = s.session;
    files = s.files ?? [];
    notes = s.notes ?? [];
  } catch (err) {
    console.error('session fetch failed:', err.message);
  }

  const envelope = buildEnvelope(entry, session, files, notes);
  envelope.contractCompliant =
    envelope.resumeContract.telosNonNull &&
    envelope.resumeContract.breadcrumbExists;

  const gaps = gapsForEntry(entry, session, files, notes);

  const dir = `.scratch/salvage-envelope-${entry.id}`;
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'envelope.json'), JSON.stringify(envelope, null, 2));
  writeFileSync(
    join(dir, 'GAPS.md'),
    `# Resume gaps for ${entry.id}\n\n` +
      gaps.map(g => `- ${g}`).join('\n') +
      `\n\n## Contract compliant: ${envelope.contractCompliant}\n`
  );

  console.log(`Wrote ${dir}/envelope.json`);
  console.log(`Wrote ${dir}/GAPS.md`);
  console.log(`Telos: ${envelope.telos}`);
  console.log(`Claims: ${envelope.claims.length} files`);
  console.log(`Notes: ${envelope.notes.length}`);
  console.log(`Breadcrumb: ${envelope.inferredBreadcrumb?.slice(0, 100) ?? '(none)'}`);
  console.log(`Contract compliant: ${envelope.contractCompliant}`);
  console.log(`Gaps: ${gaps.length}`);
  for (const g of gaps) console.log(`  - ${g}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
