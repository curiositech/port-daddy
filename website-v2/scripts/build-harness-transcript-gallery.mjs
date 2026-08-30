#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { INTEGRATION_CONTRACTS } from './porthole-proof-contracts.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const websiteRoot = join(here, '..');
const repoRoot = join(websiteRoot, '..');
const castsRoot = join(websiteRoot, 'public', 'casts', 'porthole');
const parleyEvidencePath = join(websiteRoot, 'src', 'data', 'evidence', 'parley-979f6940.json');
const parleyPaneArchivePath = join(websiteRoot, 'src', 'data', 'evidence', 'parley-source-panes.json');
const outputPath = process.argv[2] ?? join(homedir(), 'coding', 'tmp', 'port-daddy-current-harness-transcripts.html');

const scenes = [
  {
    id: 'quickstart', label: 'A fresh machine gets a harbor in seconds', station: 'First light',
    locus: 'Install → named daemon → readiness', format: 'single shell · 100×28',
    seed: 'An isolated HOME, an empty repository, and the cached release archive. No open docs and no running Port Daddy instance.',
    intervention: 'The archive is extracted, its pd binary starts a named daemon profile, and the profile environment becomes the active control plane.',
    proof: 'The released binary reports its version, a live PID, home-collapsed runtime paths, and a healthy converged control plane.',
    authority: 'Real release archive · isolated HOME · real daemon process',
  },
  {
    id: 'harness-next-turn', label: 'The model sees the harness, not transport sludge', station: 'Harness context',
    locus: 'PostToolUse → Ink Cloud → UserPromptSubmit', format: 'single shell · 100×28',
    seed: 'A harnessed agent has one unread Postmaster message, one recent write pheromone, and a relevant policy document in its repository.',
    intervention: 'The post-tool tentacle records ambient state. Squid decodes the next-turn hook envelope and renders the exact additionalContext as a distinct model-context block.',
    proof: 'The transcript labels audience and delivery explicitly, shows the model context between hard harness boundaries, then reads the durable inbox and suggested document.',
    authority: 'Real hook scripts · real daemon inbox · real hybrid idea search',
  },
  {
    id: 'collision', label: 'Two branches reach for one non-mergeable resource', station: 'Collision watch',
    locus: 'Two sessions → scoped claims → distributed lock', format: 'tmux · 2 agents · 120×34',
    seed: 'NORA and MILO work in separate linked worktrees. Both declare intent on their branch-local schema file; only one may hold the global migration lock.',
    intervention: 'Port Daddy records both sessions and claims, grants NORA the refunds-schema lock, and refuses MILO while the lock is live.',
    proof: 'Both identities remain visible in split panes. The same lock name is requested twice; the second request receives the real red refusal and holder identity.',
    authority: 'Real tmux PTYs · real linked worktrees · daemon-backed lock',
  },
  {
    id: 'visibility', label: 'A real quiet interval stays on the clock', station: 'Broken watch',
    locus: 'Turn harvest → elapsed silence → digest', format: 'tmux · 2 agents · jump cut',
    seed: 'Two agents publish durable notes, then genuinely wait through a substantial quiet interval before returning to coordination state.',
    intervention: 'Nothing is typed during the wait. Porthole preserves source time, compresses only the silent display interval, and marks the discontinuity with a broken axis and exact clock endpoints.',
    proof: 'The before/after date commands differ by more than eighty seconds. Source duration remains 112 seconds even though replay duration is compact.',
    authority: 'Real wall clock · no narration comments · no omitted terminal output',
  },
  {
    id: 'ports', label: 'pd up launches a service and another pane proves it', station: 'Engine room',
    locus: 'Project manifest → process launch → health → teardown', format: 'tmux · service + probe',
    seed: 'A tiny Node service and a real .portdaddyrc declare one API on a known port. No service process is running at capture start.',
    intervention: 'The engine pane runs pd up. The bridge pane probes HTTP, asks Port Daddy to find and health-check the service, then tears it down.',
    proof: 'The manifest project, pd up registration, exact pd find query, and health check all agree on porthole-service-proof:app:main after the live HTTP probe succeeds.',
    authority: 'Real child process · real HTTP response · real pd up/down lifecycle',
  },
  {
    id: 'parley', label: 'A decision survives adversarial review', station: 'Wardroom',
    cast: 'parley',
    locus: 'Three receipts → six public turns → caught up', format: 'tmux · 3 receipt panes · 140×40',
    seed: 'Nora, Milo, and Aya disagree over capture order, inventory safety, and retry safety in one durable three-party Parley.',
    intervention: 'Each participant reads the same durable record through a compact decision-receipt projection. Raw protocol commands stay out of this primary scene.',
    proof: 'The three panes identify proposal author, adversarial reviewer, and delivery-safety owner; all show six durable turns, CONVENED state, no global settlement, and caught-up receipts.',
    authority: 'Real Parley record · three participant-bound receipt projections · no raw performatives',
  },
  {
    id: 'parley-source', label: 'Drill into the real four-pane protocol source', station: 'Protocol source · drill-down',
    cast: 'parley-source',
    locus: 'Three sessions → six public turns → read-only witness', format: 'tmux · 3 sessions + witness · 160×44',
    seed: 'The receipt-primary view is not enough for a protocol audit. Nora, Milo, and Aya therefore remain available in their distinct linked worktrees, shells, identities, and Port Daddy sessions.',
    intervention: 'This explicitly secondary view exposes the three live protocol panes. A fourth, visually distinct witness polls the durable record without a viewer identity and explains each public move as it commits.',
    proof: 'The source shows one proposal, two independent objections, a revision that answers both, two individual agreements, and caught-up read receipts. Public rationale is visible; private chain of thought is not claimed.',
    authority: 'Real tmux PTYs · three real sessions · read-only Parley projection',
  },
];

const integrationJoin = INTEGRATION_CONTRACTS.map(({ castClaimPatterns, ...contract }) => contract);
const parleyProof = JSON.parse(await readFile(parleyEvidencePath, 'utf8'));
const parleyPaneArchive = JSON.parse(await readFile(parleyPaneArchivePath, 'utf8'));

if (parleyProof.participants?.length < 3 || parleyProof.status !== 'CONVENED' || parleyProof.outcome !== null) {
  throw new Error('Three-party Parley evidence must remain CONVENED, unresolved, and visibly multi-party');
}
if (parleyProof.turns?.length !== parleyProof.displayedTurnCount
  || parleyProof.turns.some((turn) => turn.at > parleyProof.commonReadThrough)) {
  throw new Error('Three-party Parley evidence escaped its shared-read frontier');
}

const escapeHtml = (value) => String(value)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#039;');

const safePartyColor = (value) => /^#[0-9a-f]{6}$/i.test(value) ? value : '#0b57c9';
const participantById = new Map(parleyProof.participants.map((participant) => [participant.id, participant]));
const parleyTurnsHtml = parleyProof.turns.map((turn) => {
  const participant = participantById.get(turn.party);
  if (!participant) throw new Error(`Unknown Parley participant ${turn.party}`);
  const lane = parleyProof.participants.findIndex((candidate) => candidate.id === participant.id) + 1;
  const time = new Date(turn.at).toISOString();
  return `<li class="parley-turn"><span class="turn-no">T${String(turn.sequence).padStart(2, '0')}</span><article class="turn-card lane-${lane}" style="--party:${safePartyColor(participant.color)}"><div class="turn-meta"><span class="party-glyph ${escapeHtml(participant.shape)}" aria-hidden="true"></span><strong>${escapeHtml(participant.shortLabel)}</strong><span class="turn-action ${escapeHtml(turn.performative)}">${escapeHtml(turn.displayAction)}</span></div><p>${escapeHtml(turn.summary)}</p><details><summary>Inspect exact source turn</summary><p>${escapeHtml(turn.content)}</p><code>raw act: ${escapeHtml(turn.performative)} · ${escapeHtml(participant.id)} · ${escapeHtml(time)}</code></details></article></li>`;
}).join('');

const parleyPartiesHtml = parleyProof.participants.map((participant) => `<article class="party-card" style="--party:${safePartyColor(participant.color)}"><div><span class="party-glyph ${escapeHtml(participant.shape)}" aria-hidden="true"></span><strong>${escapeHtml(participant.shortLabel)}</strong></div><p>${escapeHtml(participant.role)}</p><code>${escapeHtml(participant.id)}</code></article>`).join('');

const parleyReceiptsHtml = parleyProof.receipts.map((receipt) => {
  const participant = participantById.get(receipt.party);
  if (!participant) throw new Error(`Unknown Parley receipt party ${receipt.party}`);
  const state = receipt.unseenTurns === 0 ? 'caught up' : `${receipt.unseenTurns} unseen`;
  return `<span class="receipt-state ${receipt.unseenTurns === 0 ? 'complete' : 'unseen'}"><span class="party-glyph ${escapeHtml(participant.shape)}" style="--party:${safePartyColor(participant.color)}" aria-hidden="true"></span>${escapeHtml(participant.shortLabel)} · ${escapeHtml(state)}</span>`;
}).join('');

const paneLineClass = (line) => {
  if (/\b(?:REFUSED|ERROR|failed|denied|unhealthy)\b/i.test(line)) return 'error';
  if (/PORT DADDY WITNESS|\bWITNESS\b|CAUGHT UP/.test(line)) return 'witness';
  if (/^(?:NORA◆|MILO◇|AYA●)\s+❯/.test(line)) return 'command';
  if (/\b(?:session|agent)-[a-z0-9-]+\b/i.test(line)) return 'anchor';
  return '';
};

const paneScrollbackHtml = parleyPaneArchive.panes.map((pane) => {
  const lines = pane.lines.map((line) => `<span class="pane-line ${paneLineClass(line)}">${escapeHtml(line) || '&nbsp;'}</span>`).join('');
  const historyState = pane.historyLimitReached ? 'tmux history limit reached' : 'available history below limit';
  return `<article class="pane-history" style="--pane:${safePartyColor(pane.color)}"><header><div><strong><span aria-hidden="true">${escapeHtml(pane.mark)}</span> ${escapeHtml(pane.name)}</strong><small>${escapeHtml(pane.role)}</small></div><button type="button" data-pane-latest="${escapeHtml(pane.id)}" aria-controls="pane-history-${escapeHtml(pane.id)}" aria-label="Jump ${escapeHtml(pane.name)} tmux pane scrollback to latest">↓ latest</button></header><pre id="pane-history-${escapeHtml(pane.id)}" role="region" tabindex="0" aria-label="${escapeHtml(pane.name)} tmux pane scrollback, ${pane.lines.length} lines">${lines}</pre><footer><span>${pane.lines.length} captured lines · ${pane.geometry.cols}×${pane.geometry.rows}</span><span>${historyState}</span></footer></article>`;
}).join('');

const casts = {};
for (const scene of scenes) {
  const bytes = await readFile(join(castsRoot, `${scene.cast ?? scene.id}.cast`));
  casts[scene.id] = bytes.toString('utf8');
  scene.hash = createHash('sha256').update(bytes).digest('hex');
}

const portholeCss = await readFile(join(websiteRoot, 'src', 'components', 'porthole', 'porthole.css'), 'utf8');
const bundle = await build({
  entryPoints: [join(here, 'harness-gallery-client.ts')],
  bundle: true,
  write: false,
  format: 'iife',
  platform: 'browser',
  target: ['es2022'],
  minify: false,
  sourcemap: false,
});
const clientJs = bundle.outputFiles[0].text;
const gitBin = process.env.PD_PORTHOLE_GIT_BIN?.trim() || 'git';
const commit = execFileSync(gitBin, ['rev-parse', '--short=10', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim();
const payload = JSON.stringify({
  scenes,
  casts,
  integrationJoin,
  paneArchive: {
    schema: parleyPaneArchive.schema,
    sourceCast: parleyPaneArchive.sourceCast,
    sourceCastSha256: parleyPaneArchive.sourceCastSha256,
    paneCount: parleyPaneArchive.panes.length,
  },
}).replace(/</g, '\\u003c');

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Port Daddy · current harness proof</title>
<style>
:root {
  color-scheme: dark;
  --font-mono: "SFMono-Regular", "Cascadia Code", Menlo, Consolas, monospace;
  --font-display: Iowan Old Style, Charter, Georgia, serif;
  --surface-base:#0b0e12; --surface-raised:#12171d; --surface-sunken:#07090c;
  --text-primary:#f5f0e6; --text-secondary:#bdc3cc; --text-muted:#858e9a;
  --border-subtle:#28303a; --border-default:#46515f; --border-strong:#778393;
  --brand-primary:#76a9ff; --brand-primary-foreground:#07101d; --brand-accent:#e5ae3d;
  --interactive-active:#214d8c; --interactive-focus:#9fc1ff;
  --status-error:#ff5f57; --status-warning:#e5ae3d; --status-success:#8ecf4a;
  --code-dot-red:#ff5f57; --code-dot-amber:#e5ae3d; --code-dot-green:#8ecf4a;
  --ph-bg:#080b0f; --ph-header-bg:#141a21; --ph-text:#e7ebf0; --ph-command:#9fd1ff; --ph-comment:#8993a0;
  --agent:#8ecf4a; --session:#76a9ff; --purpose:#f09a50; --harness:#d89af0;
  --space-2:8px; --space-3:12px; --space-4:16px; --type-code-size:14px; --leading-code:1.45;
}
:root[data-theme="light"] {
  color-scheme: light;
  --surface-base:#f2ecde; --surface-raised:#fffaf0; --surface-sunken:#e5dcc9;
  --text-primary:#18202a; --text-secondary:#4f5966; --text-muted:#697481;
  --border-subtle:#d1c6b2; --border-default:#9e927f; --border-strong:#675f53;
  --brand-primary:#0b57c9; --brand-primary-foreground:#fff; --brand-accent:#9b6500;
  --interactive-active:#cfe0ff; --interactive-focus:#0b57c9;
  --status-error:#ba2d22; --status-warning:#8a5b00; --status-success:#47760e;
  --ph-bg:#fffcf5; --ph-header-bg:#e8dfcc; --ph-text:#252c35; --ph-command:#064da9; --ph-comment:#616b78;
  --agent:#47760e; --session:#0b57c9; --purpose:#b65216; --harness:#7e3b9a;
}
*{box-sizing:border-box}
html,body{margin:0;min-height:100%;background:var(--surface-base);color:var(--text-primary)}
body{font:15px/1.55 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
button{font:inherit}
.page{width:min(1320px,calc(100% - 40px));margin:0 auto;padding:34px 0 72px}
.mast{display:grid;grid-template-columns:minmax(0,1.35fr) minmax(280px,.65fr);gap:28px;padding:24px 0 26px;border-top:6px solid var(--brand-accent);border-bottom:1px solid var(--border-default)}
.eyebrow,.kicker,.proof-key,.receipt-mark{font:800 11px/1.2 var(--font-mono);letter-spacing:.12em;text-transform:uppercase}
.eyebrow{color:var(--brand-accent);margin-bottom:16px}
h1{max-width:18ch;margin:9px 0 12px;font:700 clamp(34px,5vw,68px)/.98 var(--font-display);letter-spacing:-.035em}
.mast p{max-width:72ch;margin:0;color:var(--text-secondary);font-size:16px}
.mast-aside{display:grid;grid-template-columns:1fr 1fr;border:1px solid var(--border-default);background:var(--border-default);gap:1px}
.mast-aside div{padding:15px;background:var(--surface-raised)}
.mast-aside b{display:block;margin-top:4px;font:750 20px/1.1 var(--font-mono)}
.theme{justify-self:end;align-self:start;border:1px solid var(--border-default);background:var(--surface-raised);color:var(--text-primary);padding:8px 11px;cursor:pointer}
.theme:focus-visible,.scene-tabs button:focus-visible{outline:3px solid var(--interactive-focus);outline-offset:3px}
.decoder{margin:26px 0;border:1px solid var(--border-default);background:var(--surface-raised)}
.decoder-head{display:grid;grid-template-columns:minmax(0,.7fr) minmax(0,1.3fr);gap:18px;padding:18px;border-bottom:1px solid var(--border-default)}
.decoder h2,.parley-board h2{margin:5px 0 8px;font:700 clamp(24px,3vw,38px)/1.04 var(--font-display)}
.decoder-head p{max-width:72ch;margin:0;color:var(--text-secondary)}
.layer-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:1px;background:var(--border-default)}
.layer-card{min-width:0;padding:16px;background:var(--surface-sunken)}
.layer-card .layer-no{display:block;color:var(--brand-primary);font:850 12px/1 var(--font-mono)}
.layer-card strong{display:block;margin:12px 0 7px;font:700 17px/1.15 var(--font-display)}
.layer-card p{margin:0;color:var(--text-secondary);font-size:13px}
.watch-guide{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:1px;margin:16px 0;border:1px solid var(--border-default);background:var(--border-default)}
.watch-step{padding:14px;background:var(--surface-raised)}
.watch-step span{color:var(--brand-accent);font:850 11px/1 var(--font-mono)}
.watch-step strong{display:block;margin:9px 0 5px;font:700 15px/1.15 var(--font-display)}
.watch-step p{margin:0;color:var(--text-secondary);font-size:12px}
.scene-tabs{display:grid;grid-template-columns:repeat(6,minmax(120px,1fr));margin:26px 0 0;border:1px solid var(--border-default);background:var(--border-default);gap:1px}
.scene-tabs button{min-width:0;min-height:98px;padding:13px;text-align:left;border:0;background:var(--surface-raised);color:var(--text-secondary);cursor:pointer}
.scene-tabs button span,.scene-tabs button small{display:block;font:700 10px/1.2 var(--font-mono);letter-spacing:.08em;text-transform:uppercase;color:var(--text-muted)}
.scene-tabs button strong{display:block;margin:11px 0 5px;color:var(--text-primary);font:700 14px/1.15 var(--font-mono)}
.scene-tabs button[aria-selected="true"]{box-shadow:inset 0 5px 0 var(--brand-primary);background:var(--surface-sunken)}
.scene-tabs button[aria-selected="true"] span{color:var(--brand-primary)}
.brief{display:grid;grid-template-columns:minmax(240px,.75fr) minmax(0,1.4fr) minmax(240px,.85fr);gap:1px;margin:16px 0;background:var(--border-default);border:1px solid var(--border-default)}
.brief>div{min-width:0;padding:17px;background:var(--surface-raised)}
.brief-main{grid-row:span 2}
.brief h2{margin:6px 0 9px;font:700 clamp(23px,3vw,36px)/1.05 var(--font-display)}
.brief p{margin:5px 0 0;color:var(--text-secondary)}
.scene-no{float:right;color:var(--brand-primary);font:800 28px/1 var(--font-mono)}
.receipt-mark{display:inline-block;margin-top:12px;padding:5px 7px;border:1px solid var(--brand-accent);color:var(--brand-accent)}
.proof-key{color:var(--brand-accent)}
.player-shell{border:1px solid var(--border-strong);background:var(--surface-sunken);padding:12px}
.player-error{display:grid;min-height:18rem;margin:0;place-items:center;border:2px solid var(--status-error);background:color-mix(in srgb,var(--status-error) 10%,var(--surface-raised));padding:24px;color:var(--status-error);font:800 15px/1.5 var(--font-mono);text-align:center}
.pane-inspector{margin-top:16px;border:1px solid var(--border-default);background:var(--surface-raised)}
.pane-inspector[hidden]{display:none}.pane-inspector-head{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:18px;align-items:end;padding:18px;border-left:7px solid var(--brand-primary);border-bottom:1px solid var(--border-default)}
.pane-inspector h2{max-width:24ch;margin:5px 0 8px;font:700 clamp(23px,3vw,36px)/1.05 var(--font-display)}.pane-inspector-head p{max-width:75ch;margin:0;color:var(--text-secondary)}.pane-inspector-source{text-align:right;color:var(--text-muted);font:11px/1.5 var(--font-mono)}
.pane-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1px;background:var(--border-default)}
.pane-history{display:grid;min-width:0;min-height:0;grid-template-rows:auto minmax(0,1fr) auto;border-top:7px solid var(--pane);background:var(--surface-sunken)}
.pane-history header{display:flex;align-items:start;justify-content:space-between;gap:10px;padding:12px;border-bottom:1px solid var(--border-default);background:var(--surface-raised)}.pane-history header strong,.pane-history header small{display:block}.pane-history header strong{font:800 15px/1.2 var(--font-mono)}.pane-history header strong span{color:var(--pane)}.pane-history header small{margin-top:4px;color:var(--text-muted);font:800 10px/1.2 var(--font-mono);letter-spacing:.07em;text-transform:uppercase}.pane-history button{min-height:44px;padding:5px 9px;border:1px solid var(--border-strong);background:transparent;color:var(--brand-primary);font:800 10px/1 var(--font-mono);text-transform:uppercase;cursor:pointer}.pane-history button:focus-visible,.pane-history pre:focus-visible{outline:3px solid var(--interactive-focus);outline-offset:-3px}
.pane-history pre{height:310px;max-width:none;margin:0;padding:12px;overflow:auto;scrollbar-color:var(--brand-primary) var(--surface-sunken);white-space:pre-wrap;overflow-wrap:anywhere;color:var(--ph-text);font:14px/1.45 var(--font-mono)}.pane-line{display:block;min-height:1.45em}.pane-line.command{color:var(--ph-command);font-weight:700}.pane-line.anchor{color:var(--session)}.pane-line.witness{color:var(--brand-primary);font-weight:700}.pane-line.error{color:var(--status-error);font-weight:800}
.pane-history footer{display:flex;flex-wrap:wrap;justify-content:space-between;gap:8px;padding:8px 12px;border-top:1px solid var(--border-default);color:var(--text-muted);font:10px/1.2 var(--font-mono)}
.legend{display:flex;flex-wrap:wrap;gap:8px 20px;margin:11px 0 0;color:var(--text-muted);font:700 11px/1.4 var(--font-mono)}
.legend i{display:inline-block;width:9px;height:9px;margin-right:6px;background:currentColor}
.legend .agent{color:var(--agent)} .legend .session{color:var(--session)} .legend .purpose{color:var(--purpose)} .legend .harness{color:var(--harness)} .legend .error{color:var(--status-error)}
.evidence-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:1px;margin-top:28px;border:1px solid var(--border-default);background:var(--border-default)}
.evidence-grid article{padding:18px;background:var(--surface-raised)}
.evidence-grid h3{margin:7px 0;font:700 18px/1.2 var(--font-display)}
.evidence-grid p{margin:0;color:var(--text-secondary)}
.parley-doctrine{margin-top:28px;border:1px solid var(--border-default);background:var(--surface-raised)}
.parley-doctrine-head{display:grid;grid-template-columns:minmax(0,1.25fr) minmax(260px,.75fr);gap:22px;padding:20px;border-bottom:1px solid var(--border-default)}.parley-doctrine h2{max-width:21ch;margin:5px 0 8px;font:700 clamp(24px,3vw,38px)/1.04 var(--font-display)}.parley-doctrine-head p{max-width:74ch;margin:0;color:var(--text-secondary)}.doctrine-truth{padding:13px;border-left:7px solid var(--status-warning);background:var(--surface-sunken);color:var(--text-secondary);font-size:13px}.doctrine-truth strong{display:block;margin-bottom:5px;color:var(--status-warning);font:850 10px/1.2 var(--font-mono);letter-spacing:.08em;text-transform:uppercase}
.doctrine-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:1px;background:var(--border-default)}.doctrine-grid article{padding:15px;background:var(--surface-sunken)}.doctrine-grid span{color:var(--brand-primary);font:850 10px/1.2 var(--font-mono);letter-spacing:.08em;text-transform:uppercase}.doctrine-grid strong{display:block;margin:9px 0 6px;font:700 17px/1.15 var(--font-display)}.doctrine-grid p{margin:0;color:var(--text-secondary);font-size:13px}
.parley-board{margin-top:28px;border:1px solid var(--border-default);background:var(--surface-raised)}
.parley-board-head{display:grid;grid-template-columns:minmax(0,1.25fr) minmax(260px,.75fr);gap:22px;padding:20px;border-bottom:1px solid var(--border-default)}
.parley-board-head>div>p{max-width:72ch;margin:0;color:var(--text-secondary)}
.parley-metrics{display:grid;grid-template-columns:1fr 1fr;gap:1px;background:var(--border-default);border:1px solid var(--border-default)}
.parley-metrics div{padding:12px;background:var(--surface-sunken)}
.parley-metrics span,.parley-metrics b{display:block;font-family:var(--font-mono)}
.parley-metrics span{color:var(--text-muted);font-size:10px;font-weight:850;letter-spacing:.08em;text-transform:uppercase}
.parley-metrics b{margin-top:4px;font-size:15px}.parley-metrics .warning{color:var(--status-warning)}.parley-metrics .error{color:var(--status-error)}
.suggest-index{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:1px;background:var(--border-default);border-bottom:1px solid var(--border-default)}
.suggest-index div{padding:13px;background:var(--surface-sunken)}
.suggest-index span,.suggest-index strong{display:block}.suggest-index span{color:var(--brand-primary);font:850 10px/1.2 var(--font-mono);letter-spacing:.08em;text-transform:uppercase}.suggest-index strong{margin-top:7px;font-size:13px}
.party-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:1px;margin:18px 18px 0;background:var(--border-default);border:1px solid var(--border-default)}
.party-card{min-width:0;padding:14px;background:var(--surface-sunken);border-top:6px solid var(--party)}
.party-card>div,.turn-meta{display:flex;min-width:0;align-items:center;gap:8px;flex-wrap:wrap}.party-card>div strong{min-width:0;overflow-wrap:anywhere}.party-card p{margin:7px 0;color:var(--text-secondary);font-size:14px}.party-card code{display:block;overflow-wrap:anywhere;color:var(--text-muted);font-size:10px}
.party-glyph{display:inline-block;width:13px;height:13px;flex:0 0 auto;border:2px solid var(--party);background:var(--party)}.party-glyph.circle{border-radius:50%}.party-glyph.diamond{transform:rotate(45deg)}
.parley-turns{display:grid;gap:7px;margin:18px;padding:0;list-style:none}
.parley-turn{display:grid;grid-template-columns:48px repeat(3,minmax(0,1fr));gap:7px}.turn-no{padding-top:13px;color:var(--text-muted);font:850 11px/1 var(--font-mono)}
.turn-card{min-width:0;padding:13px;border:1px solid var(--border-default);border-left:7px solid var(--party);background:var(--surface-sunken)}.turn-card.lane-1{grid-column:2}.turn-card.lane-2{grid-column:3}.turn-card.lane-3{grid-column:4}
.turn-meta strong{min-width:0;margin-right:auto;font-size:14px}.turn-action{padding:4px 6px;border:1px solid var(--border-strong);background:var(--surface-raised);color:var(--text-primary);font:850 10px/1.2 var(--font-mono);letter-spacing:.06em;text-transform:uppercase}
.turn-card>p{margin:10px 0 0;color:var(--text-primary);font-size:14px;font-weight:700}.turn-card details{margin-top:10px;padding-top:8px;border-top:1px solid var(--border-default)}.turn-card summary{cursor:pointer;color:var(--brand-primary);font:850 10px/1.2 var(--font-mono);letter-spacing:.06em;text-transform:uppercase}.turn-card details p{white-space:pre-wrap;overflow-wrap:anywhere;word-break:break-word;color:var(--text-secondary);font:14px/1.55 var(--font-mono)}.turn-card details code{display:block;overflow-wrap:anywhere;color:var(--text-muted);font-size:10px}
.parley-honesty{display:grid;grid-template-columns:minmax(0,1.2fr) minmax(280px,.8fr);gap:1px;margin:0 18px 18px;border:1px solid var(--border-default);background:var(--border-default)}.parley-honesty>div{padding:14px;background:var(--surface-sunken)}.parley-honesty h3{margin:6px 0;font:700 18px/1.2 var(--font-display)}.parley-honesty p{margin:0;color:var(--text-secondary)}
.receipt-row{display:flex;flex-wrap:wrap;align-content:start;gap:8px}.receipt-state{display:inline-flex;align-items:center;gap:6px;padding:6px 8px;border:1px solid var(--border-default);font:850 10px/1.2 var(--font-mono);text-transform:uppercase}.receipt-state.complete{color:var(--status-success)}.receipt-state.unseen{color:var(--status-warning)}
.parley-source{display:block;margin:0;padding:13px 18px;border-top:1px solid var(--border-default);overflow-wrap:anywhere;white-space:normal;color:var(--text-muted);font:14px/1.5 var(--font-mono)}
.integration-join{margin-top:28px;padding:20px;border:1px solid var(--border-default);background:var(--surface-raised)}
.integration-join h2{margin:5px 0 8px;font:700 clamp(22px,3vw,34px)/1.05 var(--font-display)}
.integration-join>p{max-width:78ch;margin:0;color:var(--text-secondary)}
.integration-slots{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:1px;margin-top:18px;border:1px solid var(--border-default);background:var(--border-default)}
.integration-slot{padding:14px;background:var(--surface-sunken)}
.integration-slot strong,.integration-slot span{display:block;font-family:var(--font-mono)}
.integration-slot strong{color:var(--text-primary);font-size:13px}.integration-slot span{margin-top:7px;color:var(--brand-accent);font-size:10px;font-weight:800;letter-spacing:.08em;text-transform:uppercase}.integration-slot p{margin:8px 0 0;color:var(--text-muted);font-size:12px;line-height:1.45}
.artifact-foot{display:flex;flex-wrap:wrap;justify-content:space-between;gap:10px;margin-top:28px;padding-top:14px;border-top:1px solid var(--border-default);color:var(--text-muted);font:12px/1.5 var(--font-mono)}
code{font-family:var(--font-mono)}
${portholeCss}
.ph-root{--type-code-size:14px}
.ph-win{border-color:var(--border-strong)}
.ph-cut-notice{background:var(--ph-header-bg)}
@media(max-width:980px){.mast,.decoder-head,.parley-board-head,.parley-honesty,.pane-inspector-head,.parley-doctrine-head{grid-template-columns:1fr}.layer-grid,.watch-guide,.suggest-index,.doctrine-grid{grid-template-columns:1fr 1fr}.scene-tabs{grid-template-columns:repeat(3,1fr)}.brief{grid-template-columns:1fr 1fr}.brief-main{grid-row:auto;grid-column:1/-1}.evidence-grid,.integration-slots{grid-template-columns:1fr}.parley-turn{grid-template-columns:38px 1fr}.turn-card.lane-1,.turn-card.lane-2,.turn-card.lane-3{grid-column:2}.pane-inspector-source{text-align:left}}
@media(max-width:640px){.page{width:min(100% - 20px,1320px);padding-top:18px}.layer-grid,.watch-guide,.suggest-index,.party-grid,.pane-grid,.doctrine-grid{grid-template-columns:1fr}.scene-tabs{grid-template-columns:1fr 1fr}.brief{grid-template-columns:1fr}.brief-main{grid-column:auto}.brief-main .scene-no{float:none;display:block;margin:0 0 9px}.mast-aside{grid-template-columns:1fr 1fr}.party-grid,.parley-turns,.parley-honesty{margin-left:10px;margin-right:10px}.ph-term{font-size:12px;padding-left:28px}.ph-provenance{overflow-wrap:anywhere}.pane-history pre{height:260px}}
@media(prefers-reduced-motion:reduce){*,*::before,*::after{scroll-behavior:auto!important;transition:none!important;animation:none!important}}
</style>
</head>
<body>
<main class="page">
  <header class="mast">
    <div>
      <div class="eyebrow">Port Daddy · harness evidence room · ${commit}</div>
      <h1>The harness is in the room.</h1>
      <p>A harness is the safety, control, and continuity layer around an agent. Six executable scenarios show what Port Daddy installs, injects, refuses, remembers, launches, and negotiates. Every terminal is selectable asciicast text. No GIF, no commented acting, no private production transcript.</p>
    </div>
    <div>
      <button class="theme" id="theme-toggle" type="button">◐ theme</button>
      <div class="mast-aside" aria-label="Corpus facts">
        <div><span class="kicker">Scenes</span><b>6</b></div>
        <div><span class="kicker">Multi-agent</span><b>4</b></div>
        <div><span class="kicker">Three-party record</span><b>1</b></div>
        <div><span class="kicker">Authority</span><b>PTY + receipt</b></div>
      </div>
    </div>
  </header>

  <section class="decoder" aria-labelledby="decoder-title">
    <div class="decoder-head">
      <div><span class="proof-key">Start here</span><h2 id="decoder-title">What is a harness?</h2></div>
      <p>The agent still writes code and runs commands. The harness is the layer around those actions: it can provide timely context, check a risky edit, and leave a trace. Port Daddy keeps the team state durable. Porthole is the window that lets you replay and inspect the evidence.</p>
    </div>
    <div class="layer-grid">
      <article class="layer-card"><span class="layer-no">01 · agent</span><strong>The worker at the keyboard</strong><p>Chooses commands, edits files, runs tests, and explains the result.</p></article>
      <article class="layer-card"><span class="layer-no">02 · harness</span><strong>Seat belt + dashboard + flight recorder</strong><p>Connects before a turn, before an edit, and after a tool without replacing the worker.</p></article>
      <article class="layer-card"><span class="layer-no">03 · Port Daddy</span><strong>The durable team control plane</strong><p>Owns identity, worktrees, claims, inbox delivery, Parley, limits, and receipts.</p></article>
      <article class="layer-card"><span class="layer-no">04 · Porthole</span><strong>The inspectable evidence window</strong><p>Replays real terminal bytes and source time. It shows the run; it does not invent the decision.</p></article>
    </div>
  </section>

  <nav class="scene-tabs" id="scene-tabs" role="tablist" aria-label="Harness proof scenarios"></nav>

  <section class="brief" aria-live="polite">
    <div class="brief-main"><span class="scene-no" id="scene-number">01</span><span class="proof-key" id="scene-station"></span><h2 id="scene-title"></h2><p id="scene-intervention"></p><span class="receipt-mark" id="scene-authority"></span></div>
    <div><span class="kicker">Lifecycle locus</span><p id="scene-locus"></p></div>
    <div><span class="kicker">Seeded condition</span><p id="scene-seed"></p></div>
    <div><span class="kicker">Observed proof</span><p id="scene-proof"></p></div>
    <div><span class="kicker">Capture</span><p><span id="scene-format"></span><br>sha256 <code id="scene-hash"></code></p></div>
  </section>

  <section class="watch-guide" aria-label="How to read the harness videos">
    <article class="watch-step"><span>01</span><strong>Read the brief</strong><p>Seed, intervention, and proof tell you what this recording may establish.</p></article>
    <article class="watch-step"><span>02</span><strong>Follow each pane</strong><p>Separate panes are separate shells, worktrees, and agent identities.</p></article>
    <article class="watch-step"><span>03</span><strong>Use the color legend</strong><p>Purple is harness context; blue is identity; orange is purpose; green is ready; red is a real refusal.</p></article>
    <article class="watch-step"><span>04</span><strong>Find the read-back</strong><p>The later discovery, receipt, or refusal is what proves the command changed real state.</p></article>
  </section>

  <section class="player-shell" role="tabpanel" aria-label="Active harness transcript">
    <div id="player-root"></div>
    <div class="legend" aria-label="Terminal semantic color legend">
      <span class="agent"><i></i>agent / ready</span><span class="session"><i></i>session / identity</span><span class="purpose"><i></i>purpose / sidequest</span><span class="harness"><i></i>model context</span><span class="error"><i></i>refusal / error</span>
    </div>
  </section>

  <section class="pane-inspector" id="parley-pane-inspector" aria-labelledby="parley-pane-inspector-title" hidden>
    <div class="pane-inspector-head">
      <div><span class="proof-key">Independent scrollback · recorder authority</span><h2 id="parley-pane-inspector-title">Four panes. Four real histories. Scroll each one.</h2><p>The moving replay above is one outer terminal surface. It cannot honestly recreate tmux history that was already scrolled away. Before teardown, the same recorder captures every pane from the beginning of its available tmux history and records the limit and whether that limit was reached. Wheel, trackpad, Page Up, and Page Down stay inside the focused pane.</p></div>
      <div class="pane-inspector-source"><div>${escapeHtml(parleyPaneArchive.capture)}</div><div>sha256 ${escapeHtml(parleyPaneArchive.sourceCastSha256.slice(0, 12))}</div></div>
    </div>
    <div class="pane-grid">${paneScrollbackHtml}</div>
  </section>

  <section class="parley-doctrine" aria-labelledby="parley-doctrine-title">
    <div class="parley-doctrine-head">
      <div><span class="proof-key">Target doctrine · compelled consultation, never compelled consent</span><h2 id="parley-doctrine-title">Parley should find the agents.</h2><p>The daemon is the only participant with enough durable context to notice that Nora’s morning work and Otis’s afternoon plan are nearing the same authority surface. It should convene the consultation in natural language before either agent needs to know a protocol verb.</p></div>
      <div class="doctrine-truth"><strong>Current source truth</strong>This recording is manually called and all three sessions are live. Automatic Parley exists only behind injected tests and currently rejects sleeping parties. Salvage returns bounded context to a successor; it does not restore a process or a mind. The proposed route is consent-leased reentry with fresh authority, not resurrection.</div>
    </div>
    <div class="doctrine-grid">
      <article><span>01 · detect</span><strong>Notice nearness</strong><p>Claims, symbols, plans, and cited evidence establish why two efforts need a shared decision.</p></article>
      <article><span>02 · summon</span><strong>Reach across time</strong><p>A durable invitation waits for the recorded identity when the original agent is offline.</p></article>
      <article><span>03 · protect</span><strong>Never puppet the sleeper</strong><p>Only a verified continuation may speak as Nora. Her evidence may inform a delegate, but cannot grant consent.</p></article>
      <article><span>04 · receipt</span><strong>Keep dissent visible</strong><p>Individual assent, refusal, unavailable parties, and operator gates remain explicit in the settlement receipt.</p></article>
    </div>
  </section>

  <section class="evidence-grid">
    <article><span class="kicker">Observed</span><h3>Timestamped terminal bytes</h3><p>The recorder runs commands in real shells and tmux panes. Porthole interprets the emitted bytes into selectable DOM text with full scrollback.</p></article>
    <article><span class="kicker">Explained</span><h3>Fixture and intervention</h3><p>Each scene states what was seeded and what Port Daddy actually did. The notes do not upgrade a cast into stronger authority than it has.</p></article>
    <article><span class="kicker">Not implied</span><h3>Evidence, not a sealed receipt</h3><p>These casts do not prove omitted context, containment, cost, or merge safety. A normalized WorkReceipt must bind those facts separately.</p></article>
  </section>

  <section class="parley-board" id="parley-three-party" aria-labelledby="parley-three-party-title">
    <div class="parley-board-head">
      <div><span class="proof-key">Three-member Parley · durable drill-down</span><h2 id="parley-three-party-title">Suggestibility, with names and receipts.</h2><p>One agent proposed an ownership split. Two peers changed the evidence requirements, tightened the safety boundary, and recorded individual agreements. The Parley is still open and has no settlement. The chronology stays intact—even the critique that arrived after an early agreement—so influence remains visible instead of being flattened into a tidy story.</p></div>
      <div class="parley-metrics" aria-label="Three-party Parley facts">
        <div><span>State</span><b class="warning">${escapeHtml(parleyProof.status)} · still open</b></div>
        <div><span>Settlement</span><b class="error">none</b></div>
        <div><span>Parties</span><b>${parleyProof.participants.length}</b></div>
        <div><span>Turns</span><b>${parleyProof.displayedTurnCount} shared · ${parleyProof.withheldTurnCount} withheld</b></div>
      </div>
    </div>
    <div class="suggest-index" aria-label="Index of how suggestions changed the proposal">
      <div><span>01 · proposal</span><strong>T01</strong></div>
      <div><span>02 · suggestions + pressure</span><strong>T02 · T03 · T07</strong></div>
      <div><span>03 · revisions</span><strong>T04 · T06</strong></div>
      <div><span>04 · individual agreements (not settlement)</span><strong>T05 · T08</strong></div>
    </div>
    <div class="party-grid" aria-label="Parley participants">${parleyPartiesHtml}</div>
    <ol class="parley-turns" aria-label="Chronological shared-read Parley turns">${parleyTurnsHtml}</ol>
    <div class="parley-honesty">
      <div><span class="proof-key">Read-frontier boundary</span><h3>Two later turns are deliberately not on this page.</h3><p>${escapeHtml(parleyProof.honestyNote)} This historical coordination record is distinct from the live three-session fixture above and from the still-unmerged Sugar experience.</p></div>
      <div><span class="kicker">Captured read receipts</span><div class="receipt-row">${parleyReceiptsHtml}</div></div>
    </div>
    <code class="parley-source">Source ${escapeHtml(parleyProof.sourceEndpoint)} · ${escapeHtml(parleyProof.parleyId)} · response sha256 ${escapeHtml(parleyProof.sourceResponseSha256)}</code>
  </section>

  <section class="integration-join" aria-labelledby="integration-join-title">
    <span class="proof-key">Integration join</span><h2 id="integration-join-title">Named contracts, deliberately unrendered</h2>
    <p>These are typed attachment points for the hypertree integration, not feature claims. A slot can become visible evidence only when its owning branch brings a verified contract and focused test result.</p>
    <div class="integration-slots" id="integration-slots"></div>
  </section>

  <footer class="artifact-foot"><span>Generated from <code>website-v2/public/casts/porthole/*.cast</code></span><span>Source revision <code>${commit}</code> · restart or choose any scene to replay from time zero</span></footer>
</main>
<script type="application/json" id="gallery-data">${payload}</script>
<script>${clientJs.replace(/<\/script/gi, '<\\/script')}</script>
</body>
</html>`;

await writeFile(outputPath, html, 'utf8');
console.log(outputPath);
