import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '../..');
const SAFE_SCRATCH_ROOT = join(homedir(), 'coding', 'tmp');
const cliSource = readFileSync(join(ROOT, 'bin/port-daddy-cli.ts'), 'utf8');
let resolveVerbHelp;
let shouldDispatchHelpToHandler;
let ALL_COMMANDS;
let TOPIC_HELP;
let HELP_TOPIC_ALIASES;
let VERB_HELP;

beforeAll(async () => {
  process.env.PORT_DADDY_SUPPRESS_CLI_MAIN = '1';
  const cli = await import('../../bin/port-daddy-cli.ts');
  ({
    resolveVerbHelp,
    shouldDispatchHelpToHandler,
    ALL_COMMANDS,
    TOPIC_HELP,
    HELP_TOPIC_ALIASES,
    VERB_HELP,
  } = cli);
  // This one-time import transpiles the ENTIRE CLI dispatch graph (every
  // cli/commands/* module) through the ESM transform. Its cost is machine-
  // speed-dependent, not behavior-dependent: a cold macOS CI runner has blown
  // the default 10s hook budget while the same commit's ubuntu job (and a
  // rerun on the identical graph) sailed through. The generous explicit
  // timeout below keeps the suite honest about WHAT it asserts (help-topic
  // coverage) without letting a slow transform masquerade as a red product.
}, 120_000);

const GLOBAL_HELP_IS_CORRECT = ['help', 'version'];

// Deliberately uncovered verbs. This is a ratchet: adding a new command without
// help fails, and covering one requires deleting it from this list.
const KNOWN_UNCOVERED = [
  'cut', 'batten', 'log', 'activity', 'wallet', 'bond', 'say', 'account', 'nudge',
  'dashboard', 'webhook', 'webhooks', 'metrics', 'config',
  'start', 'stop', 'restart', 'status', 'install', 'uninstall',
  'install-bosun',
  'dev', 'use', 'ci-gate', 'self-update', 'upgrade',
  'doctor', 'diagnose', 'hints', 'mcp', 'bench', 'benchmark', 'look',
  'changelog', 'booty', 'tunnel', 'briefing', 'integration', 'pheromone', 'ph',
  'b', 'w', 'who-owns', 'history', 'files', 'add',
  'snapshots', 'snapshot', 'backup', 'restore', 'attest', 'shipwright',
  'spawn', 'spawned', 'watch', 'work', 'transcripts', 'transcript', 'relay',
  'harbor', 'harbors', 'harbor-ledger', 'whois', 'demo', 'fleet', 'backend',
  'tuple', 'sortie', 'embed', 'quorum', 'commit', 'obligations',
  'cockpit', 'popper', 'harbormaster', 'hm',
  'dispatch', 'nightshift', 'review', 'morning',
  'periscope', 'sight', 'scope', 'coast-guard', 'cg', 'safe', 'plan', 'suggest',
  'seamanship', 'skills',
];

function hasDedicatedHelp(command) {
  return resolveVerbHelp(command) !== null || shouldDispatchHelpToHandler(command);
}

function isolatedHelpEnv(daemonUrl) {
  const env = {
    ...process.env,
    PD_URL: daemonUrl,
    PORT_DADDY_URL: daemonUrl,
    PORT_DADDY_NO_RETRY: '1',
    PORT_DADDY_NO_UPDATE_CHECK: '1',
    NO_COLOR: '1',
  };
  delete env.PORT_DADDY_SUPPRESS_CLI_MAIN;
  delete env.PORT_DADDY_PROFILE;
  return env;
}

function implicitHelpEnv(portFile, pdHome) {
  const env = {
    ...process.env,
    PD_HOME: pdHome,
    PORT_DADDY_PORT_FILE: portFile,
    PORT_DADDY_SOCK: join(pdHome, 'absent.sock'),
    PORT_DADDY_TCP_HOST: '127.0.0.1',
    PORT_DADDY_NO_RETRY: '1',
    NO_COLOR: '1',
  };
  for (const key of [
    'PD_URL',
    'PORT_DADDY_URL',
    'PORT_DADDY_PORT',
    'PORT_DADDY_PROFILE',
    'PORT_DADDY_SKIP_FRESHNESS_CHECK',
    'PORT_DADDY_NO_UPDATE_CHECK',
    'PORT_DADDY_SUPPRESS_CLI_MAIN',
  ]) delete env[key];
  return env;
}

async function captureDaemonRequests(run) {
  mkdirSync(SAFE_SCRATCH_ROOT, { recursive: true });
  const scratch = mkdtempSync(join(SAFE_SCRATCH_ROOT, 'pd-parley-help-capture-'));
  const requestLog = join(scratch, 'requests.log');
  writeFileSync(requestLog, '');
  const serverSource = `
    const fs = require('node:fs');
    const http = require('node:http');
    const requestLog = process.argv[1];
    const server = http.createServer((request, response) => {
      fs.appendFileSync(requestLog, request.method + ' ' + request.url + '\\n');
      request.resume();
      request.on('end', () => {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end('{}');
      });
    });
    server.listen(0, '127.0.0.1', () => process.stdout.write(String(server.address().port) + '\\n'));
    process.on('SIGTERM', () => server.close(() => process.exit(0)));
  `;
  const server = spawn(process.execPath, ['-e', serverSource, requestLog], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.setEncoding('utf8');
  let output = '';
  const port = await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.once('exit', (code) => reject(new Error(`capture server exited before listening: ${code}`)));
    server.stdout.on('data', (chunk) => {
      output += chunk;
      const line = output.split('\n')[0];
      if (/^\d+$/.test(line)) resolve(Number(line));
    });
  });
  const portFile = join(scratch, 'daemon.port');
  const pdHome = join(scratch, 'pd-home');
  mkdirSync(pdHome, { recursive: true });
  writeFileSync(portFile, `${port}\n`);

  try {
    const result = run({ daemonUrl: `http://127.0.0.1:${port}`, pdHome, portFile });
    return {
      result,
      requests: readFileSync(requestLog, 'utf8'),
      wroteUpdateCheck: existsSync(join(pdHome, 'update-check.json')),
    };
  } finally {
    if (server.exitCode === null) {
      server.kill('SIGTERM');
      await once(server, 'exit');
    }
    rmSync(scratch, { recursive: true, force: true });
  }
}

describe('messaging discoverability', () => {
  test('HELP_TOPIC_ALIASES maps the messaging family to the messaging topic', () => {
    for (const cmd of ['inbox', 'send', 'tube', 'pub', 'sub', 'channels', 'wait']) {
      expect(HELP_TOPIC_ALIASES[cmd]).toBe('messaging');
    }
  });

  test('`pd send` is wired as a top-level verb routing to durable inbox send', () => {
    expect(cliSource).toMatch(/case 'send':\s*\n\s*await handleInbox\('send', positional, options\)/);
  });

  test('main help surfaces the durable directed primitives', () => {
    expect(cliSource).toContain('pd send');
    expect(cliSource).toContain('Read direct messages sent to you');
  });
});

describe('`pd <verb> --help` coverage', () => {
  test('imports the real dispatch tables and resolver', () => {
    expect(ALL_COMMANDS.length).toBeGreaterThan(150);
    expect(Object.keys(TOPIC_HELP).length).toBeGreaterThan(15);
    expect(Object.keys(HELP_TOPIC_ALIASES).length).toBeGreaterThan(40);
    expect(Object.keys(VERB_HELP).length).toBeGreaterThan(3);
  });

  test('runs the exact resolver used by the dispatch', () => {
    expect(resolveVerbHelp('inbox')).toMatch(/messaging/i);
    expect(resolveVerbHelp('claim')).toMatch(/Port Management/);
    expect(resolveVerbHelp('roster')).toMatch(/pd roster/);
    expect(resolveVerbHelp('sitrep')).toMatch(/pd sitrep/);
    expect(resolveVerbHelp('cut')).toBeNull();
    expect(resolveVerbHelp('help')).toBeNull();
    expect(shouldDispatchHelpToHandler('parley')).toBe(true);
    expect(shouldDispatchHelpToHandler('squid')).toBe(true);
  });

  test('`pd parley --help` reaches Parley-owned help without daemon writes', async () => {
    const { result, requests, wroteUpdateCheck } = await captureDaemonRequests(({ pdHome, portFile }) => spawnSync(
      process.execPath,
      [join(ROOT, 'bin/port-daddy-cli.js'), 'parley', '--help'],
      { cwd: ROOT, env: implicitHelpEnv(portFile, pdHome), encoding: 'utf8', timeout: 30_000 },
    ));

    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/pd parley call --surface/);
    expect(result.stdout).toMatch(/pd parley propose\|critique\|revise\|agree\|refuse\|say/);
    expect(result.stdout).toMatch(/raw resolve is CAP0-gated and currently fail-closed/);
    expect(result.stdout).not.toMatch(/Get started:/);
    expect(result.stderr).not.toMatch(/required|fetch|ECONNREFUSED/i);
    expect(requests).toBe('');
    expect(wroteUpdateCheck).toBe(false);
  }, 90_000);

  test('`pd parley call --help` short-circuits before mutation or telemetry', async () => {
    const { result, requests } = await captureDaemonRequests(({ daemonUrl }) => spawnSync(
      process.execPath,
      [
        join(ROOT, 'node_modules/.bin/tsx'),
        join(ROOT, 'bin/port-daddy-cli.ts'),
        'parley', 'call', '--help',
        '--surface', 'never-written.ts',
        '--reason', 'prove help cannot mutate',
        '--with', 'actor-a,actor-b',
      ],
      { cwd: ROOT, env: isolatedHelpEnv(daemonUrl), encoding: 'utf8', timeout: 30_000 },
    ));

    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/pd parley call --surface/);
    expect(result.stdout).toMatch(/raw resolve is CAP0-gated and currently fail-closed/);
    expect(result.stderr).not.toMatch(/required|fetch|ECONNREFUSED/i);
    expect(requests).toBe('');
  }, 90_000);

  test('`pd parley help` is the same non-mutating help contract', async () => {
    const { result, requests } = await captureDaemonRequests(({ daemonUrl }) => spawnSync(
      process.execPath,
      [join(ROOT, 'node_modules/.bin/tsx'), join(ROOT, 'bin/port-daddy-cli.ts'), 'parley', 'help'],
      { cwd: ROOT, env: isolatedHelpEnv(daemonUrl), encoding: 'utf8', timeout: 30_000 },
    ));

    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/pd parley call --surface/);
    expect(result.stderr).not.toMatch(/required|fetch|ECONNREFUSED/i);
    expect(requests).toBe('');
  }, 90_000);

  test('every alias points at a topic that exists', () => {
    const dangling = Object.entries(HELP_TOPIC_ALIASES).filter(([, topic]) => !(topic in TOPIC_HELP));
    expect(dangling).toEqual([]);
  });

  test('VERB_HELP does not shadow a real topic name', () => {
    for (const verb of Object.keys(VERB_HELP)) expect(verb in TOPIC_HELP).toBe(false);
  });

  test('(a) every uncovered verb is pinned', () => {
    const uncovered = ALL_COMMANDS.filter(
      (cmd) => !hasDedicatedHelp(cmd) && !GLOBAL_HELP_IS_CORRECT.includes(cmd),
    );
    expect(uncovered.filter((cmd) => !KNOWN_UNCOVERED.includes(cmd)).sort()).toEqual([]);
  });

  test('(b) the uncovered list shrinks when help lands', () => {
    const stale = KNOWN_UNCOVERED.filter(
      (cmd) => ALL_COMMANDS.includes(cmd) && hasDedicatedHelp(cmd),
    );
    expect(stale.sort()).toEqual([]);
  });

  test('the integrated help families stay covered verb by verb', () => {
    for (const cmd of [
      'session', 'takeover', 'note', 'notes', 'feedback',
      'whoami', 'begin', 'done', 'with-lock', 'n', 'u', 'd',
      'agent', 'agents', 'swarm', 'salvage', 'resurrection', 'roster',
      'actor', 'actors', 'lock', 'unlock', 'locks',
      'claim', 'c', 'release', 'r', 'find', 'f', 'list', 'l', 'ps', 'services', 'url', 'env',
      'up', 'down', 'scan', 's', 'projects', 'p', 'health',
      'init', 'hooks', 'setup',
      'memory', 'graph', 'advise', 'preflight', 'compass',
      'secret', 'secrets', 'learn', 'tutorial',
      'inbox', 'send', 'sent', 'attention', 'sitrep', 'parley', 'squid',
    ]) {
      expect(`${cmd} -> ${hasDedicatedHelp(cmd)}`).toBe(`${cmd} -> true`);
    }
  });

  test('module-owned help pages remain beside the flags they document', () => {
    for (const [file, name] of [
      ['cli/commands/attention.ts', 'ATTENTION_HELP'],
      ['cli/commands/sitrep.ts', 'SITREP_HELP'],
      ['cli/commands/roster.ts', 'ROSTER_HELP'],
      ['cli/commands/inbox.ts', 'SENT_HELP'],
    ]) {
      const source = readFileSync(join(ROOT, file), 'utf8');
      expect(source).toContain(`export const ${name}: string =`);
      const deadBranch = source.split('\n').filter(
        (line) => /\boptions\.help\b/.test(line) && !/^\s*\*/.test(line),
      );
      expect(deadBranch).toEqual([]);
    }
    expect(cliSource).toMatch(/attention: ATTENTION_HELP/);
    expect(cliSource).toMatch(/sitrep: SITREP_HELP/);
    expect(cliSource).toMatch(/roster: ROSTER_HELP/);
    expect(cliSource).toMatch(/sent: SENT_HELP/);
  });
});
