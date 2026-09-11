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
import { createHash } from 'node:crypto';
import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const castsDir = join(root, 'website-v2', 'public', 'casts', 'porthole');
const parleyPaneEvidencePath = join(root, 'website-v2', 'src', 'data', 'evidence', 'parley-source-panes.json');
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

/**
 * Resolves a clean runtime for the recorded CLI rather than letting a known
 * loader warning become part of supposedly product-grade terminal evidence.
 * Explicit overrides remain authoritative; otherwise the recorder tries the
 * current process and PATH, never a package-manager-specific location.
 */
function resolveNodeBin() {
  const explicit = process.env.PD_PORTHOLE_NODE;
  const pathNode = resolveTool('PD_PORTHOLE_PATH_NODE', 'node');
  const candidates = [...new Set([explicit, process.execPath, pathNode].filter(Boolean))];
  for (const candidate of candidates) {
    const version = execFileSync(candidate, ['--version'], { encoding: 'utf8' }).trim();
    const major = Number(/^v(\d+)/.exec(version)?.[1]);
    if (Number.isInteger(major) && major >= 20 && major < 26) return candidate;
  }
  throw new Error(`Porthole refuses a runtime that emits tsx loader warnings. Set PD_PORTHOLE_NODE to a Node 20-25 executable; tried ${candidates.join(', ')}`);
}

/**
 * Publishes the existing daemon endpoint into the isolated HOME used by the
 * harness context scene. This keeps its displayed CWD fixture-relative while
 * preserving a real connection to the daemon that owns the pre-recorded
 * session, rather than post-processing the terminal output.
 */
async function resolveRecorderDaemonUrl() {
  if (process.env.PD_PORTHOLE_DAEMON_URL) return process.env.PD_PORTHOLE_DAEMON_URL;
  if (process.env.PORT_DADDY_URL) return process.env.PORT_DADDY_URL;
  const pdHome = process.env.PD_HOME ?? join(homedir(), '.port-daddy');
  const port = (await readFile(join(pdHome, 'daemon.port'), 'utf8')).trim();
  if (!/^\d+$/.test(port)) throw new Error(`Porthole recorder found an invalid daemon port in ${join(pdHome, 'daemon.port')}`);
  return `http://127.0.0.1:${port}`;
}

// Keep the CLI process ABI-compatible with the runtime that records it.
// Individual tools can be overridden for an intentionally provisioned rig.
const nodeBin = resolveNodeBin();
const cli = join(root, 'bin', 'port-daddy-cli.js');
const asciinema = resolveTool('PD_PORTHOLE_ASCIINEMA', 'asciinema');
const tmux = resolveTool('PD_PORTHOLE_TMUX', 'tmux');
const brew = resolveTool('PD_PORTHOLE_BREW', 'brew');
const toolPath = [...new Set([dirname(nodeBin), dirname(asciinema), dirname(tmux), dirname(brew)])].join(':');
const releaseArchive = execFileSync(brew, ['--cache', 'port-daddy'], { encoding: 'utf8' }).trim();
const runRoot = await mkdtemp(join(scratchParent, 'pd-porthole-proof-'));
const recorderDaemonUrl = await resolveRecorderDaemonUrl();
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
  if (prompt.startsWith('AYA')) return '\\033[1;38;5;208m';
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
run_silent_required() {
  local text="$1" status=0
  eval "$text" 2>&1 || status=$?
  if [ "$status" -ne 0 ]; then
    printf '\\033[1;41;97m REFUSED · witness exited %s \\033[0m\\n' "$status"
    if [ -n "\${PD_PORTHOLE_FAILURE_FILE:-}" ]; then
      printf '%s (exit %s)\n' "$text" "$status" > "$PD_PORTHOLE_FAILURE_FILE"
    fi
  fi
  return "$status"
}
wait_for_files() {
  local deadline=$((SECONDS + 45)) path ready
  while true; do
    ready=1
    for path in "$@"; do
      if [ ! -s "$path" ]; then ready=0; break; fi
    done
    if [ "$ready" -eq 1 ]; then return 0; fi
    if [ "$SECONDS" -ge "$deadline" ]; then
      printf '\\033[1;41;97m REFUSED · timed out waiting for durable fixture barrier \\033[0m\\n'
      return 124
    fi
    sleep 0.2
  done
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

async function recordTmux({ slug, left, right, third = null, witness = null, durationSeconds, env = {}, paneArchive = null }) {
  const dir = join(runRoot, slug);
  await mkdir(dir, { recursive: true });
  const socket = `pd-proof-${process.pid}-${slug}`;
  const session = `proof-${slug}`;
  const tmuxConfig = join(dir, 'tmux.conf');
  const failureFile = join(dir, 'required-command-failure');
  const paneCapturedAtFile = join(dir, 'pane-captured-at');
  const historyLimit = 10_000;
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
set -g history-limit ${historyLimit}
setw -g automatic-rename off
`, 'utf8');

  async function paneScript(side, spec) {
    const path = join(dir, `${side}.sh`);
    const waitsAndCommands = spec.steps.map(({ wait = 0, command, allowFailure = false, silent = false }) => {
      if (command.trimStart().startsWith('#')) throw new Error(`${slug}/${side}: narration comments are forbidden`);
      const runner = silent ? 'run_silent_required' : allowFailure ? 'run_cmd' : 'run_required';
      const failFast = allowFailure ? '' : ' || exit $?';
      return `${wait > 0 ? `sleep ${wait}\n` : ''}${runner} ${q(command)}${failFast}\n`;
    }).join('');
    await writeExecutable(path, shellPrelude({
      cwd: spec.cwd,
      prompt: spec.prompt,
      env: { ...recordEnv, ...spec.env },
      sourceCli: spec.sourceCli !== false,
    })
      + waitsAndCommands
      + 'sleep 120\n');
    return path;
  }

  const leftScript = await paneScript('left', left);
  const rightScript = await paneScript('right', right);
  const thirdScript = third ? await paneScript('third', third) : null;
  const witnessScript = witness ? await paneScript('witness', witness) : null;
  const dimensions = witness
    ? { cols: 160, rows: 44, mainWidth: 80 }
    : third
      ? { cols: 140, rows: 40, mainWidth: 70 }
      : { cols: 120, rows: 34, mainWidth: 60 };
  const extraPaneSetup = witness && third && thirdScript && witnessScript ? `
THIRD_PANE="$(${q(tmux)} -L ${q(socket)} split-window -v -t "$LEFT_PANE" -P -F '#{pane_id}' -c ${q(third.cwd)} ${q(thirdScript)})"
WITNESS_PANE="$(${q(tmux)} -L ${q(socket)} split-window -v -t "$RIGHT_PANE" -P -F '#{pane_id}' -c ${q(witness.cwd)} ${q(witnessScript)})"
${q(tmux)} -L ${q(socket)} select-layout -t ${q(session)} tiled >/dev/null
${q(tmux)} -L ${q(socket)} select-pane -t "$THIRD_PANE" -T ${q(third.title)}
${q(tmux)} -L ${q(socket)} select-pane -t "$WITNESS_PANE" -T ${q(witness.title)}` : third && thirdScript ? `
THIRD_PANE="$(${q(tmux)} -L ${q(socket)} split-window -v -t "$RIGHT_PANE" -P -F '#{pane_id}' -c ${q(third.cwd)} ${q(thirdScript)})"
${q(tmux)} -L ${q(socket)} set-window-option -t ${q(session)} main-pane-width ${dimensions.mainWidth} >/dev/null
${q(tmux)} -L ${q(socket)} select-layout -t ${q(session)} main-vertical >/dev/null
${q(tmux)} -L ${q(socket)} select-pane -t "$THIRD_PANE" -T ${q(third.title)}` : `
${q(tmux)} -L ${q(socket)} select-layout -t ${q(session)} even-horizontal >/dev/null`;
  const extraPaneCapture = witness ? `
printf '\\n'
${q(tmux)} -L ${q(socket)} capture-pane -e -p -J -S -200 -t "$THIRD_PANE"
printf '\\n'
${q(tmux)} -L ${q(socket)} capture-pane -e -p -J -S -200 -t "$WITNESS_PANE"` : third ? `
printf '\\n'
${q(tmux)} -L ${q(socket)} capture-pane -e -p -J -S -200 -t "$THIRD_PANE"` : '';
  const paneBindings = new Map([
    ['left', { variable: '$LEFT_PANE', spec: left }],
    ['right', { variable: '$RIGHT_PANE', spec: right }],
    ['third', { variable: '$THIRD_PANE', spec: third }],
    ['witness', { variable: '$WITNESS_PANE', spec: witness }],
  ]);
  const archiveEntries = (paneArchive?.panes ?? []).map((pane) => {
    const binding = paneBindings.get(pane.side);
    if (!binding?.spec) throw new Error(`${slug}: pane archive refers to unavailable ${pane.side} pane`);
    return {
      ...pane,
      capturePath: join(dir, `pane-${pane.id}.txt`),
      metadataPath: join(dir, `pane-${pane.id}.meta`),
      variable: binding.variable,
      title: binding.spec.title,
      prompt: binding.spec.prompt,
    };
  });
  const archiveCapture = archiveEntries.length > 0
    ? `/bin/date -u '+%Y-%m-%dT%H:%M:%SZ' > ${q(paneCapturedAtFile)}\n${archiveEntries.map((pane) => `${q(tmux)} -L ${q(socket)} display-message -p -t "${pane.variable}" '#{pane_width}\t#{pane_height}\t#{history_size}' > ${q(pane.metadataPath)}\n${q(tmux)} -L ${q(socket)} capture-pane -p -J -S - -t "${pane.variable}" > ${q(pane.capturePath)}`).join('\n')}\n`
    : '';
  const terminalCapture = paneArchive
    ? `printf '\nPORTHOLE PANE ARCHIVE · ${archiveEntries.length} real tmux histories captured before teardown\n'`
    : `printf '\n'
${q(tmux)} -L ${q(socket)} capture-pane -e -p -J -S -200 -t "$LEFT_PANE"
printf '\n'
${q(tmux)} -L ${q(socket)} capture-pane -e -p -J -S -200 -t "$RIGHT_PANE"
${extraPaneCapture}`;
  const driver = join(dir, 'drive-tmux.sh');
  await writeExecutable(driver, `#!/usr/bin/env bash
set -uo pipefail
${q(tmux)} -L ${q(socket)} -f ${q(tmuxConfig)} new-session -d -x ${dimensions.cols} -y ${dimensions.rows} -s ${q(session)} -c ${q(left.cwd)} ${q(leftScript)}
LEFT_PANE="$(${q(tmux)} -L ${q(socket)} display-message -p -t ${q(session)} '#{pane_id}')"
RIGHT_PANE="$(${q(tmux)} -L ${q(socket)} split-window -h -t "$LEFT_PANE" -P -F '#{pane_id}' -c ${q(right.cwd)} ${q(rightScript)})"
${extraPaneSetup}
${q(tmux)} -L ${q(socket)} select-pane -t "$LEFT_PANE" -T ${q(left.title)}
${q(tmux)} -L ${q(socket)} select-pane -t "$RIGHT_PANE" -T ${q(right.title)}
(
  sleep ${durationSeconds}
  ${q(tmux)} -L ${q(socket)} detach-client -s ${q(session)} >/dev/null 2>&1 || true
) &
${q(tmux)} -L ${q(socket)} attach-session -t ${q(session)}
${archiveCapture}${terminalCapture}
${q(tmux)} -L ${q(socket)} kill-session -t ${q(session)} >/dev/null 2>&1 || true
if [ -s ${q(failureFile)} ]; then
  printf 'Porthole required command failed: ' >&2
  cat ${q(failureFile)} >&2
  exit 1
fi
`);
  try {
    const castPath = join(castsDir, `${slug}.cast`);
    run(asciinema, [
      'record', '--window-size', `${dimensions.cols}x${dimensions.rows}`, '--headless', '--return', '--overwrite', '--quiet',
      '--command', `./${basename(driver)}`, castPath,
    ], { cwd: dir, stdio: 'inherit', env: recordEnv });
    if (paneArchive && archiveEntries.length > 0) {
      const castBytes = await readFile(castPath);
      const header = JSON.parse(castBytes.toString('utf8').split('\n', 1)[0]);
      const capturedAt = (await readFile(paneCapturedAtFile, 'utf8')).trim();
      const panes = await Promise.all(archiveEntries.map(async ({ capturePath, metadataPath, variable: _variable, side: _side, ...pane }) => {
        const captureBytes = await readFile(capturePath);
        const lines = captureBytes.toString('utf8').replaceAll('\r', '').split('\n');
        while (lines[0] === '') lines.shift();
        while (lines.at(-1) === '') lines.pop();
        if (lines.length === 0) throw new Error(`${slug}: ${pane.id} pane archive is empty`);
        const [width, height, historySize] = (await readFile(metadataPath, 'utf8')).trim().split('\t').map(Number);
        if (![width, height, historySize].every((value) => Number.isSafeInteger(value) && value >= 0)) {
          throw new Error(`${slug}: ${pane.id} pane returned invalid geometry/history metadata`);
        }
        return {
          ...pane,
          geometry: { cols: width, rows: height },
          historySize,
          historyLimit,
          historyLimitReached: historySize >= historyLimit,
          digestSha256: createHash('sha256').update(`${lines.join('\n')}\n`).digest('hex'),
          lines,
        };
      }));
      await mkdir(dirname(paneArchive.output), { recursive: true });
      await writeFile(paneArchive.output, `${JSON.stringify({
        schema: 'porthole.tmux-pane-archive.v1',
        sourceCast: `${slug}.cast`,
        sourceCastSha256: createHash('sha256').update(castBytes).digest('hex'),
        recordingStartedAt: new Date(Number(header.timestamp) * 1000).toISOString(),
        capturedAt,
        outerTerminal: { cols: dimensions.cols, rows: dimensions.rows },
        capture: 'tmux capture-pane -p -J -S -',
        capturedFromAvailableHistoryStart: true,
        panes,
      }, null, 2)}\n`, 'utf8');
    }
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

async function addThreeWorktrees(repo, name) {
  const worktrees = await addWorktrees(repo, name);
  const third = join(runRoot, `${name}-aya`);
  run('/usr/bin/git', ['worktree', 'add', '-b', `${name}-aya`, third], { cwd: repo });
  return { ...worktrees, third };
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
// `pd squid tap` truthfully names the registered turn-start tentacle that
// produced the injection. Stage only that live tentacle under the fixture HOME
// so the capture retains authentic provenance without implying the retired
// per-tool observer is still part of the harness lifecycle.
const harnessPdHome = join(runRoot, '.port-daddy');
const stagedPromptTentacle = join(harnessPdHome, 'bin', 'squid', 'pd-hook-prompt');
await mkdir(dirname(stagedPromptTentacle), { recursive: true });
await symlink(join(root, 'bin', 'pd-hook-prompt'), stagedPromptTentacle);
run(nodeBin, [cli, 'begin', 'reconcile checkout policy with current reservation logic', '--identity', `${fixtureProject}:harness`, '--lifecycle', 'durable', '--sidequest', 'public harness evidence fixture'], { cwd: harnessWt });
const who = JSON.parse(run(nodeBin, [cli, 'whoami', '--json'], { cwd: harnessWt }));
run(nodeBin, [cli, 'send', who.agentId, 'Postmaster: the checkout-policy Parley has an unread critique waiting.'], { cwd: root });
await recordSingle({
  slug: 'harness-next-turn',
  cwd: harnessWt,
  prompt: 'atlas◆harness',
  env: {
    HOME: runRoot,
    PD_HOME: harnessPdHome,
    PORT_DADDY_URL: recorderDaemonUrl,
    PD_ACTOR: who.agentId,
    PD_AGENT_ID: who.agentId,
    PD_SESSION_ID: who.sessionId,
  },
  commands: [
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
      { command: `node -e 'const config=JSON.parse(require("node:fs").readFileSync(".portdaddyrc","utf8")); if (typeof config.project !== "string") process.exit(2); console.log("Configured project: " + config.project)'` },
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
const parley = await addThreeWorktrees(parleyRepo, 'parley-proof');
const parleyShared = join(runRoot, 'parley-shared');
const parleySharedRelative = '../parley-shared';
await mkdir(parleyShared, { recursive: true });
await recordTmux({
  // Preserve the literal three-agent protocol transcript as supporting
  // evidence. Every pane owns a different worktree, session, prompt, and
  // public rationale; the audience-facing commentary may explain these turns
  // but may never replace or rewrite them.
  slug: 'parley-source',
  durationSeconds: 88,
  env: {
    PORT_DADDY_URL: recorderDaemonUrl,
    PD_PARLEY_WITNESS: join(root, 'website-v2', 'scripts', 'render-parley-live-commentary.mjs'),
  },
  left: {
    cwd: parley.left, prompt: 'NORA◆', title: 'NORA · proposal author', steps: [
      { command: `pd begin "settle checkout ownership" --identity ${fixtureProject}:nora-parley --lifecycle durable --sidequest "record public Parley proof"` },
      { command: `NORA=$(pd whoami --json | node -pe 'JSON.parse(require("node:fs").readFileSync(0,"utf8")).agentId'); printf '%s' "$NORA" > ${parleySharedRelative}/nora` },
      { command: `wait_for_files ${parleySharedRelative}/milo ${parleySharedRelative}/aya; MILO=$(cat ${parleySharedRelative}/milo); AYA=$(cat ${parleySharedRelative}/aya); pd parley call --surface src/checkout.ts --reason "capture-first, inventory safety, and retry safety disagree" --with "$NORA,$MILO,$AYA" | tee ${parleySharedRelative}/call` },
      { command: `PARLEY=$(sed -n 's/^Parley \\([^ ]*\\).*/\\1/p' ${parleySharedRelative}/call); printf '%s' "$PARLEY" > ${parleySharedRelative}/id; pd parley propose "$PARLEY" "I own checkout flow. Capture funds first, then authorize fulfillment; rollback remains bounded."` },
      { command: `wait_for_files ${parleySharedRelative}/critique-ready ${parleySharedRelative}/safety-ready; PARLEY=$(cat ${parleySharedRelative}/id); pd parley revise "$PARLEY" "I changed the plan: reserve inventory, authorize payment, then capture once under one idempotency key; release the reservation on refusal." --as "$NORA" && printf ready > ${parleySharedRelative}/revision-ready` },
      { command: `wait_for_files ${parleySharedRelative}/milo-agreed ${parleySharedRelative}/aya-agreed; pd parley show "$(cat ${parleySharedRelative}/id)" --as "$NORA" && printf ready > ${parleySharedRelative}/complete` },
    ],
  },
  right: {
    cwd: parley.right, prompt: 'MILO◇', title: 'MILO · adversarial reviewer', steps: [
      { wait: 2, command: `pd begin "challenge checkout ownership" --identity ${fixtureProject}:milo-parley --lifecycle durable --sidequest "record public Parley proof"` },
      { command: `MILO=$(pd whoami --json | node -pe 'JSON.parse(require("node:fs").readFileSync(0,"utf8")).agentId'); printf '%s' "$MILO" > ${parleySharedRelative}/milo` },
      { command: `wait_for_files ${parleySharedRelative}/id; PARLEY=$(cat ${parleySharedRelative}/id); pd parley show "$PARLEY"` },
      { command: `PARLEY=$(cat ${parleySharedRelative}/id); pd parley critique "$PARLEY" "I am the adversarial reviewer. Capture-first can charge an order that inventory later refuses; require a reservation receipt." --as "$MILO" && printf ready > ${parleySharedRelative}/critique-ready` },
      { command: `wait_for_files ${parleySharedRelative}/revision-ready; PARLEY=$(cat ${parleySharedRelative}/id); pd parley agree "$PARLEY" "My charge-without-inventory objection is closed by the reservation receipt and capture-after-authorization order." --as "$MILO" && printf ready > ${parleySharedRelative}/milo-agreed` },
      { command: `wait_for_files ${parleySharedRelative}/aya-agreed; pd parley show "$(cat ${parleySharedRelative}/id)" --as "$MILO"` },
    ],
  },
  third: {
    cwd: parley.third, prompt: 'AYA●', title: 'AYA · delivery safety owner', steps: [
      { wait: 4, command: `pd begin "bind checkout retry safety" --identity ${fixtureProject}:aya-parley --lifecycle durable --sidequest "record public Parley proof"` },
      { command: `AYA=$(pd whoami --json | node -pe 'JSON.parse(require("node:fs").readFileSync(0,"utf8")).agentId'); printf '%s' "$AYA" > ${parleySharedRelative}/aya` },
      { command: `wait_for_files ${parleySharedRelative}/id; PARLEY=$(cat ${parleySharedRelative}/id); pd parley show "$PARLEY"` },
      { command: `PARLEY=$(cat ${parleySharedRelative}/id); pd parley respond "$PARLEY" --performative inform --content "I am the delivery safety owner. One idempotency key must bind reservation, authorization, and capture so retries cannot double-charge." --as "$AYA" && printf ready > ${parleySharedRelative}/safety-ready` },
      { command: `wait_for_files ${parleySharedRelative}/revision-ready; PARLEY=$(cat ${parleySharedRelative}/id); pd parley agree "$PARLEY" "My retry-safety objection is closed because the same idempotency key now binds all three effects." --as "$AYA" && printf ready > ${parleySharedRelative}/aya-agreed` },
      { command: `wait_for_files ${parleySharedRelative}/milo-agreed; pd parley show "$(cat ${parleySharedRelative}/id)" --as "$AYA"` },
    ],
  },
  witness: {
    cwd: parleyRepo,
    prompt: 'WITNESS',
    title: 'PORT DADDY WITNESS · read-only commentary',
    sourceCli: false,
    steps: [
      {
        silent: true,
        command: `node "$PD_PARLEY_WITNESS" --id-file ${parleyShared}/id --done-file ${parleyShared}/complete --nora-file ${parleyShared}/nora --milo-file ${parleyShared}/milo --aya-file ${parleyShared}/aya --expected-turns 6`,
      },
    ],
  },
  paneArchive: {
    output: parleyPaneEvidencePath,
    panes: [
      { side: 'left', id: 'nora', name: 'Nora', mark: '◆', role: 'Proposal author', color: '#87d75f' },
      { side: 'right', id: 'milo', name: 'Milo', mark: '◇', role: 'Adversarial reviewer', color: '#5fd7ff' },
      { side: 'third', id: 'aya', name: 'Aya', mark: '●', role: 'Delivery safety owner', color: '#ff8700' },
      { side: 'witness', id: 'witness', name: 'Port Daddy', mark: '▣', role: 'Read-only witness', color: '#5b8bff' },
    ],
  },
});

await recordTmux({
  slug: 'parley',
  durationSeconds: 24,
  env: {
    PORT_DADDY_URL: recorderDaemonUrl,
    PD_PARLEY_RECEIPT: join(root, 'website-v2', 'scripts', 'render-parley-proof-receipt.mjs'),
  },
  left: {
    cwd: parley.left, prompt: 'NORA◆', title: 'NORA · settlement author', steps: [
      { wait: 1, command: `PARLEY=$(cat ${parleySharedRelative}/id); FORCE_COLOR=0 pd parley show "$PARLEY" --as "$(cat ${parleySharedRelative}/nora)" --json > ${parleySharedRelative}/nora-receipt.json && FORCE_COLOR=3 node "$PD_PARLEY_RECEIPT" --role author < ${parleySharedRelative}/nora-receipt.json` },
    ],
  },
  right: {
    cwd: parley.right, prompt: 'MILO◇', title: 'MILO · adversarial reviewer', steps: [
      { wait: 3, command: `PARLEY=$(cat ${parleySharedRelative}/id); FORCE_COLOR=0 pd parley show "$PARLEY" --as "$(cat ${parleySharedRelative}/milo)" --json > ${parleySharedRelative}/milo-receipt.json && FORCE_COLOR=3 node "$PD_PARLEY_RECEIPT" --role reviewer < ${parleySharedRelative}/milo-receipt.json` },
    ],
  },
  third: {
    cwd: parley.third, prompt: 'AYA●', title: 'AYA · delivery safety owner', steps: [
      { wait: 5, command: `PARLEY=$(cat ${parleySharedRelative}/id); FORCE_COLOR=0 pd parley show "$PARLEY" --as "$(cat ${parleySharedRelative}/aya)" --json > ${parleySharedRelative}/aya-receipt.json && FORCE_COLOR=3 node "$PD_PARLEY_RECEIPT" --role safety-owner < ${parleySharedRelative}/aya-receipt.json` },
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
