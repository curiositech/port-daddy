#!/usr/bin/env node

/**
 * Record the public harness proof corpus against real Port Daddy surfaces.
 *
 * No narration is typed into the terminal. Every visible line is either a
 * command that actually ran or output from that command. Multi-actor scenes
 * use real linked worktrees and a real tmux split; long waits are preserved
 * on the asciicast clock for Porthole's declared broken-axis treatment.
 */
import { execFileSync } from 'node:child_process';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const castsDir = join(root, 'website-v2', 'public', 'casts', 'porthole');
const scratchParent = join(homedir(), 'coding', 'tmp');
function resolveTool(envName, fallback) {
  const explicit = process.env[envName];
  if (explicit) return explicit;
  try {
    return execFileSync('/usr/bin/which', [fallback], { encoding: 'utf8' }).trim();
  } catch {
    return fallback;
  }
}

// Keep the CLI process ABI-compatible with the runtime that records it.
// Individual tools can be overridden for an intentionally provisioned rig.
const nodeBin = process.env.PD_PORTHOLE_NODE ?? process.execPath;
const cli = join(root, 'bin', 'port-daddy-cli.js');
const asciinema = resolveTool('PD_PORTHOLE_ASCIINEMA', 'asciinema');
const tmux = resolveTool('PD_PORTHOLE_TMUX', 'tmux');
const brew = resolveTool('PD_PORTHOLE_BREW', 'brew');
const toolPath = [...new Set([dirname(nodeBin), dirname(asciinema), dirname(tmux), dirname(brew)])].join(':');
const releaseArchive = execFileSync(brew, ['--cache', 'port-daddy'], { encoding: 'utf8' }).trim();
const runRoot = await mkdtemp(join(scratchParent, 'pd-porthole-proof-'));
// A capture must not inherit unrelated agent salvage state from a previous
// fixture run against the shared daemon. This is a real semantic project name,
// unique to the recorder process, not a visual stand-in for another project.
const fixtureProject = `proof-${process.pid}`;
const fixtureDirs = new Set([runRoot]);
const requestedScenes = new Set(process.argv.slice(2));
const knownScenes = new Set(['quickstart', 'harness-next-turn', 'collision', 'visibility', 'recovery', 'ports', 'parley']);

for (const scene of requestedScenes) {
  if (!knownScenes.has(scene)) throw new Error(`unknown proof scene: ${scene}`);
}

function wants(scene) {
  return requestedScenes.size === 0 || requestedScenes.has(scene);
}

await mkdir(castsDir, { recursive: true });

function q(value) {
  return `'${String(value).replace(/'/g, `'"'"'`)}'`;
}

function run(bin, args, options = {}) {
  return execFileSync(bin, args, {
    cwd: options.cwd ?? root,
    env: {
      ...process.env,
      PATH: `${toolPath}:${process.env.PATH ?? ''}`,
      TERM: 'xterm-256color',
      PORT_DADDY_SKIP_FRESHNESS_CHECK: '1',
      ...options.env,
    },
    encoding: 'utf8',
    stdio: options.stdio ?? 'pipe',
  });
}

function promptColor(prompt) {
  if (prompt.startsWith('NORA')) return '\\033[1;38;5;114m';
  if (prompt.startsWith('MILO')) return '\\033[1;38;5;117m';
  if (prompt.startsWith('ENGINE')) return '\\033[1;38;5;221m';
  if (prompt.startsWith('BRIDGE')) return '\\033[1;38;5;81m';
  return '\\033[1;36m';
}

async function writeExecutable(path, body) {
  await writeFile(path, body, 'utf8');
  await chmod(path, 0o755);
}

function shellPrelude({ cwd, prompt, env = {}, sourceCli = true }) {
  const exports = Object.entries(env).map(([key, value]) => `export ${key}=${q(value)}`).join('\n');
  return `#!/usr/bin/env bash
set -uo pipefail
export PATH=${q(toolPath)}:$PATH
export PORT_DADDY_SKIP_FRESHNESS_CHECK=1
unset NO_COLOR
export FORCE_COLOR=3
export TERM=xterm-256color
${exports}
cd ${q(cwd)}
${sourceCli ? `pd() { ${q(nodeBin)} ${q(cli)} "$@"; }` : ''}
type_cmd() {
  local text="$1" i
  printf ${q(`${promptColor(prompt)}${prompt}\\033[0m \\033[1;32m❯\\033[0m `)}
  sleep 0.25
  for ((i = 0; i < \${#text}; i += 1)); do printf "%s" "\${text:$i:1}"; sleep 0.012; done
  sleep 0.18
  printf "\n"
}
run_cmd() {
  local text="$1" status=0
  type_cmd "$text"
  eval "$text" 2>&1 || status=$?
  if [ "$status" -ne 0 ]; then
    printf '\\033[1;41;97m REFUSED · command exited %s \\033[0m\\n' "$status"
  fi
  printf "\n"
  sleep 0.55
  return "$status"
}
run_required() {
  local text="$1" status=0
  run_cmd "$text" || status=$?
  if [ "$status" -ne 0 ] && [ -n "\${PD_PORTHOLE_FAILURE_FILE:-}" ]; then
    printf '%s (exit %s)\n' "$text" "$status" > "$PD_PORTHOLE_FAILURE_FILE"
  fi
  return "$status"
}
`;
}

async function recordSingle({ slug, cwd, prompt, commands, env = {}, sourceCli = true }) {
  for (const command of commands) {
    if (command.trimStart().startsWith('#')) throw new Error(`${slug}: narration comments are forbidden`);
  }
  const dir = join(runRoot, slug);
  await mkdir(dir, { recursive: true });
  const driver = join(dir, 'drive.sh');
  const failureFile = join(dir, 'required-command-failure');
  const recordEnv = { ...env, PD_PORTHOLE_FAILURE_FILE: failureFile };
  const body = shellPrelude({ cwd, prompt, env: recordEnv, sourceCli })
    + commands.map((command) => `run_required ${q(command)} || exit $?\n`).join('')
    + 'sleep 1\n';
  await writeExecutable(driver, body);
  run(asciinema, [
    'record', '--window-size', '100x28', '--headless', '--return', '--overwrite', '--quiet',
    '--command', `./${basename(driver)}`, join(castsDir, `${slug}.cast`),
  ], { cwd: dir, stdio: 'inherit', env: recordEnv });
}

async function recordTmux({ slug, left, right, durationSeconds, env = {} }) {
  const dir = join(runRoot, slug);
  await mkdir(dir, { recursive: true });
  const socket = `pd-proof-${process.pid}-${slug}`;
  const session = `proof-${slug}`;
  const tmuxConfig = join(dir, 'tmux.conf');
  const failureFile = join(dir, 'required-command-failure');
  const recordEnv = { ...env, PD_PORTHOLE_FAILURE_FILE: failureFile };
  await writeFile(tmuxConfig, `
set -g status on
set -g status-interval 0
set -g status-style 'bg=#141821,fg=#d7dbe4'
set -g status-left '#[fg=#b5d43d,bold] ⚓ PORT DADDY #[default]'
set -g status-right '#[fg=#9aa1ad]real linked worktrees · unfiltered PTY #[default]'
set -g pane-border-status top
set -g pane-border-format '#[bold] #{pane_title} #[default]'
set -g pane-border-style 'fg=#59606e'
set -g pane-active-border-style 'fg=#5b8bff'
set -g mouse off
set -g remain-on-exit on
setw -g automatic-rename off
`, 'utf8');

  async function paneScript(side, spec) {
    const path = join(dir, `${side}.sh`);
    const waitsAndCommands = spec.steps.map(({ wait = 0, command, allowFailure = false }) => {
      if (command.trimStart().startsWith('#')) throw new Error(`${slug}/${side}: narration comments are forbidden`);
      const runner = allowFailure ? 'run_cmd' : 'run_required';
      const failFast = allowFailure ? '' : ' || exit $?';
      return `${wait > 0 ? `sleep ${wait}\n` : ''}${runner} ${q(command)}${failFast}\n`;
    }).join('');
    await writeExecutable(path, shellPrelude({ cwd: spec.cwd, prompt: spec.prompt, env: { ...recordEnv, ...spec.env } })
      + `printf '\\033]2;${spec.title}\\007'\n`
      + waitsAndCommands
      + 'sleep 120\n');
    return path;
  }

  const leftScript = await paneScript('left', left);
  const rightScript = await paneScript('right', right);
  const driver = join(dir, 'drive-tmux.sh');
  await writeExecutable(driver, `#!/usr/bin/env bash
set -uo pipefail
${q(tmux)} -L ${q(socket)} -f ${q(tmuxConfig)} new-session -d -x 120 -y 34 -s ${q(session)} -c ${q(left.cwd)} ${q(leftScript)}
${q(tmux)} -L ${q(socket)} split-window -h -t ${q(session)} -c ${q(right.cwd)} ${q(rightScript)}
${q(tmux)} -L ${q(socket)} select-layout -t ${q(session)} even-horizontal >/dev/null
(
  sleep ${durationSeconds}
  ${q(tmux)} -L ${q(socket)} detach-client -s ${q(session)} >/dev/null 2>&1 || true
) &
${q(tmux)} -L ${q(socket)} attach-session -t ${q(session)}
printf '\n'
${q(tmux)} -L ${q(socket)} capture-pane -e -p -J -S -200 -t ${q(`${session}:0.0`)}
printf '\n'
${q(tmux)} -L ${q(socket)} capture-pane -e -p -J -S -200 -t ${q(`${session}:0.1`)}
${q(tmux)} -L ${q(socket)} kill-session -t ${q(session)} >/dev/null 2>&1 || true
if [ -s ${q(failureFile)} ]; then
  printf 'Porthole required command failed: ' >&2
  cat ${q(failureFile)} >&2
  exit 1
fi
`);
  try {
    run(asciinema, [
      'record', '--window-size', '120x34', '--headless', '--return', '--overwrite', '--quiet',
      '--command', `./${basename(driver)}`, join(castsDir, `${slug}.cast`),
    ], { cwd: dir, stdio: 'inherit', env: recordEnv });
  } finally {
    try { run(tmux, ['-L', socket, 'kill-server']); } catch { /* session already ended */ }
  }
}

async function makeRepo(name, files = {}) {
  const repo = join(runRoot, name);
  await mkdir(repo, { recursive: true });
  run('/usr/bin/git', ['init', '-b', 'main'], { cwd: repo });
  run('/usr/bin/git', ['config', 'user.name', 'Porthole Proof Rig'], { cwd: repo });
  run('/usr/bin/git', ['config', 'user.email', 'proof@portdaddy.local'], { cwd: repo });
  await writeFile(join(repo, 'package.json'), JSON.stringify({ name }, null, 2));
  for (const [path, contents] of Object.entries(files)) {
    const target = join(repo, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, contents, 'utf8');
  }
  run('/usr/bin/git', ['add', '.'], { cwd: repo });
  run('/usr/bin/git', ['commit', '-m', 'seed proof fixture'], { cwd: repo });
  return repo;
}

async function addWorktrees(repo, name) {
  const left = join(runRoot, `${name}-nora`);
  const right = join(runRoot, `${name}-milo`);
  run('/usr/bin/git', ['worktree', 'add', '-b', `${name}-nora`, left], { cwd: repo });
  run('/usr/bin/git', ['worktree', 'add', '-b', `${name}-milo`, right], { cwd: repo });
  return { left, right };
}

if (wants('quickstart')) {
// Unix-domain sockets have a short path limit on macOS. Give the isolated
// first-run HOME its own deliberately short root so this is a faithful startup
// proof, not an accidental test of sockaddr_un truncation.
const quickstartHome = await mkdtemp(join(scratchParent, 'pdq-'));
fixtureDirs.add(quickstartHome);
const quickstartRepo = await makeRepo('fresh-atlas', { 'README.md': '# Fresh Atlas\n' });
await mkdir(join(quickstartHome, '.local', 'port-daddy'), { recursive: true });
const profile = `p${process.pid}`;
await recordSingle({
  slug: 'quickstart',
  cwd: quickstartRepo,
  prompt: 'freshbox:~/atlas',
  env: {
    HOME: quickstartHome,
    PD_HOME: join(quickstartHome, '.pd'),
    PORT_DADDY_RESOURCE_DIR: join(quickstartHome, '.local', 'port-daddy'),
    RELEASE_ARCHIVE: releaseArchive,
  },
  sourceCli: false,
  commands: [
    'tar -xzf "$RELEASE_ARCHIVE" -C "$HOME/.local/port-daddy"',
    'export PATH="$HOME/.local/port-daddy:$PATH"',
    'pd --version',
    `pd daemon start ${profile} --port 19987 2>&1 | sed "s#$HOME#~#g"`,
    `eval "$(pd daemon env ${profile})"`,
    'pd status',
  ],
});
try {
  run(join(quickstartHome, '.local', 'port-daddy', 'pd'), ['daemon', 'stop', profile, '--force'], {
    cwd: quickstartRepo,
    env: {
      HOME: quickstartHome,
      PD_HOME: join(quickstartHome, '.pd'),
      PORT_DADDY_RESOURCE_DIR: join(quickstartHome, '.local', 'port-daddy'),
    },
  });
} catch { /* profile may already have exited */ }
}

if (wants('harness-next-turn')) {
const harnessRepo = await makeRepo('harness-context', {
  'src/checkout.ts': 'export function reserveCart() { return true }\n',
  'docs/checkout-policy.md': '# Checkout policy\n',
});
const harnessWt = (await addWorktrees(harnessRepo, 'harness-context')).left;
run(nodeBin, [cli, 'begin', 'reconcile checkout policy with current reservation logic', '--identity', `${fixtureProject}:harness`, '--lifecycle', 'durable', '--sidequest', 'public harness evidence fixture'], { cwd: harnessWt });
const who = JSON.parse(run(nodeBin, [cli, 'whoami', '--json'], { cwd: harnessWt }));
run(nodeBin, [cli, 'send', who.agentId, 'Postmaster: the checkout-policy Parley has an unread critique waiting.'], { cwd: root });
const harnessMatrix = join(runRoot, 'harness-context.matrix.env');
await recordSingle({
  slug: 'harness-next-turn',
  cwd: harnessWt,
  prompt: 'atlas◆harness',
  env: { PD_ACTOR: who.agentId, PD_AGENT_ID: who.agentId, PD_SESSION_ID: who.sessionId, PD_MATRIX_FILE: harnessMatrix, PD_HOOK_POST: join(root, 'bin', 'pd-hook-post-tool') },
  commands: [
    `printf '%s' '{"cwd":".","tool_name":"Write","tool_input":{"file_path":"src/checkout.ts"}}' | "$PD_HOOK_POST"`,
    'pd squid tap',
    'pd attention',
    'pd ideas search "checkout ownership policy" --sources markdown --limit 3',
  ],
});
}

if (wants('collision')) {
const collisionRepo = await makeRepo('collision-proof', { 'db/schema.sql': 'CREATE TABLE refunds(id TEXT PRIMARY KEY);\n' });
const collision = await addWorktrees(collisionRepo, 'collision-proof');
const collisionShared = join(runRoot, 'collision-shared');
await mkdir(collisionShared, { recursive: true });
await recordTmux({
  slug: 'collision',
  durationSeconds: 42,
  env: { PD_COLLISION_SHARED: collisionShared },
  left: {
    cwd: collision.left, prompt: 'NORA◆', title: 'NORA · migration author', steps: [
      { command: `pd begin "add refund reason code" --identity ${fixtureProject}:nora --lifecycle durable --sidequest "record collision proof"` },
      { command: 'pd plan set "- [ ] claim schema\n- [ ] add migration"' },
      { command: 'pd session files add db/schema.sql' },
      { command: 'pd note "I own db/schema.sql while adding the refund reason enum."' },
      { command: 'pd lock refunds-schema --ttl 120000 --owner nora-migration && printf ready > "$PD_COLLISION_SHARED/nora-lock"' },
      { wait: 10, command: 'pd unlock refunds-schema --owner nora-migration' },
    ],
  },
  right: {
    cwd: collision.right, prompt: 'MILO◇', title: 'MILO · checkout worker', steps: [
      { wait: 2, command: `pd begin "add refund settlement index" --identity ${fixtureProject}:milo --lifecycle durable --sidequest "record collision proof"` },
      { command: 'pd plan set "- [ ] claim schema\n- [ ] add index"' },
      { command: 'pd session files add db/schema.sql', allowFailure: true },
      { command: 'until [ -s "$PD_COLLISION_SHARED/nora-lock" ]; do sleep 0.2; done; pd lock refunds-schema --ttl 120000 --owner milo-index', allowFailure: true },
      { wait: 12, command: 'pd lock refunds-schema --ttl 120000 --owner milo-index' },
    ],
  },
});
}

if (wants('visibility')) {
const digestRepo = await makeRepo('digest-proof', { 'src/export.ts': 'export const retry = 3\n' });
const digest = await addWorktrees(digestRepo, 'digest-proof');
await recordTmux({
  slug: 'visibility',
  durationSeconds: 112,
  left: {
    cwd: digest.left, prompt: 'NORA◆', title: 'NORA · export repair', steps: [
      { command: `pd begin "repair export retry" --identity ${fixtureProject}:nora-digest --lifecycle durable --sidequest "record real elapsed digest"` },
      { command: 'date "+%H:%M:%S"' },
      { command: 'pd note "Export retry is green; bounded backoff verified against the failure window."' },
      { command: 'sleep 90' },
      { command: 'date "+%H:%M:%S"' },
      { command: 'pd notes --limit 6' },
    ],
  },
  right: {
    cwd: digest.right, prompt: 'MILO◇', title: 'MILO · policy reviewer', steps: [
      { wait: 4, command: `pd begin "review token rotation" --identity ${fixtureProject}:milo-digest --lifecycle durable --sidequest "record real elapsed digest"` },
      { command: 'pd note "Rotation interval is four hours under the new mobile policy; awaiting owner confirmation."' },
      { command: 'sleep 90' },
      { command: 'pd attention' },
    ],
  },
});
}

if (wants('recovery')) {
const recoveryRepo = await makeRepo('recovery-proof', { 'src/refund.ts': 'export const recover = true\n' });
const recovery = await addWorktrees(recoveryRepo, 'recovery-proof');
const recoveryShared = join(runRoot, 'recovery-shared');
const recoverySharedRelative = '../recovery-shared';
await mkdir(recoveryShared, { recursive: true });
await recordTmux({
  slug: 'recovery',
  durationSeconds: 32,
  left: {
    cwd: recovery.left, prompt: 'NORA◆', title: 'NORA · durable handoff', steps: [
      { command: `pd begin "prepare refund handoff" --identity ${fixtureProject}:nora-recovery --lifecycle durable --sidequest "record durable takeover proof"` },
      { command: 'pd plan set "- [ ] retain handoff note\n- [ ] verify successor"' },
      { command: 'pd session files add src/refund.ts' },
      { command: 'pd note "Refund retry is isolated; continue from this note before changing the settlement seam."' },
      { command: `pd whoami --json | node -pe 'JSON.parse(require("node:fs").readFileSync(0,"utf8")).sessionId' > ${recoverySharedRelative}/predecessor` },
      { wait: 12, command: `pd notes --session "$(cat ${recoverySharedRelative}/predecessor)" --limit 4` },
    ],
  },
  right: {
    cwd: recovery.right, prompt: 'MILO◇', title: 'MILO · successor', steps: [
      { wait: 3, command: `pd begin "continue refund handoff" --identity ${fixtureProject}:milo-recovery --lifecycle durable --sidequest "record durable takeover proof"` },
      { command: `until [ -s ${recoverySharedRelative}/predecessor ]; do sleep 0.2; done; pd session takeover "$(cat ${recoverySharedRelative}/predecessor)" "Continue from the durable refund handoff note." --purpose "verify refund handoff" --lifecycle durable` },
      { command: 'pd whoami' },
      { command: 'pd notes --limit 6' },
    ],
  },
});
}

if (wants('ports')) {
const servicePort = 19876;
const serviceProject = 'porthole-service-proof';
const serviceSemanticId = `${serviceProject}:app:main`;
const serviceRepo = await makeRepo('service-proof', {
  'service.mjs': `import { createServer } from 'node:http';\nconst port = Number(process.env.PORT);\ncreateServer((req,res) => { res.setHeader('content-type','application/json'); res.end(JSON.stringify({status:'ok',service:'atlas-api',port})); }).listen(port, () => console.log('atlas-api listening on ' + port));\n`,
  '.portdaddyrc': JSON.stringify({ project: serviceProject, services: { api: { cmd: 'node service.mjs', dir: '.', port: servicePort, healthPath: '/health' } } }, null, 2),
});
await recordTmux({
  slug: 'ports',
  durationSeconds: 25,
  left: {
    cwd: serviceRepo, prompt: 'ENGINE◆', title: 'ENGINE · pd up orchestrator', steps: [
      { command: 'pd up --dir .' },
    ],
  },
  right: {
    cwd: serviceRepo, prompt: 'BRIDGE◇', title: 'BRIDGE · readiness probe', steps: [
      { wait: 6, command: `curl -sS http://127.0.0.1:${servicePort}/health` },
      { command: `pd find '${serviceSemanticId}'` },
      { command: `pd health '${serviceSemanticId}'` },
      { command: 'pd down --dir . --yes' },
    ],
  },
});
}

if (wants('parley')) {
const parleyRepo = await makeRepo('parley-proof', { 'src/checkout.ts': 'export function settle() { return "capture-first" }\n' });
const parley = await addWorktrees(parleyRepo, 'parley-proof');
const parleyShared = join(runRoot, 'parley-shared');
const parleySharedRelative = '../parley-shared';
await mkdir(parleyShared, { recursive: true });
await recordTmux({
  // Preserve the literal two-agent protocol transcript as supporting evidence.
  // The gallery's primary cast below is a receipt rendered from this same
  // durable state, so a visitor never has to read debug performatives to
  // understand the product result.
  slug: 'parley-source',
  durationSeconds: 72,
  left: {
    cwd: parley.left, prompt: 'NORA◆', title: 'NORA · proposal author', steps: [
      { command: `pd begin "settle checkout ownership" --identity ${fixtureProject}:nora-parley --lifecycle durable --sidequest "record public Parley proof"` },
      { command: `NORA=$(pd whoami --json | node -pe 'JSON.parse(require("node:fs").readFileSync(0,"utf8")).agentId'); printf '%s' "$NORA" > ${parleySharedRelative}/nora` },
      { command: `until [ -s ${parleySharedRelative}/milo ]; do sleep 0.2; done; MILO=$(cat ${parleySharedRelative}/milo); pd parley call --surface src/checkout.ts --reason "capture-first and authorize-first branches disagree" --with "$NORA,$MILO" | tee ${parleySharedRelative}/call` },
      { command: `PARLEY=$(sed -n 's/^Parley \\([^ ]*\\).*/\\1/p' ${parleySharedRelative}/call); printf '%s' "$PARLEY" > ${parleySharedRelative}/id; pd parley propose "$PARLEY" "Capture funds first, then authorize fulfillment; rollback remains bounded."` },
      { command: `until [ -s ${parleySharedRelative}/critique-ready ]; do sleep 0.2; done; PARLEY=$(cat ${parleySharedRelative}/id); pd parley revise "$PARLEY" "Reserve funds, authorize inventory, then capture atomically; release reservation on refusal." --as "$NORA" && printf ready > ${parleySharedRelative}/revision-ready` },
      { command: `until [ -s ${parleySharedRelative}/agreement-ready ]; do sleep 0.2; done; pd parley show "$(cat ${parleySharedRelative}/id)" --as "$NORA"` },
    ],
  },
  right: {
    cwd: parley.right, prompt: 'MILO◇', title: 'MILO · adversarial reviewer', steps: [
      { wait: 2, command: `pd begin "challenge checkout ownership" --identity ${fixtureProject}:milo-parley --lifecycle durable --sidequest "record public Parley proof"` },
      { command: `MILO=$(pd whoami --json | node -pe 'JSON.parse(require("node:fs").readFileSync(0,"utf8")).agentId'); printf '%s' "$MILO" > ${parleySharedRelative}/milo` },
      { command: `until [ -s ${parleySharedRelative}/id ]; do sleep 0.2; done; PARLEY=$(cat ${parleySharedRelative}/id); pd parley show "$PARLEY"` },
      { command: `PARLEY=$(cat ${parleySharedRelative}/id); pd parley critique "$PARLEY" "Capture-first can charge an order that inventory later refuses; require a reservation receipt." --as "$MILO" && printf ready > ${parleySharedRelative}/critique-ready` },
      { command: `until [ -s ${parleySharedRelative}/revision-ready ]; do sleep 0.2; done; PARLEY=$(cat ${parleySharedRelative}/id); pd parley agree "$PARLEY" "The revision closes the charge-without-inventory hole; I agree." --as "$MILO" && printf ready > ${parleySharedRelative}/agreement-ready` },
      { wait: 5, command: `pd attention` },
    ],
  },
});

await recordTmux({
  slug: 'parley',
  durationSeconds: 24,
  env: { PD_PARLEY_RECEIPT: join(root, 'website-v2', 'scripts', 'render-parley-proof-receipt.mjs') },
  left: {
    cwd: parley.left, prompt: 'NORA◆', title: 'NORA · settlement author', steps: [
      { command: `PARLEY=$(cat ${parleySharedRelative}/id); pd parley show "$PARLEY" --as "$(cat ${parleySharedRelative}/nora)" --json | node "$PD_PARLEY_RECEIPT" --role author` },
    ],
  },
  right: {
    cwd: parley.right, prompt: 'MILO◇', title: 'MILO · adversarial reviewer', steps: [
      { command: `PARLEY=$(cat ${parleySharedRelative}/id); pd parley show "$PARLEY" --as "$(cat ${parleySharedRelative}/milo)" --json | node "$PD_PARLEY_RECEIPT" --role reviewer` },
    ],
  },
});
}

// Session teardown must be derived from the daemon's durable project index,
// not from a worktree's last active-context pointer: a takeover can leave a
// successor session that whoami in the old fixture directory no longer names.
// Archive only this recorder's uniquely named semantic project, preserving all
// notes and receipts while releasing the fixture's active claims.
function activeFixtureSessions() {
  const result = JSON.parse(run(nodeBin, [cli, 'sessions', '--all-worktrees', '--json']));
  return (result.sessions ?? []).filter((session) => (
    session.identityProject === fixtureProject && session.status === 'active'
  ));
}

for (const session of activeFixtureSessions()) {
  run(nodeBin, [cli, 'session', 'rm', session.id]);
}

const remainingFixtureSessions = activeFixtureSessions();
if (remainingFixtureSessions.length > 0) {
  throw new Error(`fixture cleanup left active session(s): ${remainingFixtureSessions.map((session) => session.id).join(', ')}`);
}

console.log(`Recorded ${requestedScenes.size === 0 ? 'all harness proof scenes' : [...requestedScenes].join(', ')} in ${relative(root, castsDir)}`);
if (process.env.PD_PORTHOLE_KEEP_FIXTURES === '1') {
  console.log(`Fixture root retained for inspection: ${runRoot}`);
} else {
  for (const dir of fixtureDirs) {
    const proofRoot = `${scratchParent}/pd-porthole-proof-`;
    const quickstartRoot = `${scratchParent}/pdq-`;
    if (!dir.startsWith(proofRoot) && !dir.startsWith(quickstartRoot)) {
      throw new Error(`refusing to remove non-proof fixture path: ${dir}`);
    }
    await rm(dir, { recursive: true, force: true });
  }
  console.log('Fixture sessions archived with notes preserved and isolated proof roots removed.');
}
