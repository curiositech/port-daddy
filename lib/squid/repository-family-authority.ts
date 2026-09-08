import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
  accessSync,
  chmodSync,
  constants as fsConstants,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, isAbsolute, join, parse, relative, resolve } from 'node:path';

import { PD_HOME } from '../../shared/paths.js';

export const SQUID_REPOSITORY_FAMILY_RECORD_VERSION = 'v1';
export const SQUID_REPOSITORY_FAMILY_MARKER_FILENAME = 'squid-repository-family.v1';
export const SQUID_REPOSITORY_FAMILY_MAX_RECORD_BYTES = 4_096;
const RECORD_VERSION = SQUID_REPOSITORY_FAMILY_RECORD_VERSION;
const MARKER_FILENAME = SQUID_REPOSITORY_FAMILY_MARKER_FILENAME;
const MAX_RECORD_BYTES = SQUID_REPOSITORY_FAMILY_MAX_RECORD_BYTES;
const MAX_PARENT_ASCENTS = 64;
const LOCAL_REPOSITORY_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const AUTHORITY_LOOKUP_ID = /^(?:git|root)-[1-9][0-9]*-[1-9][0-9]*$/;

export type RepositoryFamilyKind = 'git' | 'root';
export type RepositoryFamilyFaultPoint =
  | 'after-verifier-commit'
  | 'before-marker-commit'
  | 'after-marker-commit'
  | 'after-verifier-remove';

export interface RepositoryFamilyAuthority {
  kind: RepositoryFamilyKind;
  /** Current Git worktree or nearest non-Git project boundary. Provenance only. */
  projectRoot: string;
  /** Git common directory or non-Git project root. Provenance only. */
  authorityRoot: string;
  /** Repository-family authority. Path, remote URL, owner/name, and branch are excluded. */
  device: number;
  inode: number;
  /** Verified worktree identity used only for a narrower local deny. */
  worktreeDevice: number;
  worktreeInode: number;
}

export interface RepositoryFamilyInspection {
  armed: boolean;
  kind: RepositoryFamilyKind | null;
  projectRoot: string | null;
  localRepositoryId: string | null;
  reason: string;
  authority: RepositoryFamilyAuthority | null;
}

export interface RepositoryFamilyArmReceipt {
  armed: true;
  kind: RepositoryFamilyKind;
  projectRoot: string;
  localRepositoryId: string;
  lookupId: string;
  authority: RepositoryFamilyAuthority;
  markerPath: string;
  verifierPath: string;
  /** True when an injected/post-write error was resolved by exact disk readback. */
  commitReadBack: boolean;
}

export interface RepositoryFamilyDisarmReceipt {
  revoked: boolean;
  kind: RepositoryFamilyKind | null;
  projectRoot: string | null;
  localRepositoryId: string | null;
  markerRemoved: boolean;
  verifierRemoved: boolean;
  deniesRemoved: boolean;
  reason: string;
}

export interface WorktreeDenyReceipt {
  denied: true;
  localRepositoryId: string;
  lookupId: string;
  denyPath: string;
}

export interface WorktreeAllowReceipt {
  allowed: boolean;
  denyPath: string | null;
}

export interface RepositoryFamilyMutationOptions {
  pdHome?: string;
  /** Test-only deterministic interruption seam; production callers omit it. */
  fault?: (point: RepositoryFamilyFaultPoint) => void;
  /** Test-only concurrent ancestry swap seam; production callers omit it. */
  directoryFault?: (event: RepositoryFamilyDirectoryFaultEvent) => void;
}

export interface RepositoryFamilyDirectoryFaultEvent {
  phase: 'after-parent-pin-before-mkdir';
  parent: string;
  component: string;
}

export interface RepositoryFamilyMutationLock {
  path: string;
  nonce: string;
  release: () => boolean;
}

export interface RepositoryFamilyMutationLockInspection {
  exists: boolean;
  /** Automatic takeover is never authorized by this diagnostic record. */
  automaticRecoveryAllowed: false;
  manualRecoveryRequired: boolean;
  reason: string;
  lockPath: string;
  lockDevice: number | null;
  lockInode: number | null;
  ownerDigest: string | null;
  ownerPid: number | null;
  ownerStartToken: string | null;
}

export interface PendingRepositoryFamilyArm {
  authority: RepositoryFamilyAuthority;
  lookupId: string;
  localRepositoryId: string;
  verifierPath: string;
  markerPath: string;
}

export interface PreparedRepositoryFamilyArm<T> {
  value: T;
  /** Compensates callback writes if the family marker does not commit. */
  rollback: () => string[];
}

export class RepositoryFamilyAuthorityError extends Error {
  constructor(message: string, readonly reason: string) {
    super(message);
    this.name = 'RepositoryFamilyAuthorityError';
  }
}

interface VerifierRecord {
  kind: RepositoryFamilyKind;
  lookupId: string;
  localRepositoryId: string;
  device: number;
  inode: number;
}

interface MarkerRecord {
  lookupId: string;
  localRepositoryId: string;
}

interface DenyRecord {
  lookupId: string;
  localRepositoryId: string;
  worktreeDevice: number;
  worktreeInode: number;
}

function currentUid(): number | null {
  return typeof process.getuid === 'function' ? process.getuid() : null;
}

function ownedByCurrentUser(path: string): boolean {
  const uid = currentUid();
  return uid === null || lstatSync(path).uid === uid;
}

function positiveSafeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

function pathHasSymlinkComponent(value: string): boolean {
  const absolute = resolve(value);
  const root = parse(absolute).root;
  let cursor = root;
  for (const part of absolute.slice(root.length).split('/').filter(Boolean)) {
    cursor = join(cursor, part);
    try {
      if (lstatSync(cursor).isSymbolicLink()) return true;
    } catch {
      return false;
    }
  }
  return false;
}

function pathEntryExists(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ENOENT';
  }
}

interface DirectoryIdentity {
  path: string;
  device: number;
  inode: number;
  mode: number;
}

interface DirectoryTreePolicy {
  /** Components at or below this path must be owned by the current user. */
  ownedFrom: string;
  /** Components at or below this path must additionally be exact mode 0700. */
  privateFrom?: string;
  label: string;
}

function isPathWithin(root: string, candidate: string): boolean {
  const rel = relative(resolve(root), resolve(candidate));
  return rel === '' || (!rel.startsWith('..') && !parse(rel).root);
}

function directoryComponents(path: string): string[] {
  const absolute = resolve(path);
  const root = parse(absolute).root;
  const components = [root];
  let cursor = root;
  for (const part of absolute.slice(root.length).split('/').filter(Boolean)) {
    cursor = join(cursor, part);
    components.push(cursor);
  }
  return components;
}

function readDirectoryIdentity(path: string, policy: DirectoryTreePolicy): DirectoryIdentity {
  let stats;
  try {
    stats = lstatSync(path);
  } catch (error) {
    throw new RepositoryFamilyAuthorityError(
      `Cannot inspect ${policy.label} directory ${path}: ${(error as Error).message}`,
      `${policy.label}-unreadable`,
    );
  }
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    throw new RepositoryFamilyAuthorityError(
      `${policy.label} ancestry is not a real directory: ${path}`,
      `${policy.label}-ancestry-invalid`,
    );
  }
  if (isPathWithin(policy.ownedFrom, path) && !ownedByCurrentUser(path)) {
    throw new RepositoryFamilyAuthorityError(
      `${policy.label} ancestry is not owned by the current user: ${path}`,
      `${policy.label}-owner-invalid`,
    );
  }
  if (policy.privateFrom && isPathWithin(policy.privateFrom, path) && (stats.mode & 0o777) !== 0o700) {
    throw new RepositoryFamilyAuthorityError(
      `${policy.label} private ancestry must be mode 0700: ${path}`,
      `${policy.label}-mode-invalid`,
    );
  }
  return { path, device: stats.dev, inode: stats.ino, mode: stats.mode & 0o777 };
}

function readMatchingDirectoryIdentity(expected: DirectoryIdentity, policy: DirectoryTreePolicy): DirectoryIdentity {
  const current = readDirectoryIdentity(expected.path, policy);
  if (current.device !== expected.device || current.inode !== expected.inode) {
    throw new RepositoryFamilyAuthorityError(
      `${policy.label} ancestry changed during mutation: ${expected.path}`,
      `${policy.label}-ancestry-changed`,
    );
  }
  return current;
}

/**
 * Reject static ancestry traversal before mutation, then create one missing
 * level at a time. The parent identity is checked immediately before and after
 * each mkdir so a concurrent swap is detected. Node has no dirfd-relative
 * mkdirat/openat-no-follow primitive here: detection does not prevent an empty
 * directory residue through a hostile same-uid swap, and that residue is never
 * accepted as verifier/marker/deny authority.
 */
function ensureOwnedDirectoryTree(
  target: string,
  policy: DirectoryTreePolicy,
  create: boolean,
  directoryFault?: (event: RepositoryFamilyDirectoryFaultEvent) => void,
): DirectoryIdentity | null {
  const absolute = resolve(target);
  const components = directoryComponents(absolute);
  const identities = new Map<string, DirectoryIdentity>();
  let firstMissing = -1;

  // Complete preflight: no mkdir occurs until every currently reachable
  // component has been lstat-validated and pinned by dev+ino.
  for (let index = 0; index < components.length; index += 1) {
    const component = components[index];
    try {
      lstatSync(component);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        firstMissing = index;
        break;
      }
      throw new RepositoryFamilyAuthorityError(
        `Cannot preflight ${policy.label} ancestry ${component}: ${(error as Error).message}`,
        `${policy.label}-unreadable`,
      );
    }
    identities.set(component, readDirectoryIdentity(component, policy));
  }

  if (firstMissing >= 0 && !create) return null;
  if (firstMissing >= 0) {
    for (let index = firstMissing; index < components.length; index += 1) {
      const component = components[index];
      const parent = components[index - 1];
      const parentIdentity = identities.get(parent);
      if (!parentIdentity) {
        throw new RepositoryFamilyAuthorityError(
          `${policy.label} parent identity is unavailable: ${parent}`,
          `${policy.label}-ancestry-invalid`,
        );
      }
      readMatchingDirectoryIdentity(parentIdentity, policy);
      directoryFault?.({ phase: 'after-parent-pin-before-mkdir', parent, component });
      try {
        mkdirSync(component, { mode: 0o700 });
      } catch (error) {
        throw new RepositoryFamilyAuthorityError(
          `Cannot create ${policy.label} directory ${component}: ${(error as Error).message}`,
          `${policy.label}-create-failed`,
        );
      }
      const created = readDirectoryIdentity(component, policy);
      readMatchingDirectoryIdentity(parentIdentity, policy);
      if (realpathSync(component) !== component) {
        throw new RepositoryFamilyAuthorityError(
          `${policy.label} directory escaped its lexical authority: ${component}`,
          `${policy.label}-ancestry-invalid`,
        );
      }
      identities.set(component, created);
    }
  }

  for (const identity of identities.values()) readMatchingDirectoryIdentity(identity, policy);
  const targetIdentity = identities.get(absolute);
  if (!targetIdentity) return null;
  return readMatchingDirectoryIdentity(targetIdentity, policy);
}

function ownedDirectory(path: string): { path: string; device: number; inode: number } | null {
  try {
    if (pathHasSymlinkComponent(path)) return null;
    const canonical = realpathSync(path);
    const stats = statSync(canonical);
    if (!stats.isDirectory() || !ownedByCurrentUser(canonical)) return null;
    if (!positiveSafeInteger(stats.dev) || !positiveSafeInteger(stats.ino)) return null;
    return { path: canonical, device: stats.dev, inode: stats.ino };
  } catch {
    return null;
  }
}

function strictRegularSingleLine(path: string): string | null {
  try {
    const stats = lstatSync(path);
    if (
      !stats.isFile()
      || stats.isSymbolicLink()
      || stats.nlink !== 1
      || !ownedByCurrentUser(path)
      || stats.size <= 0
      || stats.size > MAX_RECORD_BYTES
    ) return null;
    const text = readFileSync(path, 'utf8');
    if (text.includes('\0') || !text.endsWith('\n')) return null;
    const lines = text.slice(0, -1).split('\n');
    return lines.length === 1 && lines[0].length > 0 ? lines[0] : null;
  } catch {
    return null;
  }
}

function strictMetadataPath(line: string, prefix: string): string | null {
  if (!line.startsWith(prefix)) return null;
  const raw = line.slice(prefix.length);
  if (!raw || raw.trim() !== raw || raw.includes('\0')) return null;
  // Git's linked-worktree .git file and admin backpointer are expected to be
  // absolute. Accepting relative authority metadata creates a second parser
  // contract and makes cwd/path text security-relevant.
  return isAbsolute(raw) ? resolve(raw) : null;
}

function resolveGitAuthority(projectRoot: string, dotGit: string): RepositoryFamilyAuthority | null {
  const worktree = ownedDirectory(projectRoot);
  if (!worktree) return null;
  let dotGitStats;
  try {
    dotGitStats = lstatSync(dotGit);
  } catch {
    return null;
  }
  if (dotGitStats.isSymbolicLink() || !ownedByCurrentUser(dotGit)) return null;

  if (dotGitStats.isDirectory()) {
    // A normal worktree is accepted only when its own, non-symlink .git
    // directory is the direct child that supplies repository authority.
    if (dirname(dotGit) !== projectRoot) return null;
    const common = ownedDirectory(dotGit);
    if (!common) return null;
    return {
      kind: 'git',
      projectRoot,
      authorityRoot: common.path,
      device: common.device,
      inode: common.inode,
      worktreeDevice: worktree.device,
      worktreeInode: worktree.inode,
    };
  }

  if (!dotGitStats.isFile() || dotGitStats.nlink !== 1 || dotGitStats.size > MAX_RECORD_BYTES) return null;
  const gitdirLine = strictRegularSingleLine(dotGit);
  const adminCandidate = gitdirLine
    ? strictMetadataPath(gitdirLine, 'gitdir: ')
    : null;
  if (!adminCandidate) return null;
  const admin = ownedDirectory(adminCandidate);
  if (!admin) return null;

  const commondirPath = join(admin.path, 'commondir');
  const commondirLine = strictRegularSingleLine(commondirPath);
  // Native `git worktree` records ../.. from <common>/worktrees/<slot>. Pin
  // that one shape and derive the parent lexically before resolving it, so a
  // commondir path cannot smuggle a symlink traversal past the shell verifier.
  if (commondirLine !== '../..') return null;
  const commonCandidate = dirname(dirname(admin.path));
  const common = ownedDirectory(commonCandidate);
  if (!common) return null;
  const worktreesDirectory = ownedDirectory(join(common.path, 'worktrees'));
  if (!worktreesDirectory || dirname(admin.path) !== worktreesDirectory.path || basename(admin.path).length === 0) return null;

  const backpointerPath = join(admin.path, 'gitdir');
  const backpointerLine = strictRegularSingleLine(backpointerPath);
  if (!backpointerLine || backpointerLine.trim() !== backpointerLine) return null;
  const backpointer = isAbsolute(backpointerLine) ? resolve(backpointerLine) : null;
  if (backpointer !== dotGit) return null;

  return {
    kind: 'git',
    projectRoot,
    authorityRoot: common.path,
    device: common.device,
    inode: common.inode,
    // The verified admin directory is the move-stable linked-worktree object.
    // Its backpointer is revalidated above; cwd/path text is never the deny key.
    worktreeDevice: admin.device,
    worktreeInode: admin.inode,
  };
}

/**
 * Resolve only the nearest local project boundary. A malformed or untrusted
 * nested boundary blocks ascent instead of falling through to a parent family.
 */
export function resolveRepositoryFamilyAuthority(cwd: string): RepositoryFamilyAuthority | null {
  let cursor: string;
  try {
    cursor = realpathSync(resolve(cwd));
    if (!statSync(cursor).isDirectory()) return null;
  } catch {
    return null;
  }

  for (let ascent = 0; ascent <= MAX_PARENT_ASCENTS; ascent++) {
    const dotGit = join(cursor, '.git');
    if (pathEntryExists(dotGit)) return resolveGitAuthority(cursor, dotGit);

    const dotPortDaddy = join(cursor, '.portdaddy');
    if (pathEntryExists(dotPortDaddy)) {
      const root = ownedDirectory(cursor);
      const markerDirectory = ownedDirectory(dotPortDaddy);
      if (!root || !markerDirectory) return null;
      return {
        kind: 'root',
        projectRoot: root.path,
        authorityRoot: root.path,
        device: root.device,
        inode: root.inode,
        worktreeDevice: root.device,
        worktreeInode: root.inode,
      };
    }

    const parent = dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  return null;
}

export function repositoryFamilyAuthorityLookupId(authority: RepositoryFamilyAuthority): string {
  return `${authority.kind}-${authority.device}-${authority.inode}`;
}

export function repositoryFamilyMarkerPath(authority: RepositoryFamilyAuthority): string {
  return authority.kind === 'git'
    ? join(authority.authorityRoot, 'port-daddy', MARKER_FILENAME)
    : join(authority.authorityRoot, '.portdaddy', MARKER_FILENAME);
}

export function repositoryFamilyVerifierDirectory(pdHome = PD_HOME): string {
  return join(pdHome, 'squid', 'repository-families');
}

export function repositoryFamilyVerifierPath(authority: RepositoryFamilyAuthority, pdHome = PD_HOME): string {
  return join(repositoryFamilyVerifierDirectory(pdHome), `${repositoryFamilyAuthorityLookupId(authority)}.v1`);
}

export function repositoryFamilyDenyPath(authority: RepositoryFamilyAuthority, pdHome = PD_HOME): string {
  return join(
    repositoryFamilyVerifierDirectory(pdHome),
    'denies',
    repositoryFamilyAuthorityLookupId(authority),
    `${authority.worktreeDevice}-${authority.worktreeInode}.v1`,
  );
}

export function repositoryFamilyMutationLockPath(pdHome = PD_HOME): string {
  return join(repositoryFamilyVerifierDirectory(pdHome), '.mutation.lock');
}

function parsePositiveInteger(raw: string | undefined): number | null {
  if (!raw || !/^[1-9][0-9]*$/.test(raw)) return null;
  const value = Number(raw);
  return positiveSafeInteger(value) ? value : null;
}

function strictRecordFileReason(path: string, label: string): string | null {
  try {
    const stats = lstatSync(path);
    if (stats.isSymbolicLink()) return `${label}-symlink`;
    if (!stats.isFile() || !ownedByCurrentUser(path)) return `${label}-invalid`;
    if (stats.nlink !== 1) return `${label}-hardlink`;
    if ((stats.mode & 0o777) !== 0o600) return `${label}-mode-invalid`;
    if (stats.size <= 0 || stats.size > MAX_RECORD_BYTES) return `${label}-malformed`;
  } catch {
    return `${label}-missing`;
  }
  return null;
}

function parseVerifier(path: string): { record: VerifierRecord | null; reason: string } {
  const fileReason = strictRecordFileReason(path, 'verifier');
  if (fileReason) return { record: null, reason: fileReason };
  const line = strictRegularSingleLine(path);
  if (!line) return { record: null, reason: 'verifier-malformed' };
  const [version, kind, lookupId, localRepositoryId, rawDevice, rawInode, extra] = line.split('\t');
  const device = parsePositiveInteger(rawDevice);
  const inode = parsePositiveInteger(rawInode);
  if (
    version !== RECORD_VERSION
    || (kind !== 'git' && kind !== 'root')
    || !AUTHORITY_LOOKUP_ID.test(lookupId ?? '')
    || !LOCAL_REPOSITORY_ID.test(localRepositoryId ?? '')
    || device === null
    || inode === null
    || extra !== undefined
  ) return { record: null, reason: 'verifier-malformed' };
  return { record: { kind, lookupId, localRepositoryId, device, inode }, reason: 'verifier-valid' };
}

function parseMarker(path: string): { record: MarkerRecord | null; reason: string } {
  const fileReason = strictRecordFileReason(path, 'marker');
  if (fileReason) return { record: null, reason: fileReason === 'marker-missing' ? 'not-armed' : fileReason };
  const line = strictRegularSingleLine(path);
  if (!line) return { record: null, reason: 'marker-malformed' };
  const [version, lookupId, localRepositoryId, extra] = line.split('\t');
  if (
    version !== RECORD_VERSION
    || !AUTHORITY_LOOKUP_ID.test(lookupId ?? '')
    || !LOCAL_REPOSITORY_ID.test(localRepositoryId ?? '')
    || extra !== undefined
  ) return { record: null, reason: 'marker-malformed' };
  return { record: { lookupId, localRepositoryId }, reason: 'marker-valid' };
}

function parseDeny(path: string): { record: DenyRecord | null; reason: string } {
  if (!existsSync(path)) return { record: null, reason: 'deny-missing' };
  const fileReason = strictRecordFileReason(path, 'deny');
  if (fileReason) return { record: null, reason: fileReason };
  const line = strictRegularSingleLine(path);
  if (!line) return { record: null, reason: 'deny-malformed' };
  const [version, type, lookupId, localRepositoryId, rawDevice, rawInode, extra] = line.split('\t');
  const worktreeDevice = parsePositiveInteger(rawDevice);
  const worktreeInode = parsePositiveInteger(rawInode);
  if (
    version !== RECORD_VERSION
    || type !== 'deny'
    || !AUTHORITY_LOOKUP_ID.test(lookupId ?? '')
    || !LOCAL_REPOSITORY_ID.test(localRepositoryId ?? '')
    || worktreeDevice === null
    || worktreeInode === null
    || extra !== undefined
  ) return { record: null, reason: 'deny-malformed' };
  return { record: { lookupId, localRepositoryId, worktreeDevice, worktreeInode }, reason: 'deny-valid' };
}

function verifierRegistryReason(pdHome: string): string | null {
  const registry = repositoryFamilyVerifierDirectory(pdHome);
  if (!existsSync(registry)) return null;
  try {
    if (pathHasSymlinkComponent(registry)) return 'verifier-registry-symlink';
    const stats = lstatSync(registry);
    if (!stats.isDirectory() || !ownedByCurrentUser(registry)) return 'verifier-registry-invalid';
    if ((stats.mode & 0o777) !== 0o700) return 'verifier-registry-mode-invalid';
  } catch {
    return 'verifier-registry-invalid';
  }
  return null;
}

function strictPrivateDirectoryReason(path: string, label: string): string | null {
  if (!pathEntryExists(path)) return null;
  try {
    if (pathHasSymlinkComponent(path)) return `${label}-symlink`;
    const stats = lstatSync(path);
    if (
      !stats.isDirectory()
      || stats.isSymbolicLink()
      || !ownedByCurrentUser(path)
      || (stats.mode & 0o777) !== 0o700
    ) return `${label}-invalid`;
    return null;
  } catch {
    return `${label}-invalid`;
  }
}

function denyDirectoryReason(authority: RepositoryFamilyAuthority, pdHome: string): string | null {
  const root = join(repositoryFamilyVerifierDirectory(pdHome), 'denies');
  const rootReason = strictPrivateDirectoryReason(root, 'deny-directory');
  if (rootReason) return rootReason;
  return strictPrivateDirectoryReason(
    join(root, repositoryFamilyAuthorityLookupId(authority)),
    'deny-family-directory',
  );
}

function ensurePrivateDirectory(
  path: string,
  pdHome: string,
  directoryFault?: (event: RepositoryFamilyDirectoryFaultEvent) => void,
): void {
  ensureOwnedDirectoryTree(path, {
    ownedFrom: pdHome,
    privateFrom: join(pdHome, 'squid'),
    label: 'private-directory',
  }, true, directoryFault);
}

function ensureVerifierRegistry(
  pdHome: string,
  directoryFault?: (event: RepositoryFamilyDirectoryFaultEvent) => void,
): string {
  const registry = repositoryFamilyVerifierDirectory(pdHome);
  ensureOwnedDirectoryTree(registry, {
    ownedFrom: pdHome,
    privateFrom: join(pdHome, 'squid'),
    label: 'verifier-registry',
  }, true, directoryFault);
  const reason = verifierRegistryReason(pdHome);
  if (reason) throw new RepositoryFamilyAuthorityError('Repository-family verifier registry is not trustworthy', reason);
  return registry;
}

function atomicWrite0600(path: string, content: string): void {
  const temporary = join(dirname(path), `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`);
  try {
    writeFileSync(temporary, content, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    chmodSync(temporary, 0o600);
    renameSync(temporary, path);
    chmodSync(path, 0o600);
  } finally {
    rmSync(temporary, { force: true });
  }
}

function trustedMarkerParent(
  authority: RepositoryFamilyAuthority,
  create: boolean,
  directoryFault?: (event: RepositoryFamilyDirectoryFaultEvent) => void,
): string | null {
  const parent = dirname(repositoryFamilyMarkerPath(authority));
  try {
    const identity = ensureOwnedDirectoryTree(parent, {
      ownedFrom: authority.kind === 'git' ? authority.authorityRoot : authority.projectRoot,
      label: 'marker-parent',
    }, create, directoryFault);
    return identity?.path ?? null;
  } catch {
    return null;
  }
}

export function acquireRepositoryFamilyMutationLock(
  pdHome = PD_HOME,
  options: Pick<RepositoryFamilyMutationOptions, 'directoryFault'> = {},
): RepositoryFamilyMutationLock {
  ensureVerifierRegistry(pdHome, options.directoryFault);
  const lock = repositoryFamilyMutationLockPath(pdHome);
  const nonce = randomUUID();
  try {
    mkdirSync(lock, { mode: 0o700 });
  } catch {
    throw new RepositoryFamilyAuthorityError(
      'Repository-family mutation lock is busy; automatic takeover is disabled, so use doctor and operator-authorized manual recovery',
      'mutation-lock-busy',
    );
  }
  const identity = lstatSync(lock);
  const owner = join(lock, 'owner.v1');
  const ownerStartToken = readProcessStartToken(process.pid);
  if (!ownerStartToken) {
    rmSync(lock, { recursive: true, force: true });
    throw new RepositoryFamilyAuthorityError(
      'Repository-family mutation lock cannot establish an OS-backed owner start token',
      'mutation-lock-owner-unverifiable',
    );
  }
  try {
    atomicWrite0600(owner, `${RECORD_VERSION}\t${nonce}\t${identity.dev}\t${identity.ino}\t${process.pid}\t${ownerStartToken}\n`);
  } catch (error) {
    rmSync(lock, { recursive: true, force: true });
    throw error;
  }
  let released = false;
  return {
    path: lock,
    nonce,
    release: () => {
      if (released) return false;
      released = true;
      try {
        const current = lstatSync(lock);
        if (!current.isDirectory() || current.isSymbolicLink() || current.dev !== identity.dev || current.ino !== identity.ino) return false;
        if (strictRegularSingleLine(owner) !== `${RECORD_VERSION}\t${nonce}\t${identity.dev}\t${identity.ino}\t${process.pid}\t${ownerStartToken}`) return false;
        rmSync(owner, { force: true });
        rmSync(lock, { recursive: true, force: true });
        return true;
      } catch {
        return false;
      }
    },
  };
}

const PROCESS_START_TOKEN = /^(?:proc-[1-9][0-9]*|ps-[0-9a-f]{64})$/;

function trustedPsExecutable(): string | null {
  for (const candidate of ['/bin/ps', '/usr/bin/ps']) {
    try {
      accessSync(candidate, fsConstants.X_OK);
      return candidate;
    } catch {
      // Try the next fixed system location.
    }
  }
  return null;
}

/** Pure parser for Linux proc stat; comm may itself contain spaces or `)`. */
export function parseLinuxProcStatStartToken(line: string): string | null {
  const close = line.lastIndexOf(')');
  const fields = close >= 0 ? line.slice(close + 2).trim().split(/\s+/) : [];
  // The tail begins at proc field 3; index 19 is field 22 (starttime).
  const starttime = fields[19];
  return starttime && /^[1-9][0-9]*$/.test(starttime) ? `proc-${starttime}` : null;
}

function readProcessStartToken(pid: number): string | null {
  if (!positiveSafeInteger(pid)) return null;
  const procStat = `/proc/${pid}/stat`;
  try {
    const stats = lstatSync(procStat);
    if (stats.isFile() && !stats.isSymbolicLink() && stats.size > 0 && stats.size <= MAX_RECORD_BYTES) {
      const token = parseLinuxProcStatStartToken(readFileSync(procStat, 'utf8'));
      if (token) return token;
    }
  } catch {
    // macOS and some hardened Linux hosts do not expose /proc.
  }
  const ps = trustedPsExecutable();
  if (!ps) return null;
  try {
    const output = execFileSync(ps, ['-o', 'lstart=', '-p', String(pid)], {
      encoding: 'utf8',
      timeout: 1_000,
      maxBuffer: MAX_RECORD_BYTES,
      env: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', LC_ALL: 'C' },
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (!output || output.includes('\0') || output.length > 256 || output.includes('\n')) return null;
    return `ps-${createHash('sha256').update(output).digest('hex')}`;
  } catch {
    return null;
  }
}

type ProcessOwnerState = 'same' | 'reused' | 'absent' | 'unknown';

function inspectProcessOwner(pid: number, expectedStartToken: string): ProcessOwnerState {
  const currentStartToken = readProcessStartToken(pid);
  if (currentStartToken) return currentStartToken === expectedStartToken ? 'same' : 'reused';
  try {
    process.kill(pid, 0);
    return 'unknown';
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ESRCH' ? 'absent' : 'unknown';
  }
}

function mutationLockOwnerDigest(line: string): string {
  return createHash('sha256').update(`${line}\n`).digest('hex');
}

/**
 * Read-only half of explicit lock recovery. Age never proves abandonment: a
 * caller receives a CAS challenge only when the recorded owner PID is
 * definitely absent, and must present this exact identity to recover.
 */
export function inspectRepositoryFamilyMutationLock(
  pdHome = PD_HOME,
): RepositoryFamilyMutationLockInspection {
  const lockPath = repositoryFamilyMutationLockPath(pdHome);
  if (!pathEntryExists(lockPath)) {
    return {
      exists: false,
      automaticRecoveryAllowed: false,
      manualRecoveryRequired: false,
      reason: 'mutation-lock-absent',
      lockPath,
      lockDevice: null,
      lockInode: null,
      ownerDigest: null,
      ownerPid: null,
      ownerStartToken: null,
    };
  }
  try {
    const lock = lstatSync(lockPath);
    if (
      lock.isSymbolicLink()
      || !lock.isDirectory()
      || !ownedByCurrentUser(lockPath)
      || (lock.mode & 0o777) !== 0o700
      || !positiveSafeInteger(lock.dev)
      || !positiveSafeInteger(lock.ino)
    ) throw new Error('unsafe lock directory');
    const ownerLine = strictRegularSingleLine(join(lockPath, 'owner.v1'));
    if (!ownerLine) throw new Error('missing owner record');
    const [version, nonce, rawDevice, rawInode, rawPid, ownerStartToken, extra] = ownerLine.split('\t');
    const device = parsePositiveInteger(rawDevice);
    const inode = parsePositiveInteger(rawInode);
    const ownerPid = parsePositiveInteger(rawPid);
    if (
      version !== RECORD_VERSION
      || !LOCAL_REPOSITORY_ID.test(nonce ?? '')
      || device !== lock.dev
      || inode !== lock.ino
      || ownerPid === null
      || !PROCESS_START_TOKEN.test(ownerStartToken ?? '')
      || extra !== undefined
    ) throw new Error('malformed owner record');
    const ownerState = inspectProcessOwner(ownerPid, ownerStartToken!);
    return {
      exists: true,
      automaticRecoveryAllowed: false,
      manualRecoveryRequired: ownerState === 'absent' || ownerState === 'reused',
      reason: ownerState === 'reused'
        ? 'mutation-lock-owner-pid-reused'
        : ownerState === 'absent'
          ? 'mutation-lock-owner-absent'
          : ownerState === 'same'
            ? 'mutation-lock-owner-live'
            : 'mutation-lock-owner-unverifiable',
      lockPath,
      lockDevice: lock.dev,
      lockInode: lock.ino,
      ownerDigest: mutationLockOwnerDigest(ownerLine),
      ownerPid,
      ownerStartToken: ownerStartToken!,
    };
  } catch {
    return {
      exists: true,
      automaticRecoveryAllowed: false,
      manualRecoveryRequired: true,
      reason: 'mutation-lock-malformed',
      lockPath,
      lockDevice: null,
      lockInode: null,
      ownerDigest: null,
      ownerPid: null,
      ownerStartToken: null,
    };
  }
}

function withMutationLock<T>(
  pdHome: string,
  operation: () => T,
  directoryFault?: (event: RepositoryFamilyDirectoryFaultEvent) => void,
): T {
  const lock = acquireRepositoryFamilyMutationLock(pdHome, { directoryFault });
  try {
    return operation();
  } finally {
    lock.release();
  }
}

function verifierMatchesAuthority(record: VerifierRecord, authority: RepositoryFamilyAuthority): boolean {
  return record.kind === authority.kind
    && record.lookupId === repositoryFamilyAuthorityLookupId(authority)
    && record.device === authority.device
    && record.inode === authority.inode;
}

function markerMatchesVerifier(marker: MarkerRecord, verifier: VerifierRecord): boolean {
  return marker.lookupId === verifier.lookupId && marker.localRepositoryId === verifier.localRepositoryId;
}

function denyMatchesAuthority(deny: DenyRecord, verifier: VerifierRecord, authority: RepositoryFamilyAuthority): boolean {
  return deny.lookupId === verifier.lookupId
    && deny.localRepositoryId === verifier.localRepositoryId
    && deny.worktreeDevice === authority.worktreeDevice
    && deny.worktreeInode === authority.worktreeInode;
}

function readTrustedVerifier(authority: RepositoryFamilyAuthority, pdHome: string): { record: VerifierRecord | null; reason: string } {
  const registryReason = verifierRegistryReason(pdHome);
  if (registryReason) return { record: null, reason: registryReason };
  const parsed = parseVerifier(repositoryFamilyVerifierPath(authority, pdHome));
  if (!parsed.record) return parsed;
  if (!verifierMatchesAuthority(parsed.record, authority)) return { record: null, reason: 'authority-binding-mismatch' };
  return parsed;
}

export type RepositoryFamilyReasonClass = 'allow' | 'boundary' | 'verifier' | 'marker' | 'deny';

/** Coarse class shared with the staged shell verifier's sanitized receipt. */
export function repositoryFamilyReasonClass(reason: string): RepositoryFamilyReasonClass {
  if (reason === 'armed') return 'allow';
  if (reason === 'worktree-denied' || reason.startsWith('deny-')) return 'deny';
  if (reason === 'not-armed' || reason.startsWith('marker-')) return 'marker';
  if (
    reason.startsWith('verifier-')
    || reason === 'authority-binding-mismatch'
    || reason === 'private-directory-invalid'
    || reason === 'private-directory-symlink'
  ) return 'verifier';
  return 'boundary';
}

export function inspectSquidRepositoryFamily(
  cwd: string,
  options: { pdHome?: string } = {},
): RepositoryFamilyInspection {
  const pdHome = options.pdHome ?? PD_HOME;
  const authority = resolveRepositoryFamilyAuthority(cwd);
  if (!authority) {
    return { armed: false, kind: null, projectRoot: null, localRepositoryId: null, reason: 'no-supported-project-authority', authority: null };
  }
  const verifier = readTrustedVerifier(authority, pdHome);
  if (!verifier.record) {
    return { armed: false, kind: authority.kind, projectRoot: authority.projectRoot, localRepositoryId: null, reason: verifier.reason, authority };
  }

  const denyParentReason = denyDirectoryReason(authority, pdHome);
  if (denyParentReason) {
    return {
      armed: false,
      kind: authority.kind,
      projectRoot: authority.projectRoot,
      localRepositoryId: verifier.record.localRepositoryId,
      reason: denyParentReason,
      authority,
    };
  }

  // A narrower verified-worktree deny is checked before the family allow
  // marker. The hook wrapper follows the same deny-before-allow order.
  const deny = parseDeny(repositoryFamilyDenyPath(authority, pdHome));
  if (deny.record && denyMatchesAuthority(deny.record, verifier.record, authority)) {
    return {
      armed: false,
      kind: authority.kind,
      projectRoot: authority.projectRoot,
      localRepositoryId: verifier.record.localRepositoryId,
      reason: 'worktree-denied',
      authority,
    };
  }
  if (deny.reason !== 'deny-missing' && !deny.record) {
    return {
      armed: false,
      kind: authority.kind,
      projectRoot: authority.projectRoot,
      localRepositoryId: verifier.record.localRepositoryId,
      reason: deny.reason,
      authority,
    };
  }

  const markerPath = repositoryFamilyMarkerPath(authority);
  const markerParent = dirname(markerPath);
  if (existsSync(markerParent) && !trustedMarkerParent(authority, false)) {
    return {
      armed: false,
      kind: authority.kind,
      projectRoot: authority.projectRoot,
      localRepositoryId: verifier.record.localRepositoryId,
      reason: 'marker-parent-invalid',
      authority,
    };
  }
  const marker = parseMarker(markerPath);
  if (!marker.record) {
    return {
      armed: false,
      kind: authority.kind,
      projectRoot: authority.projectRoot,
      localRepositoryId: verifier.record.localRepositoryId,
      reason: marker.reason,
      authority,
    };
  }
  if (!markerMatchesVerifier(marker.record, verifier.record)) {
    return {
      armed: false,
      kind: authority.kind,
      projectRoot: authority.projectRoot,
      localRepositoryId: verifier.record.localRepositoryId,
      reason: 'marker-verifier-mismatch',
      authority,
    };
  }
  return {
    armed: true,
    kind: authority.kind,
    projectRoot: authority.projectRoot,
    localRepositoryId: verifier.record.localRepositoryId,
    reason: 'armed',
    authority,
  };
}

function retireLegacyExactRootRegistry(pdHome: string): void {
  const squidRoot = join(pdHome, 'squid');
  const legacy = join(pdHome, 'squid', 'projects');
  try {
    // Legacy state is never authority and is removed only beneath an already
    // pinned, private, non-symlink state root. Unsafe ancestry is left inert.
    const rootIdentity = ensureOwnedDirectoryTree(squidRoot, {
      ownedFrom: pdHome,
      privateFrom: squidRoot,
      label: 'legacy-registry-parent',
    }, false);
    if (!rootIdentity) return;
    const stats = lstatSync(legacy);
    if (
      stats.isFile()
      && !stats.isSymbolicLink()
      && stats.nlink === 1
      && ownedByCurrentUser(legacy)
    ) {
      readMatchingDirectoryIdentity(rootIdentity, {
        ownedFrom: pdHome,
        privateFrom: squidRoot,
        label: 'legacy-registry-parent',
      });
      rmSync(legacy, { force: true });
      readMatchingDirectoryIdentity(rootIdentity, {
        ownedFrom: pdHome,
        privateFrom: squidRoot,
        label: 'legacy-registry-parent',
      });
    }
  } catch {
    // It is never consulted as an authority fallback.
  }
}

export function transactSquidRepositoryFamilyArm<T>(
  cwd: string,
  options: RepositoryFamilyMutationOptions,
  prepare: (pending: PendingRepositoryFamilyArm) => PreparedRepositoryFamilyArm<T>,
): { arm: RepositoryFamilyArmReceipt; value: T } {
  const pdHome = options.pdHome ?? PD_HOME;
  const authority = resolveRepositoryFamilyAuthority(cwd);
  if (!authority) {
    throw new RepositoryFamilyAuthorityError('No trustworthy local project boundary was found', 'no-supported-project-authority');
  }
  return withMutationLock(pdHome, () => {
    if (!trustedMarkerParent(authority, true, options.directoryFault)) {
      throw new RepositoryFamilyAuthorityError('Repository-family marker directory is not trustworthy', 'marker-parent-invalid');
    }
    const lookupId = repositoryFamilyAuthorityLookupId(authority);
    const verifierPath = repositoryFamilyVerifierPath(authority, pdHome);
    const markerPath = repositoryFamilyMarkerPath(authority);
    // Re-arm is also fail closed: remove the current allow before repairing any
    // shared registration. The callback must succeed before the marker returns.
    rmSync(markerPath, { force: true });
    const existingVerifier = parseVerifier(verifierPath);
    if (existingVerifier.record && !verifierMatchesAuthority(existingVerifier.record, authority)) {
      throw new RepositoryFamilyAuthorityError('Verifier conflicts with current repository authority', 'authority-binding-mismatch');
    }
    if (!existingVerifier.record && existingVerifier.reason !== 'verifier-missing') {
      throw new RepositoryFamilyAuthorityError('Verifier record is malformed or unsafe', existingVerifier.reason);
    }
    const localRepositoryId = existingVerifier.record?.localRepositoryId ?? randomUUID();
    const verifier: VerifierRecord = {
      kind: authority.kind,
      lookupId,
      localRepositoryId,
      device: authority.device,
      inode: authority.inode,
    };

    // Trust anchor first, allow marker last. A crash or injected interruption
    // between these commits leaves a verifier that is still inactive.
    atomicWrite0600(
      verifierPath,
      [RECORD_VERSION, verifier.kind, verifier.lookupId, verifier.localRepositoryId, verifier.device, verifier.inode].join('\t') + '\n',
    );
    options.fault?.('after-verifier-commit');
    const pending: PendingRepositoryFamilyArm = {
      authority,
      lookupId,
      localRepositoryId,
      verifierPath,
      markerPath,
    };
    const prepared = prepare(pending);
    let commitReadBack = false;
    try {
      options.fault?.('before-marker-commit');
      atomicWrite0600(markerPath, [RECORD_VERSION, lookupId, localRepositoryId].join('\t') + '\n');
      options.fault?.('after-marker-commit');
    } catch (error) {
      // A rename may have committed before a post-write error or process-level
      // interruption surfaced. Exact marker+verifier readback is the only
      // authority for treating that ambiguous completion as success.
      const markerReadBack = parseMarker(markerPath);
      const verifierReadBack = parseVerifier(verifierPath);
      const committed = !!markerReadBack.record
        && !!verifierReadBack.record
        && verifierMatchesAuthority(verifierReadBack.record, authority)
        && markerMatchesVerifier(markerReadBack.record, verifierReadBack.record)
        && verifierReadBack.record.localRepositoryId === localRepositoryId;
      if (committed) {
        commitReadBack = true;
      } else {
        // No allow survives a failed transaction. Callback compensation is
        // CAS-bound by its owner so concurrent user edits are never clobbered.
        try {
          if (trustedMarkerParent(authority, false)) rmSync(markerPath, { force: true });
        } catch {
          // The absent/invalid exact readback above already keeps activation off.
        }
        const rollbackFailures = prepared.rollback();
        if (rollbackFailures.length > 0) {
          throw new RepositoryFamilyAuthorityError(
            `Repository-family arm failed and callback rollback was incomplete: ${rollbackFailures.join('; ')}`,
            'arm-callback-rollback-incomplete',
          );
        }
        throw error;
      }
    }
    retireLegacyExactRootRegistry(pdHome);
    const arm: RepositoryFamilyArmReceipt = {
      armed: true,
      kind: authority.kind,
      projectRoot: authority.projectRoot,
      localRepositoryId,
      lookupId,
      authority,
      markerPath,
      verifierPath,
      commitReadBack,
    };
    return { arm, value: prepared.value };
  }, options.directoryFault);
}

export function armSquidRepositoryFamily(
  cwd: string,
  options: RepositoryFamilyMutationOptions = {},
): RepositoryFamilyArmReceipt {
  return transactSquidRepositoryFamilyArm(cwd, options, () => ({ value: undefined, rollback: () => [] })).arm;
}

export function denySquidWorktree(
  cwd: string,
  options: RepositoryFamilyMutationOptions = {},
): WorktreeDenyReceipt {
  const pdHome = options.pdHome ?? PD_HOME;
  const authority = resolveRepositoryFamilyAuthority(cwd);
  if (!authority) throw new RepositoryFamilyAuthorityError('No trustworthy worktree identity was found', 'no-supported-project-authority');
  return withMutationLock(pdHome, () => {
    const verifier = readTrustedVerifier(authority, pdHome);
    if (!verifier.record) throw new RepositoryFamilyAuthorityError('Repository family is not armed', verifier.reason);
    const marker = parseMarker(repositoryFamilyMarkerPath(authority));
    if (!marker.record || !markerMatchesVerifier(marker.record, verifier.record)) {
      throw new RepositoryFamilyAuthorityError('Repository family allow marker is missing or conflicts', marker.reason);
    }
    const path = repositoryFamilyDenyPath(authority, pdHome);
    ensurePrivateDirectory(dirname(path), pdHome, options.directoryFault);
    atomicWrite0600(path, [
      RECORD_VERSION,
      'deny',
      verifier.record.lookupId,
      verifier.record.localRepositoryId,
      authority.worktreeDevice,
      authority.worktreeInode,
    ].join('\t') + '\n');
    return {
      denied: true,
      localRepositoryId: verifier.record.localRepositoryId,
      lookupId: verifier.record.lookupId,
      denyPath: path,
    };
  }, options.directoryFault);
}

export function allowSquidWorktree(
  cwd: string,
  options: RepositoryFamilyMutationOptions = {},
): WorktreeAllowReceipt {
  const pdHome = options.pdHome ?? PD_HOME;
  const authority = resolveRepositoryFamilyAuthority(cwd);
  if (!authority) return { allowed: false, denyPath: null };
  return withMutationLock(pdHome, () => {
    const path = repositoryFamilyDenyPath(authority, pdHome);
    const denyParent = dirname(path);
    const denyReason = denyDirectoryReason(authority, pdHome);
    if (denyReason) throw new RepositoryFamilyAuthorityError('Deny directory is unsafe', denyReason);
    if (pathEntryExists(denyParent)) {
      ensureOwnedDirectoryTree(denyParent, {
        ownedFrom: pdHome,
        privateFrom: join(pdHome, 'squid'),
        label: 'deny-directory',
      }, false);
    }
    const existed = existsSync(path);
    rmSync(path, { force: true });
    return { allowed: existed, denyPath: path };
  }, options.directoryFault);
}

export function disarmSquidRepositoryFamily(
  cwd: string,
  options: RepositoryFamilyMutationOptions = {},
): RepositoryFamilyDisarmReceipt {
  const pdHome = options.pdHome ?? PD_HOME;
  const authority = resolveRepositoryFamilyAuthority(cwd);
  if (!authority) {
    return { revoked: false, kind: null, projectRoot: null, localRepositoryId: null, markerRemoved: false, verifierRemoved: false, deniesRemoved: false, reason: 'no-supported-project-authority' };
  }
  const markerPath = repositoryFamilyMarkerPath(authority);
  const markerParent = dirname(markerPath);
  if (existsSync(markerParent) && !trustedMarkerParent(authority, false)) {
    return {
      revoked: false,
      kind: authority.kind,
      projectRoot: authority.projectRoot,
      localRepositoryId: null,
      markerRemoved: false,
      verifierRemoved: false,
      deniesRemoved: false,
      reason: 'marker-parent-invalid',
    };
  }
  const marker = parseMarker(markerPath);
  const perform = (): RepositoryFamilyDisarmReceipt => {
    const verifierPath = repositoryFamilyVerifierPath(authority, pdHome);
    const verifier = parseVerifier(verifierPath);
    let verifierRemoved = false;
    try {
      // Revocation barrier first. A surviving marker or deny cannot reactivate.
      const existed = existsSync(verifierPath);
      rmSync(verifierPath, { force: true });
      verifierRemoved = existed;
    } catch {
      verifierRemoved = false;
    }
    options.fault?.('after-verifier-remove');
    let markerRemoved = false;
    try {
      const existed = existsSync(markerPath);
      rmSync(markerPath, { force: true });
      markerRemoved = existed;
    } catch {
      markerRemoved = false;
    }
    const denyFamilyDirectory = dirname(repositoryFamilyDenyPath(authority, pdHome));
    let deniesRemoved = false;
    try {
      if (!denyDirectoryReason(authority, pdHome)) {
        const identity = ensureOwnedDirectoryTree(denyFamilyDirectory, {
          ownedFrom: pdHome,
          privateFrom: join(pdHome, 'squid'),
          label: 'deny-directory',
        }, false);
        const existed = existsSync(denyFamilyDirectory);
        if (identity && existed) {
          rmSync(denyFamilyDirectory, { recursive: true, force: true });
          deniesRemoved = true;
        }
      }
    } catch {
      deniesRemoved = false;
    }
    retireLegacyExactRootRegistry(pdHome);
    return {
      revoked: verifierRemoved || markerRemoved,
      kind: authority.kind,
      projectRoot: authority.projectRoot,
      localRepositoryId: verifier.record?.localRepositoryId ?? marker.record?.localRepositoryId ?? null,
      markerRemoved,
      verifierRemoved,
      deniesRemoved,
      reason: verifierRemoved || markerRemoved || deniesRemoved ? 'revoked' : 'already-disarmed',
    };
  };

  const registryReason = verifierRegistryReason(pdHome);
  if (registryReason) {
    // An unsafe registry cannot be locked or traversed. Removing only the
    // verified common-directory marker still makes the family inactive.
    let markerRemoved = false;
    try {
      const existed = existsSync(markerPath);
      rmSync(markerPath, { force: true });
      markerRemoved = existed;
    } catch {
      markerRemoved = false;
    }
    return {
      revoked: markerRemoved,
      kind: authority.kind,
      projectRoot: authority.projectRoot,
      localRepositoryId: marker.record?.localRepositoryId ?? null,
      markerRemoved,
      verifierRemoved: false,
      deniesRemoved: false,
      reason: markerRemoved ? 'marker-revoked-unsafe-registry' : registryReason,
    };
  }
  return withMutationLock(pdHome, perform, options.directoryFault);
}

export function isSquidRepositoryFamilyArmed(cwd: string, pdHome = PD_HOME): boolean {
  return inspectSquidRepositoryFamily(cwd, { pdHome }).armed;
}

/**
 * Global provider registrations may be removed only after every family
 * verifier is gone. Verifiers intentionally carry no path authority, so this
 * function refuses instead of guessing where an unrelated family's marker is.
 */
export function assertAllSquidRepositoryFamiliesDisarmed(pdHome = PD_HOME): void {
  const registry = repositoryFamilyVerifierDirectory(pdHome);
  if (!pathEntryExists(registry)) return;
  const registryReason = verifierRegistryReason(pdHome);
  if (registryReason) {
    throw new RepositoryFamilyAuthorityError('Repository-family registry is unsafe', registryReason);
  }
  let entries: string[];
  try {
    entries = readdirSync(registry);
  } catch (error) {
    throw new RepositoryFamilyAuthorityError(
      `Repository-family registry cannot be enumerated: ${(error as Error).message}`,
      'repository-family-registry-unreadable',
    );
  }
  for (const entry of entries) {
    if (entry === 'denies') continue;
    if (entry === '.mutation.lock') {
      throw new RepositoryFamilyAuthorityError('Repository-family mutation is active', 'mutation-lock-busy');
    }
    if (!/^(?:git|root)-[1-9][0-9]*-[1-9][0-9]*\.v1$/.test(entry)) {
      throw new RepositoryFamilyAuthorityError('Repository-family registry contains an ambiguous entry', 'repository-family-registry-ambiguous');
    }
    const parsed = parseVerifier(join(registry, entry));
    if (!parsed.record || `${parsed.record.lookupId}.v1` !== entry) {
      throw new RepositoryFamilyAuthorityError('Repository-family verifier is malformed or mismatched', parsed.reason);
    }
    throw new RepositoryFamilyAuthorityError(
      `Repository family ${parsed.record.lookupId} must be disarmed before global hook removal`,
      'repository-families-still-armed',
    );
  }
}

const MAX_WORKTREE_LIST_BYTES = 1024 * 1024;
const MAX_WORKTREE_COUNT = 4_096;

interface WorktreeGitInvocation {
  gitPath: string;
  args: string[];
  timeoutMs: number;
  maxBuffer: number;
  env: NodeJS.ProcessEnv;
}

export interface ListRepositoryFamilyWorktreesOptions {
  /** Test seam only. Production always invokes the resolved absolute Git. */
  runGit?: (invocation: WorktreeGitInvocation) => string;
}

function trustedGitExecutable(): string {
  for (const candidate of ['/usr/bin/git', '/bin/git']) {
    try {
      accessSync(candidate, fsConstants.X_OK);
      return candidate;
    } catch {
      // Try the next system-owned absolute location.
    }
  }
  throw new RepositoryFamilyAuthorityError('No trusted absolute Git executable is available', 'trusted-git-unavailable');
}

function verifiedFamilyRootsFromAdmin(authority: RepositoryFamilyAuthority): string[] {
  const mainRoot = dirname(authority.authorityRoot);
  const verifiedMain = resolveRepositoryFamilyAuthority(mainRoot);
  if (
    basename(authority.authorityRoot) !== '.git'
    || verifiedMain?.kind !== 'git'
    || verifiedMain.device !== authority.device
    || verifiedMain.inode !== authority.inode
  ) {
    throw new RepositoryFamilyAuthorityError(
      'Repository-family main worktree cannot be verified from its common directory',
      'worktree-enumeration-unverified',
    );
  }

  const roots = [verifiedMain.projectRoot];
  const adminParentPath = join(authority.authorityRoot, 'worktrees');
  try {
    lstatSync(adminParentPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return roots;
    throw new RepositoryFamilyAuthorityError(
      'Repository-family worktree admin directory cannot be inspected',
      'worktree-enumeration-unverified',
    );
  }
  const adminParent = ownedDirectory(adminParentPath);
  if (!adminParent) {
    throw new RepositoryFamilyAuthorityError(
      'Repository-family worktree admin directory is unsafe',
      'worktree-enumeration-unverified',
    );
  }

  let entries: string[];
  try {
    entries = readdirSync(adminParent.path);
  } catch {
    throw new RepositoryFamilyAuthorityError(
      'Repository-family worktree admin directory cannot be enumerated',
      'worktree-enumeration-unverified',
    );
  }
  if (entries.length > MAX_WORKTREE_COUNT - 1) {
    throw new RepositoryFamilyAuthorityError(
      'Repository-family worktree admin directory exceeds the bounded count',
      'worktree-enumeration-malformed',
    );
  }
  for (const entry of entries) {
    if (!entry || entry === '.' || entry === '..' || entry.includes('/') || entry.includes('\0')) {
      throw new RepositoryFamilyAuthorityError(
        'Repository-family worktree admin entry is malformed',
        'worktree-enumeration-unverified',
      );
    }
    const adminPath = join(adminParent.path, entry);
    const admin = ownedDirectory(adminPath);
    const backpointer = admin ? strictRegularSingleLine(join(admin.path, 'gitdir')) : null;
    if (!admin || !backpointer || !isAbsolute(backpointer) || basename(backpointer) !== '.git') {
      throw new RepositoryFamilyAuthorityError(
        'Repository-family worktree admin entry is stale or malformed',
        'worktree-enumeration-unverified',
      );
    }
    const candidate = resolveRepositoryFamilyAuthority(dirname(resolve(backpointer)));
    if (
      candidate?.kind !== 'git'
      || candidate.device !== authority.device
      || candidate.inode !== authority.inode
      || candidate.worktreeDevice !== admin.device
      || candidate.worktreeInode !== admin.inode
    ) {
      throw new RepositoryFamilyAuthorityError(
        'Repository-family worktree admin entry does not resolve to this family',
        'worktree-enumeration-unverified',
      );
    }
    roots.push(candidate.projectRoot);
  }
  return [...new Set(roots)].sort();
}

/** Mutation/status time only. The generated hook gate never invokes Git. */
export function listVerifiedRepositoryFamilyWorktrees(
  cwd: string,
  options: ListRepositoryFamilyWorktreesOptions = {},
): string[] {
  const authority = resolveRepositoryFamilyAuthority(cwd);
  if (!authority || authority.kind !== 'git') return authority ? [authority.projectRoot] : [];
  const invocation: WorktreeGitInvocation = {
    gitPath: trustedGitExecutable(),
    args: ['-C', authority.projectRoot, 'worktree', 'list', '--porcelain'],
    timeoutMs: 5_000,
    maxBuffer: MAX_WORKTREE_LIST_BYTES,
    env: {
      PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
      LC_ALL: 'C',
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_TERMINAL_PROMPT: '0',
    },
  };
  let output: string;
  try {
    output = options.runGit
      ? options.runGit(invocation)
      : execFileSync(invocation.gitPath, invocation.args, {
        encoding: 'utf8',
        timeout: invocation.timeoutMs,
        maxBuffer: invocation.maxBuffer,
        env: invocation.env,
      });
  } catch (error) {
    throw new RepositoryFamilyAuthorityError(
      `Git worktree enumeration failed closed: ${(error as Error).message}`,
      'worktree-enumeration-failed',
    );
  }
  if (
    Buffer.byteLength(output) <= 0
    || Buffer.byteLength(output) > MAX_WORKTREE_LIST_BYTES
    || output.includes('\0')
  ) {
    throw new RepositoryFamilyAuthorityError('Git worktree enumeration was empty or oversized', 'worktree-enumeration-malformed');
  }
  const records = output.trimEnd().split('\n\n');
  if (records.length === 0 || records.length > MAX_WORKTREE_COUNT) {
    throw new RepositoryFamilyAuthorityError('Git worktree enumeration count is invalid', 'worktree-enumeration-malformed');
  }
  const roots: string[] = [];
  for (const record of records) {
    const first = record.split('\n')[0] ?? '';
    if (!first.startsWith('worktree /')) {
      throw new RepositoryFamilyAuthorityError('Git worktree record lacks an absolute root', 'worktree-enumeration-malformed');
    }
    const root = first.slice('worktree '.length);
    const candidate = resolveRepositoryFamilyAuthority(root);
    if (
      candidate?.kind !== 'git'
      || candidate.device !== authority.device
      || candidate.inode !== authority.inode
    ) {
      throw new RepositoryFamilyAuthorityError('Git listed an unverified or stale family worktree', 'worktree-enumeration-unverified');
    }
    roots.push(candidate.projectRoot);
  }
  const unique = [...new Set(roots)].sort();
  const expected = verifiedFamilyRootsFromAdmin(authority);
  if (
    unique.length !== roots.length
    || unique.length !== expected.length
    || unique.some((root, index) => root !== expected[index])
  ) {
    throw new RepositoryFamilyAuthorityError('Git worktree enumeration is duplicate or incomplete', 'worktree-enumeration-incomplete');
  }
  return unique;
}
