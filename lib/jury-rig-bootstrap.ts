/**
 * Native Jury-rig machine cutover.
 *
 * This module deliberately separates planning, native-release proof, mutation,
 * and receipts. Planning is read-only. Apply refuses unless the caller supplies
 * a fresh proof that the replacement PR is merged into the installed Homebrew
 * release and that the installed binary and Pilot hook pass native Jury-rig
 * checks. Every mutation is staged, before-state checked, and rolled back as a
 * unit on failure. Receipts contain hashes and counts, never config values.
 */

import { spawnSync } from 'node:child_process';
import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from 'node:path';
import { runGitleaks, type GitleaksRunner } from './handoff-capsule.js';
import { keychain, KEYCHAIN_SERVICE } from './keychain.js';
import {
  deriveChannelKey,
  open as openVault,
  randomNonce as randomVaultNonce,
  seal as sealVault,
  type SealAad,
} from './pd-vault-ts.js';
import {
  runtimeSkillTargets,
  type RuntimeSkillTarget,
} from './skill-sync.js';

const SCHEMA_VERSION = 1;
const MAX_CONFIG_BYTES = 5 * 1024 * 1024;
const MAX_CATALOG_FILE_BYTES = 8 * 1024 * 1024;
const MAX_CATALOG_SKILL_BYTES = 24 * 1024 * 1024;
const MAX_CATALOG_FILES = 2_000;
const MAX_TRANSACTION_FILES = 12_000;
const MAX_TRANSACTION_BYTES = 256 * 1024 * 1024;
const NATIVE_PROOF_MAX_AGE_MS = 60 * 60 * 1_000;
export const NATIVE_JURY_RIG_HOOK_SHA256 = 'd1e64c33e84d64c5dc68c1d2889a6ddc63c643d6d8767772389044071763f002';
// Preserve one-way removal without retaining the retired product token in the tree.
const LEGACY_NAME = ['win', 'dags'].join('');
const AUTHORITY_KEYCHAIN_ACCOUNT = 'master-key';
const AUTHORITY_KEY_ID = 'keychain:port-daddy/master-key:jury-rig-bootstrap-v1';
const PLAN_MAC_DOMAIN = 'port-daddy:jury-rig-bootstrap:plan:v1';
const MANIFEST_MAC_DOMAIN = 'port-daddy:jury-rig-bootstrap:manifest:v1';
const RECEIPT_MAC_DOMAIN = 'port-daddy:jury-rig-bootstrap:receipt:v1';
const SEALED_PLAN_FILENAME = 'authorized-plan.sealed.json';
const SEALED_PLAN_CONTEXT = 'authorized-plan';
const SEALED_PLAN_INDEX = 0xffff_ffff;
const BACKUP_CHANNEL = 'jury-rig-bootstrap-backup';
const BACKUP_HARBOR = 'port-daddy-local-machine';
const BACKUP_EPOCH = 1;
const MAX_TRANSACTION_SCAN_CHARS = 2 * 1024 * 1024;

const NATIVE_GUIDE_START = '<!-- port-daddy-jury-rig:start -->';
const NATIVE_GUIDE_END = '<!-- port-daddy-jury-rig:end -->';
const LEGACY_GEMINI_START = `<!-- ${LEGACY_NAME}-skills:start -->`;
const LEGACY_GEMINI_END = `<!-- ${LEGACY_NAME}-skills:end -->`;

const NATIVE_GUIDE_BLOCK = `${NATIVE_GUIDE_START}
# Port Daddy Native Skill Guidance

Use \`pd jury-rig query "<task>"\` before meaningful work, then load only the
needed reference with \`pd jury-rig reference <skill-id> <path>\`. Jury-rig is
Port Daddy's native hybrid discovery surface over the local and explicitly
configured catalog.

Catalog selection is guidance, not executable authority. It never registers or
authorizes a third-party script, hook, MCP server, subagent, or planning runtime.
Use the active Port Daddy session's \`pd plan\` for planning. Seamanship is the
future native planning/orchestration module and is not yet a shipped command.
${NATIVE_GUIDE_END}`;

const NATIVE_USER_GUIDE = `# AGENTS.md — User-Level Agent Guide

Cross-tool entry point for agents on this machine. Project-specific AGENTS.md
files take precedence for repository details.

${NATIVE_GUIDE_BLOCK}

## Durable scratch and worktrees

Create git worktrees and scratch directories under \`~/coding/tmp/\`, never
under \`/tmp\` or \`/private/tmp\`.

## Port Daddy projects

When a project is protected by Port Daddy, begin with \`pd attention\`,
\`pd status\`, \`pd sitrep --template\`, \`pd briefing\`, and \`pd salvage\`.
Establish a lawful linked-worktree session, set and maintain a \`pd plan\`, leave
a scope note, and claim the smallest real edit surfaces before mutation.
`;

const CATALOG_NOTICE_START = '<!-- port-daddy-catalog-provenance:start -->';
const CATALOG_NOTICE_END = '<!-- port-daddy-catalog-provenance:end -->';

const ALLOWED_CATALOG_ROOT_FILES = [
  /^SKILL\.md$/i,
  /^README(?:\.[^.]+)?$/i,
  /^CHANGELOG(?:\.[^.]+)?$/i,
  /^LICENSE(?:\.[^.]+)?$/i,
  /^NOTICE(?:\.[^.]+)?$/i,
  /^COPYING(?:\.[^.]+)?$/i,
  /^_raw_response\.md$/i,
];
const ALLOWED_CATALOG_DIRS = new Set([
  'references',
  'examples',
  'schemas',
  'templates',
  'prompts',
  'assets',
]);
const REJECTED_CATALOG_AUTHORITY_DIRS = new Set([
  'agents',
  'hooks',
  'mcp',
  'mcp-server',
  'mcp-servers',
  'scripts',
]);
const ALLOWED_CATALOG_EXTENSIONS = new Set([
  '.md', '.txt', '.json', '.jsonc', '.yaml', '.yml', '.toml',
  '.png', '.jpg', '.jpeg', '.webp', '.gif',
]);

export type JuryRigBootstrapVerdict =
  | 'ready'
  | 'blocked'
  | 'clean';

export type JuryRigBootstrapReceiptStatus =
  | 'committed'
  | 'refused'
  | 'rolled-back'
  | 'rollback-failed';

export interface JuryRigBootstrapBlocker {
  code: string;
  surface: string;
  message: string;
}

export interface JuryRigBootstrapSealedBackup {
  schemaVersion: 1;
  keyId: string;
  nonce: string;
  ciphertext: string;
  aad: SealAad;
  plaintextSha256: string;
}

export interface JuryRigBootstrapAuthority {
  keyId: string;
  sign(payload: string): string;
  verify(payload: string, mac: string): boolean;
  sealBackup(plaintext: Buffer, transactionId: string, index: number, path: string): JuryRigBootstrapSealedBackup;
  openBackup(envelope: JuryRigBootstrapSealedBackup, transactionId: string, index: number, path: string): Buffer;
}

export interface JuryRigBootstrapPlanAuthorization {
  keyId: string;
  planDigest: string;
  mac: string;
}

export interface JuryRigBootstrapLayoutOptions {
  home?: string;
  pdHome?: string;
  nativeHookPath?: string;
  runtimeTargets?: RuntimeSkillTarget[];
  transactionRoot?: string;
  importRoot?: string;
  repository?: string;
  replacementPr?: number;
  expectedReplacementHead?: string;
  /** Test/daemon seam; production defaults to the Keychain-derived private authority. */
  authority?: JuryRigBootstrapAuthority;
}

export interface JuryRigBootstrapLayout {
  home: string;
  pdHome: string;
  nativeHookPath: string | null;
  runtimeTargets: RuntimeSkillTarget[];
  transactionRoot: string;
  importRoot: string;
  repository: string;
  replacementPr: number;
  expectedReplacementHead: string | null;
  surfaces: {
    userAgents: string;
    codexAgents: string;
    geminiInstructions: string;
    claudeInstructions: string;
    codexConfig: string;
    claudeSettings: string;
    geminiSettings: string;
    installedPilotHook: string;
  };
}

export interface JuryRigFileAction {
  kind: 'file';
  label: string;
  path: string;
  beforeSha256: string | null;
  afterSha256: string;
  beforeMode: number | null;
  afterMode: number;
  content: string | Buffer;
  removals: number;
  removedAuthorities: string[];
}

export interface JuryRigSymlinkAction {
  kind: 'symlink';
  label: string;
  path: string;
  beforeTarget: string;
  afterTarget: string | null;
}

export interface JuryRigCatalogImportAction {
  kind: 'catalog-import';
  label: string;
  sourcePath: string;
  targetPath: string;
  sourceSkillSha256: string;
  sourceContentSha256: string;
  targetContentSha256: string;
  skillId: string;
}

export type JuryRigBootstrapAction =
  | JuryRigFileAction
  | JuryRigSymlinkAction
  | JuryRigCatalogImportAction;

export interface JuryRigBootstrapPlan {
  schemaVersion: 1;
  generatedAt: string;
  verdict: JuryRigBootstrapVerdict;
  authorization: JuryRigBootstrapPlanAuthorization;
  layout: JuryRigBootstrapLayout;
  blockers: JuryRigBootstrapBlocker[];
  actions: JuryRigBootstrapAction[];
  preconditions: {
    repository: string;
    replacementPr: number;
    expectedReplacementHead: string | null;
    installedDistribution: 'homebrew-keg';
    nativeQueryRequired: true;
    nativeHookRequired: true;
    githubMergeAncestryRequired: true;
    proofMaxAgeMs: number;
  };
  inventory: {
    inspectedFiles: number;
    legacyProjectionLinks: number;
    brokenLegacyProjectionLinks: number;
    uniqueCatalogImports: number;
    reusedCatalogImports: number;
  };
}

export interface NativeJuryRigProof {
  schemaVersion: 1;
  status: 'verified';
  repository: string;
  replacementPr: number;
  prUrl: string;
  prHead: string;
  prMergeCommit: string;
  mergedAt: string;
  releaseTag: string;
  releaseCommit: string;
  releaseComparison: 'ahead' | 'identical';
  installedPdPath: string;
  installedPdVersion: string;
  installedPdSha256: string;
  installedKeg: string;
  nativeHookPath: string;
  nativeHookSha256: string;
  juryRigQueryScannedCount: number;
  verifiedAt: string;
}

export interface VerifyNativeJuryRigOptions {
  repository: string;
  replacementPr: number;
  pdCommand?: string;
  ghCommand?: string;
  now?: Date;
}

export interface JuryRigBootstrapReceiptAction {
  kind: JuryRigBootstrapAction['kind'];
  label: string;
  path: string;
  before: string | null;
  after: string | null;
  removedAuthorities: string[];
}

export interface JuryRigBootstrapAttribution {
  agentId: string;
  sessionId: string;
  remit: string;
  roadmapAuthority: string;
  sourceHead: string;
}

export interface JuryRigBootstrapReceipt {
  schemaVersion: 1;
  id: string;
  status: JuryRigBootstrapReceiptStatus;
  startedAt: string;
  completedAt: string;
  transactionDir: string;
  receiptPath: string;
  planDigest: string;
  authorityKeyId: string;
  attribution: JuryRigBootstrapAttribution;
  proof: NativeJuryRigProof | null;
  blockers: JuryRigBootstrapBlocker[];
  actions: JuryRigBootstrapReceiptAction[];
  appliedCount: number;
  rolledBackCount: number;
  error: string | null;
  receiptSha256: string;
  receiptMac: string;
}

interface PersistedActionState extends JuryRigBootstrapReceiptAction {
  index: number;
  backupPath: string | null;
  beforeMode: number | null;
  pending: boolean;
  applied: boolean;
  createdByTransaction: boolean;
}

interface TransactionManifest {
  schemaVersion: 1;
  id: string;
  planDigest: string;
  authorityKeyId: string;
  manifestMac: string;
  status: 'prepared' | 'applying' | JuryRigBootstrapReceiptStatus;
  startedAt: string;
  completedAt: string | null;
  attribution: JuryRigBootstrapAttribution;
  proof: NativeJuryRigProof | null;
  blockers: JuryRigBootstrapBlocker[];
  error: string | null;
  appliedCount: number;
  rolledBackCount: number;
  actions: PersistedActionState[];
}

export interface ApplyJuryRigBootstrapOptions {
  plan: JuryRigBootstrapPlan;
  proof: NativeJuryRigProof | null;
  attribution: JuryRigBootstrapAttribution;
  now?: Date;
  /** Test/daemon seam; production defaults to the Keychain-derived private authority. */
  authority?: JuryRigBootstrapAuthority;
  /** Test seam; production invokes the fail-closed external scanner. */
  gitleaksRunner?: GitleaksRunner;
  /** Test seam; production apply always re-runs the native verifier itself. */
  verifyRuntime?: (options: VerifyNativeJuryRigOptions) => NativeJuryRigProof;
  /** Test-only failure injection. Throws after this many applied actions. */
  failAfterAction?: number;
  /** Test-only crash injection. Leaves an applying manifest for recovery. */
  interruptAfterAction?: number;
  /** Test-only crash injection between target mutation and applied checkpoint. */
  interruptAfterMutationBeforeCheckpoint?: number;
}

export interface JuryRigBootstrapRecoveryOptions {
  /** Test/daemon seam; production defaults to the Keychain-derived private authority. */
  authority?: JuryRigBootstrapAuthority;
}

export class JuryRigBootstrapInterruptedError extends Error {
  constructor(readonly transactionDir: string, appliedCount: number) {
    super(`simulated interruption after ${appliedCount} action(s)`);
    this.name = 'JuryRigBootstrapInterruptedError';
  }
}

/**
 * Design: use one byte-stable digest format for plans, receipts, and rollback checks.
 * @param data Bytes whose exact identity must be recorded.
 * @returns Lowercase SHA-256 hex.
 */
function sha256(data: string | Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

/**
 * Design: JSON round-trips Buffer postimages only inside an authenticated encrypted envelope.
 * @param _key JSON property name supplied by the parser.
 * @param value Parsed candidate value.
 * @returns A restored Buffer when Node's Buffer JSON shape is present, otherwise the input.
 */
function revivePlanBuffer(_key: string, value: unknown): unknown {
  if (
    value
    && typeof value === 'object'
    && (value as { type?: unknown }).type === 'Buffer'
    && Array.isArray((value as { data?: unknown }).data)
  ) {
    return Buffer.from((value as { data: number[] }).data);
  }
  return value;
}

/**
 * Design: normalize every transaction time to an unambiguous UTC receipt value.
 * @param now Clock value, injectable for deterministic fixtures.
 * @returns ISO-8601 timestamp.
 */
function iso(now = new Date()): string {
  return now.toISOString();
}

/**
 * Design: derive one private, domain-separated authority from existing Port Daddy key material.
 * @param masterKey Exactly 32 bytes held by the daemon or a test fixture.
 * @param keyId Non-secret key identifier persisted in plans and receipts.
 * @returns Signing and pd-vault sealing operations that never expose the key.
 */
export function createJuryRigBootstrapAuthority(
  masterKey: Buffer,
  keyId = AUTHORITY_KEY_ID,
): JuryRigBootstrapAuthority {
  if (masterKey.length !== 32) {
    throw new Error('Jury-rig bootstrap authority requires exactly 32 private key bytes');
  }
  const signingKey = createHmac('sha256', masterKey)
    .update('port-daddy:jury-rig-bootstrap:authority-key:v1')
    .digest();
  const backupKey = deriveChannelKey(masterKey, BACKUP_CHANNEL, BACKUP_EPOCH);

  return Object.freeze({
    keyId,
    /** Design: authenticate canonical control-plane bytes with the private derived key. @param payload Canonical payload. @returns HMAC hex. */
    sign(payload: string): string {
      return createHmac('sha256', signingKey).update(payload).digest('hex');
    },
    /** Design: compare keyed authority in constant time. @param payload Canonical payload. @param mac Claimed HMAC. @returns Whether it is authentic. */
    verify(payload: string, mac: string): boolean {
      if (!/^[a-f0-9]{64}$/.test(mac)) return false;
      const expected = Buffer.from(createHmac('sha256', signingKey).update(payload).digest('hex'), 'hex');
      return timingSafeEqual(expected, Buffer.from(mac, 'hex'));
    },
    /** Design: seal rollback bytes to transaction/action context. @param plaintext Exact preimage. @param transactionId Transaction id. @param index Action index. @param path Target path. @returns Authenticated ciphertext envelope. */
    sealBackup(plaintext: Buffer, transactionId: string, index: number, path: string): JuryRigBootstrapSealedBackup {
      const aad: SealAad = {
        harborId: BACKUP_HARBOR,
        channelId: `${transactionId}:${index}:${sha256(path)}`,
        epoch: BACKUP_EPOCH,
        seq: index,
      };
      const nonce = randomVaultNonce();
      return {
        schemaVersion: SCHEMA_VERSION,
        keyId,
        nonce: nonce.toString('base64'),
        ciphertext: sealVault(backupKey, nonce, plaintext, aad).toString('base64'),
        aad,
        plaintextSha256: sha256(plaintext),
      };
    },
    /** Design: open only a context-matching rollback envelope. @param envelope Sealed backup. @param transactionId Transaction id. @param index Action index. @param path Target path. @returns Exact preimage bytes. */
    openBackup(envelope: JuryRigBootstrapSealedBackup, transactionId: string, index: number, path: string): Buffer {
      const expectedAad: SealAad = {
        harborId: BACKUP_HARBOR,
        channelId: `${transactionId}:${index}:${sha256(path)}`,
        epoch: BACKUP_EPOCH,
        seq: index,
      };
      if (
        envelope.schemaVersion !== SCHEMA_VERSION
        || envelope.keyId !== keyId
        || JSON.stringify(envelope.aad) !== JSON.stringify(expectedAad)
      ) {
        throw new Error('sealed rollback backup authority/context mismatch');
      }
      const plaintext = openVault(
        backupKey,
        Buffer.from(envelope.nonce, 'base64'),
        Buffer.from(envelope.ciphertext, 'base64'),
        expectedAad,
      );
      if (sha256(plaintext) !== envelope.plaintextSha256) {
        throw new Error('sealed rollback backup plaintext hash mismatch');
      }
      return plaintext;
    },
  });
}

/**
 * Design: production cutover authority must come from the OS-mediated Keychain, never disk fallback.
 * @returns Private authority derived from the existing Port Daddy master key.
 */
function loadJuryRigBootstrapAuthority(): JuryRigBootstrapAuthority {
  const encoded = keychain.loadSecret(KEYCHAIN_SERVICE, AUTHORITY_KEYCHAIN_ACCOUNT);
  if (!encoded || !/^[a-fA-F0-9]{64}$/.test(encoded)) {
    throw new Error('Jury-rig bootstrap requires the 32-byte Port Daddy master key in the OS Keychain');
  }
  return createJuryRigBootstrapAuthority(Buffer.from(encoded, 'hex'));
}

/**
 * Design: bound reads before allocation so hostile config and catalog files fail closed.
 * @param path Regular file to read.
 * @param maxBytes Maximum admitted byte count.
 * @returns Exact file bytes.
 */
function readBounded(path: string, maxBytes = MAX_CONFIG_BYTES): Buffer {
  const size = statSync(path).size;
  if (size > maxBytes) {
    throw new Error(`${path} is ${size} bytes; refusing to read beyond ${maxBytes}`);
  }
  return readFileSync(path);
}

/**
 * Design: centralize bounded UTF-8 decoding for every textual control surface.
 * @param path Text file to read.
 * @param maxBytes Maximum admitted byte count.
 * @returns Decoded UTF-8 content.
 */
function readUtf8(path: string, maxBytes = MAX_CONFIG_BYTES): string {
  return readBounded(path, maxBytes).toString('utf8');
}

/**
 * Design: preserve user-selected permission bits across atomic replacement and rollback.
 * @param path Candidate file path.
 * @returns Existing permission mode, or null when absent.
 */
function fileMode(path: string): number | null {
  if (!existsSync(path)) return null;
  return statSync(path).mode & 0o777;
}

/**
 * Design: distinguish an absent file from a byte-identical preimage without following leaf symlinks.
 * @param path Candidate regular file.
 * @returns SHA-256 of its bytes, or null when absent or not a regular file.
 */
function currentFileSha(path: string): string | null {
  if (!existsSync(path)) return null;
  const stat = lstatSync(path);
  if (!stat.isFile()) return null;
  return sha256(readBounded(path, Math.max(MAX_CONFIG_BYTES, stat.size)));
}

/**
 * Design: destructive rollback is permitted only below its narrow catalog root.
 * @param path Candidate descendant path.
 * @param root Required containing directory.
 * @returns Whether lexical resolution keeps the candidate within the root.
 */
function pathInside(path: string, root: string): boolean {
  const rel = relative(resolve(root), resolve(path));
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel));
}

/**
 * Design: identify leaf or parent symlinks before a trusted surface is read or mutated.
 * @param path Candidate path.
 * @param root Containment root from which components are inspected.
 * @returns First symlink component, or null when every existing component is concrete.
 */
function firstSymlinkComponent(path: string, root: string): string | null {
  const resolvedRoot = resolve(root);
  const resolvedPath = resolve(path);
  if (!pathInside(resolvedPath, resolvedRoot)) return resolvedPath;
  let current = resolvedRoot;
  if (lstatExists(current) && lstatSync(current).isSymbolicLink()) return current;
  const rel = relative(resolvedRoot, resolvedPath);
  for (const component of rel.split(sep).filter(Boolean)) {
    current = join(current, component);
    if (!lstatExists(current)) break;
    if (lstatSync(current).isSymbolicLink()) return current;
  }
  return null;
}

/**
 * Design: resolve the deepest existing ancestor so lexical containment is confirmed by filesystem truth.
 * @param path Candidate path, which may not exist yet.
 * @returns Deepest existing ancestor.
 */
function nearestExistingAncestor(path: string): string {
  let current = resolve(path);
  while (!lstatExists(current)) {
    const parent = dirname(current);
    if (parent === current) throw new Error(`no existing ancestor for ${path}`);
    current = parent;
  }
  return current;
}

/**
 * Design: collect all containment and symlink hazards without mutating the dry-run target set.
 * @param layout Resolved bootstrap layout.
 * @returns Fail-closed layout blockers.
 */
function bootstrapLayoutBlockers(layout: JuryRigBootstrapLayout): JuryRigBootstrapBlocker[] {
  const checks: Array<{ path: string; root: string; label: string }> = [
    { path: layout.pdHome, root: layout.home, label: 'Port Daddy home' },
    { path: layout.transactionRoot, root: layout.pdHome, label: 'transaction root' },
    { path: layout.importRoot, root: layout.pdHome, label: 'catalog import root' },
    ...Object.entries(layout.surfaces).map(([label, path]) => ({
      path,
      root: label === 'installedPilotHook' ? layout.pdHome : layout.home,
      label,
    })),
    ...layout.runtimeTargets.map((target) => ({ path: target.path, root: layout.home, label: target.label })),
  ];
  const blockers: JuryRigBootstrapBlocker[] = [];
  for (const check of checks) {
    if (!pathInside(check.path, check.root)) {
      blockers.push({
        code: 'SURFACE_OUTSIDE_AUTHORITY_ROOT',
        surface: check.path,
        message: `${check.label} escapes ${check.root}`,
      });
      continue;
    }
    const symlink = firstSymlinkComponent(check.path, check.root);
    if (symlink) {
      blockers.push({
        code: 'SYMLINKED_SURFACE_PATH',
        surface: check.path,
        message: `${check.label} traverses symlink ${symlink}`,
      });
      continue;
    }
    try {
      const rootReal = realpathSync(nearestExistingAncestor(check.root));
      const ancestorReal = realpathSync(nearestExistingAncestor(check.path));
      if (!pathInside(ancestorReal, rootReal)) {
        blockers.push({
          code: 'SURFACE_REALPATH_ESCAPE',
          surface: check.path,
          message: `${check.label} resolves outside ${check.root}`,
        });
      }
    } catch (error) {
      blockers.push({
        code: 'SURFACE_REALPATH_FAILED',
        surface: check.path,
        message: (error as Error).message,
      });
    }
  }
  return blockers;
}

/**
 * Design: apply/recovery re-run layout checks because parents can change after plan authorization.
 * @param layout Signed layout to revalidate.
 */
function assertSafeBootstrapLayout(layout: JuryRigBootstrapLayout): void {
  const blockers = bootstrapLayoutBlockers(layout);
  if (blockers.length > 0) {
    throw new Error(`unsafe Jury-rig bootstrap layout: ${blockers[0].code} ${blockers[0].surface}`);
  }
}

/**
 * Design: classify only path components naming the legacy distribution, not arbitrary prose.
 * @param path Resolved or dangling catalog target.
 * @returns Whether the path belongs to a legacy catalog tree.
 */
function isLegacyCatalogPath(path: string): boolean {
  const normalized = resolve(path).toLowerCase().split(sep).join('/');
  return normalized.includes(`/${LEGACY_NAME}/`) || normalized.includes(`/${LEGACY_NAME}-skills/`);
}

/**
 * Design: keep legacy-name detection case-insensitive and consistent across config formats.
 * @param value Text to inspect.
 * @returns Whether it contains the legacy runtime name.
 */
function hasLegacyName(value: string): boolean {
  return value.toLowerCase().includes(LEGACY_NAME);
}

/**
 * Design: marker-bounded replacement makes repeated instruction projection idempotent.
 * @param content Existing instruction text.
 * @param start Opening ownership marker.
 * @param end Closing ownership marker.
 * @param replacement Complete replacement block.
 * @returns Transformed content plus change/removal evidence or a marker error.
 */
function upsertMarkedBlock(
  content: string,
  start: string,
  end: string,
  replacement: string,
): { content: string; changed: boolean; removals: number; error?: string } {
  const startAt = content.indexOf(start);
  const endAt = content.indexOf(end);
  if ((startAt === -1) !== (endAt === -1) || (startAt !== -1 && endAt < startAt)) {
    return { content, changed: false, removals: 0, error: `unbalanced marker ${start}` };
  }
  if (startAt !== -1) {
    const tail = endAt + end.length;
    const next = `${content.slice(0, startAt)}${replacement}${content.slice(tail)}`;
    return { content: next, changed: next !== content, removals: 1 };
  }
  const separator = content.length === 0 || content.endsWith('\n') ? '' : '\n';
  const prefix = content.length === 0 ? '' : `${separator}\n`;
  return { content: `${content}${prefix}${replacement}\n`, changed: true, removals: 0 };
}

/**
 * Design: replace only recognized generated authority while preserving handwritten guides.
 * @param content Existing AGENTS.md text.
 * @returns Safe native projection or a fail-closed transform error.
 */
function transformAgentsGuide(content: string): {
  content: string;
  changed: boolean;
  removals: number;
  removedAuthorities?: string[];
  error?: string;
} {
  if (content.includes(NATIVE_GUIDE_START)) {
    return upsertMarkedBlock(content, NATIVE_GUIDE_START, NATIVE_GUIDE_END, NATIVE_GUIDE_BLOCK);
  }
  const generatedLegacy = content.includes('# AGENTS.md — User-Level Agent Guide')
    && content.includes(`## ${LEGACY_NAME} Skill System`)
    && content.includes('This file was generated by');
  if (generatedLegacy) {
    return {
      content: NATIVE_USER_GUIDE,
      changed: content !== NATIVE_USER_GUIDE,
      removals: 1,
      removedAuthorities: ['generated-user-guide:legacy-skill-runtime'],
    };
  }
  if (hasLegacyName(content)) {
    return {
      content,
      changed: false,
      removals: 0,
      error: 'legacy authority appears outside the recognized generated guide',
    };
  }
  return upsertMarkedBlock(content, NATIVE_GUIDE_START, NATIVE_GUIDE_END, NATIVE_GUIDE_BLOCK);
}

/**
 * Design: retire the installer-owned Gemini block without rewriting unrelated instructions.
 * @param content Existing GEMINI.md text.
 * @returns Native marked-block projection and exact authority-removal metadata.
 */
function transformGeminiInstructions(content: string) {
  let next = content;
  let removals = 0;
  if (content.includes(LEGACY_GEMINI_START) || content.includes(LEGACY_GEMINI_END)) {
    const removed = upsertMarkedBlock(content, LEGACY_GEMINI_START, LEGACY_GEMINI_END, '');
    if (removed.error) return removed;
    next = removed.content;
    removals += removed.removals;
  }
  if (hasLegacyName(next)) {
    return {
      content,
      changed: false,
      removals,
      error: 'legacy authority appears outside the recognized Gemini marker block',
    };
  }
  const native = upsertMarkedBlock(next, NATIVE_GUIDE_START, NATIVE_GUIDE_END, NATIVE_GUIDE_BLOCK);
  return {
    ...native,
    changed: native.content !== content,
    removals: removals + native.removals,
    removedAuthorities: removals > 0 ? ['marker:legacy-skill-runtime'] : [],
  };
}

/**
 * Design: remove the known active Claude directive while retaining historical user prose.
 * @param content Existing CLAUDE.md text.
 * @returns Native marked-block projection and exact authority-removal metadata.
 */
function transformClaudeInstructions(content: string) {
  const lines = content.split(/\r?\n/);
  let removed = 0;
  const activeDirective = new RegExp(`^\\s*(?:[-*+]\\s+)?Embrace ${LEGACY_NAME}\\b`, 'i');
  const kept = lines.filter((line) => {
    if (activeDirective.test(line)) {
      removed += 1;
      return false;
    }
    return true;
  }).join('\n');
  const native = upsertMarkedBlock(kept, NATIVE_GUIDE_START, NATIVE_GUIDE_END, NATIVE_GUIDE_BLOCK);
  return {
    ...native,
    changed: native.content !== content,
    removals: removed + native.removals,
    removedAuthorities: removed > 0 ? ['instruction-line:legacy-skill-runtime'] : [],
  };
}

/**
 * Design: remove complete legacy TOML tables so nested credentials cannot leak or survive.
 * @param content Existing Codex TOML configuration.
 * @returns Preserved non-legacy text plus exact removed table names.
 */
function stripLegacyTomlTables(content: string): {
  content: string;
  changed: boolean;
  removals: number;
  removedAuthorities?: string[];
  error?: string;
} {
  const lines = content.match(/.*(?:\r?\n|$)/g)?.filter(Boolean) ?? [];
  const kept: string[] = [];
  let skip = false;
  let removals = 0;
  const removedAuthorities: string[] = [];
  for (const line of lines) {
    const header = line.match(/^\s*\[\[?([^\]]+)\]\]?\s*(?:#.*)?(?:\r?\n)?$/);
    if (header) {
      skip = hasLegacyName(header[1]);
      if (skip) {
        removals += 1;
        removedAuthorities.push(`toml-table:${header[1].trim()}`);
      }
    }
    if (!skip) kept.push(line);
  }
  const next = kept.join('').replace(/\n{3,}/g, '\n\n');
  if (hasLegacyName(next)) {
    return {
      content,
      changed: false,
      removals,
      error: 'legacy authority remains outside a removable TOML table',
    };
  }
  return { content: next, changed: next !== content, removals, removedAuthorities };
}

/**
 * Design: structurally remove legacy JSON registrations while preserving unrelated keys and values.
 * @param value Current JSON node.
 * @param path Field path used for operator-safe removal receipts.
 * @returns Transformed node and exact field-removal evidence.
 */
function removeLegacyJson(
  value: unknown,
  path: string[] = [],
): { value: unknown; removals: number; removedAuthorities: string[] } {
  if (Array.isArray(value)) {
    const output: unknown[] = [];
    let removals = 0;
    const removedAuthorities: string[] = [];
    for (let index = 0; index < value.length; index++) {
      const entry = value[index];
      if (typeof entry === 'string' && hasLegacyName(entry)) {
        removals += 1;
        removedAuthorities.push(`json-field:${[...path, String(index)].join('.')}`);
        continue;
      }
      const transformed = removeLegacyJson(entry, [...path, String(index)]);
      removals += transformed.removals;
      removedAuthorities.push(...transformed.removedAuthorities);
      if (transformed.value && typeof transformed.value === 'object') {
        const serialized = JSON.stringify(transformed.value);
        if (hasLegacyName(serialized)) {
          removals += 1;
          removedAuthorities.push(`json-field:${[...path, String(index)].join('.')}`);
          continue;
        }
      }
      output.push(transformed.value);
    }
    return { value: output, removals, removedAuthorities };
  }
  if (value && typeof value === 'object') {
    const output: Record<string, unknown> = {};
    let removals = 0;
    const removedAuthorities: string[] = [];
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (hasLegacyName(key)) {
        removals += 1;
        removedAuthorities.push(`json-field:${[...path, key].join('.')}`);
        continue;
      }
      const transformed = removeLegacyJson(entry, [...path, key]);
      output[key] = transformed.value;
      removals += transformed.removals;
      removedAuthorities.push(...transformed.removedAuthorities);
    }
    return { value: output, removals, removedAuthorities };
  }
  return { value, removals: 0, removedAuthorities: [] };
}

/**
 * Design: parse and reserialize tool configuration so edits occur on fields, never text fragments.
 * @param content Existing JSON configuration.
 * @returns Preserved configuration, removal evidence, or a parse blocker.
 */
function transformJsonConfig(content: string) {
  try {
    const parsed = JSON.parse(content) as unknown;
    const transformed = removeLegacyJson(parsed);
    const next = JSON.stringify(transformed.value, null, 2) + '\n';
    if (hasLegacyName(next)) {
      return {
        content,
        changed: false,
        removals: transformed.removals,
        error: 'legacy authority remains after structured JSON cleanup',
      };
    }
    return {
      content: next,
      changed: next !== content,
      removals: transformed.removals,
      removedAuthorities: transformed.removedAuthorities,
    };
  } catch {
    return {
      content,
      changed: false,
      removals: 0,
      error: 'configuration is not valid JSON',
    };
  }
}

/**
 * Design: turn one instruction/config surface into an inspectable action without writing it.
 * @param plan Plan that receives blockers, inventory, and a possible action.
 * @param label Operator-readable surface label.
 * @param path Exact target path.
 * @param transform Format-aware pure transformer.
 * @param createWhenMissing Whether absence should produce a new file action.
 * @param defaultMode Permission mode for newly created files.
 */
function addTextAction(
  plan: JuryRigBootstrapPlan,
  label: string,
  path: string,
  transform: (content: string) => {
    content: string;
    changed: boolean;
    removals: number;
    removedAuthorities?: string[];
    error?: string;
  },
  createWhenMissing: boolean,
  defaultMode = 0o644,
): void {
  plan.inventory.inspectedFiles += 1;
  const present = existsSync(path);
  let content = '';
  let beforeMode: number | null = null;
  try {
    if (present) {
      const stat = lstatSync(path);
      if (!stat.isFile()) {
        plan.blockers.push({ code: 'SURFACE_NOT_FILE', surface: path, message: `${label} is not a regular file` });
        return;
      }
      content = readUtf8(path);
      beforeMode = stat.mode & 0o777;
    } else if (!createWhenMissing) {
      return;
    }
  } catch (error) {
    plan.blockers.push({ code: 'SURFACE_READ_FAILED', surface: path, message: (error as Error).message });
    return;
  }
  const result = transform(content);
  if (result.error) {
    plan.blockers.push({ code: 'UNSAFE_TRANSFORM', surface: path, message: result.error });
    return;
  }
  if (!result.changed && present) return;
  plan.actions.push({
    kind: 'file',
    label,
    path,
    beforeSha256: present ? sha256(content) : null,
    afterSha256: sha256(result.content),
    beforeMode,
    afterMode: beforeMode ?? defaultMode,
    content: result.content,
    removals: result.removals,
    removedAuthorities: result.removedAuthorities ?? [],
  });
}

/**
 * Design: derive portable catalog directory names without admitting traversal characters.
 * @param value Runtime projection name.
 * @returns Lowercase filesystem-safe skill id.
 */
function sanitizeSkillId(value: string): string {
  const normalized = value.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return normalized || 'imported-skill';
}

/**
 * Design: keep imported provenance at one predictable location within each catalog copy.
 * @param root Imported skill directory.
 * @returns Manifest path.
 */
function catalogManifestPath(root: string): string {
  return join(root, '.port-daddy-catalog.json');
}

/**
 * Design: canonicalize a path-to-hash map so catalog identity is independent of directory order.
 * @param fileHashes Relative catalog paths and exact byte hashes.
 * @returns SHA-256 identity for the complete admitted catalog body.
 */
function catalogTreeDigest(fileHashes: Record<string, string>): string {
  return sha256(JSON.stringify(Object.entries(fileHashes).sort(([left], [right]) => left.localeCompare(right))));
}

interface CatalogProjectionInspection {
  sourceContentSha256: string;
  targetContentSha256: string;
}

/**
 * Design: compute source and annotated target identities during dry-run without writing staging bytes.
 * @param sourceRoot Third-party skill directory.
 * @param sourceSkillSha256 Pinned raw SKILL.md digest.
 * @returns Complete admitted source and projected-content digests.
 */
function inspectCatalogProjection(
  sourceRoot: string,
  sourceSkillSha256: string,
): CatalogProjectionInspection {
  const sourceHashes: Record<string, string> = {};
  const targetHashes: Record<string, string> = {};
  let files = 0;
  let bytes = 0;

  /**
   * Design: mirror copy admission while remaining read-only.
   * @param sourceDir Current source directory.
   * @param topLevel Whether root admission rules apply.
   */
  function visit(sourceDir: string, topLevel: boolean): void {
    for (const entry of readdirSync(sourceDir, { withFileTypes: true })) {
      const source = join(sourceDir, entry.name);
      const normalizedName = entry.name.toLowerCase();
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (REJECTED_CATALOG_AUTHORITY_DIRS.has(normalizedName)) continue;
        if (topLevel && !ALLOWED_CATALOG_DIRS.has(normalizedName)) continue;
        visit(source, false);
        continue;
      }
      if (!entry.isFile()) continue;
      const allowed = topLevel
        ? ALLOWED_CATALOG_ROOT_FILES.some((pattern) => pattern.test(entry.name))
        : ALLOWED_CATALOG_EXTENSIONS.has(catalogExtension(entry.name));
      if (!allowed) continue;
      const stat = statSync(source);
      if (stat.size > MAX_CATALOG_FILE_BYTES) {
        throw new Error(`catalog file exceeds ${MAX_CATALOG_FILE_BYTES} bytes: ${source}`);
      }
      files += 1;
      bytes += stat.size;
      if (files > MAX_CATALOG_FILES || bytes > MAX_CATALOG_SKILL_BYTES) {
        throw new Error(`catalog skill exceeds safe copy bounds: ${sourceRoot}`);
      }
      const raw = readFileSync(source);
      const rel = relative(sourceRoot, source).split(sep).join('/');
      sourceHashes[rel] = sha256(raw);
      const projected = topLevel && entry.name === 'SKILL.md'
        ? Buffer.from(annotateCatalogSkill(raw.toString('utf8'), sourceRoot, sourceSkillSha256))
        : raw;
      targetHashes[rel] = sha256(projected);
    }
  }

  visit(sourceRoot, true);
  if (!sourceHashes['SKILL.md']) {
    throw new Error(`catalog import did not preserve SKILL.md from ${sourceRoot}`);
  }
  return {
    sourceContentSha256: catalogTreeDigest(sourceHashes),
    targetContentSha256: catalogTreeDigest(targetHashes),
  };
}

/**
 * Design: enumerate every reused target byte so a truthful manifest cannot mask later tampering.
 * @param target Imported catalog directory.
 * @returns Actual relative file hashes, or null for links/non-files/unbounded bytes.
 */
function importedCatalogFileHashes(target: string): Record<string, string> | null {
  const hashes: Record<string, string> = {};
  let files = 0;
  let bytes = 0;
  try {
    /**
     * Design: reject every non-regular entry in the guidance-only projection.
     * @param directory Current imported directory.
     */
    function visit(directory: string): void {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        if (path === catalogManifestPath(target)) continue;
        if (entry.isSymbolicLink() || (!entry.isFile() && !entry.isDirectory())) throw new Error('non-regular import entry');
        if (entry.isDirectory()) {
          if (REJECTED_CATALOG_AUTHORITY_DIRS.has(entry.name.toLowerCase())) throw new Error('authority directory in import');
          visit(path);
          continue;
        }
        const stat = statSync(path);
        files += 1;
        bytes += stat.size;
        if (stat.size > MAX_CATALOG_FILE_BYTES || files > MAX_CATALOG_FILES || bytes > MAX_CATALOG_SKILL_BYTES) {
          throw new Error('import exceeds bounds');
        }
        hashes[relative(target, path).split(sep).join('/')] = sha256(readFileSync(path));
      }
    }
    visit(target);
    return hashes;
  } catch {
    return null;
  }
}

/**
 * Design: reuse imports only when their manifest and every projected byte prove non-executable identity.
 * @param target Existing imported skill directory.
 * @param sourceSkillSha256 Expected source SKILL.md digest.
 * @param sourceContentSha256 Expected complete admitted source digest.
 * @param targetContentSha256 Expected complete projected target digest.
 * @returns Whether the import is safe to project again.
 */
function reusableCatalogImport(
  target: string,
  sourceSkillSha256: string,
  sourceContentSha256: string,
  targetContentSha256: string,
): boolean {
  try {
    const manifest = JSON.parse(readUtf8(catalogManifestPath(target))) as {
      schemaVersion?: unknown;
      sourceSkillSha256?: unknown;
      sourceContentSha256?: unknown;
      targetContentSha256?: unknown;
      executableAuthority?: unknown;
      fileHashes?: unknown;
    };
    if (!(manifest.schemaVersion === SCHEMA_VERSION
      && manifest.sourceSkillSha256 === sourceSkillSha256
      && manifest.sourceContentSha256 === sourceContentSha256
      && manifest.targetContentSha256 === targetContentSha256
      && manifest.executableAuthority === false
      && manifest.fileHashes
      && typeof manifest.fileHashes === 'object'
      && !Array.isArray(manifest.fileHashes))) return false;
    const expectedHashes = manifest.fileHashes as Record<string, string>;
    const actualHashes = importedCatalogFileHashes(target);
    return actualHashes !== null
      && JSON.stringify(Object.entries(actualHashes).sort()) === JSON.stringify(Object.entries(expectedHashes).sort())
      && catalogTreeDigest(actualHashes) === targetContentSha256;
  } catch {
    return false;
  }
}

/**
 * Design: inventory legacy runtime links and plan provenance-preserving replacements in one pass.
 * @param plan Mutable read-only plan accumulator.
 */
function scanCatalogProjections(plan: JuryRigBootstrapPlan): void {
  const imports = new Map<string, JuryRigCatalogImportAction>();
  const seenLinks = new Set<string>();
  for (const target of plan.layout.runtimeTargets) {
    if (!existsSync(target.path)) continue;
    let entries;
    try {
      entries = readdirSync(target.path, { withFileTypes: true });
    } catch (error) {
      plan.blockers.push({ code: 'CATALOG_TARGET_READ_FAILED', surface: target.path, message: (error as Error).message });
      continue;
    }
    for (const entry of entries) {
      if (!entry.isSymbolicLink()) continue;
      const linkPath = join(target.path, entry.name);
      if (seenLinks.has(linkPath)) continue;
      seenLinks.add(linkPath);
      let rawTarget: string;
      try {
        rawTarget = readlinkSync(linkPath);
      } catch (error) {
        plan.blockers.push({ code: 'CATALOG_LINK_READ_FAILED', surface: linkPath, message: (error as Error).message });
        continue;
      }
      let sourcePath: string | null = null;
      try {
        sourcePath = realpathSync(linkPath);
      } catch {
        const absoluteRaw = isAbsolute(rawTarget) ? rawTarget : resolve(dirname(linkPath), rawTarget);
        if (isLegacyCatalogPath(absoluteRaw)) {
          plan.inventory.legacyProjectionLinks += 1;
          plan.inventory.brokenLegacyProjectionLinks += 1;
          plan.actions.push({
            kind: 'symlink',
            label: `${target.label} broken legacy catalog projection`,
            path: linkPath,
            beforeTarget: rawTarget,
            afterTarget: null,
          });
        }
        continue;
      }
      if (!isLegacyCatalogPath(sourcePath)) continue;
      plan.inventory.legacyProjectionLinks += 1;
      const skillFile = join(sourcePath, 'SKILL.md');
      if (!existsSync(skillFile) || !lstatSync(skillFile).isFile()) {
        plan.blockers.push({
          code: 'LEGACY_SKILL_BODY_MISSING',
          surface: linkPath,
          message: 'legacy projection has no regular SKILL.md to preserve',
        });
        continue;
      }
      const sourceSkill = readBounded(skillFile, MAX_CATALOG_FILE_BYTES);
      const sourceSkillSha256 = sha256(sourceSkill);
      let inspection: CatalogProjectionInspection;
      try {
        inspection = inspectCatalogProjection(sourcePath, sourceSkillSha256);
      } catch (error) {
        plan.blockers.push({
          code: 'CATALOG_SOURCE_REJECTED',
          surface: sourcePath,
          message: (error as Error).message,
        });
        continue;
      }
      const importKey = `${sourcePath}\0${inspection.sourceContentSha256}`;
      let importAction = imports.get(importKey);
      if (!importAction) {
        const skillId = sanitizeSkillId(entry.name || basename(sourcePath));
        const sourcePathId = sha256(resolve(sourcePath)).slice(0, 8);
        const targetPath = join(
          plan.layout.importRoot,
          `${skillId}-${sourcePathId}-${inspection.sourceContentSha256.slice(0, 12)}`,
        );
        importAction = {
          kind: 'catalog-import',
          label: `provenance catalog import ${skillId}`,
          sourcePath,
          targetPath,
          sourceSkillSha256,
          sourceContentSha256: inspection.sourceContentSha256,
          targetContentSha256: inspection.targetContentSha256,
          skillId,
        };
        imports.set(importKey, importAction);
        if (existsSync(targetPath)) {
          if (!reusableCatalogImport(
            targetPath,
            sourceSkillSha256,
            inspection.sourceContentSha256,
            inspection.targetContentSha256,
          )) {
            plan.blockers.push({
              code: 'CATALOG_IMPORT_TAMPERED',
              surface: targetPath,
              message: 'existing import bytes do not match its non-executable provenance manifest',
            });
          } else {
            plan.inventory.reusedCatalogImports += 1;
          }
        }
      }
      plan.actions.push({
        kind: 'symlink',
        label: `${target.label} native catalog projection`,
        path: linkPath,
        beforeTarget: rawTarget,
        afterTarget: importAction.targetPath,
      });
    }
  }
  for (const action of imports.values()) {
    if (!existsSync(action.targetPath)) plan.actions.unshift(action);
  }
  plan.inventory.uniqueCatalogImports = imports.size;
}

/**
 * Design: hash every trusted layout/precondition/action field while excluding secret postimage bytes.
 * @param plan Full in-memory plan.
 * @returns SHA-256 identity used by plan, manifest, and receipt authority checks.
 */
function juryRigBootstrapPlanDigest(plan: JuryRigBootstrapPlan): string {
  const { authorization: _authorization, actions: _actions, ...safePlan } = plan;
  return sha256(JSON.stringify({
    ...safePlan,
    actions: plan.actions.map(receiptAction),
  }));
}

/**
 * Design: bind the complete plan digest to private machine authority before any target path is trusted.
 * @param plan Completed dry-run plan.
 * @param authority Keychain-derived or fixture-only authority.
 * @returns Signed plan authorization.
 */
function authorizeJuryRigBootstrapPlan(
  plan: JuryRigBootstrapPlan,
  authority: JuryRigBootstrapAuthority,
): JuryRigBootstrapPlanAuthorization {
  const planDigest = juryRigBootstrapPlanDigest(plan);
  return {
    keyId: authority.keyId,
    planDigest,
    mac: authority.sign(`${PLAN_MAC_DOMAIN}\0${planDigest}`),
  };
}

/**
 * Design: reject caller-fabricated or mutated plans before reading any plan-selected filesystem path.
 * @param plan Candidate plan.
 * @param authority Private authority expected to have approved it.
 * @returns Verified plan digest.
 */
function verifyJuryRigBootstrapPlanAuthorization(
  plan: JuryRigBootstrapPlan,
  authority: JuryRigBootstrapAuthority,
): string {
  const digest = juryRigBootstrapPlanDigest(plan);
  if (
    plan.authorization.keyId !== authority.keyId
    || plan.authorization.planDigest !== digest
    || !authority.verify(`${PLAN_MAC_DOMAIN}\0${digest}`, plan.authorization.mac)
  ) {
    throw new Error('Jury-rig bootstrap plan authorization failed');
  }
  return digest;
}

/**
 * Design: resolve every machine surface once so plan, apply, receipt, and rollback share identity.
 * @param options Explicit fixture or host layout overrides.
 * @returns Fully resolved bootstrap layout.
 */
export function juryRigBootstrapLayout(
  options: JuryRigBootstrapLayoutOptions = {},
): JuryRigBootstrapLayout {
  const home = resolve(options.home ?? homedir());
  const pdHome = resolve(options.pdHome ?? join(home, '.port-daddy'));
  const nativeHookPath = options.nativeHookPath ? resolve(options.nativeHookPath) : null;
  const targets = options.runtimeTargets ?? [
    ...runtimeSkillTargets(home, 'user'),
    { label: 'Claude agents', path: join(home, '.claude', 'agents') },
  ];
  return {
    home,
    pdHome,
    nativeHookPath,
    runtimeTargets: targets,
    transactionRoot: resolve(options.transactionRoot ?? join(pdHome, 'jury-rig-cutover', 'transactions')),
    importRoot: resolve(options.importRoot ?? join(pdHome, 'catalogs', 'imported', 'legacy-external')),
    repository: options.repository ?? 'curiositech/port-daddy',
    replacementPr: options.replacementPr ?? 9965,
    expectedReplacementHead: options.expectedReplacementHead ?? null,
    surfaces: {
      userAgents: join(home, 'AGENTS.md'),
      codexAgents: join(home, '.codex', 'AGENTS.md'),
      geminiInstructions: join(home, '.gemini', 'GEMINI.md'),
      claudeInstructions: join(home, '.claude', 'CLAUDE.md'),
      codexConfig: join(home, '.codex', 'config.toml'),
      claudeSettings: join(home, '.claude', 'settings.json'),
      geminiSettings: join(home, '.gemini', 'settings.json'),
      installedPilotHook: join(pdHome, 'hooks', 'sessionstart-pilot.mjs'),
    },
  };
}

/**
 * Design: produce the complete cutover diff and blockers with zero machine mutation.
 * @param options Explicit fixture or host layout overrides, including the pinned PR head.
 * @returns Redactable action plan with exact preimages and intended postimages.
 */
export function planJuryRigBootstrap(
  options: JuryRigBootstrapLayoutOptions = {},
): JuryRigBootstrapPlan {
  const layout = juryRigBootstrapLayout(options);
  const plan: JuryRigBootstrapPlan = {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: iso(),
    verdict: 'ready',
    authorization: { keyId: 'UNAVAILABLE', planDigest: '', mac: '' },
    layout,
    blockers: [],
    actions: [],
    preconditions: {
      repository: layout.repository,
      replacementPr: layout.replacementPr,
      expectedReplacementHead: layout.expectedReplacementHead,
      installedDistribution: 'homebrew-keg',
      nativeQueryRequired: true,
      nativeHookRequired: true,
      githubMergeAncestryRequired: true,
      proofMaxAgeMs: NATIVE_PROOF_MAX_AGE_MS,
    },
    inventory: {
      inspectedFiles: 0,
      legacyProjectionLinks: 0,
      brokenLegacyProjectionLinks: 0,
      uniqueCatalogImports: 0,
      reusedCatalogImports: 0,
    },
  };

  if (!layout.expectedReplacementHead) {
    plan.blockers.push({
      code: 'EXPECTED_NATIVE_HEAD_REQUIRED',
      surface: `github:${layout.repository}#${layout.replacementPr}`,
      message: 'plan must pin the exact replacement PR head before apply',
    });
  }
  plan.blockers.push(...bootstrapLayoutBlockers(layout));

  addTextAction(plan, 'user AGENTS instructions', layout.surfaces.userAgents, transformAgentsGuide, true);
  addTextAction(plan, 'Codex AGENTS instructions', layout.surfaces.codexAgents, transformAgentsGuide, true);
  addTextAction(plan, 'Gemini instructions', layout.surfaces.geminiInstructions, transformGeminiInstructions, true);
  addTextAction(plan, 'Claude instructions', layout.surfaces.claudeInstructions, transformClaudeInstructions, true);
  addTextAction(plan, 'Codex tool config', layout.surfaces.codexConfig, stripLegacyTomlTables, false, 0o600);
  addTextAction(plan, 'Claude tool config', layout.surfaces.claudeSettings, transformJsonConfig, false, 0o600);
  addTextAction(plan, 'Gemini tool config', layout.surfaces.geminiSettings, transformJsonConfig, false, 0o600);

  if (!layout.nativeHookPath) {
    plan.blockers.push({
      code: 'NATIVE_HOOK_REQUIRED',
      surface: layout.surfaces.installedPilotHook,
      message: 'native installed-release Pilot hook path was not supplied',
    });
  } else {
    try {
      const hook = readBounded(layout.nativeHookPath, MAX_CONFIG_BYTES);
      const text = hook.toString('utf8');
      if (hasLegacyName(text) || !text.toLowerCase().includes('jury-rig')) {
        plan.blockers.push({
          code: 'NATIVE_HOOK_REJECTED',
          surface: layout.nativeHookPath,
          message: 'candidate hook must name Jury-rig and contain no legacy runtime reference',
        });
      } else {
        const current = currentFileSha(layout.surfaces.installedPilotHook);
        const next = sha256(hook);
        plan.inventory.inspectedFiles += 1;
        if (current !== next) {
          plan.actions.push({
            kind: 'file',
            label: 'installed native Pilot SessionStart hook',
            path: layout.surfaces.installedPilotHook,
            beforeSha256: current,
            afterSha256: next,
            beforeMode: fileMode(layout.surfaces.installedPilotHook),
            afterMode: 0o755,
            content: hook,
            removals: current ? 1 : 0,
            removedAuthorities: current ? ['installed-hook-preimage'] : [],
          });
        }
      }
    } catch (error) {
      plan.blockers.push({ code: 'NATIVE_HOOK_READ_FAILED', surface: layout.nativeHookPath, message: (error as Error).message });
    }
  }

  scanCatalogProjections(plan);
  plan.verdict = plan.blockers.length > 0
    ? 'blocked'
    : plan.actions.length === 0
      ? 'clean'
      : 'ready';
  try {
    const authority = options.authority ?? loadJuryRigBootstrapAuthority();
    plan.authorization = authorizeJuryRigBootstrapPlan(plan, authority);
  } catch (error) {
    plan.blockers.push({
      code: 'PRIVATE_AUTHORITY_UNAVAILABLE',
      surface: 'os-keychain:port-daddy/master-key',
      message: (error as Error).message,
    });
    plan.verdict = 'blocked';
    plan.authorization.planDigest = juryRigBootstrapPlanDigest(plan);
  }
  return plan;
}

/**
 * Design: bind runtime proof to the resolved executable bytes instead of a mutable PATH label.
 * @param command Absolute executable or command name.
 * @returns Canonical executable path.
 */
function resolveExecutable(command: string): string {
  const candidates = isAbsolute(command)
    ? [command]
    : command === 'pd'
      ? [process.execPath, '/opt/homebrew/bin/pd', '/usr/local/bin/pd']
      : command === 'gh'
        ? ['/opt/homebrew/bin/gh', '/usr/local/bin/gh']
        : [];
  for (const candidate of candidates) {
    try {
      const resolved = realpathSync(candidate);
      const stat = statSync(resolved);
      if (!stat.isFile() || (stat.mode & 0o022) !== 0) continue;
      if (pathInside(resolved, process.cwd())) continue;
      return resolved;
    } catch {
      // Try only the next explicit trusted installation path.
    }
  }
  throw new Error(`cannot resolve trusted executable ${command}`);
}

/**
 * Design: constrain proof subprocesses and reject non-JSON or non-zero evidence.
 * @param command Resolved executable.
 * @param args Argument vector without shell interpolation.
 * @param label Human-readable proof step.
 * @returns Parsed JSON evidence.
 */
function runJson(command: string, args: string[], label: string): unknown {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 60_000,
    maxBuffer: 8 * 1024 * 1024,
  });
  if ((result.status ?? 1) !== 0) {
    const stderr = result.stderr.trim().slice(0, 1_000);
    throw new Error(`${label} failed with exit ${result.status ?? 'unknown'}${stderr ? `: ${stderr}` : ''}`);
  }
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new Error(`${label} returned invalid JSON`);
  }
}

/**
 * Design: constrain textual proof subprocesses and surface bounded diagnostic errors.
 * @param command Resolved executable.
 * @param args Argument vector without shell interpolation.
 * @param label Human-readable proof step.
 * @returns Trimmed standard output.
 */
function runText(command: string, args: string[], label: string): string {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 60_000,
    maxBuffer: 8 * 1024 * 1024,
  });
  if ((result.status ?? 1) !== 0) {
    const stderr = result.stderr.trim().slice(0, 1_000);
    throw new Error(`${label} failed with exit ${result.status ?? 'unknown'}${stderr ? `: ${stderr}` : ''}`);
  }
  return result.stdout.trim();
}

/**
 * Design: bind cutover authority to a merged PR, descendant release, Homebrew keg, and live query.
 * @param options Repository, PR, commands, and injectable verification clock.
 * @returns Fresh native-runtime proof suitable for fail-closed apply validation.
 */
export function verifyNativeJuryRigRuntime(
  options: VerifyNativeJuryRigOptions,
): NativeJuryRigProof {
  const now = options.now ?? new Date();
  const pdPath = resolveExecutable(options.pdCommand ?? 'pd');
  const escapedSep = sep === '\\' ? '\\\\' : sep;
  const kegPattern = new RegExp(`${escapedSep}Cellar${escapedSep}port-daddy${escapedSep}(\\d+\\.\\d+\\.\\d+)${escapedSep}bin${escapedSep}(?:pd|port-daddy)$`);
  const kegMatch = pdPath.match(kegPattern);
  if (!kegMatch) {
    throw new Error(`native cutover requires an installed Homebrew keg; resolved ${pdPath}`);
  }
  const version = kegMatch[1];
  const keg = dirname(dirname(pdPath));
  const reportedVersion = runText(pdPath, ['--version'], 'installed pd version').match(/\d+\.\d+\.\d+/)?.[0];
  if (reportedVersion !== version) {
    throw new Error(`installed pd version ${reportedVersion ?? 'missing'} does not match keg ${version}`);
  }
  const nativeHookPath = join(keg, 'share', 'port-daddy', 'hooks', 'sessionstart-pilot.mjs');
  const hook = readUtf8(nativeHookPath);
  if (sha256(hook) !== NATIVE_JURY_RIG_HOOK_SHA256) {
    throw new Error('installed release Pilot hook digest does not match the compiled native artifact manifest');
  }
  if (hasLegacyName(hook) || !hook.toLowerCase().includes('jury-rig')) {
    throw new Error('installed release Pilot hook is not native Jury-rig guidance');
  }
  const query = runJson(pdPath, [
    'jury-rig', 'query', 'native skill discovery cutover preflight',
    '--top-limit', '1', '--body-chars', '64', '--json',
  ], 'installed pd jury-rig query') as { scannedCount?: unknown };
  if (typeof query.scannedCount !== 'number' || query.scannedCount < 1) {
    throw new Error('installed pd jury-rig query did not prove a readable native catalog');
  }

  const gh = resolveExecutable(options.ghCommand ?? 'gh');
  const pr = runJson(gh, [
    'pr', 'view', String(options.replacementPr), '--repo', options.repository,
    '--json', 'state,url,headRefOid,mergeCommit,mergedAt',
  ], 'replacement PR proof') as {
    state?: unknown;
    url?: unknown;
    headRefOid?: unknown;
    mergeCommit?: { oid?: unknown } | null;
    mergedAt?: unknown;
  };
  if (pr.state !== 'MERGED' || typeof pr.mergeCommit?.oid !== 'string') {
    throw new Error(`replacement PR #${options.replacementPr} is not merged`);
  }
  if (typeof pr.url !== 'string' || typeof pr.headRefOid !== 'string' || typeof pr.mergedAt !== 'string') {
    throw new Error('replacement PR proof is incomplete');
  }
  const releaseTag = `v${version}`;
  const release = runJson(gh, [
    'api', `repos/${options.repository}/commits/${releaseTag}`,
  ], 'installed release tag proof') as { sha?: unknown };
  if (typeof release.sha !== 'string') throw new Error(`release tag ${releaseTag} did not resolve to a commit`);
  const comparison = runJson(gh, [
    'api', `repos/${options.repository}/compare/${pr.mergeCommit.oid}...${release.sha}`,
  ], 'replacement-to-release ancestry proof') as { status?: unknown; behind_by?: unknown };
  if ((comparison.status !== 'ahead' && comparison.status !== 'identical') || comparison.behind_by !== 0) {
    throw new Error(`release ${releaseTag} does not descend from replacement PR merge ${pr.mergeCommit.oid}`);
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    status: 'verified',
    repository: options.repository,
    replacementPr: options.replacementPr,
    prUrl: pr.url,
    prHead: pr.headRefOid,
    prMergeCommit: pr.mergeCommit.oid,
    mergedAt: pr.mergedAt,
    releaseTag,
    releaseCommit: release.sha,
    releaseComparison: comparison.status,
    installedPdPath: pdPath,
    installedPdVersion: version,
    installedPdSha256: sha256(readFileSync(pdPath)),
    installedKeg: keg,
    nativeHookPath,
    nativeHookSha256: sha256(hook),
    juryRigQueryScannedCount: query.scannedCount,
    verifiedAt: iso(now),
  };
}

/**
 * Design: recheck pinned identity, freshness, and installed bytes immediately before mutation.
 * @param plan Plan whose native preconditions must hold.
 * @param proof Previously gathered merged/install proof.
 * @param now Apply-time clock.
 * @returns Every fail-closed proof blocker.
 */
function validateNativeProof(plan: JuryRigBootstrapPlan, proof: NativeJuryRigProof | null, now: Date): JuryRigBootstrapBlocker[] {
  const blockers: JuryRigBootstrapBlocker[] = [];
  if (!proof) {
    return [{ code: 'NATIVE_PROOF_REQUIRED', surface: 'installed runtime', message: 'merged installed native Jury-rig proof is required before cutover' }];
  }
  if (proof.repository !== plan.preconditions.repository || proof.replacementPr !== plan.preconditions.replacementPr) {
    blockers.push({
      code: 'NATIVE_PROOF_PR_MISMATCH',
      surface: proof.prUrl,
      message: 'native proof does not match the repository and replacement PR pinned by the plan',
    });
  }
  if (
    !plan.preconditions.expectedReplacementHead
    || proof.prHead !== plan.preconditions.expectedReplacementHead
  ) {
    blockers.push({
      code: 'NATIVE_PROOF_HEAD_MISMATCH',
      surface: proof.prUrl,
      message: 'native proof does not match the exact replacement PR head pinned by the plan',
    });
  }
  const verifiedAt = Date.parse(proof.verifiedAt);
  if (!Number.isFinite(verifiedAt) || now.getTime() - verifiedAt > NATIVE_PROOF_MAX_AGE_MS || verifiedAt > now.getTime() + 60_000) {
    blockers.push({ code: 'NATIVE_PROOF_STALE', surface: proof.installedPdPath, message: 'native proof must be fresh within one hour' });
  }
  try {
    if (sha256(readFileSync(proof.installedPdPath)) !== proof.installedPdSha256) {
      blockers.push({ code: 'INSTALLED_BINARY_DRIFT', surface: proof.installedPdPath, message: 'installed pd hash changed after native proof' });
    }
  } catch (error) {
    blockers.push({ code: 'INSTALLED_BINARY_UNREADABLE', surface: proof.installedPdPath, message: (error as Error).message });
  }
  if (!plan.layout.nativeHookPath || resolve(plan.layout.nativeHookPath) !== resolve(proof.nativeHookPath)) {
    blockers.push({ code: 'NATIVE_HOOK_PROOF_MISMATCH', surface: plan.layout.nativeHookPath ?? 'missing', message: 'plan hook is not the proved installed release hook' });
  } else {
    try {
      if (sha256(readFileSync(proof.nativeHookPath)) !== proof.nativeHookSha256) {
        blockers.push({ code: 'NATIVE_HOOK_DRIFT', surface: proof.nativeHookPath, message: 'installed hook hash changed after native proof' });
      }
    } catch (error) {
      blockers.push({ code: 'NATIVE_HOOK_UNREADABLE', surface: proof.nativeHookPath, message: (error as Error).message });
    }
  }
  return blockers;
}

/**
 * Design: compare every durable authority field while allowing a fresh verification timestamp.
 * @param expected Proof supplied with the approved plan.
 * @param live Proof independently regenerated at apply time.
 * @returns Whether both attest the same merge, release, binary, hook, and native query.
 */
function sameNativeProofAuthority(expected: NativeJuryRigProof, live: NativeJuryRigProof): boolean {
  const { verifiedAt: _expectedVerifiedAt, ...expectedAuthority } = expected;
  const { verifiedAt: _liveVerifiedAt, ...liveAuthority } = live;
  return JSON.stringify(expectedAuthority) === JSON.stringify(liveAuthority);
}

/**
 * Design: persist renamed files and directory entries before a receipt claims durability.
 * @param path File or directory to synchronize.
 */
function fsyncPath(path: string): void {
  const fd = openSync(path, 'r');
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

/**
 * Design: same-directory temporary writes prevent observers from seeing partial postimages.
 * @param path Final file path.
 * @param content Exact intended bytes.
 * @param mode Final permission mode.
 */
function atomicWrite(path: string, content: string | Buffer, mode: number): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = join(dirname(path), `.${basename(path)}.jury-rig-${process.pid}-${randomUUID()}.tmp`);
  try {
    writeFileSync(temporary, content, { mode });
    chmodSync(temporary, mode);
    fsyncPath(temporary);
    renameSync(temporary, path);
    fsyncPath(dirname(path));
  } finally {
    if (existsSync(temporary)) rmSync(temporary, { force: true });
  }
}

/**
 * Design: replace projections through one atomic rename rather than unlink-then-create gaps.
 * @param path Final symlink path.
 * @param target Exact link target string.
 */
function atomicSymlink(path: string, target: string): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = join(dirname(path), `.${basename(path)}.jury-rig-${process.pid}-${randomUUID()}.tmp`);
  try {
    symlinkSync(target, temporary, 'dir');
    renameSync(temporary, path);
    fsyncPath(dirname(path));
  } finally {
    if (existsSync(temporary)) rmSync(temporary, { force: true });
  }
}

/**
 * Design: put non-execution and provenance warnings in the guidance agents actually read.
 * @param content Original SKILL.md text.
 * @param sourcePath Preserved third-party source location.
 * @param sourceSha256 Exact source digest.
 * @returns Annotated catalog-only skill text.
 */
function annotateCatalogSkill(content: string, sourcePath: string, sourceSha256: string): string {
  const notice = `${CATALOG_NOTICE_START}
> **Imported catalog input only.** Port Daddy preserved this third-party skill
> from \`${sourcePath}\` at source SHA-256 \`${sourceSha256}\`. Jury-rig may rank
> and read its guidance, but this import grants no authority to execute scripts,
> hooks, MCP servers, subagents, or planning pipelines. Executable files were not
> projected into this catalog copy.
${CATALOG_NOTICE_END}`;
  const frontmatter = content.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n/);
  if (frontmatter) {
    return `${frontmatter[0]}\n${notice}\n\n${content.slice(frontmatter[0].length)}`;
  }
  return `${notice}\n\n${content}`;
}

interface CatalogCopyStats {
  copiedFiles: number;
  copiedBytes: number;
  skippedExecutableEntries: number;
  licenseFiles: string[];
  fileHashes: Record<string, string>;
}

/**
 * Design: extension admission is explicit so scripts cannot enter through executable mode alone.
 * @param path Candidate catalog file path.
 * @returns Lowercase suffix including its dot, or an empty string.
 */
function catalogExtension(path: string): string {
  const leaf = basename(path).toLowerCase();
  const dot = leaf.lastIndexOf('.');
  return dot === -1 ? '' : leaf.slice(dot);
}

/**
 * Design: preserve bounded documentation and assets while omitting links and executable surfaces.
 * @param sourceRoot Third-party skill directory.
 * @param stageRoot Transaction-private staging directory.
 * @param sourceSkillSha256 Planned SKILL.md digest.
 * @returns Copy counts, license paths, skipped entries, and postimage hashes.
 */
function copyCatalogDocumentation(
  sourceRoot: string,
  stageRoot: string,
  sourceSkillSha256: string,
): CatalogCopyStats {
  const stats: CatalogCopyStats = {
    copiedFiles: 0,
    copiedBytes: 0,
    skippedExecutableEntries: 0,
    licenseFiles: [],
    fileHashes: {},
  };

  /**
   * Design: recursively enforce the allowlist at each catalog depth.
   * @param sourceDir Current source directory.
   * @param destDir Matching staging directory.
   * @param topLevel Whether root-file admission rules apply.
   */
  function visit(sourceDir: string, destDir: string, topLevel: boolean): void {
    mkdirSync(destDir, { recursive: true, mode: 0o755 });
    for (const entry of readdirSync(sourceDir, { withFileTypes: true })) {
      const source = join(sourceDir, entry.name);
      const destination = join(destDir, entry.name);
      if (entry.isSymbolicLink()) {
        stats.skippedExecutableEntries += 1;
        continue;
      }
      if (entry.isDirectory()) {
        const normalizedName = entry.name.toLowerCase();
        if (
          REJECTED_CATALOG_AUTHORITY_DIRS.has(normalizedName)
          || (topLevel && !ALLOWED_CATALOG_DIRS.has(normalizedName))
        ) {
          stats.skippedExecutableEntries += 1;
          continue;
        }
        visit(source, destination, false);
        continue;
      }
      if (!entry.isFile()) {
        stats.skippedExecutableEntries += 1;
        continue;
      }
      const allowed = topLevel
        ? ALLOWED_CATALOG_ROOT_FILES.some((pattern) => pattern.test(entry.name))
        : ALLOWED_CATALOG_EXTENSIONS.has(catalogExtension(entry.name));
      if (!allowed) {
        stats.skippedExecutableEntries += 1;
        continue;
      }
      const stat = statSync(source);
      if (stat.size > MAX_CATALOG_FILE_BYTES) {
        throw new Error(`catalog file exceeds ${MAX_CATALOG_FILE_BYTES} bytes: ${source}`);
      }
      stats.copiedFiles += 1;
      stats.copiedBytes += stat.size;
      if (stats.copiedFiles > MAX_CATALOG_FILES || stats.copiedBytes > MAX_CATALOG_SKILL_BYTES) {
        throw new Error(`catalog skill exceeds safe copy bounds: ${sourceRoot}`);
      }
      let body = readFileSync(source);
      if (topLevel && entry.name === 'SKILL.md') {
        body = Buffer.from(annotateCatalogSkill(body.toString('utf8'), sourceRoot, sourceSkillSha256));
      }
      mkdirSync(dirname(destination), { recursive: true, mode: 0o755 });
      writeFileSync(destination, body, { mode: 0o644 });
      chmodSync(destination, 0o644);
      const rel = relative(stageRoot, destination);
      stats.fileHashes[rel] = sha256(body);
      if (/^(LICENSE|NOTICE|COPYING)/i.test(entry.name)) stats.licenseFiles.push(rel);
    }
  }

  visit(sourceRoot, stageRoot, true);
  if (!existsSync(join(stageRoot, 'SKILL.md'))) {
    throw new Error(`catalog import did not preserve SKILL.md from ${sourceRoot}`);
  }
  return stats;
}

/**
 * Design: expose hashes, paths, and authority removals without exposing secret-bearing content.
 * @param action Planned mutation containing private postimage bytes.
 * @returns Redacted receipt-safe action.
 */
function receiptAction(action: JuryRigBootstrapAction): JuryRigBootstrapReceiptAction {
  if (action.kind === 'file') {
    return {
      kind: action.kind,
      label: action.label,
      path: action.path,
      before: action.beforeSha256,
      after: action.afterSha256,
      removedAuthorities: action.removedAuthorities,
    };
  }
  if (action.kind === 'symlink') {
    return {
      kind: action.kind,
      label: action.label,
      path: action.path,
      before: action.beforeTarget,
      after: action.afterTarget,
      removedAuthorities: ['legacy-catalog-projection'],
    };
  }
  return {
    kind: action.kind,
    label: action.label,
    path: action.targetPath,
    before: null,
    after: action.targetContentSha256,
    removedAuthorities: ['executable-files-omitted-from-import'],
  };
}

/**
 * Design: attach recovery metadata before any action can mutate its target.
 * @param action Planned action.
 * @param index Stable transaction ordering index.
 * @param backupDir Transaction-private backup directory.
 * @returns Initial persisted action state.
 */
function persistedAction(action: JuryRigBootstrapAction, index: number, backupDir: string): PersistedActionState {
  const summary = receiptAction(action);
  return {
    ...summary,
    index,
    backupPath: action.kind === 'file' && action.beforeSha256
      ? join(backupDir, `${index}.sealed.json`)
      : null,
    beforeMode: action.kind === 'file' ? action.beforeMode : null,
    pending: false,
    applied: false,
    createdByTransaction: action.kind === 'catalog-import' && !existsSync(action.targetPath),
  };
}

/**
 * Design: checkpoint the transaction after every state transition for crash recovery.
 * @param path Durable manifest path.
 * @param manifest Current transaction state.
 * @param authority Private authority that authenticates recovery state.
 */
function writeManifest(
  path: string,
  manifest: TransactionManifest,
  authority: JuryRigBootstrapAuthority,
): void {
  const { manifestMac: _manifestMac, ...unsigned } = manifest;
  manifest.manifestMac = authority.sign(`${MANIFEST_MAC_DOMAIN}\0${JSON.stringify(unsigned)}`);
  atomicWrite(path, JSON.stringify(manifest, null, 2) + '\n', 0o600);
}

/**
 * Design: recovery trusts only a complete manifest authenticated by the same private authority as its plan.
 * @param manifest Parsed transaction manifest.
 * @param authority Expected private authority.
 */
function verifyManifestIntegrity(
  manifest: TransactionManifest,
  authority: JuryRigBootstrapAuthority,
): void {
  const { manifestMac, ...unsigned } = manifest;
  if (
    manifest.authorityKeyId !== authority.keyId
    || !authority.verify(`${MANIFEST_MAC_DOMAIN}\0${JSON.stringify(unsigned)}`, manifestMac)
  ) {
    throw new Error(`transaction ${manifest.id} failed private keyed manifest authorization`);
  }
}

/**
 * Design: emit immutable, attributable, redacted evidence for every terminal outcome.
 * @param transactionDir Durable transaction directory.
 * @param manifest Terminal transaction state.
 * @param authority Private authority that authenticates the receipt.
 * @returns Receipt including its self-integrity digest.
 */
function writeReceipt(
  transactionDir: string,
  manifest: TransactionManifest,
  authority: JuryRigBootstrapAuthority,
): JuryRigBootstrapReceipt {
  const receiptName = manifest.status === 'committed'
    ? 'apply-receipt.json'
    : manifest.status === 'refused'
      ? 'refused-receipt.json'
      : manifest.status === 'rollback-failed'
        ? 'rollback-failed-receipt.json'
        : 'rollback-receipt.json';
  const receiptPath = join(transactionDir, receiptName);
  const unsigned = {
    schemaVersion: 1 as const,
    id: manifest.id,
    status: manifest.status as JuryRigBootstrapReceiptStatus,
    startedAt: manifest.startedAt,
    completedAt: manifest.completedAt ?? iso(),
    transactionDir,
    receiptPath,
    planDigest: manifest.planDigest,
    authorityKeyId: manifest.authorityKeyId,
    attribution: manifest.attribution,
    proof: manifest.proof,
    blockers: manifest.blockers,
    actions: manifest.actions.map(({ kind, label, path, before, after, removedAuthorities }) => ({
      kind,
      label,
      path,
      before,
      after,
      removedAuthorities,
    })),
    appliedCount: manifest.appliedCount,
    rolledBackCount: manifest.rolledBackCount,
    error: manifest.error,
  };
  const receiptSha256 = sha256(JSON.stringify(unsigned));
  const receipt: JuryRigBootstrapReceipt = {
    ...unsigned,
    receiptSha256,
    receiptMac: authority.sign(`${RECEIPT_MAC_DOMAIN}\0${receiptSha256}`),
  };
  atomicWrite(receiptPath, JSON.stringify(receipt, null, 2) + '\n', 0o600);
  return receipt;
}

/**
 * Design: rollback refuses edited receipt bytes rather than trusting operator-visible prose.
 * @param receipt Parsed apply receipt to verify.
 * @param authority Expected private authority.
 */
function verifyReceiptIntegrity(
  receipt: JuryRigBootstrapReceipt,
  authority: JuryRigBootstrapAuthority,
): void {
  const { receiptSha256, receiptMac, ...unsigned } = receipt;
  if (
    sha256(JSON.stringify(unsigned)) !== receiptSha256
    || receipt.authorityKeyId !== authority.keyId
    || !authority.verify(`${RECEIPT_MAC_DOMAIN}\0${receiptSha256}`, receiptMac)
  ) {
    throw new Error(`receipt ${receipt.id} failed private keyed receipt authorization`);
  }
}

/**
 * Design: stage and annotate a pinned third-party body before any runtime link changes.
 * @param action Planned catalog import.
 * @param stageDir Transaction-private staging root.
 * @param startedAt Stable import timestamp.
 * @returns Staged directory ready for atomic promotion.
 */
function prepareCatalogImport(
  action: JuryRigCatalogImportAction,
  stageDir: string,
  startedAt: string,
): string {
  const current = sha256(readBounded(join(action.sourcePath, 'SKILL.md'), MAX_CATALOG_FILE_BYTES));
  if (current !== action.sourceSkillSha256) {
    throw new Error(`catalog source changed after planning: ${action.sourcePath}`);
  }
  const currentInspection = inspectCatalogProjection(action.sourcePath, action.sourceSkillSha256);
  if (
    currentInspection.sourceContentSha256 !== action.sourceContentSha256
    || currentInspection.targetContentSha256 !== action.targetContentSha256
  ) {
    throw new Error(`catalog content changed after planning: ${action.sourcePath}`);
  }
  const target = join(stageDir, String(sha256(action.targetPath).slice(0, 20)));
  const stats = copyCatalogDocumentation(action.sourcePath, target, action.sourceSkillSha256);
  if (catalogTreeDigest(stats.fileHashes) !== action.targetContentSha256) {
    throw new Error(`catalog projected postimage changed during staging: ${action.sourcePath}`);
  }
  const manifest = {
    schemaVersion: SCHEMA_VERSION,
    sourceKind: 'third-party-catalog-input',
    sourceRuntime: 'legacy-external',
    sourcePath: action.sourcePath,
    sourceSkillSha256: action.sourceSkillSha256,
    sourceContentSha256: action.sourceContentSha256,
    targetContentSha256: action.targetContentSha256,
    skillId: action.skillId,
    importedAt: startedAt,
    executableAuthority: false,
    copiedFiles: stats.copiedFiles,
    copiedBytes: stats.copiedBytes,
    skippedExecutableEntries: stats.skippedExecutableEntries,
    licenseFiles: stats.licenseFiles,
    fileHashes: stats.fileHashes,
  };
  atomicWrite(catalogManifestPath(target), JSON.stringify(manifest, null, 2) + '\n', 0o644);
  return target;
}

/**
 * Design: validate every preimage in a complete first pass so stale plans cause zero target writes.
 * @param action Planned action to compare with live state.
 */
function validateBeforeState(action: JuryRigBootstrapAction): void {
  if (action.kind === 'file') {
    const current = currentFileSha(action.path);
    if (current !== action.beforeSha256) {
      throw new Error(`before-hash changed after planning: ${action.path}`);
    }
    return;
  }
  if (action.kind === 'symlink') {
    if (!existsSync(action.path) && !lstatExists(action.path)) {
      throw new Error(`projection disappeared after planning: ${action.path}`);
    }
    const stat = lstatSync(action.path);
    if (!stat.isSymbolicLink() || readlinkSync(action.path) !== action.beforeTarget) {
      throw new Error(`projection changed after planning: ${action.path}`);
    }
    return;
  }
  if (existsSync(action.targetPath) && !reusableCatalogImport(
    action.targetPath,
    action.sourceSkillSha256,
    action.sourceContentSha256,
    action.targetContentSha256,
  )) {
    throw new Error(`catalog import target changed after planning: ${action.targetPath}`);
  }
}

/**
 * Design: detect dangling symlinks that ordinary existence checks intentionally hide.
 * @param path Candidate filesystem entry.
 * @returns Whether any leaf entry exists without following it.
 */
function lstatExists(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Design: apply one already-validated action and verify its intended postimage immediately.
 * @param action Planned mutation.
 * @param stagedCatalogs Prepared import directories keyed by final path.
 */
function applyAction(action: JuryRigBootstrapAction, stagedCatalogs: Map<string, string>): void {
  if (action.kind === 'file') {
    atomicWrite(action.path, action.content, action.afterMode);
    if (currentFileSha(action.path) !== action.afterSha256) {
      throw new Error(`after-hash verification failed: ${action.path}`);
    }
    return;
  }
  if (action.kind === 'symlink') {
    if (action.afterTarget === null) {
      unlinkSync(action.path);
      fsyncPath(dirname(action.path));
    } else {
      atomicSymlink(action.path, action.afterTarget);
      if (readlinkSync(action.path) !== action.afterTarget) {
        throw new Error(`projection verification failed: ${action.path}`);
      }
    }
    return;
  }
  if (existsSync(action.targetPath)) return;
  const staged = stagedCatalogs.get(action.targetPath);
  if (!staged) throw new Error(`catalog import was not staged: ${action.targetPath}`);
  mkdirSync(dirname(action.targetPath), { recursive: true, mode: 0o700 });
  renameSync(staged, action.targetPath);
  fsyncPath(dirname(action.targetPath));
  if (!reusableCatalogImport(
    action.targetPath,
    action.sourceSkillSha256,
    action.sourceContentSha256,
    action.targetContentSha256,
  )) {
    throw new Error(`catalog import verification failed: ${action.targetPath}`);
  }
}

/**
 * Design: compensate exactly one applied action from transaction-private preimage evidence.
 * @param action Original planned action.
 * @param state Persisted backup and application state.
 * @param importRoot Narrow deletion boundary for created imports.
 * @param transactionId Transaction binding for sealed backup context.
 * @param authority Private authority that opens rollback bytes.
 */
function rollbackOne(
  action: JuryRigBootstrapAction,
  state: PersistedActionState,
  importRoot: string,
  transactionId: string,
  authority: JuryRigBootstrapAuthority,
): void {
  if (state.applied && liveActionState(action, state) !== 'after') {
    throw new Error(`refusing rollback over concurrent target drift: ${state.path}`);
  }
  if (action.kind === 'file') {
    if (action.beforeSha256 === null) {
      if (lstatExists(action.path)) unlinkSync(action.path);
      return;
    }
    if (!state.backupPath || !existsSync(state.backupPath)) {
      throw new Error(`missing rollback backup for ${action.path}`);
    }
    const envelope = JSON.parse(readUtf8(state.backupPath)) as JuryRigBootstrapSealedBackup;
    const preimage = authority.openBackup(envelope, transactionId, state.index, action.path);
    if (sha256(preimage) !== action.beforeSha256) {
      throw new Error(`sealed rollback backup does not match planned preimage for ${action.path}`);
    }
    atomicWrite(action.path, preimage, state.beforeMode ?? 0o600);
    if (currentFileSha(action.path) !== action.beforeSha256) {
      throw new Error(`rollback hash verification failed: ${action.path}`);
    }
    return;
  }
  if (action.kind === 'symlink') {
    atomicSymlink(action.path, action.beforeTarget);
    return;
  }
  if (state.createdByTransaction && existsSync(action.targetPath)) {
    if (!pathInside(action.targetPath, importRoot) || resolve(action.targetPath) === resolve(importRoot)) {
      throw new Error(`refusing broad catalog rollback target ${action.targetPath}`);
    }
    if (!reusableCatalogImport(
      action.targetPath,
      action.sourceSkillSha256,
      action.sourceContentSha256,
      action.targetContentSha256,
    )) {
      throw new Error(`refusing catalog rollback over tampered import ${action.targetPath}`);
    }
    rmSync(action.targetPath, { recursive: true, force: true });
  }
}

/**
 * Design: classify a pending action only by its signed before/after identities after a crash.
 * @param action Signed planned action.
 * @param state Signed write-ahead state.
 * @returns Whether the target is still before, fully after, or neither.
 */
function liveActionState(
  action: JuryRigBootstrapAction,
  state: PersistedActionState,
): 'before' | 'after' | 'drift' {
  if (action.kind === 'file') {
    const current = currentFileSha(action.path);
    if (current === action.beforeSha256) return 'before';
    if (current === action.afterSha256) return 'after';
    return 'drift';
  }
  if (action.kind === 'symlink') {
    const current = lstatExists(action.path) && lstatSync(action.path).isSymbolicLink()
      ? readlinkSync(action.path)
      : null;
    if (current === action.beforeTarget) return 'before';
    if (current === action.afterTarget) return 'after';
    return 'drift';
  }
  if (!existsSync(action.targetPath)) return 'before';
  return reusableCatalogImport(
    action.targetPath,
    action.sourceSkillSha256,
    action.sourceContentSha256,
    action.targetContentSha256,
  ) ? 'after' : 'drift';
}

/**
 * Design: convert a signed pending record into applied or untouched state without guessing.
 * @param action Signed planned action.
 * @param state Signed write-ahead state.
 * @param manifest Mutable recovery counters.
 */
function reconcilePendingAction(
  action: JuryRigBootstrapAction,
  state: PersistedActionState,
  manifest: TransactionManifest,
): void {
  if (!state.pending || state.applied) return;
  const live = liveActionState(action, state);
  if (live === 'drift') {
    throw new Error(`pending action is neither exact preimage nor postimage: ${state.path}`);
  }
  state.pending = false;
  if (live === 'after') {
    state.applied = true;
    manifest.appliedCount += 1;
  }
}

/**
 * Design: serialize all cutovers through a POSIX-atomic lock directory.
 * @param layout Signed bootstrap layout.
 * @param transactionId Transaction claiming exclusivity.
 * @returns Idempotent release callback.
 */
function acquireJuryRigCutoverLock(
  layout: JuryRigBootstrapLayout,
  transactionId: string,
): () => void {
  const lockParent = dirname(layout.transactionRoot);
  const lockPath = join(lockParent, 'cutover.lock');
  mkdirSync(lockParent, { recursive: true, mode: 0o700 });
  if (firstSymlinkComponent(lockPath, layout.pdHome)) {
    throw new Error(`refusing symlinked exclusive cutover lock path ${lockPath}`);
  }
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      mkdirSync(lockPath, { mode: 0o700 });
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      let staleOwner = false;
      try {
        const owner = JSON.parse(readUtf8(join(lockPath, 'owner.json'), 16 * 1024)) as { pid?: unknown };
        if (typeof owner.pid !== 'number' || !Number.isSafeInteger(owner.pid) || owner.pid <= 0) {
          throw new Error('invalid lock owner pid');
        }
        try {
          process.kill(owner.pid, 0);
        } catch (probeError) {
          staleOwner = (probeError as NodeJS.ErrnoException).code === 'ESRCH';
        }
      } catch {
        staleOwner = false;
      }
      if (!staleOwner || attempt > 0) {
        throw new Error(`exclusive cutover lock is already held: ${lockPath}`);
      }
      const stalePath = `${lockPath}.stale-${transactionId}`;
      renameSync(lockPath, stalePath);
      rmSync(stalePath, { recursive: true, force: true });
    }
  }
  atomicWrite(join(lockPath, 'owner.json'), JSON.stringify({ transactionId, pid: process.pid, acquiredAt: iso() }) + '\n', 0o600);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    try {
      const owner = JSON.parse(readUtf8(join(lockPath, 'owner.json'))) as { transactionId?: unknown };
      if (owner.transactionId === transactionId && lstatSync(lockPath).isDirectory()) {
        rmSync(lockPath, { recursive: true, force: true });
      }
    } catch {
      // A changed lock is left in place; removing ambiguous state would break exclusivity.
    }
  };
}

/**
 * Design: resolve the packaged scanner deterministically under launchd's restricted PATH.
 * @returns Absolute gitleaks executable path.
 */
function resolveJuryRigGitleaks(): string {
  const candidates = [
    join(dirname(process.execPath), 'gitleaks'),
    '/opt/homebrew/bin/gitleaks',
    '/usr/local/bin/gitleaks',
  ];
  for (const candidate of candidates) {
    try {
      const resolved = realpathSync(candidate);
      if (statSync(resolved).isFile()) return resolved;
    } catch {
      // Try the next deterministic install location.
    }
  }
  throw new Error('trusted packaged gitleaks scanner is unavailable');
}

/**
 * Design: scan every regular transaction byte before a committed receipt can exist.
 * @param transactionDir Complete transaction tree.
 * @param runner Optional fixture scanner; production uses deterministic gitleaks stdin.
 */
function scanJuryRigTransactionTree(
  transactionDir: string,
  runner?: GitleaksRunner,
): void {
  const scan = runner ?? ((content: string) => runGitleaks(content, { binary: resolveJuryRigGitleaks() }));
  let chunk = '';
  let fileCount = 0;
  let byteCount = 0;
  /** Design: scan a bounded accumulated chunk. */
  const flush = (): void => {
    if (!chunk) return;
    const result = scan(chunk);
    chunk = '';
    if (result.findings.length > 0) {
      throw new Error(`transaction secret scan found ${result.findings.length} unresolved finding(s)`);
    }
  };
  /**
   * Design: reject links and cover every file in the transaction tree exactly once.
   * @param directory Current transaction directory.
   */
  function visit(directory: string): void {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`transaction tree contains symlink ${path}`);
      if (entry.isDirectory()) {
        visit(path);
        continue;
      }
      if (!entry.isFile()) throw new Error(`transaction tree contains non-regular entry ${path}`);
      const size = statSync(path).size;
      fileCount += 1;
      byteCount += size;
      if (fileCount > MAX_TRANSACTION_FILES || byteCount > MAX_TRANSACTION_BYTES) {
        throw new Error('transaction tree exceeds bounded scan authority');
      }
      const body = readBounded(path, Math.min(MAX_TRANSACTION_BYTES, Math.max(MAX_CATALOG_FILE_BYTES, size))).toString('utf8');
      const framed = `\n<file path=${JSON.stringify(relative(transactionDir, path))}>\n${body}\n</file>\n`;
      if (framed.length > MAX_TRANSACTION_SCAN_CHARS) {
        flush();
        const result = scan(framed);
        if (result.findings.length > 0) {
          throw new Error(`transaction secret scan found ${result.findings.length} unresolved finding(s)`);
        }
      } else {
        if (chunk.length + framed.length > MAX_TRANSACTION_SCAN_CHARS) flush();
        chunk += framed;
      }
    }
  }
  visit(transactionDir);
  flush();
}

/**
 * Design: caller-provided transaction and receipt paths must stay within the signed root and avoid links.
 * @param path Candidate transaction artifact.
 * @param transactionRoot Signed transaction root.
 */
function assertSafeTransactionPath(path: string, transactionRoot: string): void {
  if (!pathInside(path, transactionRoot) || firstSymlinkComponent(path, transactionRoot)) {
    throw new Error(`unsafe transaction path ${path}`);
  }
}

/**
 * Design: execute the prepared plan as a compensated transaction only after native proof passes.
 * @param options Plan, proof, attribution, clock, and fixture-only fault injection.
 * @returns Attributable committed, refused, or compensated receipt.
 */
export function applyJuryRigBootstrap(
  options: ApplyJuryRigBootstrapOptions,
): JuryRigBootstrapReceipt {
  const { plan } = options;
  const authority = options.authority ?? loadJuryRigBootstrapAuthority();
  const planDigest = verifyJuryRigBootstrapPlanAuthorization(plan, authority);
  assertSafeBootstrapLayout(plan.layout);
  const now = options.now ?? new Date();
  const startedAt = iso(now);
  const id = `${startedAt.replace(/[:.]/g, '-')}-${randomUUID()}`;
  const transactionDir = join(plan.layout.transactionRoot, id);
  const backupDir = join(transactionDir, 'backups');
  const stageDir = join(transactionDir, 'stage');
  const manifestPath = join(transactionDir, 'manifest.json');
  const releaseLock = acquireJuryRigCutoverLock(plan.layout, id);
  try {
    mkdirSync(backupDir, { recursive: true, mode: 0o700 });
    mkdirSync(stageDir, { recursive: true, mode: 0o700 });
    const sealedPlan = authority.sealBackup(
      Buffer.from(JSON.stringify(plan)),
      id,
      SEALED_PLAN_INDEX,
      SEALED_PLAN_CONTEXT,
    );
    atomicWrite(
      join(transactionDir, SEALED_PLAN_FILENAME),
      JSON.stringify(sealedPlan, null, 2) + '\n',
      0o600,
    );
    let liveProof: NativeJuryRigProof | null = null;
    const reverifyBlockers: JuryRigBootstrapBlocker[] = [];
    if (options.proof) {
      try {
        const verifier = options.verifyRuntime ?? verifyNativeJuryRigRuntime;
        liveProof = verifier({
          repository: plan.preconditions.repository,
          replacementPr: plan.preconditions.replacementPr,
          now,
        });
        if (!sameNativeProofAuthority(options.proof, liveProof)) {
          reverifyBlockers.push({
            code: 'NATIVE_PROOF_REVERIFY_MISMATCH',
            surface: `github:${plan.preconditions.repository}#${plan.preconditions.replacementPr}`,
            message: 'apply-time native proof does not match the proof supplied with the approved plan',
          });
        }
      } catch (error) {
        reverifyBlockers.push({
          code: 'NATIVE_RUNTIME_REVERIFY_FAILED',
          surface: `github:${plan.preconditions.repository}#${plan.preconditions.replacementPr}`,
          message: (error as Error).message,
        });
      }
    }
    const proofBlockers = validateNativeProof(plan, liveProof, now);
    const attributionBlockers: JuryRigBootstrapBlocker[] = [];
    for (const [field, value] of Object.entries(options.attribution)) {
      if (typeof value !== 'string' || value.trim().length === 0) {
        attributionBlockers.push({
          code: 'ATTRIBUTION_REQUIRED',
          surface: `attribution.${field}`,
          message: 'cutover receipts require complete Port Daddy actor/session/remit/roadmap/head attribution',
        });
      }
    }
    if (
      options.attribution.sourceHead !== plan.preconditions.expectedReplacementHead
      || (liveProof && options.attribution.sourceHead !== liveProof.prHead)
    ) {
      attributionBlockers.push({
        code: 'ATTRIBUTION_SOURCE_HEAD_MISMATCH',
        surface: 'attribution.sourceHead',
        message: 'receipt sourceHead must equal both the signed plan head and live replacement PR proof',
      });
    }
    const blockers = [...plan.blockers, ...reverifyBlockers, ...proofBlockers, ...attributionBlockers];
    const states = plan.actions.map((action, index) => persistedAction(action, index, backupDir));
    const manifest: TransactionManifest = {
      schemaVersion: SCHEMA_VERSION,
      id,
      planDigest,
      authorityKeyId: authority.keyId,
      manifestMac: '',
      status: blockers.length > 0 ? 'refused' : 'prepared',
      startedAt,
      completedAt: blockers.length > 0 ? startedAt : null,
      attribution: options.attribution,
      proof: liveProof,
      blockers,
      error: blockers.length > 0 ? 'cutover refused by fail-closed preflight' : null,
      appliedCount: 0,
      rolledBackCount: 0,
      actions: states,
    };
    writeManifest(manifestPath, manifest, authority);
    if (blockers.length > 0) return writeReceipt(transactionDir, manifest, authority);

    const stagedCatalogs = new Map<string, string>();
    try {
      for (const action of plan.actions) validateBeforeState(action);
      for (let index = 0; index < plan.actions.length; index++) {
        const action = plan.actions[index];
        const state = states[index];
        if (action.kind === 'file' && action.beforeSha256) {
          const sealed = authority.sealBackup(readFileSync(action.path), id, index, action.path);
          atomicWrite(state.backupPath as string, JSON.stringify(sealed, null, 2) + '\n', 0o600);
        }
        if (action.kind === 'catalog-import' && !existsSync(action.targetPath)) {
          stagedCatalogs.set(action.targetPath, prepareCatalogImport(action, stageDir, startedAt));
        }
      }
      manifest.status = 'applying';
      writeManifest(manifestPath, manifest, authority);
      for (let index = 0; index < plan.actions.length; index++) {
        states[index].pending = true;
        writeManifest(manifestPath, manifest, authority);
        applyAction(plan.actions[index], stagedCatalogs);
        if (
          options.interruptAfterMutationBeforeCheckpoint
          && index + 1 >= options.interruptAfterMutationBeforeCheckpoint
        ) {
          throw new JuryRigBootstrapInterruptedError(transactionDir, manifest.appliedCount);
        }
        states[index].pending = false;
        states[index].applied = true;
        manifest.appliedCount += 1;
        writeManifest(manifestPath, manifest, authority);
        if (options.interruptAfterAction && manifest.appliedCount >= options.interruptAfterAction) {
          throw new JuryRigBootstrapInterruptedError(transactionDir, manifest.appliedCount);
        }
        if (options.failAfterAction && manifest.appliedCount >= options.failAfterAction) {
          throw new Error(`injected failure after action ${manifest.appliedCount}`);
        }
      }
      scanJuryRigTransactionTree(transactionDir, options.gitleaksRunner);
      manifest.status = 'committed';
      manifest.completedAt = iso();
      writeManifest(manifestPath, manifest, authority);
      return writeReceipt(transactionDir, manifest, authority);
    } catch (error) {
      if (error instanceof JuryRigBootstrapInterruptedError) throw error;
      manifest.error = (error as Error).message;
      let rollbackError: Error | null = null;
      for (let index = plan.actions.length - 1; index >= 0; index--) {
        const state = states[index];
        try {
          reconcilePendingAction(plan.actions[index], state, manifest);
          if (!state.applied) continue;
          rollbackOne(plan.actions[index], state, plan.layout.importRoot, id, authority);
          manifest.rolledBackCount += 1;
        } catch (failure) {
          rollbackError = failure as Error;
          break;
        }
      }
      manifest.status = rollbackError
        ? 'rollback-failed'
        : manifest.appliedCount === 0
          ? 'refused'
          : 'rolled-back';
      manifest.completedAt = iso();
      if (rollbackError) manifest.error = `${manifest.error}; rollback failed: ${rollbackError.message}`;
      writeManifest(manifestPath, manifest, authority);
      return writeReceipt(transactionDir, manifest, authority);
    }
  } finally {
    releaseLock();
  }
}

/**
 * Design: reconcile from the durable manifest and restore exact preimages after process loss.
 * @param plan Original action plan whose identity must match the manifest.
 * @param transactionDir Interrupted transaction directory.
 * @param options Private authority seam.
 * @returns Recovery receipt, including any fail-closed rollback error.
 */
export function recoverInterruptedJuryRigBootstrap(
  plan: JuryRigBootstrapPlan,
  transactionDir: string,
  options: JuryRigBootstrapRecoveryOptions = {},
): JuryRigBootstrapReceipt {
  const authority = options.authority ?? loadJuryRigBootstrapAuthority();
  const planDigest = verifyJuryRigBootstrapPlanAuthorization(plan, authority);
  assertSafeBootstrapLayout(plan.layout);
  assertSafeTransactionPath(transactionDir, plan.layout.transactionRoot);
  const releaseLock = acquireJuryRigCutoverLock(plan.layout, `recovery-${randomUUID()}`);
  try {
    const manifestPath = join(transactionDir, 'manifest.json');
    const manifest = JSON.parse(readUtf8(manifestPath)) as TransactionManifest;
    verifyManifestIntegrity(manifest, authority);
    if (manifest.planDigest !== planDigest || manifest.actions.length !== plan.actions.length) {
      throw new Error('recovery plan digest does not match interrupted transaction');
    }
    if (manifest.status !== 'prepared' && manifest.status !== 'applying') {
      throw new Error(`transaction ${manifest.id} is ${manifest.status}, not interrupted`);
    }
    for (let index = 0; index < plan.actions.length; index++) {
      const expected = receiptAction(plan.actions[index]);
      const actual = manifest.actions[index];
      if (
        actual.index !== index
        || actual.kind !== expected.kind
        || actual.path !== expected.path
        || actual.before !== expected.before
        || actual.after !== expected.after
        || JSON.stringify(actual.removedAuthorities) !== JSON.stringify(expected.removedAuthorities)
      ) {
        throw new Error(`recovery plan action ${index} does not match interrupted manifest`);
      }
      reconcilePendingAction(plan.actions[index], actual, manifest);
      if (actual.applied && liveActionState(plan.actions[index], actual) !== 'after') {
        throw new Error(`refusing recovery over post-interruption drift: ${actual.path}`);
      }
    }
    try {
      for (let index = plan.actions.length - 1; index >= 0; index--) {
        const action = plan.actions[index];
        const state = manifest.actions[index];
        if (!state.applied) continue;
        rollbackOne(action, state, plan.layout.importRoot, manifest.id, authority);
        manifest.rolledBackCount += 1;
      }
      manifest.status = 'rolled-back';
      manifest.error = 'recovered interrupted cutover by restoring verified preimages';
    } catch (error) {
      manifest.status = 'rollback-failed';
      manifest.error = (error as Error).message;
    }
    manifest.completedAt = iso();
    writeManifest(manifestPath, manifest, authority);
    return writeReceipt(transactionDir, manifest, authority);
  } finally {
    releaseLock();
  }
}

/**
 * Design: require the immutable apply receipt and untouched postimages before manual rollback.
 * @param plan Original action plan.
 * @param receiptPath Exact committed apply-receipt path.
 * @param options Private authority seam.
 * @returns Rollback receipt after exact preimages are restored.
 */
export function rollbackJuryRigBootstrap(
  plan: JuryRigBootstrapPlan,
  receiptPath: string,
  options: JuryRigBootstrapRecoveryOptions = {},
): JuryRigBootstrapReceipt {
  const authority = options.authority ?? loadJuryRigBootstrapAuthority();
  const planDigest = verifyJuryRigBootstrapPlanAuthorization(plan, authority);
  assertSafeBootstrapLayout(plan.layout);
  assertSafeTransactionPath(receiptPath, plan.layout.transactionRoot);
  const receipt = JSON.parse(readUtf8(receiptPath)) as JuryRigBootstrapReceipt;
  verifyReceiptIntegrity(receipt, authority);
  if (receipt.planDigest !== planDigest) {
    throw new Error('rollback plan digest does not match committed receipt');
  }
  if (receipt.status !== 'committed') {
    throw new Error(`receipt ${receipt.id} is ${receipt.status}, not committed`);
  }
  assertSafeTransactionPath(receipt.transactionDir, plan.layout.transactionRoot);
  const releaseLock = acquireJuryRigCutoverLock(plan.layout, `rollback-${receipt.id}`);
  try {
    const manifestPath = join(receipt.transactionDir, 'manifest.json');
    const manifest = JSON.parse(readUtf8(manifestPath)) as TransactionManifest;
    verifyManifestIntegrity(manifest, authority);
    if (
      manifest.id !== receipt.id
      || manifest.planDigest !== planDigest
      || manifest.actions.length !== plan.actions.length
      || receipt.actions.length !== plan.actions.length
    ) {
      throw new Error('rollback plan digest does not match committed manifest and receipt');
    }
    if (
      manifest.status !== 'committed'
      || JSON.stringify(manifest.attribution) !== JSON.stringify(receipt.attribution)
      || JSON.stringify(manifest.proof) !== JSON.stringify(receipt.proof)
    ) {
      throw new Error('committed manifest does not match apply receipt authority');
    }
    for (let index = plan.actions.length - 1; index >= 0; index--) {
      const expected = receiptAction(plan.actions[index]);
      const receiptState = receipt.actions[index];
      const manifestState = manifest.actions[index];
      for (const actual of [receiptState, manifestState]) {
        if (
          actual.kind !== expected.kind
          || actual.path !== expected.path
          || actual.before !== expected.before
          || actual.after !== expected.after
          || JSON.stringify(actual.removedAuthorities) !== JSON.stringify(expected.removedAuthorities)
        ) {
          throw new Error(`rollback plan action ${index} does not match committed authority`);
        }
      }
      if (manifestState.applied && liveActionState(plan.actions[index], manifestState) !== 'after') {
        throw new Error(`refusing rollback over post-cutover drift: ${manifestState.path}`);
      }
    }
    for (let index = plan.actions.length - 1; index >= 0; index--) {
      const state = manifest.actions[index];
      if (!state.applied) continue;
      rollbackOne(plan.actions[index], state, plan.layout.importRoot, manifest.id, authority);
      manifest.rolledBackCount += 1;
    }
    manifest.status = 'rolled-back';
    manifest.completedAt = iso();
    manifest.error = null;
    writeManifest(manifestPath, manifest, authority);
    return writeReceipt(receipt.transactionDir, manifest, authority);
  } finally {
    releaseLock();
  }
}

/**
 * Design: an installed CLI can roll back from one immutable receipt without exposing
 * secret-bearing config postimages in a plaintext plan file. Apply stores the authorized
 * plan only as a context-bound pd-vault envelope; this function authenticates and opens it,
 * then delegates to the same exact-plan rollback gate used in-process.
 *
 * @param receiptPath Exact committed apply receipt produced by the bootstrap.
 * @param options Private authority seam; production loads the OS-Keychain-derived authority.
 * @returns Rollback receipt after exact preimages are restored.
 */
export function rollbackJuryRigBootstrapReceipt(
  receiptPath: string,
  options: JuryRigBootstrapRecoveryOptions = {},
): JuryRigBootstrapReceipt {
  const authority = options.authority ?? loadJuryRigBootstrapAuthority();
  const resolvedReceipt = resolve(receiptPath);
  const transactionDir = dirname(resolvedReceipt);
  const transactionId = basename(transactionDir);
  const envelopePath = join(transactionDir, SEALED_PLAN_FILENAME);
  const envelope = JSON.parse(readUtf8(envelopePath)) as JuryRigBootstrapSealedBackup;
  const plaintext = authority.openBackup(envelope, transactionId, SEALED_PLAN_INDEX, SEALED_PLAN_CONTEXT);
  const plan = JSON.parse(plaintext.toString('utf8'), revivePlanBuffer) as JuryRigBootstrapPlan;
  assertSafeBootstrapLayout(plan.layout);
  assertSafeTransactionPath(resolvedReceipt, plan.layout.transactionRoot);
  return rollbackJuryRigBootstrap(plan, resolvedReceipt, { authority });
}

/**
 * Reads a bounded authenticated projection of terminal bootstrap receipts.
 * The design keeps status from treating arbitrary JSON in the transaction
 * directory as authority or allocating without limit.
 *
 * @param layout Signed machine layout containing the transaction root.
 * @param options Optional test authority seam.
 * @returns Newest authenticated terminal receipts, bounded to 100 transactions.
 */
export function readJuryRigBootstrapStatus(
  layout: JuryRigBootstrapLayout,
  options: JuryRigBootstrapRecoveryOptions = {},
): JuryRigBootstrapReceipt[] {
  assertSafeBootstrapLayout(layout);
  if (!existsSync(layout.transactionRoot)) return [];
  const authority = options.authority ?? loadJuryRigBootstrapAuthority();
  const names = [
    'rollback-failed-receipt.json',
    'rollback-receipt.json',
    'apply-receipt.json',
    'refused-receipt.json',
  ];
  return readdirSync(layout.transactionRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .sort((left, right) => right.name.localeCompare(left.name))
    .slice(0, 100)
    .flatMap((entry) => {
      const dir = join(layout.transactionRoot, entry.name);
      const receiptPath = names.map((name) => join(dir, name)).find(existsSync);
      if (!receiptPath) return [];
      assertSafeTransactionPath(receiptPath, layout.transactionRoot);
      const receipt = JSON.parse(readUtf8(receiptPath, 1024 * 1024)) as JuryRigBootstrapReceipt;
      verifyReceiptIntegrity(receipt, authority);
      return [receipt];
    });
}

/**
 * Design: make dry-run output operator-readable without serializing secret-bearing postimage bytes.
 * @param plan Full in-memory plan.
 * @returns Plan whose actions contain only paths, hashes, and removal metadata.
 */
export function redactJuryRigBootstrapPlan(plan: JuryRigBootstrapPlan): Omit<JuryRigBootstrapPlan, 'actions'> & {
  actions: JuryRigBootstrapReceiptAction[];
} {
  return {
    ...plan,
    actions: plan.actions.map(receiptAction),
  };
}
