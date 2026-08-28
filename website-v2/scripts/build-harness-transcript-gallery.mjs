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
    locus: 'Two sessions → durable decision receipt', format: 'tmux · 2 agents · durable receipts',
    seed: 'Two agents disagree over capture-first versus authorize-first checkout settlement. Each has a separate worktree, identity, session, and inbox.',
    intervention: 'The retained source transcript records the live two-agent exchange. The primary replay renders its returned JSON as a decision receipt instead of exposing debug protocol verbs.',
    proof: 'Both panes show the same durable surface, ordered decision stages, the recorded risk, and caught-up receipts. It does not claim a settlement authority that the source has not exposed.',
    authority: 'Real two-agent source cast · returned receipt JSON · no forged collapse',
  },
];

const integrationJoin = INTEGRATION_CONTRACTS.map(({ castClaimPatterns, ...contract }) => contract);

const casts = {};
for (const scene of scenes) {
  const bytes = await readFile(join(castsRoot, `${scene.id}.cast`));
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
const commit = execFileSync('/usr/bin/git', ['rev-parse', '--short=10', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim();
const payload = JSON.stringify({ scenes, casts, integrationJoin }).replace(/</g, '\\u003c');

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
.legend{display:flex;flex-wrap:wrap;gap:8px 20px;margin:11px 0 0;color:var(--text-muted);font:700 11px/1.4 var(--font-mono)}
.legend i{display:inline-block;width:9px;height:9px;margin-right:6px;background:currentColor}
.legend .agent{color:var(--agent)} .legend .session{color:var(--session)} .legend .purpose{color:var(--purpose)} .legend .harness{color:var(--harness)} .legend .error{color:var(--status-error)}
.evidence-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:1px;margin-top:28px;border:1px solid var(--border-default);background:var(--border-default)}
.evidence-grid article{padding:18px;background:var(--surface-raised)}
.evidence-grid h3{margin:7px 0;font:700 18px/1.2 var(--font-display)}
.evidence-grid p{margin:0;color:var(--text-secondary)}
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
@media(max-width:980px){.mast{grid-template-columns:1fr}.scene-tabs{grid-template-columns:repeat(3,1fr)}.brief{grid-template-columns:1fr 1fr}.brief-main{grid-row:auto;grid-column:1/-1}.evidence-grid,.integration-slots{grid-template-columns:1fr}}
@media(max-width:640px){.page{width:min(100% - 20px,1320px);padding-top:18px}.scene-tabs{grid-template-columns:1fr 1fr}.brief{grid-template-columns:1fr}.brief-main{grid-column:auto}.brief-main .scene-no{float:none;display:block;margin:0 0 9px}.mast-aside{grid-template-columns:1fr 1fr}.ph-term{font-size:12px;padding-left:28px}.ph-provenance{overflow-wrap:anywhere}}
@media(prefers-reduced-motion:reduce){*,*::before,*::after{scroll-behavior:auto!important;transition:none!important;animation:none!important}}
</style>
</head>
<body>
<main class="page">
  <header class="mast">
    <div>
      <div class="eyebrow">Port Daddy · harness evidence room · ${commit}</div>
      <h1>The harness is in the room.</h1>
      <p>Six executable scenarios show what Port Daddy installs, injects, refuses, remembers, launches, and negotiates. Every terminal is selectable asciicast text. No GIF, no commented acting, no private production transcript.</p>
    </div>
    <div>
      <button class="theme" id="theme-toggle" type="button">◐ theme</button>
      <div class="mast-aside" aria-label="Corpus facts">
        <div><span class="kicker">Scenes</span><b>6</b></div>
        <div><span class="kicker">Two-agent</span><b>4</b></div>
        <div><span class="kicker">Silent cuts</span><b>declared</b></div>
        <div><span class="kicker">Authority</span><b>PTY + hash</b></div>
      </div>
    </div>
  </header>

  <nav class="scene-tabs" id="scene-tabs" role="tablist" aria-label="Harness proof scenarios"></nav>

  <section class="brief" aria-live="polite">
    <div class="brief-main"><span class="scene-no" id="scene-number">01</span><span class="proof-key" id="scene-station"></span><h2 id="scene-title"></h2><p id="scene-intervention"></p><span class="receipt-mark" id="scene-authority"></span></div>
    <div><span class="kicker">Lifecycle locus</span><p id="scene-locus"></p></div>
    <div><span class="kicker">Seeded condition</span><p id="scene-seed"></p></div>
    <div><span class="kicker">Observed proof</span><p id="scene-proof"></p></div>
    <div><span class="kicker">Capture</span><p><span id="scene-format"></span><br>sha256 <code id="scene-hash"></code></p></div>
  </section>

  <section class="player-shell" role="tabpanel" aria-label="Active harness transcript">
    <div id="player-root"></div>
    <div class="legend" aria-label="Terminal semantic color legend">
      <span class="agent"><i></i>agent / ready</span><span class="session"><i></i>session / identity</span><span class="purpose"><i></i>purpose / sidequest</span><span class="harness"><i></i>model context</span><span class="error"><i></i>refusal / error</span>
    </div>
  </section>

  <section class="evidence-grid">
    <article><span class="kicker">Observed</span><h3>Timestamped terminal bytes</h3><p>The recorder runs commands in real shells and tmux panes. Porthole interprets the emitted bytes into selectable DOM text with full scrollback.</p></article>
    <article><span class="kicker">Explained</span><h3>Fixture and intervention</h3><p>Each scene states what was seeded and what Port Daddy actually did. The notes do not upgrade a cast into stronger authority than it has.</p></article>
    <article><span class="kicker">Not implied</span><h3>Evidence, not a sealed receipt</h3><p>These casts do not prove omitted context, containment, cost, or merge safety. A normalized WorkReceipt must bind those facts separately.</p></article>
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
