/**
 * Adversarial contract for PR #7279.
 *
 * ADRs 0122–0126 are accepted decision records, not evidence that their
 * proposed runtimes exist. These tests therefore pin their status, normative
 * fail-closed language, and explicit implementation gates separately from the
 * executable numbering, cron, relay, secret, and fleet-manifest changes.
 *
 * PURSER_TARGET_REF is a local stacked-PR validation aid; CI never fetches a
 * hidden ref. The base PR always runs adversarial harness self-tests plus an
 * atomic stack gate. Once all #7279-only files exist, every contract test runs
 * against the checked-out child tree (or the explicit local target ref).
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from '@jest/globals';
import * as ts from 'typescript';
import { parse as parseYaml, parseDocument as parseYamlDocument } from 'yaml';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const targetRef = process.env.PURSER_TARGET_REF?.trim() || null;

function gitText(args: string[]): string {
  return execFileSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function readRepoFile(relativePath: string): string {
  if (targetRef) return gitText(['show', `${targetRef}:${relativePath}`]);
  return readFileSync(join(repoRoot, relativePath), 'utf8');
}

function listRepoDirectory(relativePath: string): string[] {
  if (targetRef) {
    return gitText(['ls-tree', '--name-only', `${targetRef}:${relativePath}`])
      .trim()
      .split('\n')
      .filter(Boolean);
  }
  return readdirSync(join(repoRoot, relativePath));
}

function repoFileExists(relativePath: string): boolean {
  if (!targetRef) return existsSync(join(repoRoot, relativePath));
  try {
    execFileSync('git', ['cat-file', '-e', `${targetRef}:${relativePath}`], {
      cwd: repoRoot,
      stdio: 'ignore',
    });
    return true;
  } catch {
    return false;
  }
}

interface MarkdownSection {
  level: number;
  title: string;
  body: string;
}

interface MarkdownDocument {
  title: string;
  metadata: Map<string, string>;
  sections: MarkdownSection[];
}

function parseMarkdownText(source: string, sourceName: string): MarkdownDocument {
  const lines = source.split(/\r?\n/);
  const titleMatch = lines[0]?.match(/^#\s+(.+)$/);
  if (!titleMatch) throw new Error(`${sourceName}: missing level-one title`);

  const preamble: string[] = [];
  const sections: MarkdownSection[] = [];
  let current: MarkdownSection | null = null;

  for (const line of lines.slice(1)) {
    const heading = line.match(/^(#{2,6})\s+(.+?)\s*$/);
    if (heading) {
      if (current) sections.push({ ...current, body: current.body.trim() });
      current = { level: heading[1].length, title: heading[2], body: '' };
    } else if (current) {
      current.body += `${line}\n`;
    } else {
      preamble.push(line);
    }
  }
  if (current) sections.push({ ...current, body: current.body.trim() });

  const metadata = new Map<string, string>();
  for (const line of preamble) {
    const field = line.match(/^-\s+\*\*([^*]+):\*\*\s*(.*)$/);
    if (field) metadata.set(field[1].trim(), field[2].trim());
  }

  return { title: titleMatch[1], metadata, sections };
}

function parseMarkdown(relativePath: string): MarkdownDocument {
  return parseMarkdownText(readRepoFile(relativePath), relativePath);
}

function section(document: MarkdownDocument, title: string): MarkdownSection {
  const found = document.sections.find((candidate) => candidate.title === title);
  if (!found) throw new Error(`${document.title}: missing section ${title}`);
  return found;
}

function bulletBlocks(body: string): string[] {
  const blocks: string[] = [];
  let current: string | null = null;
  for (const line of body.split(/\r?\n/)) {
    if (/^-\s+/.test(line)) {
      if (current) blocks.push(current);
      current = line.replace(/^-\s+/, '').trim();
    } else if (current && line.trim()) {
      current += ` ${line.trim()}`;
    }
  }
  if (current) blocks.push(current);
  return blocks;
}

function strongBulletLabels(body: string): string[] {
  return bulletBlocks(body).map((block) => {
    const match = block.match(/^\*\*(?:`([^`]+)`|([^*]+))\*\*/);
    if (!match) throw new Error(`Expected strong-labeled Markdown bullet: ${block}`);
    return (match[1] ?? match[2]).trim();
  });
}

function fencedBlocks(body: string): string[] {
  return [...body.matchAll(/```[^\n]*\n([\s\S]*?)```/g)].map((match) => match[1].trim());
}

function parseTypeScriptText(source: string, sourceName: string): ts.SourceFile {
  return ts.createSourceFile(
    sourceName,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
}

function parseTypeScript(relativePath: string): ts.SourceFile {
  return parseTypeScriptText(readRepoFile(relativePath), relativePath);
}

function allNodes(root: ts.Node): ts.Node[] {
  const nodes: ts.Node[] = [];
  const visit = (node: ts.Node) => {
    nodes.push(node);
    node.forEachChild(visit);
  };
  visit(root);
  return nodes;
}

function findStringConstant(sourceFile: ts.SourceFile, name: string): string | undefined {
  const declaration = allNodes(sourceFile).find(
    (node): node is ts.VariableDeclaration =>
      ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name,
  );
  if (!declaration?.initializer || !ts.isStringLiteralLike(declaration.initializer)) return undefined;
  return declaration.initializer.text;
}

function findNamedFunction(root: ts.Node, name: string): ts.FunctionDeclaration | undefined {
  return allNodes(root).find(
    (node): node is ts.FunctionDeclaration =>
      ts.isFunctionDeclaration(node) && node.name?.text === name,
  );
}

interface CronHelpers {
  parseCronInterval: (cron: string) => number;
  isAbsoluteCronSchedule: (cron: string) => boolean;
  computeNextAbsoluteFireDelayMs: (cron: string, now?: number) => number | null;
}

function loadCronHelpers(sourceFile: ts.SourceFile): Partial<CronHelpers> {
  const variableNames = new Set(['MIN_INTERVAL', 'DEFAULT_INTERVAL']);
  const functionNames = new Set([
    'parseCronInterval',
    'isAbsoluteCronSchedule',
    'computeNextAbsoluteFireDelayMs',
  ]);
  const selected = sourceFile.statements.filter((statement) => {
    if (ts.isFunctionDeclaration(statement)) return !!statement.name && functionNames.has(statement.name.text);
    if (!ts.isVariableStatement(statement)) return false;
    return statement.declarationList.declarations.some(
      (declaration) => ts.isIdentifier(declaration.name) && variableNames.has(declaration.name.text),
    );
  });
  const moduleSource = selected.map((statement) => statement.getText(sourceFile)).join('\n');
  const compiled = ts.transpileModule(moduleSource, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const moduleRecord: { exports: Record<string, unknown> } = { exports: {} };
  const evaluate = new Function('exports', 'module', compiled) as (
    exports: Record<string, unknown>,
    module: { exports: Record<string, unknown> },
  ) => void;
  evaluate(moduleRecord.exports, moduleRecord);
  return moduleRecord.exports as Partial<CronHelpers>;
}

function numberedCommentClauses(comment: string): Map<number, string> {
  const clauses = new Map<number, string>();
  let current: number | null = null;
  for (const line of comment.split(/\r?\n/)) {
    const start = line.match(/^\s*(\d+)\.\s+(.*)$/);
    if (start) {
      current = Number(start[1]);
      clauses.set(current, start[2].trim());
    } else if (!line.trim()) {
      current = null;
    } else if (current !== null) {
      clauses.set(current, `${clauses.get(current)} ${line.trim()}`);
    }
  }
  return clauses;
}

const literalSecretPattern = /^(?:[a-f0-9]{32,}|(?:sk|ghp|pdu|xox[baprs])_[A-Za-z0-9_-]{16,})$/i;

type StackStage = 'baseline' | 'partial' | 'stacked';

function classifyStackStage(present: number, total: number): StackStage {
  if (present === 0) return 'baseline';
  if (present === total) return 'stacked';
  return 'partial';
}

const adrPaths = {
  '0122': 'docs/adr/0122-harbor-authority.md',
  '0123': 'docs/adr/0123-cloud-vault-account-kms.md',
  '0124': 'docs/adr/0124-transcript-redaction.md',
  '0125': 'docs/adr/0125-ios-operator-surface.md',
  '0126': 'docs/adr/0126-shared-harbors-resequencing.md',
} as const;
const declaredTargetPaths = [
  '.mcp.json',
  'AGENTS.md',
  'CHANGELOG.md',
  'cli/commands/account.ts',
  'docs/adr/0119-durable-agent-roster.md',
  'docs/adr/0121-durable-agent-roster.md',
  'docs/adr/0122-harbor-authority.md',
  'docs/adr/0123-cloud-vault-account-kms.md',
  'docs/adr/0124-transcript-redaction.md',
  'docs/adr/0125-ios-operator-surface.md',
  'docs/adr/0126-shared-harbors-resequencing.md',
  'docs/adr/adr-numbering-registry.json',
  'lib/fleet-engine.ts',
  'pd-fleet.yml',
  'tests/unit/account-relay-config.test.js',
  'tests/unit/adr-numbering-registry.test.js',
  'tests/unit/fleet-engine.test.js',
] as const;
const targetOnlyPaths = [
  'docs/adr/0121-durable-agent-roster.md',
  ...Object.values(adrPaths),
  'tests/unit/account-relay-config.test.js',
  'tests/unit/adr-numbering-registry.test.js',
] as const;
const presentTargetOnlyPaths = targetOnlyPaths.filter(repoFileExists);
const stackStage = classifyStackStage(presentTargetOnlyPaths.length, targetOnlyPaths.length);
const targetContractDescribe = stackStage === 'stacked' ? describe : describe.skip;
const targetContractReason = stackStage === 'baseline'
  ? ' [skipped: all 8 #7279-only files are absent on the #9781 baseline]'
  : stackStage === 'partial'
    ? ' [skipped: partial #7279-only file set; the always-on activation gate fails]'
    : '';

function readAdr(number: keyof typeof adrPaths): MarkdownDocument {
  return parseMarkdown(adrPaths[number]);
}

function readRegistry(): {
  counts: { live: number; stubs: number };
  numbers: Record<string, unknown>;
  stubs: Array<{ file: string; renumberedTo: string }>;
} {
  return JSON.parse(readRepoFile('docs/adr/adr-numbering-registry.json'));
}

function readFleetContract(): { source: ts.SourceFile; cron: Partial<CronHelpers> } {
  const source = parseTypeScript('lib/fleet-engine.ts');
  return { source, cron: loadCronHelpers(source) };
}

interface DispatchManifestContract {
  errors: readonly unknown[];
  runner: Record<string, unknown> | undefined;
  comment: string;
  preconditions: Map<number, string>;
}

function readDispatchManifest(): DispatchManifestContract {
  const raw = readRepoFile('pd-fleet.yml');
  const document = parseYamlDocument(raw);
  const manifest = parseYaml(raw) as {
    fleet?: { agents?: Record<string, Record<string, unknown>> };
  };
  const agentsNode = document.getIn(['fleet', 'agents'], true) as {
    items?: Array<{ key?: { value?: unknown; commentBefore?: string } }>;
  } | undefined;
  const dispatchPair = agentsNode?.items?.find((entry) => entry.key?.value === 'dispatch-runner');
  const comment = dispatchPair?.key?.commentBefore ?? '';
  return {
    errors: document.errors,
    runner: manifest.fleet?.agents?.['dispatch-runner'],
    comment,
    preconditions: numberedCommentClauses(comment),
  };
}

describe('always-on adversarial harness', () => {
  test('Markdown parsing preserves metadata, sections, strong labels, and fenced contracts', () => {
    const document = parseMarkdownText([
      '# ADR-9999: Fixture',
      '',
      '- **Status:** Accepted',
      '',
      '## Decision',
      '',
      '- **`raw`** blocked',
      '  even when the bullet wraps',
      '- **scrubbed** allowed',
      '',
      '```text',
      'seal(redact(event))',
      '```',
      '',
      '### Gate',
      '',
      'Fail closed.',
    ].join('\n'), 'markdown fixture');

    expect(document.title).toBe('ADR-9999: Fixture');
    expect(document.metadata.get('Status')).toBe('Accepted');
    expect(strongBulletLabels(section(document, 'Decision').body)).toEqual(['raw', 'scrubbed']);
    expect(fencedBlocks(section(document, 'Decision').body)).toEqual(['seal(redact(event))']);
    expect(section(document, 'Gate')).toMatchObject({ level: 3, body: 'Fail closed.' });
    expect(() => parseMarkdownText('## Missing H1', 'broken fixture')).toThrow(
      'broken fixture: missing level-one title',
    );
    expect(() => section(document, 'Missing')).toThrow('ADR-9999: Fixture: missing section Missing');
  });

  test('TypeScript helpers distinguish literals and execute only the selected cron contract', () => {
    const source = parseTypeScriptText([
      'const MIN_INTERVAL = 60_000;',
      'const DEFAULT_INTERVAL = 600_000;',
      "const DEFAULT_RELAY = 'https://relay.portdaddy.dev';",
      'const DYNAMIC_RELAY = process.env.RELAY_URL;',
      "export function parseCronInterval(cron: string) { return cron === '0 1 * * *' ? 86_400_000 : DEFAULT_INTERVAL; }",
      "export function isAbsoluteCronSchedule(cron: string) { return cron === '0 1 * * *'; }",
      'export function computeNextAbsoluteFireDelayMs(cron: string) { return isAbsoluteCronSchedule(cron) ? MIN_INTERVAL : null; }',
      'function ignored() { throw new Error(\'must not execute\'); }',
    ].join('\n'), 'cron fixture.ts');
    const helpers = loadCronHelpers(source);

    expect(findStringConstant(source, 'DEFAULT_RELAY')).toBe('https://relay.portdaddy.dev');
    expect(findStringConstant(source, 'DYNAMIC_RELAY')).toBeUndefined();
    expect(findNamedFunction(source, 'ignored')).toBeDefined();
    expect(helpers.isAbsoluteCronSchedule?.('0 1 * * *')).toBe(true);
    expect(helpers.parseCronInterval?.('malformed')).toBe(600_000);
    expect(helpers.computeNextAbsoluteFireDelayMs?.('malformed')).toBeNull();
  });

  test('numbered YAML-comment parsing keeps wrapped clauses but not detached prose', () => {
    const clauses = numberedCommentClauses([
      'Preconditions:',
      '1. operator review remains open,',
      '   with a wrapped explanation',
      '2. push guard is installed',
      '',
      'detached prose must not join clause 2',
      '3. cron parser is verified — SATISFIED',
    ].join('\n'));

    expect([...clauses.entries()]).toEqual([
      [1, 'operator review remains open, with a wrapped explanation'],
      [2, 'push guard is installed'],
      [3, 'cron parser is verified — SATISFIED'],
    ]);
  });

  test('secret-shape detection rejects committed literals but permits environment expansion', () => {
    expect(literalSecretPattern.test('4f'.repeat(32))).toBe(true);
    expect(literalSecretPattern.test('pdu_0123456789abcdef0123456789abcdef')).toBe(true);
    expect(literalSecretPattern.test('${TWENTYFIRST_API_KEY}')).toBe(false);
    expect(literalSecretPattern.test('https://relay.portdaddy.dev')).toBe(false);
  });

  test('stack classification treats every partial target set as invalid', () => {
    expect(classifyStackStage(0, 8)).toBe('baseline');
    expect(classifyStackStage(8, 8)).toBe('stacked');
    expect(classifyStackStage(1, 8)).toBe('partial');
    expect(classifyStackStage(7, 8)).toBe('partial');
  });
});

describe('stack activation', () => {
  test('the declared #7279 target is wholly absent or complete, never partial', () => {
    if (stackStage === 'partial') {
      const missing = targetOnlyPaths.filter((path) => !presentTargetOnlyPaths.includes(path));
      throw new Error(
        `partial #7279 target: present=${presentTargetOnlyPaths.join(',')} missing=${missing.join(',')}`,
      );
    }
    if (targetRef && stackStage !== 'stacked') {
      throw new Error(`PURSER_TARGET_REF=${targetRef} does not contain the complete #7279-only file set`);
    }
    if (stackStage === 'stacked') {
      expect(declaredTargetPaths.filter((path) => !repoFileExists(path))).toEqual([]);
    } else {
      expect(presentTargetOnlyPaths).toEqual([]);
    }
  });
});

targetContractDescribe(`PR #7279 target contract${targetContractReason}`, () => {
describe('accepted ADR decision contracts (not implementation evidence)', () => {
  test('[1] ADR-0122 defines authority, epochs, causal order, and queue-only Phase 1 honestly', () => {
    const document = readAdr('0122');
    expect(document.metadata.get('Status')).toBe('Accepted');
    expect(section(document, '1. Exactly one authoritative writer per harbor').body).toMatch(
      /exactly one daemon holds the writer lease[\s\S]*There is no co-writing and no election/,
    );
    expect(strongBulletLabels(section(document, '2. The authority record (normative)').body)).toEqual([
      'harbor_id',
      'authority_epoch',
      'writer_lease',
      'event_seq',
      'causal_parents',
      'revocation_list',
      'artifact_acls',
      'retention_policy',
      'control_commands',
    ]);
    expect(section(document, '4. Authority epochs, and visible failure').body).toMatch(
      /member\s+added, member removed, device paired, device revoked, writer-lease handoff[\s\S]*silently dropped, silently downgraded, or\s+silently retried/,
    );
    expect(section(document, '6. Relay-buffered trigger firings are queue-only in Phase 1').body).toMatch(
      /queues a Work Intent[\s\S]*It never starts a run remotely[\s\S]*fail-closed[\s\S]*ADR-0093/,
    );
    expect(section(document, 'Consequences').body).toMatch(
      /prerequisite on paper[\s\S]*ADR-0126 owns sequencing\s+the build/,
    );
  });

  test('[2] ADR-0123 specifies key custody and fail-closed recovery without claiming the vault is built', () => {
    const document = readAdr('0123');
    expect(document.metadata.get('Status')).toBe('Accepted');
    const hierarchySection = section(document, '1. The key hierarchy — four tiers, one derivation direction');
    const hierarchy = fencedBlocks(hierarchySection.body)[0];
    expect(hierarchy).toContain('account root    Ed25519 account keypair, OS keychain');
    expect(hierarchy).toContain('harbor root     Ed25519 per-harbor keypair');
    expect(hierarchy).toContain('pd-vault/content/v1');
    expect(hierarchy).toContain('pd-vault/channel/v1/<epoch>');
    expect(hierarchySection.body).toMatch(
      /keypair-in-keychain upgrade[\s\S]*first work item[\s\S]*not a thing to claim early/,
    );
    expect(hierarchySection.body).toMatch(
      /Per-harbor content and channel keys are HKDF-SHA256[\s\S]*compromise of one harbor's keys reads that\s+harbor and nothing else/,
    );
    expect(section(document, '2. Custody doctrine — a secret a process can use, that process can copy').body).toMatch(
      /keys never enter agent bodies[\s\S]*`core\/kernel\/pd-vault`[\s\S]*Rust kernel[\s\S]*over FFI/,
    );
    expect(section(document, '5. Recovery — shares and passkeys; read back never equals control back').body).toMatch(
      /No email-only recovery for control authority[\s\S]*Recovery of READ never silently restores CONTROL/,
    );
    expect(section(document, '6. N1 on every wire — sealed or labeled, no third state').body).toMatch(
      /AEAD-sealed[\s\S]*`relay_readable: true`[\s\S]*Until this gate is live/,
    );
  });

  test('[3] ADR-0124 closes redaction states and makes unknown/raw non-exportable before sealing', () => {
    const document = readAdr('0124');
    expect(document.metadata.get('Status')).toBe('Accepted');
    expect(strongBulletLabels(section(document, '1. Redaction state is a closed enum, stamped per transcript segment').body)).toEqual([
      'raw',
      'scrubbed',
      'redacted',
      'unknown',
    ]);
    const exportSection = section(document, '2. Fail closed: nothing leaves the machine unless scrubbed or redacted');
    expect(fencedBlocks(exportSection.body)).toContain(
      'exportable(event) := event.redaction_state ∈ { scrubbed, redacted }',
    );
    expect(strongBulletLabels(exportSection.body)).toEqual([
      'relay publish',
      'cloud sync',
      'R2 snapshot',
      'iOS transcript tail',
      'export flows',
    ]);
    expect(exportSection.body).toMatch(/`unknown` and `raw` are non-exportable, without exception/);
    expect(fencedBlocks(section(document, '3. Redact before seal: the relay never holds unredacted ciphertext').body)).toContain(
      'wire_event = seal(redact(event))',
    );
    expect(section(document, '4. The archive and the delete flows carry the state; backfill says unknown').body).toMatch(
      /migration stamps every pre-existing row and\s+archive line `unknown`/,
    );
    expect(section(document, '5. The redaction verifier: a named gate with teeth').body).toMatch(
      /`lib\/safe\/redaction-verifier\.ts`, proposed — not yet built/,
    );
  });

  test('[4] ADR-0125 gates iOS control on authoritative state and four fail-closed device fixtures', () => {
    const document = readAdr('0125');
    expect(document.metadata.get('Status')).toBe('Accepted');
    expect(section(document, '1. `ios` is the fourth sanctioned operator surface').body).toMatch(
      /native SwiftUI app at `apps\/pd-ios\/`[\s\S]*owns \*\*no runtime state\*\*/,
    );
    expect(section(document, '2. v1 scope is HITL-first').body).toMatch(
      /first shippable app is the human-in-the-loop surface[\s\S]*Consent gates and interruptions/,
    );
    const pairing = section(document, '3. Pairing mints a passkey-backed device card').body;
    const strongTerms = [...pairing.matchAll(/\*\*([^*]+)\*\*/g)].map((match) => match[1]);
    expect(strongTerms).toEqual(expect.arrayContaining([
      'stolen-device',
      'replayed-command',
      'expired-approval',
      'revoked-device',
    ]));
    expect(pairing).toMatch(/No\s+email-only recovery path exists for control authority[\s\S]*must all fail closed BEFORE the app ships/);
    expect(section(document, '5. Authorization reads authoritative state only').body).toMatch(
      /`authoritative-lease` or `authoritative-event`[\s\S]*never a cached projection, never UI state[\s\S]*fails closed/,
    );
  });

  test('[5] ADR-0126 is a Tier-3 decision log with four decisions and explicit supersessions', () => {
    const document = readAdr('0126');
    expect(document.metadata.get('Status')).toBe('Accepted');
    expect(section(document, 'Context').body).toMatch(/This ADR is a decision log, not a design/);
    expect(document.sections.filter((candidate) => candidate.level === 3 && /^[1-4]\. /.test(candidate.title)).map((candidate) => candidate.title)).toEqual([
      '1. Cloud bodies are staged: coordination plane now, Sandbox bodies later',
      '2. iOS is native SwiftUI, HITL-first — PWA-first is superseded',
      '3. Full end-to-end encryption gates the shared-harbors launch',
      '4. The roadmap is home; the fleet demotes to plumbing',
    ]);
    const supersessions = bulletBlocks(section(document, 'Formal supersessions').body);
    const classified = (path: string, status: string) => {
      const entry = supersessions.find((candidate) => candidate.includes(`\`${path}\``));
      expect(entry).toBeDefined();
      expect(entry).toContain(`— **${status}**`);
    };
    classified('docs/DAEMON-MESH-ARCHITECTURE.md', 'superseded');
    classified('docs/plans/PHONE-INTEGRATION-MASTER-PLAN.md', 'superseded');
    classified('V4-DAG.md', 'dead');
    classified('docs/recovery/', 'demoted to narrative history.');
    expect(section(document, 'Ruling on binder ch21 open question 5').body).toMatch(
      /queue-only in Phase 1[\s\S]*never starts a run remotely/,
    );
  });
});

describe('ADR numbering migration', () => {
  test('[6] 0119 has one live owner and the roster is an exact 0121 forwarding stub', () => {
    const registry = readRegistry();
    expect(registry.numbers['0119']).toBe('0119-relay-release-channels-and-staging-d1.md');
    expect(registry.numbers['0121']).toBe('0121-durable-agent-roster.md');
    const stub = registry.stubs.find((entry) => entry.file === '0119-durable-agent-roster.md');
    expect(stub).toEqual({ file: '0119-durable-agent-roster.md', renumberedTo: '0121' });
    const stubBody = readRepoFile('docs/adr/0119-durable-agent-roster.md');
    expect(stubBody.match(/<!-- ADR-RENUMBERED-TO:\s*(\d{4}) -->/)?.[1]).toBe('0121');
    const links = [...stubBody.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)].map((match) => match[1]);
    expect(links).toEqual(expect.arrayContaining([
      '0121-durable-agent-roster.md',
      '0119-relay-release-channels-and-staging-d1.md',
    ]));
  });

  test('[6] every live number is unique, on disk, registered, and disjoint from stubs', () => {
    const registry = readRegistry();
    const entries = Object.entries(registry.numbers);
    expect(entries.every(([, file]) => typeof file === 'string')).toBe(true);
    const liveFiles = entries.map(([, file]) => file as string);
    expect(new Set(liveFiles).size).toBe(liveFiles.length);
    expect(registry.counts.live).toBe(entries.length);
    expect(registry.counts.stubs).toBe(registry.stubs.length);

    const stubFiles = new Set(registry.stubs.map((entry) => entry.file));
    for (const [number, file] of entries) {
      expect(file.startsWith(number)).toBe(true);
      expect(repoFileExists(`docs/adr/${file}`)).toBe(true);
      expect(stubFiles.has(file)).toBe(false);
    }

    const numberedFiles = listRepoDirectory('docs/adr').filter((file) => /^\d{4}-.*\.md$/.test(file));
    const registered = new Set([...liveFiles, ...stubFiles]);
    expect(numberedFiles.filter((file) => !registered.has(file))).toEqual([]);

    const liveByNumber = new Map<string, string[]>();
    for (const file of numberedFiles.filter((candidate) => !stubFiles.has(candidate))) {
      const number = file.slice(0, 4);
      liveByNumber.set(number, [...(liveByNumber.get(number) ?? []), file]);
    }
    for (const [number, files] of liveByNumber) {
      expect(files).toHaveLength(1);
      expect(registry.numbers[number]).toBe(files[0]);
    }
  });
});

describe('fleet absolute-hour cron behavior', () => {
  test('[7] fixed-clock recognition is narrow and malformed/constrained schedules retain the 10-minute fallback', () => {
    const { cron } = readFleetContract();
    expect(typeof cron.isAbsoluteCronSchedule).toBe('function');
    expect(typeof cron.parseCronInterval).toBe('function');
    if (!cron.isAbsoluteCronSchedule || !cron.parseCronInterval) return;
    expect(cron.isAbsoluteCronSchedule('0 1 * * *')).toBe(true);
    expect(cron.isAbsoluteCronSchedule('15 * * * *')).toBe(true);
    expect(cron.isAbsoluteCronSchedule('*/5 * * * *')).toBe(false);
    expect(cron.isAbsoluteCronSchedule('0 8 * * 1')).toBe(false);
    expect(cron.isAbsoluteCronSchedule('0 25 * * *')).toBe(false);
    expect(cron.parseCronInterval('garbage')).toBe(600_000);
    expect(cron.parseCronInterval('0 25 * * *')).toBe(600_000);
    expect(cron.parseCronInterval('0 8 * * 1')).toBe(600_000);
  });

  test('[7] next-fire calculation honors later-today, tomorrow, and exact-midnight boundaries', () => {
    const { cron } = readFleetContract();
    expect(typeof cron.computeNextAbsoluteFireDelayMs).toBe('function');
    if (!cron.computeNextAbsoluteFireDelayMs) return;
    const beforeOne = new Date(2026, 0, 15, 0, 30, 0, 0).getTime();
    expect(cron.computeNextAbsoluteFireDelayMs('0 1 * * *', beforeOne)).toBe(30 * 60 * 1000);
    const afterOne = new Date(2026, 0, 15, 1, 30, 0, 0).getTime();
    expect(cron.computeNextAbsoluteFireDelayMs('0 1 * * *', afterOne)).toBe(23.5 * 60 * 60 * 1000);
    const midnight = new Date(2026, 0, 15, 0, 0, 0, 0).getTime();
    expect(cron.computeNextAbsoluteFireDelayMs('0 0 * * *', midnight)).toBe(24 * 60 * 60 * 1000);
    expect(cron.computeNextAbsoluteFireDelayMs('garbage', midnight)).toBeNull();
  });

  test('[7] the scheduler structurally re-arms a timeout chain and cancellation clears either timer type', () => {
    const { source: fleetSource } = readFleetContract();
    const runner = findNamedFunction(fleetSource, 'createFleetRunner');
    expect(runner).toBeDefined();
    if (!runner) return;
    const runnerNodes = allNodes(runner);
    const scheduleNext = runnerNodes.find(
      (node): node is ts.VariableDeclaration =>
        ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === 'scheduleNext',
    );
    expect(scheduleNext?.initializer && ts.isArrowFunction(scheduleNext.initializer)).toBe(true);
    if (!scheduleNext?.initializer || !ts.isArrowFunction(scheduleNext.initializer)) return;
    const scheduleNodes = allNodes(scheduleNext.initializer);
    const timeoutAssignment = scheduleNodes.find(
      (node): node is ts.BinaryExpression =>
        ts.isBinaryExpression(node)
        && node.operatorToken.kind === ts.SyntaxKind.EqualsToken
        && node.left.getText(fleetSource) === 'record.interval'
        && ts.isCallExpression(node.right)
        && node.right.expression.getText(fleetSource) === 'setTimeout',
    );
    expect(timeoutAssignment).toBeDefined();
    if (!timeoutAssignment || !ts.isCallExpression(timeoutAssignment.right)) return;
    const callback = timeoutAssignment.right.arguments[0];
    expect(callback).toBeDefined();
    const callbackCalls = callback
      ? allNodes(callback)
        .filter((node): node is ts.CallExpression => ts.isCallExpression(node))
        .map((call) => call.expression.getText(fleetSource))
      : [];
    expect(callbackCalls).toEqual(expect.arrayContaining(['requestAgentRun', 'scheduleNext']));

    const stop = findNamedFunction(runner, 'stopRunningRecord');
    expect(stop).toBeDefined();
    const clears = stop
      ? allNodes(stop)
        .filter((node): node is ts.CallExpression => ts.isCallExpression(node))
        .filter((call) => call.arguments[0]?.getText(fleetSource) === 'record.interval')
        .map((call) => call.expression.getText(fleetSource))
      : [];
    expect(new Set(clears)).toEqual(new Set(['clearInterval', 'clearTimeout']));
  });
});

describe('relay and credential configuration', () => {
  test('[8] DEFAULT_RELAY is the branded HTTPS origin with no workers.dev literal', () => {
    const accountSource = parseTypeScript('cli/commands/account.ts');
    expect(findStringConstant(accountSource, 'DEFAULT_RELAY')).toBe('https://relay.portdaddy.dev');
    const stringLiterals = allNodes(accountSource)
      .filter((node): node is ts.StringLiteralLike => ts.isStringLiteralLike(node))
      .map((node) => node.text);
    expect(stringLiterals.filter((value) => value.includes('workers.dev'))).toEqual([]);
  });

  test('[9] .mcp.json uses an environment expansion and contains no hardcoded secret-shaped env value', () => {
    const config = JSON.parse(readRepoFile('.mcp.json')) as {
      mcpServers: Record<string, { env?: Record<string, unknown> }>;
    };
    expect(config.mcpServers['21st-dev-magic']?.env?.TWENTYFIRST_API_KEY).toBe('${TWENTYFIRST_API_KEY}');
    for (const server of Object.values(config.mcpServers)) {
      for (const value of Object.values(server.env ?? {})) {
        expect(typeof value).toBe('string');
        expect(literalSecretPattern.test(String(value))).toBe(false);
      }
    }
  });
});

describe('dispatch-runner manifest', () => {
  test('[10] the armed YAML entry keeps its reviewed identity, command, and blast-radius limits', () => {
    const { errors, runner } = readDispatchManifest();
    const { cron } = readFleetContract();
    expect(errors).toEqual([]);
    expect(runner).toBeDefined();
    expect(runner).toMatchObject({
      schedule: '0 1 * * *',
      backend: 'custom',
      singleton: true,
      cooldown_ms: 21_600_000,
      timeout: 14_400_000,
      daily_cap_usd: 10,
      prompt: 'pd dispatch run --next --really-run',
      identity: '{project}:fleet:dispatch-runner',
    });
    if (typeof runner?.schedule === 'string' && cron.isAbsoluteCronSchedule) {
      expect(cron.isAbsoluteCronSchedule(runner.schedule)).toBe(true);
    }
  });

  test('[10] YAML comments preserve all three preconditions and admit operator review is still open', () => {
    const { comment: dispatchComment, preconditions } = readDispatchManifest();
    expect([...preconditions.keys()]).toEqual([1, 2, 3]);
    expect(preconditions.get(1)).toBe('operator has reviewed the first PR opened by a dispatch run,');
    expect(preconditions.get(1)).not.toContain('SATISFIED');
    expect(preconditions.get(3)).toContain('SATISFIED');
    expect(dispatchComment).toMatch(/precondition 1 still open and\s+unverified in-repo/);
    expect(dispatchComment).toMatch(/nothing here attests to that review having\s+happened/);
  });
});
});
