import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// IMPORT THE REAL CLI, not a regex over its source. An earlier version of this
// file parsed the tables out of the source text and reimplemented the resolver
// as `resolvesToHelp()`. A reviewer broke it in the way that matters: they
// replaced the live dispatch resolver with `buildHelp()` behind a comment that
// still matched the source regex — ten green tests, the whole feature reverted.
// The lesson is that a help router can only be proven by RUNNING it. So the
// dispatch's resolution logic now lives in one exported function,
// `resolveVerbHelp`, and this file imports and executes it over every verb.
//
// `PORT_DADDY_SUPPRESS_CLI_MAIN=1` stops the module's `void main()` from running
// at import (see the guard at the bottom of bin/port-daddy-cli.ts), so importing
// the CLI is side-effect-free here.
const ROOT = join(import.meta.dirname, '../..');

let resolveVerbHelp; // (cmd) => help string | null — the REAL dispatch resolver
let ALL_COMMANDS; // the verb list the dispatch switch accepts
let TOPIC_HELP; // topic key -> body
let HELP_TOPIC_ALIASES; // verb -> topic key
let VERB_HELP; // verb -> its own page

beforeAll(async () => {
  process.env.PORT_DADDY_SUPPRESS_CLI_MAIN = '1';
  const cli = await import('../../bin/port-daddy-cli.ts');
  ({ resolveVerbHelp, ALL_COMMANDS, TOPIC_HELP, HELP_TOPIC_ALIASES, VERB_HELP } = cli);
});

// The CLI source is still read for the few checks that are genuinely about
// wiring rather than behaviour (a `case` in the switch, a VERB_HELP entry
// pointing at the right exported const).
const cliSource = readFileSync(join(ROOT, 'bin/port-daddy-cli.ts'), 'utf8');

/** `pd help` / `pd version`: the global help / version string IS the right answer. */
const GLOBAL_HELP_IS_CORRECT = ['help', 'version'];

// Verbs that still fall through to buildHelp() because no topic documents them
// (`pd cut` cuts a release; `pd squid` is a harness hook layer). Pointing them at
// a near-looking family topic would print confidently wrong help — worse than the
// global help's honest everything-list. Shrinking this means WRITING the missing
// topic, not inventing an alias.
//
// This is a CHURN-ROBUST ratchet, not an exact-set equality. Two independent
// assertions below enforce it:
//   (a) every uncovered verb must appear here      — a new uncovered verb fails
//   (b) every entry here that is STILL a verb must be genuinely uncovered
//                                                    — covering one fails until removed
// An entry for a verb another stacked PR has since deleted from ALL_COMMANDS
// (e.g. a bosun-retirement branch removing `install-bosun`) is simply inert — it
// does not break this suite the moment that PR lands. Exact-set equality did,
// which turned every verb-removal PR anywhere into a spurious red here.
const KNOWN_UNCOVERED = [
  'cut', 'batten', 'log', 'activity', 'wallet', 'bond', 'say', 'account', 'nudge',
  'dashboard', 'webhook', 'webhooks', 'metrics', 'config',
  'start', 'stop', 'restart', 'status', 'install', 'uninstall',
  'dev', 'use', 'ci-gate', 'self-update', 'upgrade',
  'doctor', 'diagnose', 'hints', 'mcp', 'bench', 'benchmark', 'look', 'sitrep',
  'changelog', 'booty', 'tunnel', 'briefing', 'integration', 'pheromone', 'ph',
  'b', 'w', 'who-owns', 'history', 'files', 'add',
  'snapshots', 'snapshot', 'backup', 'restore', 'attest', 'shipwright',
  'spawn', 'spawned', 'watch', 'work', 'transcripts', 'transcript', 'relay',
  'harbor', 'harbors', 'harbor-ledger', 'whois', 'demo', 'fleet', 'backend', 'squid',
  'tuple', 'sortie', 'embed', 'quorum', 'parley', 'commit', 'obligations',
  'cockpit', 'popper', 'harbormaster', 'hm',
  'dispatch', 'nightshift', 'review', 'morning',
  'periscope', 'sight', 'scope', 'coast-guard', 'cg', 'safe', 'plan', 'suggest',
  'seamanship', 'skills',
];

describe('messaging discoverability', () => {
  test('HELP_TOPIC_ALIASES maps the messaging family to the messaging topic', () => {
    for (const cmd of ['inbox', 'send', 'tube', 'pub', 'sub', 'channels', 'wait']) {
      expect(HELP_TOPIC_ALIASES[cmd]).toBe('messaging');
    }
  });

  test('`pd send` is wired as a top-level verb routing to the durable inbox send', () => {
    expect(cliSource).toMatch(/case 'send':\s*\n\s*await handleInbox\('send', positional, options\)/);
  });

  test('main help surfaces the durable directed primitives', () => {
    expect(cliSource).toContain('pd send');
    expect(cliSource).toContain('Read direct messages sent to you');
  });
});

describe('`pd <verb> --help` coverage', () => {
  test('the imported tables are real (guards the assertions below from reading nothing)', () => {
    expect(ALL_COMMANDS.length).toBeGreaterThan(150);
    expect(Object.keys(TOPIC_HELP).length).toBeGreaterThan(15);
    expect(Object.keys(HELP_TOPIC_ALIASES).length).toBeGreaterThan(40);
    expect(Object.keys(VERB_HELP).length).toBeGreaterThan(0);
  });

  test('the REAL resolver runs — sabotaging the dispatch fails here, not just the source', () => {
    // These call resolveVerbHelp directly, the same function the dispatch calls.
    // If someone replaces its body with buildHelp() (returns null → global help),
    // every one of these flips.
    expect(resolveVerbHelp('inbox')).toMatch(/messaging/i); // alias -> topic
    expect(resolveVerbHelp('claim')).toMatch(/Port Management/); // single-letter family
    expect(resolveVerbHelp('roster')).toMatch(/pd roster/); // VERB_HELP page
    expect(resolveVerbHelp('cut')).toBeNull(); // deliberately uncovered -> global help
    expect(resolveVerbHelp('help')).toBeNull(); // global help is the right answer
  });

  test('every alias points at a topic that exists', () => {
    // A typo'd target returns null at runtime and the verb falls through to global
    // help — exactly the bug this table exists to fix. Checked against the real
    // TOPIC_HELP, so a renamed topic is caught.
    const dangling = Object.entries(HELP_TOPIC_ALIASES).filter(([, topic]) => !(topic in TOPIC_HELP));
    expect(dangling).toEqual([]);
  });

  test('VERB_HELP does not shadow a real topic name', () => {
    // TOPIC_HELP wins first in resolveVerbHelp, so a VERB_HELP key that collides
    // with a topic is dead weight that reads as live.
    for (const verb of Object.keys(VERB_HELP)) expect(verb in TOPIC_HELP).toBe(false);
  });

  test('(a) ratchet: every uncovered verb is pinned in KNOWN_UNCOVERED', () => {
    const uncovered = ALL_COMMANDS.filter(
      (cmd) => resolveVerbHelp(cmd) === null && !GLOBAL_HELP_IS_CORRECT.includes(cmd)
    );
    const unpinned = uncovered.filter((cmd) => !KNOWN_UNCOVERED.includes(cmd));
    // A new verb with no help must be given help or added here — it cannot ship
    // silently answering "Get started:".
    expect(unpinned.sort()).toEqual([]);
  });

  test('(b) shrink ratchet: no KNOWN_UNCOVERED entry that is still a verb is actually covered', () => {
    const stale = KNOWN_UNCOVERED.filter(
      (cmd) => ALL_COMMANDS.includes(cmd) && resolveVerbHelp(cmd) !== null
    );
    // Covering a verb means deleting it from this list in the same PR; otherwise
    // the list rots into a lie about what is uncovered.
    expect(stale.sort()).toEqual([]);
  });

  test('the families fixed here stay fixed, verb by verb', () => {
    // Named explicitly so deleting an alias and adding the verb to KNOWN_UNCOVERED
    // cannot quietly "fix" the suite. Runs the real resolver on each.
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
      'inbox', 'send', 'sent', 'attention',
    ]) {
      expect(`${cmd} -> ${resolveVerbHelp(cmd) !== null}`).toBe(`${cmd} -> true`);
    }
  });

  test('the three verb pages come from the modules that own the flags they document', () => {
    // The point of VERB_HELP is one source per verb. If these texts were re-inlined
    // in the CLI they would drift from the handlers' actual flags — which is how
    // they became unreachable dead code in the first place.
    expect(cliSource).toMatch(/attention: ATTENTION_HELP/);
    expect(cliSource).toMatch(/roster: ROSTER_HELP/);
    expect(cliSource).toMatch(/sent: SENT_HELP/);

    for (const [file, name] of [
      ['cli/commands/attention.ts', 'ATTENTION_HELP'],
      ['cli/commands/roster.ts', 'ROSTER_HELP'],
      ['cli/commands/inbox.ts', 'SENT_HELP'],
    ]) {
      const source = readFileSync(join(ROOT, file), 'utf8');
      expect(source).toContain(`export const ${name}: string =`);
      // The dispatch short-circuits --help before any handler runs, so an
      // `options.help` branch inside one of these modules is by definition dead.
      // Jsdoc lines (` * …`) are exempt — they are where we explain that.
      const liveHelpBranch = source.split('\n').filter((line) => /\boptions\.help\b/.test(line) && !/^\s*\*/.test(line));
      expect(liveHelpBranch).toEqual([]);
    }
  });
});
