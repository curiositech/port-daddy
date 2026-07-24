import { createHash } from 'node:crypto';
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
  realpathSync,
  statSync,
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
import type { HandoffCapsuleV0 } from './handoff-capsule.js';
import {
  isNativeSessionAdapterFamily,
  normalizeNativeHarnessSessionId,
} from './harness-session-id.js';
import {
  captureWorkspaceIdentity,
  sameWorkspaceIdentity,
  type WorkspaceIdentity,
} from './workspace-identity.js';

export const NATIVE_SESSION_WITNESS_SCHEMA = 'pd.agent-harbor.native-session-witness.v0' as const;

export type NativeSessionWitnessMethod =
  | 'claude-jsonl-session-id'
  | 'codex-session-meta'
  | 'agy-brain-transcript'
  | 'gemini-project-chat';

export interface NativeSessionWitness {
  schema: typeof NATIVE_SESSION_WITNESS_SCHEMA;
  adapterFamily: string;
  method: NativeSessionWitnessMethod;
  sessionIdHash: string;
  evidenceHash: string;
  workspaceHash: string;
  witnessedAt: number;
}

export interface NativeSessionWitnessResult {
  verified: boolean;
  witness: NativeSessionWitness | null;
  reason: string | null;
  canonicalWorkspace: string | null;
  workspaceIdentity: WorkspaceIdentity | null;
}

export interface NativeSessionWitnessOptions {
  home?: string;
  now?: () => number;
}

interface CanonicalWorkspace {
  path: string;
  fingerprint: string;
  identity: WorkspaceIdentity;
}

interface OpenEvidenceFile {
  descriptor: number;
  path: string;
  size: number;
  fingerprint: string;
}

interface NativeEvidence {
  method: NativeSessionWitnessMethod;
  fingerprint: string;
}

const MAX_JSONL_PREFIX_BYTES = 1024 * 1024;
const MAX_TRANSCRIPT_FILE_BYTES = 256 * 1024 * 1024;
const MAX_GEMINI_CHAT_BYTES = 128 * 1024 * 1024;
const MAX_METADATA_BYTES = 4 * 1024 * 1024;
const MAX_METADATA_ENTRIES = 4_096;

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function fail(reason: string): NativeSessionWitnessResult {
  return {
    verified: false,
    witness: null,
    reason,
    canonicalWorkspace: null,
    workspaceIdentity: null,
  };
}

function workspacePath(capsule: HandoffCapsuleV0): string | null {
  return capsule.workspace.cwd ?? capsule.workspace.repoRoot ?? capsule.identity.projectDir;
}

function canonicalizeWorkspace(value: unknown): CanonicalWorkspace | null {
  const identity = captureWorkspaceIdentity(value);
  if (!identity) return null;
  return {
    path: identity.canonicalPath,
    fingerprint: `${identity.canonicalPath}\0${identity.device}:${identity.inode}`,
    identity,
  };
}

function capsuleWorkspace(capsule: HandoffCapsuleV0): CanonicalWorkspace | null {
  return canonicalizeWorkspace(workspacePath(capsule));
}

function sameWorkspace(value: unknown, expected: CanonicalWorkspace): boolean {
  return sameWorkspaceIdentity(value, expected.identity);
}

function within(root: string, candidate: string): boolean {
  const suffix = relative(root, candidate);
  return suffix !== ''
    && suffix !== '..'
    && !suffix.startsWith(`..${sep}`)
    && !isAbsolute(suffix);
}

function withEvidenceFile<T>(
  candidate: string,
  root: string,
  maxFileBytes: number,
  read: (file: OpenEvidenceFile) => T,
): T | null {
  let descriptor: number | null = null;
  try {
    if (!isAbsolute(candidate)) return null;
    const linkStats = lstatSync(candidate);
    if (linkStats.isSymbolicLink() || !linkStats.isFile()) return null;
    const realRoot = realpathSync(root);
    const realPath = realpathSync(candidate);
    if (!within(realRoot, realPath)) return null;
    const beforeOpen = statSync(realPath);
    if (!beforeOpen.isFile() || beforeOpen.size > maxFileBytes) return null;
    const noFollow = typeof constants.O_NOFOLLOW === 'number' ? constants.O_NOFOLLOW : 0;
    descriptor = openSync(realPath, constants.O_RDONLY | noFollow);
    const opened = fstatSync(descriptor);
    if (
      !opened.isFile()
      || opened.dev !== beforeOpen.dev
      || opened.ino !== beforeOpen.ino
      || opened.size > maxFileBytes
      || (typeof process.getuid === 'function' && opened.uid !== process.getuid())
    ) {
      return null;
    }
    return read({
      descriptor,
      path: realPath,
      size: opened.size,
      fingerprint: `${realPath}\0${opened.dev}:${opened.ino}`,
    });
  } catch {
    return null;
  } finally {
    if (descriptor !== null) closeSync(descriptor);
  }
}

function readPrefix(file: OpenEvidenceFile, maxBytes: number): string {
  const length = Math.min(file.size, maxBytes);
  const buffer = Buffer.allocUnsafe(length);
  const bytesRead = readSync(file.descriptor, buffer, 0, length, 0);
  return buffer.subarray(0, bytesRead).toString('utf8');
}

function inspectJsonl(
  candidate: string,
  root: string,
  predicate: (value: Record<string, unknown>) => boolean,
): string | null {
  return withEvidenceFile(candidate, root, MAX_TRANSCRIPT_FILE_BYTES, (file) => {
    for (const line of readPrefix(file, MAX_JSONL_PREFIX_BYTES).split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        const value = JSON.parse(line) as unknown;
        if (value && typeof value === 'object' && !Array.isArray(value) && predicate(value as Record<string, unknown>)) {
          return file.fingerprint;
        }
      } catch {
        continue;
      }
    }
    return null;
  });
}

function transcriptRef(capsule: HandoffCapsuleV0): string | null {
  return capsule.source.transcriptRef && isAbsolute(capsule.source.transcriptRef)
    ? capsule.source.transcriptRef
    : null;
}

function sessionIdMatches(value: unknown, expected: string): boolean {
  return typeof value === 'string' && value.toLowerCase() === expected;
}

function claudeEvidence(
  capsule: HandoffCapsuleV0,
  home: string,
  workspace: CanonicalWorkspace,
  sessionId: string,
): NativeEvidence | null {
  const candidate = transcriptRef(capsule);
  if (!candidate) return null;
  const root = join(home, '.claude', 'projects');
  if (basename(candidate).toLowerCase() !== `${sessionId}.jsonl`) return null;
  const fingerprint = inspectJsonl(candidate, root, (value) => (
    sessionIdMatches(value.sessionId, sessionId)
    && sameWorkspace(value.cwd, workspace)
  ));
  return fingerprint ? { method: 'claude-jsonl-session-id', fingerprint } : null;
}

function codexEvidence(
  capsule: HandoffCapsuleV0,
  home: string,
  workspace: CanonicalWorkspace,
  sessionId: string,
): NativeEvidence | null {
  const candidate = transcriptRef(capsule);
  if (!candidate) return null;
  const root = join(home, '.codex', 'sessions');
  if (!basename(candidate).toLowerCase().endsWith(`-${sessionId}.jsonl`)) return null;
  const fingerprint = inspectJsonl(candidate, root, (value) => {
    if (value.type !== 'session_meta') return false;
    const payload = value.payload;
    return Boolean(payload && typeof payload === 'object' && !Array.isArray(payload)
      && sessionIdMatches((payload as Record<string, unknown>).id, sessionId)
      && sameWorkspace((payload as Record<string, unknown>).cwd, workspace));
  });
  return fingerprint ? { method: 'codex-session-meta', fingerprint } : null;
}

function readJsonMap(
  candidate: string,
  root: string,
  nestedKey?: string,
): { values: Record<string, string>; fingerprint: string } | null {
  return withEvidenceFile(candidate, root, MAX_METADATA_BYTES, (file) => {
    try {
      const parsed = JSON.parse(readPrefix(file, MAX_METADATA_BYTES)) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
      const source = nestedKey ? (parsed as Record<string, unknown>)[nestedKey] : parsed;
      if (!source || typeof source !== 'object' || Array.isArray(source)) return null;
      const entries = Object.entries(source as Record<string, unknown>);
      if (entries.length > MAX_METADATA_ENTRIES) return null;
      const values = Object.fromEntries(
        entries.filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
      );
      return { values, fingerprint: file.fingerprint };
    } catch {
      return null;
    }
  });
}

function agyWorkspaceBinding(
  home: string,
  workspace: CanonicalWorkspace,
  sessionId: string,
): string | null {
  const cacheRoot = join(home, '.gemini', 'antigravity-cli', 'cache');
  const cache = readJsonMap(join(cacheRoot, 'last_conversations.json'), cacheRoot);
  if (!cache) return null;
  const match = Object.entries(cache.values).find(([registeredWorkspace, conversationId]) => (
    sessionIdMatches(conversationId, sessionId)
    && sameWorkspace(registeredWorkspace, workspace)
  ));
  return match
    ? `${cache.fingerprint}\0${sha256(`${match[0]}\0${sessionId}`)}`
    : null;
}

function agyEvidence(
  capsule: HandoffCapsuleV0,
  home: string,
  workspace: CanonicalWorkspace,
  sessionId: string,
): NativeEvidence | null {
  const root = join(home, '.gemini', 'antigravity-cli', 'brain');
  const expected = join(root, sessionId, '.system_generated', 'logs', 'transcript.jsonl');
  const supplied = transcriptRef(capsule);
  if (supplied && resolve(supplied) !== resolve(expected)) return null;
  const binding = agyWorkspaceBinding(home, workspace, sessionId);
  if (!binding) return null;
  const fingerprint = inspectJsonl(expected, root, (value) => Object.keys(value).length > 0);
  return fingerprint
    ? { method: 'agy-brain-transcript', fingerprint: `${fingerprint}\0${binding}` }
    : null;
}

function readGeminiHeader(file: OpenEvidenceFile): { sessionId: string; projectHash: string } | null {
  try {
    const prefix = readPrefix(file, 256 * 1024);
    const messagesAt = prefix.indexOf('"messages"');
    const header = messagesAt >= 0 ? prefix.slice(0, messagesAt) : prefix;
    const stringField = (field: string): string | null => {
      const match = header.match(new RegExp(`"${field}"\\s*:\\s*("(?:[^"\\\\]|\\\\.)*")`));
      if (!match) return null;
      const value = JSON.parse(match[1]) as unknown;
      return typeof value === 'string' ? value : null;
    };
    const sessionId = stringField('sessionId');
    const projectHash = stringField('projectHash');
    return sessionId && projectHash ? { sessionId, projectHash } : null;
  } catch {
    return null;
  }
}

function geminiEvidence(
  capsule: HandoffCapsuleV0,
  home: string,
  workspace: CanonicalWorkspace,
  sessionId: string,
): NativeEvidence | null {
  const geminiRoot = join(home, '.gemini');
  const projects = readJsonMap(join(geminiRoot, 'projects.json'), geminiRoot, 'projects');
  if (!projects) return null;
  const registration = Object.entries(projects.values).find(([registeredWorkspace]) => (
    sameWorkspace(registeredWorkspace, workspace)
  ));
  if (!registration) return null;
  const [registeredWorkspace, projectId] = registration;
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(projectId) || projectId === '..') return null;

  const candidate = transcriptRef(capsule);
  if (!candidate) return null;
  const chatsRoot = join(geminiRoot, 'tmp', projectId, 'chats');
  const inspected = withEvidenceFile(candidate, chatsRoot, MAX_GEMINI_CHAT_BYTES, (file) => ({
    header: readGeminiHeader(file),
    fingerprint: file.fingerprint,
    path: file.path,
  }));
  if (!inspected || dirname(inspected.path) !== realpathSync(chatsRoot)) return null;
  if (!inspected.header || !sessionIdMatches(inspected.header.sessionId, sessionId)) return null;
  if (inspected.header.projectHash !== sha256(registeredWorkspace)) return null;
  return {
    method: 'gemini-project-chat',
    fingerprint: `${inspected.fingerprint}\0${projects.fingerprint}\0${sha256(registeredWorkspace)}`,
  };
}

function evidenceFor(
  capsule: HandoffCapsuleV0,
  adapterFamily: string,
  home: string,
  workspace: CanonicalWorkspace,
  sessionId: string,
): NativeEvidence | null {
  if (adapterFamily === 'claude-code') return claudeEvidence(capsule, home, workspace, sessionId);
  if (adapterFamily === 'codex-cli') return codexEvidence(capsule, home, workspace, sessionId);
  if (adapterFamily === 'agy-cli') return agyEvidence(capsule, home, workspace, sessionId);
  if (adapterFamily === 'gemini-cli') return geminiEvidence(capsule, home, workspace, sessionId);
  return null;
}

export function captureNativeSessionWitness(
  capsule: HandoffCapsuleV0,
  adapterFamily: string,
  options: NativeSessionWitnessOptions = {},
): NativeSessionWitnessResult {
  if (!isNativeSessionAdapterFamily(adapterFamily)) {
    return fail(`adapter ${adapterFamily} does not expose daemon-witnessed native resume`);
  }
  let sessionId: string;
  try {
    sessionId = normalizeNativeHarnessSessionId(adapterFamily, capsule.source.sessionId);
  } catch (error) {
    return fail(error instanceof Error ? error.message : 'native session ID is invalid');
  }
  const home = options.home ?? homedir();
  const workspace = capsuleWorkspace(capsule);
  if (!workspace) return fail('source workspace is unavailable for native resume');
  const evidence = evidenceFor(capsule, adapterFamily, home, workspace, sessionId);
  if (!evidence) return fail('daemon could not bind the claimed native session to this workspace in local harness storage');
  return {
    verified: true,
    witness: {
      schema: NATIVE_SESSION_WITNESS_SCHEMA,
      adapterFamily,
      method: evidence.method,
      sessionIdHash: sha256(sessionId),
      evidenceHash: sha256(evidence.fingerprint),
      workspaceHash: sha256(workspace.fingerprint),
      witnessedAt: (options.now ?? Date.now)(),
    },
    reason: null,
    canonicalWorkspace: workspace.path,
    workspaceIdentity: workspace.identity,
  };
}

function witnessRecord(value: unknown): NativeSessionWitness | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (
    record.schema !== NATIVE_SESSION_WITNESS_SCHEMA
    || typeof record.adapterFamily !== 'string'
    || ![
      'claude-jsonl-session-id',
      'codex-session-meta',
      'agy-brain-transcript',
      'gemini-project-chat',
    ].includes(String(record.method))
    || typeof record.sessionIdHash !== 'string'
    || typeof record.evidenceHash !== 'string'
    || typeof record.workspaceHash !== 'string'
    || typeof record.witnessedAt !== 'number'
  ) {
    return null;
  }
  return record as unknown as NativeSessionWitness;
}

export function verifyNativeSessionWitness(
  capsule: HandoffCapsuleV0,
  adapterFamily: string,
  storedWitness: unknown,
  options: NativeSessionWitnessOptions = {},
): NativeSessionWitnessResult {
  const witness = witnessRecord(storedWitness);
  if (!witness) return fail('handoff has no valid daemon-witnessed native session evidence');
  const current = captureNativeSessionWitness(capsule, adapterFamily, options);
  if (!current.verified || !current.witness) return current;
  if (
    witness.adapterFamily !== current.witness.adapterFamily
    || witness.method !== current.witness.method
    || witness.sessionIdHash !== current.witness.sessionIdHash
    || witness.evidenceHash !== current.witness.evidenceHash
    || witness.workspaceHash !== current.witness.workspaceHash
  ) {
    return fail('daemon-witnessed native session evidence no longer matches the handoff');
  }
  return {
    verified: true,
    witness,
    reason: null,
    canonicalWorkspace: current.canonicalWorkspace,
    workspaceIdentity: current.workspaceIdentity,
  };
}
