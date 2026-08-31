import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '../..');
const cliSource = readFileSync(join(ROOT, 'bin/port-daddy-cli.ts'), 'utf8');
let resolveVerbHelp;
let resolveTopicHelp;
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
    resolveTopicHelp,
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
  'tuple', 'sortie', 'embed', 'quorum', 'parley', 'commit', 'obligations',
  'cockpit', 'popper', 'harbormaster', 'hm',
  'dispatch', 'nightshift', 'review', 'morning',
  'periscope', 'sight', 'scope', 'coast-guard', 'cg', 'safe', 'plan', 'suggest',
  'seamanship', 'skills',
];

function hasDedicatedHelp(command) {
  return resolveVerbHelp(command) !== null || shouldDispatchHelpToHandler(command);
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

describe('pd learn help contract', () => {
  test('learn is canonical and tutorial resolves to the same read-only orientation', () => {
    const learnHelp = resolveTopicHelp('learn');

    expect(HELP_TOPIC_ALIASES.tutorial).toBe('learn');
    expect(resolveTopicHelp('tutorial')).toBe(learnHelp);
    expect(resolveVerbHelp('learn')).toBe(learnHelp);
    expect(resolveVerbHelp('tutorial')).toBe(learnHelp);
    expect(learnHelp).toMatch(/Read-only coordination, retrieval, and evidence guide/);
    expect(learnHelp).toMatch(/Headless runs issue no daemon request/);
    expect(learnHelp).toMatch(/Standard append-only CLI usage telemetry may still be recorded/);
  });

  test('launch, first-run, and unknown-command help no longer promise a stateful tutorial', () => {
    expect(cliSource).not.toMatch(/interactive tutorial/i);
    expect(cliSource).not.toContain('Tutorial: pd learn');
    expect(cliSource).toContain('pd learn         Read-only agent orientation');
    expect(cliSource).toContain('Agent orientation: pd learn (read-only)');
    expect(cliSource).toContain('pd learn for the read-only agent orientation');
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
    expect(shouldDispatchHelpToHandler('squid')).toBe(true);
  });

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
      'inbox', 'send', 'sent', 'attention', 'sitrep', 'squid',
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
