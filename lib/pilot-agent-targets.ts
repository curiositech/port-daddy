import * as nativeFs from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

/** Local installation provenance, not an actor grant or a same-user sandbox. */
export interface PilotTargetSource {
  agentSha256: string;
  configSha256: string;
}
export interface PilotTargetDefinition {
  runtime: string;
  path: string;
  content: string;
  cleanup?: string[];
}
export interface PilotTargetError { runtime: string; path: string; error: string; code?: string }
type Identity = { dev: number; ino: number; mode: number; uid: number };
type Observation = { kind: 'absent' } | (Identity & {
  kind: 'file' | 'directory' | 'symlink' | 'other';
  size: number; mtimeMs: number; sha256?: string;
});
type Parent = { path: string; identity: Identity | null };
type Owner = { run: string; index: number; sha256: string };
type Entry = {
  runtime: string; path: string; stale: boolean;
  action: 'create' | 'replace' | 'remove' | 'unchanged' | 'preserve';
  before: Observation; parents: Parent[]; content: string | null; owner?: Owner;
};
export interface PilotTargetPlan {
  version: 1; baseDir: string; id: string; source: PilotTargetSource;
  operation: 'install' | 'uninstall'; root: Identity; pointer: Observation;
  entries: Entry[]; errors: PilotTargetError[]; digest: string;
}
export interface PilotTargetResult {
  written: Array<{ runtime: string; path: string; changed: boolean }>;
  cleaned: Array<{ runtime: string; path: string; changed: boolean }>;
  errors: PilotTargetError[];
  outcome: 'preview' | 'complete' | 'unchanged' | 'blocked' | 'partial' | 'recovered';
  plan?: PilotTargetPlan;
  recovery?: { runId: string; directory: string };
}
type Input = {
  baseDir: string; id: string; source: PilotTargetSource;
  targets: PilotTargetDefinition[]; operation?: 'install' | 'uninstall';
};
type Journal = {
  version: 1; run: string; plan: PilotTargetPlan;
  beforePointer: string | null; backups: Array<string | null>;
};
type Receipt = { version: 1; id: string; baseDir: string; entries: Record<string, Owner> };
const SHA = /^[a-f0-9]{64}$/;
const RUN = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const MAX_FILE = 256 * 1024;
const MAX_RECORD = 8 * 1024 * 1024;

/**
 * Design: create a filesystem executor whose injected adapter tests real I/O
 * boundaries without inventing a second implementation or touching live targets.
 * @param fs Native filesystem operations, or an instrumented fixture adapter.
 * @returns Shared preview/apply/recover operations with installation-local evidence.
 */
export function createPilotTargetExecutor(fs: typeof nativeFs = nativeFs) {
  /** The design hashes exact bytes, not display strings. @param value Bytes. @returns SHA-256. */
  function hash(value: string | Buffer): string {
    return createHash('sha256').update(value).digest('hex');
  }
  /** The purpose is deterministic structural comparison. @param value Data. @returns JSON bytes. */
  function json(value: unknown): string { return JSON.stringify(value); }
  /** Design: preserve native failure classification without exposing arbitrary error text. @param e Error. @returns Code. */
  function code(e: unknown): string { return String((e as NodeJS.ErrnoException)?.code ?? 'TARGET_IO_FAILED'); }
  /** The purpose of typed refusal is to distinguish unavailable evidence from absence. @param message Fixed message. @returns Never. */
  function refuse(message: string): never { throw Object.assign(new Error(message), { code: message }); }
  /** The design ignores directory mtime, which our own children change. @param st Metadata. @returns Identity. */
  function identity(st: nativeFs.Stats): Identity {
    return { dev: st.dev, ino: st.ino, mode: st.mode & 0o777, uid: st.uid };
  }
  /** The purpose is exact same-object evidence. @param a First value. @param b Second value. @returns Equality. */
  function equal(a: unknown, b: unknown): boolean { return json(a) === json(b); }
  /** Design: bound every derived path to the selected root. @param base Root. @param path Absolute path. @returns Relative path. */
  function local(base: string, path: string): string {
    const rel = relative(base, resolve(path));
    if (!rel || isAbsolute(rel) || rel === '..' || rel.startsWith('..' + sep)) refuse('TARGET_OUTSIDE_ROOT');
    return rel.split(sep).join('/');
  }
  /** Design: reject receipt path tricks before opening anything. @param base Root. @param rel Stored path. @returns Absolute path. */
  function absolute(base: string, rel: string): string {
    if (typeof rel !== 'string' || rel.includes('\\') || rel.split('/').some(p => !p || p === '.' || p === '..')) {
      refuse('INVALID_TARGET_PATH');
    }
    const path = join(base, rel);
    if (local(base, path) !== rel) refuse('INVALID_TARGET_PATH');
    return path;
  }
  /** Only genuine absence is benign by design. @param path Path. @returns Metadata or null. */
  function stat(path: string): nativeFs.Stats | null {
    try { return fs.lstatSync(path); } catch (e) { if (code(e) === 'ENOENT') return null; throw e; }
  }
  /** Design: refuse symbolic parent redirection rather than reading through it. @param base Root. @param path Leaf. @returns Parent witnesses. */
  function parents(base: string, path: string): Parent[] {
    const rel = local(base, path);
    const result: Parent[] = [];
    let current = base;
    for (const part of rel.split('/').slice(0, -1)) {
      current = join(current, part);
      const st = stat(current);
      if (st && (!st.isDirectory() || st.isSymbolicLink())) refuse('UNSAFE_TARGET_PARENT');
      result.push({ path: local(base, current), identity: st ? identity(st) : null });
    }
    return result;
  }
  /**
   * Design: bound reads before allocation and use nonblocking, no-follow acquisition.
   * Rechecking fd and pathname catches ordinary startup/write races; this is not
   * a guarantee against a malicious process with the same filesystem authority.
   * @param path Regular file. @param limit Byte limit. @param privateFile Require private metadata.
   * @param links Exact permitted link count for ordinary or witnessed interrupted publication.
   * @returns Exact bytes and stable metadata.
   */
  function read(path: string, limit = MAX_FILE, privateFile = false, links = 1): { bytes: Buffer; st: nativeFs.Stats } {
    if (fs.realpathSync(dirname(path)) !== dirname(path)) refuse('UNSAFE_TARGET_PARENT');
    const before = fs.lstatSync(path);
    if (!before.isFile() || before.nlink !== links || before.size > limit) refuse('UNSAFE_TARGET_FILE');
    if (privateFile && ((before.mode & 0o077) !== 0 || before.uid !== process.getuid?.())) refuse('UNSAFE_INSTALL_RECORD');
    const fd = fs.openSync(path, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
    try {
      const opened = fs.fstatSync(fd);
      if (!opened.isFile() || opened.nlink !== links || !equal(identity(before), identity(opened))
        || opened.size !== before.size || opened.size > limit) refuse('TARGET_CHANGED');
      const bytes = Buffer.alloc(opened.size + 1);
      let count = 0;
      while (count < bytes.length) {
        const n = fs.readSync(fd, bytes, count, bytes.length - count, count);
        if (!n) break;
        count += n;
      }
      const after = fs.fstatSync(fd);
      const named = fs.lstatSync(path);
      if (count !== opened.size || after.size !== opened.size || after.mtimeMs !== opened.mtimeMs
        || !equal(identity(after), identity(named)) || named.nlink !== links) refuse('TARGET_CHANGED');
      return { bytes: bytes.subarray(0, count), st: after };
    } finally { fs.closeSync(fd); }
  }
  /** Design: capture a leaf without treating broken links as absence. @param path Path. @param limit Byte limit. @param links Exact permitted link count. @returns Stable observation. */
  function observe(path: string, limit = MAX_FILE, links = 1): Observation {
    const st = stat(path);
    if (!st) return { kind: 'absent' };
    const base = { ...identity(st), size: st.size, mtimeMs: st.mtimeMs };
    if (st.isSymbolicLink()) return { ...base, kind: 'symlink' };
    if (st.isDirectory()) return { ...base, kind: 'directory' };
    if (!st.isFile()) return { ...base, kind: 'other' };
    const found = read(path, limit, false, links);
    return { ...identity(found.st), size: found.st.size, mtimeMs: found.st.mtimeMs, kind: 'file', sha256: hash(found.bytes) };
  }
  /** The purpose is private, scoped installation bookkeeping. @param base Root. @param id Pilot ID. @returns State directory. */
  function statePath(base: string, id: string): string { return join(base, '.port-daddy', 'pilot-installations', id); }
  /** Design: validate stored records before using their fields. @param path Record. @returns Parsed object. */
  function record<T>(path: string): T {
    try { return JSON.parse(read(path, MAX_RECORD, true).bytes.toString('utf8')) as T; }
    catch (e) { if (code(e) === 'ENOENT') throw e; refuse('INVALID_INSTALL_RECORD'); }
  }
  /** The design requires private, physical state directories. @param base Root. @param state Directory. @returns Nothing. */
  function checkState(base: string, state: string): void {
    parents(base, join(state, 'current.json'));
    const st = stat(state);
    if (st && (!st.isDirectory() || (st.mode & 0o077) !== 0 || st.uid !== process.getuid?.())) refuse('UNSAFE_INSTALL_RECORD');
  }
  /**
   * Design: verify ownership against an immutable installer journal. Matching
   * new output alone never creates an entry. These records are local provenance,
   * not a cryptographic defense against another same-UID process.
   * @param base Root. @param id Pilot ID. @returns Prior verified ownership entries.
   */
  function owners(base: string, id: string): Record<string, Owner> {
    const state = statePath(base, id);
    checkState(base, state);
    const pointerPath = join(state, 'current.json');
    if (!stat(pointerPath)) return {};
    const pointer = record<{ version: number; run: string; sha256: string }>(pointerPath);
    if (pointer.version !== 1 || !RUN.test(pointer.run) || !SHA.test(pointer.sha256)) refuse('INVALID_INSTALL_RECORD');
    const receiptPath = join(state, 'runs', pointer.run, 'receipt.json');
    parents(base, receiptPath);
    const raw = read(receiptPath, MAX_RECORD, true).bytes;
    if (hash(raw) !== pointer.sha256) refuse('INVALID_INSTALL_RECORD');
    let receipt: Receipt;
    try { receipt = JSON.parse(raw.toString('utf8')) as Receipt; }
    catch { refuse('INVALID_INSTALL_RECORD'); }
    if (receipt.version !== 1 || receipt.id !== id || receipt.baseDir !== base
      || !receipt.entries || typeof receipt.entries !== 'object' || Array.isArray(receipt.entries)
      || Object.keys(receipt.entries).length > 16) refuse('INVALID_INSTALL_RECORD');
    for (const [path, owner] of Object.entries(receipt.entries)) {
      absolute(base, path);
      if (!owner || !RUN.test(owner.run) || !Number.isInteger(owner.index) || !SHA.test(owner.sha256)) refuse('INVALID_INSTALL_RECORD');
      const journalPath = join(state, 'runs', owner.run, 'journal.json');
      parents(base, journalPath);
      const journal = record<Journal>(journalPath);
      const e = journal.plan?.entries?.[owner.index];
      if (journal.version !== 1 || journal.run !== owner.run || journal.plan.id !== id || journal.plan.baseDir !== base
        || !validSource(journal.plan.source) || !validDigest(journal.plan)
        || !e || e.path !== path || typeof e.content !== 'string' || hash(e.content) !== owner.sha256
        || !['create', 'replace'].includes(e.action)) refuse('INVALID_INSTALL_RECORD');
    }
    return receipt.entries;
  }
  /** The purpose is preserving the renderer's source-pin shape. @param source Digests. @returns Validity. */
  function validSource(source: PilotTargetSource): boolean {
    return !!source && SHA.test(source.agentSha256) && SHA.test(source.configSha256);
  }
  /** The design excludes only the digest from preview identity. @param plan Plan. @returns Digest. */
  function digest(plan: Omit<PilotTargetPlan, 'digest'> | PilotTargetPlan): string {
    const { digest: ignored, ...body } = plan as PilotTargetPlan;
    return hash(json(body));
  }
  /** The purpose is detecting altered or partial previews. @param plan Plan. @returns Validity. */
  function validDigest(plan: PilotTargetPlan): boolean { return SHA.test(plan.digest) && digest(plan) === plan.digest; }
  /**
   * Design: inspect without creating directories, locks, backups or receipts.
   * @param input Captured source and exact render targets.
   * @returns Complete target preview including unmanaged preservation.
   */
  function preview(input: Input): PilotTargetPlan {
    if (!/^[a-z][a-z0-9-]*$/.test(input.id) || !validSource(input.source)) refuse('INVALID_PILOT_INPUT');
    const baseDir = fs.realpathSync(input.baseDir);
    const rootStat = fs.lstatSync(baseDir);
    if (!rootStat.isDirectory()) refuse('UNSAFE_TARGET_ROOT');
    if (!input.targets.length || input.targets.length > 8) refuse('INVALID_TARGET_COUNT');
    const state = statePath(baseDir, input.id);
    checkState(baseDir, state);
    const pointer = observe(join(state, 'current.json'));
    const prior = owners(baseDir, input.id);
    const entries: Entry[] = [];
    const errors: PilotTargetError[] = [];
    const seen = new Set<string>();
    const definitions = input.targets.flatMap(t => [
      { runtime: t.runtime, path: t.path, content: t.content, stale: false },
      ...(t.cleanup ?? []).map(path => ({ runtime: t.runtime, path, content: null, stale: true })),
    ]);
    for (const target of definitions) {
      const path = local(resolve(input.baseDir), target.path);
      if (seen.has(path) || path.startsWith('.port-daddy/')) refuse('CONFLICTING_TARGET_PATH');
      seen.add(path);
      const full = absolute(baseDir, path);
      const parentRows = parents(baseDir, full);
      const before = observe(full);
      const owner = prior[path];
      const owned = before.kind === 'file' && before.uid === process.getuid?.() && !!owner && before.sha256 === owner.sha256;
      let action: Entry['action'] = 'preserve';
      const removing = target.stale || input.operation === 'uninstall';
      if (before.kind === 'absent') action = removing ? 'unchanged' : 'create';
      else if (owned) action = removing ? 'remove' : before.sha256 === hash(target.content!) ? 'unchanged' : 'replace';
      else if (!target.stale) errors.push({ runtime: target.runtime, path: full, code: 'UNMANAGED_TARGET', error: 'Target is not a verified prior Pilot installation; preserved.' });
      if (target.content !== null && Buffer.byteLength(target.content) > MAX_FILE) refuse('TARGET_TOO_LARGE');
      entries.push({ runtime: target.runtime, path, stale: target.stale, action, before, parents: parentRows,
        content: removing ? null : target.content, ...(owned ? { owner } : {}) });
    }
    // A pending operation is explicit evidence, not permission to silently resume.
    if (stat(join(state, 'active.json'))) errors.push({ runtime: 'installation', path: state, code: 'INSTALLATION_PENDING', error: 'A prior installation is active or interrupted; inspect its recovery handle.' });
    const plan: PilotTargetPlan = { version: 1, baseDir, id: input.id, source: input.source, operation: input.operation ?? 'install',
      root: identity(rootStat), pointer, entries, errors, digest: '' };
    plan.digest = digest(plan);
    return plan;
  }
  /** Design: translate planned actions without claiming preview performed them. @param plan Plan. @param previewOnly Preview flag. @returns Result. */
  function resultFor(plan: PilotTargetPlan, previewOnly = false): PilotTargetResult {
    const accepted = plan.errors.length === 0;
    return {
      written: accepted ? plan.entries.filter(e => !e.stale && plan.operation === 'install' && e.action !== 'preserve')
        .map(e => ({ runtime: e.runtime, path: absolute(plan.baseDir, e.path), changed: ['create', 'replace'].includes(e.action) })) : [],
      cleaned: plan.entries.filter(e => e.stale || plan.operation === 'uninstall')
        .map(e => ({ runtime: e.runtime, path: absolute(plan.baseDir, e.path), changed: accepted && e.action === 'remove' })),
      errors: [...plan.errors], outcome: accepted ? previewOnly ? 'preview' : 'unchanged' : 'blocked', plan,
    };
  }
  /** Design: recheck parents, allowing only directories this exact apply created. @param plan Plan. @param entry Entry. @param made Created parents. @returns Nothing. */
  function checkParents(plan: PilotTargetPlan, entry: Entry, made: Map<string, Identity>): void {
    if (!equal(identity(fs.lstatSync(plan.baseDir)), plan.root)) refuse('TARGET_ROOT_CHANGED');
    for (const p of entry.parents) {
      const st = stat(absolute(plan.baseDir, p.path));
      const expected = p.identity ?? made.get(p.path) ?? null;
      if (st && (!st.isDirectory() || st.isSymbolicLink())) refuse('UNSAFE_TARGET_PARENT');
      if (!equal(st ? identity(st) : null, expected)) refuse('TARGET_PARENT_CHANGED');
    }
  }
  /** The purpose is create-only parent acquisition, never chmod of existing data. @param base Root. @param path Leaf. @param made Witness map. @returns Nothing. */
  function ensureParents(base: string, path: string, made: Map<string, Identity>): void {
    for (const p of parents(base, path)) {
      if (!p.identity) {
        fs.mkdirSync(absolute(base, p.path), { mode: 0o700 });
        flushDirectory(dirname(absolute(base, p.path)));
      }
      const st = fs.lstatSync(absolute(base, p.path));
      if (!st.isDirectory() || st.isSymbolicLink()) refuse('UNSAFE_TARGET_PARENT');
      if (!p.identity) made.set(p.path, identity(st));
    }
  }
  /** Design: use exclusive creation plus flush for durable immutable evidence. @param path New file. @param bytes Exact bytes. @param mode Mode. @param acquired Record exclusive acquisition before a subsequent write can fail. @returns Stable observation. */
  function createFile(path: string, bytes: Buffer | string, mode = 0o600, acquired?: () => void): Observation {
    if (Buffer.byteLength(bytes) > MAX_RECORD) refuse('INSTALL_RECORD_TOO_LARGE');
    const fd = fs.openSync(path, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, mode);
    try { acquired?.(); fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    return observe(path, MAX_RECORD);
  }
  /** The purpose is flushing directory metadata on supported local filesystems. @param path Directory. @returns Nothing. */
  function flushDirectory(path: string): void {
    const fd = fs.openSync(path, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  }
  /** Design: preserve postimage identity before reporting completion. @param directory Journal directory. @param index Entry index. @param value Evidence. @returns Nothing. */
  function witness(directory: string, index: number, value: unknown): void {
    createFile(join(directory, 'step-' + index + '.json'), json(value));
    flushDirectory(directory);
  }
  /**
   * Design: apply one exact preview. Per-file replacement is atomic; the target set
   * is deliberately not described as a single transaction.
   * @param plan Unchanged preview. @param expectedDigest Explicit reviewed digest.
   * @returns Exact effects or retained partial recovery evidence.
   */
  function apply(plan: PilotTargetPlan, expectedDigest: string): PilotTargetResult {
    const result = resultFor(plan);
    const changed: number[] = [];
    let directory: string | undefined;
    let lock: Observation | undefined;
    let lockAcquired = false;
    const state = statePath(plan.baseDir, plan.id);
    const active = join(state, 'active.json');
    const made = new Map<string, Identity>();
    try {
      if (!validDigest(plan) || plan.digest !== expectedDigest || plan.version !== 1 || !validSource(plan.source)) refuse('STALE_TARGET_PREVIEW');
      if (result.errors.length) return result;
      for (const entry of plan.entries) {
        checkParents(plan, entry, made);
        if (!equal(observe(absolute(plan.baseDir, entry.path)), entry.before)) refuse('TARGET_CHANGED');
      }
      checkState(plan.baseDir, state);
      if (!equal(observe(join(state, 'current.json')), plan.pointer)) refuse('INSTALL_RECORD_CHANGED');
      owners(plan.baseDir, plan.id);
      if (!plan.entries.some(e => ['create', 'replace', 'remove'].includes(e.action))) return result;
      if (stat(active)) refuse('INSTALLATION_PENDING');
      const run = randomUUID();
      directory = join(state, 'runs', run);
      ensureParents(plan.baseDir, join(directory, 'journal.json'), made);
      checkState(plan.baseDir, state);
      const backups = plan.entries.map(e => e.before.kind === 'file' && ['replace', 'remove'].includes(e.action)
        ? read(absolute(plan.baseDir, e.path)).bytes.toString('base64') : null);
      const beforePointer = plan.pointer.kind === 'absent' ? null : read(join(state, 'current.json'), MAX_RECORD, true).bytes.toString('base64');
      const journal: Journal = { version: 1, run, plan, beforePointer, backups };
      createFile(join(directory, 'journal.json'), json(journal));
      lock = createFile(active, json({ version: 1, run, digest: plan.digest }), 0o600, () => {
        lockAcquired = true;
        result.recovery = { runId: run, directory: directory! };
      });
      flushDirectory(state);
      result.recovery = { runId: run, directory };
      const entries = owners(plan.baseDir, plan.id);
      // Establish new active outputs before retiring stale predecessors.
      const order = plan.entries.map((e, index) => ({ e, index })).sort((a, b) => Number(a.e.action === 'remove') - Number(b.e.action === 'remove'));
      for (const { e, index } of order) {
        if (!['create', 'replace', 'remove'].includes(e.action)) continue;
        checkParents(plan, e, made);
        const path = absolute(plan.baseDir, e.path);
        if (!equal(observe(path), e.before)) refuse('TARGET_CHANGED');
        ensureParents(plan.baseDir, path, made);
        createFile(join(directory, 'parents-' + index + '.json'), json(parents(plan.baseDir, path)));
        flushDirectory(directory);
        if (e.action === 'remove') {
          fs.unlinkSync(path);
          delete entries[e.path];
        } else {
          const staged = join(dirname(path), '.pd-pilot-' + run + '-' + index);
          const stagedState = createFile(staged, e.content!, e.before.kind === 'file' ? e.before.mode : 0o600);
          createFile(join(directory, 'stage-' + index + '.json'), json({ path: local(plan.baseDir, staged), state: stagedState }));
          flushDirectory(directory);
          checkParents(plan, e, made);
          if (!equal(observe(path), e.before)) refuse('TARGET_CHANGED');
          if (e.action === 'create') {
            fs.linkSync(staged, path); // atomic no-clobber publication for absence
            changed.push(index); // Publication already happened if staging cleanup fails.
            fs.unlinkSync(staged);
          } else {
            fs.renameSync(staged, path);
            changed.push(index);
          }
          const after = observe(path);
          if (after.kind !== 'file' || after.sha256 !== hash(e.content!) || after.ino !== (stagedState as Identity).ino) refuse('TARGET_READBACK_FAILED');
          entries[e.path] = { run, index, sha256: after.sha256! };
        }
        if (!changed.includes(index)) changed.push(index);
        flushDirectory(dirname(path));
        witness(directory, index, { before: e.before, after: observe(path) });
      }
      const receipt: Receipt = { version: 1, id: plan.id, baseDir: plan.baseDir, entries };
      const bytes = json(receipt);
      createFile(join(directory, 'receipt.json'), bytes);
      const pointer = json({ version: 1, run, sha256: hash(bytes) });
      createFile(join(directory, 'pointer.json'), pointer);
      if (!equal(observe(join(state, 'current.json')), plan.pointer)) refuse('INSTALL_RECORD_CHANGED');
      fs.renameSync(join(directory, 'pointer.json'), join(state, 'current.json'));
      flushDirectory(state);
      owners(plan.baseDir, plan.id);
      createFile(join(directory, 'complete.json'), json({ version: 1, changed }));
      flushDirectory(directory);
      if (!equal(observe(active), lock)) refuse('INSTALL_LOCK_CHANGED');
      fs.unlinkSync(active);
      flushDirectory(state);
      result.outcome = 'complete';
      delete result.recovery;
      return result;
    } catch (e) {
      result.outcome = lockAcquired ? 'partial' : 'blocked';
      result.written = plan.entries.flatMap((entry, index) => changed.includes(index) && entry.action !== 'remove'
        ? [{ runtime: entry.runtime, path: absolute(plan.baseDir, entry.path), changed: true }] : []);
      result.cleaned = plan.entries.flatMap((entry, index) => changed.includes(index) && entry.action === 'remove'
        ? [{ runtime: entry.runtime, path: absolute(plan.baseDir, entry.path), changed: true }] : []);
      result.errors.push({ runtime: 'installation', path: state, code: code(e), error: 'Pilot installation stopped; existing evidence was preserved (' + code(e) + ').' });
      return result;
    }
  }
  /**
   * Design: roll back an exact interruption without replacing later edits.
   * Recovery is explicit and requires every affected current postimage to match;
   * it neither clears unknown locks nor converts unmanaged files into ownership.
   * @param baseDir Selected root. @param id Pilot ID. @param run Exact recovery handle.
   * @param source Freshly validated source hashes, bound to the interrupted plan.
   * @returns Recovered or an honest preserved partial result.
   */
  function recover(baseDir: string, id: string, run: string, source: PilotTargetSource): PilotTargetResult {
    const result: PilotTargetResult = { written: [], cleaned: [], errors: [], outcome: 'blocked' };
    try {
      if (!/^[a-z][a-z0-9-]*$/.test(id) || !RUN.test(run)) refuse('INVALID_RECOVERY_HANDLE');
      const base = fs.realpathSync(baseDir);
      const state = statePath(base, id);
      checkState(base, state);
      const active = join(state, 'active.json');
      const lockState = observe(active);
      const lock = lockState.kind === 'absent' ? null : record<{ version: number; run: string; digest: string }>(active);
      if (lock && (lock.version !== 1 || lock.run !== run)) refuse('RECOVERY_LOCK_MISMATCH');
      const directory = join(state, 'runs', run);
      const journal = record<Journal>(join(directory, 'journal.json'));
      const plan = journal.plan;
      result.recovery = { runId: run, directory };
      if (journal.version !== 1 || journal.run !== run || plan.baseDir !== base || plan.id !== id
        || !validSource(plan.source) || !validSource(source)
        || plan.source.agentSha256 !== source.agentSha256 || plan.source.configSha256 !== source.configSha256
        || !validDigest(plan) || (lock && lock.digest !== plan.digest)
        || journal.backups.length !== plan.entries.length) refuse('INVALID_RECOVERY_JOURNAL');
      if (!equal(identity(fs.lstatSync(base)), plan.root)) refuse('RECOVERY_ROOT_CHANGED');
      const pointerPath = join(state, 'current.json');
      const recoveredPath = join(directory, 'recovered.json');
      if (stat(recoveredPath)) {
        const priorRecovery = record<{ version: number; run: string; observations: Observation[]; pointer: Observation }>(recoveredPath);
        if (priorRecovery.version !== 1 || priorRecovery.run !== run || !Array.isArray(priorRecovery.observations)
          || priorRecovery.observations.length !== plan.entries.length) refuse('INVALID_RECOVERY_JOURNAL');
        for (const [index, e] of plan.entries.entries()) {
          parents(base, absolute(base, e.path));
          if (!equal(observe(absolute(base, e.path)), priorRecovery.observations[index])) refuse('RECOVERY_TARGET_CHANGED');
        }
        if (!equal(observe(pointerPath), priorRecovery.pointer)) refuse('RECOVERY_RECORD_CHANGED');
        if (lock) {
          if (!equal(observe(active), lockState)) refuse('RECOVERY_LOCK_MISMATCH');
          fs.unlinkSync(active);
          flushDirectory(state);
        }
        result.outcome = 'recovered';
        delete result.recovery;
        return result;
      }
      if (!lock) refuse('RECOVERY_LOCK_MISMATCH');
      // Validate all prior bytes and pointer state before restoring any target.
      for (const [index, e] of plan.entries.entries()) {
        if (e.before.kind === 'file' && ['replace', 'remove'].includes(e.action)) {
          const backup = journal.backups[index];
          if (typeof backup !== 'string' || hash(Buffer.from(backup, 'base64')) !== e.before.sha256) refuse('INVALID_RECOVERY_BACKUP');
        }
      }
      if (journal.beforePointer !== null && (typeof journal.beforePointer !== 'string'
        || plan.pointer.kind !== 'file' || hash(Buffer.from(journal.beforePointer, 'base64')) !== plan.pointer.sha256)) refuse('INVALID_RECOVERY_BACKUP');
      const pointerBeforeRecovery = observe(pointerPath);
      const pointerRestoreRecord = join(directory, 'restore-pointer-state.json');
      const priorPointerRestore = stat(pointerRestoreRecord) ? record<{ state: Observation }>(pointerRestoreRecord) : null;
      let restorePointer = false;
      if (!equal(pointerBeforeRecovery, plan.pointer)
        && !(priorPointerRestore && equal(pointerBeforeRecovery, priorPointerRestore.state))) {
        const pointer = pointerBeforeRecovery.kind === 'file'
          ? record<{ version: number; run: string; sha256: string }>(pointerPath) : null;
        const receiptPath = join(directory, 'receipt.json');
        if (!pointer || pointer.version !== 1 || pointer.run !== run || !SHA.test(pointer.sha256)
          || !stat(receiptPath) || hash(read(receiptPath, MAX_RECORD, true).bytes) !== pointer.sha256) refuse('RECOVERY_RECORD_CHANGED');
        restorePointer = true;
      }
      const changes: Array<{ e: Entry; index: number; current: Observation }> = [];
      for (let index = 0; index < plan.entries.length; index++) {
        const e = plan.entries[index];
        if (!['create', 'replace', 'remove'].includes(e.action)) continue;
        const path = absolute(base, e.path);
        const parentRows = parents(base, path);
        for (const [prefix, recordPrefix] of [['.pd-pilot-', 'stage-'], ['.pd-pilot-restore-', 'restore-']]) {
          const staged = join(dirname(path), prefix + run + '-' + index);
          if (stat(staged) && !stat(join(directory, recordPrefix + index + '.json'))) refuse('RECOVERY_UNWITNESSED_STAGE');
        }
        const parentRecord = join(directory, 'parents-' + index + '.json');
        if (stat(parentRecord) && !equal(parentRows, record<Parent[]>(parentRecord))) refuse('RECOVERY_PARENT_CHANGED');
        let links = 1;
        const currentStat = stat(path);
        if (currentStat?.nlink === 2) {
          const candidates = [
            { file: join(directory, 'stage-' + index + '.json'), restore: false },
            { file: join(directory, 'restore-' + index + '.json'), restore: true },
          ];
          let matched = false;
          for (const candidate of candidates) {
            if (!stat(candidate.file)) continue;
            const stage = record<{ path: string; state: Observation }>(candidate.file);
            const stagedPath = candidate.restore ? join(dirname(path), '.pd-pilot-restore-' + run + '-' + index) : absolute(base, stage.path);
            parents(base, stagedPath);
            const stagedStat = stat(stagedPath);
            if (stage.state.kind === 'file' && stagedStat?.nlink === 2
              && stagedStat.ino === currentStat.ino && stagedStat.dev === currentStat.dev
              && stage.state.ino === currentStat.ino && stage.state.dev === currentStat.dev) matched = true;
          }
          if (!matched) refuse('RECOVERY_TARGET_CHANGED');
          links = 2;
        }
        const current = observe(path, MAX_FILE, links);
        if (equal(current, e.before)) continue;
        if (!stat(parentRecord)) refuse('RECOVERY_PARENT_CHANGED');
        const restoredPath = join(directory, 'restore-' + index + '.json');
        if (stat(restoredPath)) {
          const restored = record<{ state: Observation }>(restoredPath);
          if (equal(current, restored.state) && e.before.kind === 'file'
            && current.kind === 'file' && current.sha256 === e.before.sha256) continue;
        }
        const stepPath = join(directory, 'step-' + index + '.json');
        if (stat(stepPath)) {
          const step = record<{ after: Observation }>(stepPath);
          if (!equal(current, step.after)) refuse('RECOVERY_TARGET_CHANGED');
        } else if (e.action === 'remove') {
          if (current.kind !== 'absent') refuse('RECOVERY_TARGET_CHANGED');
        } else {
          const staged = record<{ state: Observation }>(join(directory, 'stage-' + index + '.json'));
          if (current.kind !== 'file' || staged.state.kind !== 'file' || current.ino !== staged.state.ino
            || current.dev !== staged.state.dev || current.sha256 !== hash(e.content!)) refuse('RECOVERY_TARGET_CHANGED');
        }
        changes.push({ e, index, current });
      }
      for (const { e, index, current } of changes.reverse()) {
        const path = absolute(base, e.path);
        parents(base, path);
        if (!equal(observe(path, MAX_FILE, stat(path)?.nlink === 2 ? 2 : 1), current)) refuse('RECOVERY_TARGET_CHANGED');
        if (e.before.kind === 'absent') fs.unlinkSync(path);
        else {
          const prior = Buffer.from(journal.backups[index]!, 'base64');
          if (hash(prior) !== e.before.sha256) refuse('INVALID_RECOVERY_BACKUP');
          const restore = join(dirname(path), '.pd-pilot-restore-' + run + '-' + index);
          const restoreRecord = join(directory, 'restore-' + index + '.json');
          if (stat(restoreRecord)) {
            const restored = record<{ state: Observation }>(restoreRecord);
            if (!equal(observe(restore), restored.state) || restored.state.kind !== 'file'
              || restored.state.sha256 !== e.before.sha256 || restored.state.mode !== e.before.mode) refuse('RECOVERY_STAGE_CHANGED');
          } else {
            const restoredState = createFile(restore, prior, e.before.mode);
            createFile(restoreRecord, json({ state: restoredState }));
            flushDirectory(directory);
          }
          if (!equal(observe(path), current)) refuse('RECOVERY_TARGET_CHANGED');
          if (current.kind === 'absent') { fs.linkSync(restore, path); fs.unlinkSync(restore); }
          else fs.renameSync(restore, path);
          if (read(path).bytes.compare(prior) !== 0) refuse('RECOVERY_READBACK_FAILED');
        }
        flushDirectory(dirname(path));
        (e.before.kind === 'absent' ? result.cleaned : result.written).push({ runtime: e.runtime, path, changed: true });
      }
      // Discard only our exact staged inode. Never sweep a directory by prefix.
      for (const [index, e] of plan.entries.entries()) {
        for (const kind of ['stage', 'restore']) {
          const stagePath = join(directory, kind + '-' + index + '.json');
          if (!stat(stagePath)) continue;
          const stage = record<{ path: string; state: Observation }>(stagePath);
          const stagedPath = kind === 'restore'
            ? join(dirname(absolute(base, e.path)), '.pd-pilot-restore-' + run + '-' + index) : absolute(base, stage.path);
          parents(base, stagedPath);
          const links = stat(stagedPath)?.nlink === 2 ? 2 : 1;
          if (links === 2) {
            const target = stat(absolute(base, e.path));
            if (stage.state.kind !== 'file' || target?.ino !== stage.state.ino || target?.dev !== stage.state.dev) refuse('RECOVERY_STAGE_CHANGED');
          }
          const staged = observe(stagedPath, MAX_FILE, links);
          if (staged.kind === 'absent') continue;
          if (!equal(staged, stage.state)) refuse('RECOVERY_STAGE_CHANGED');
          fs.unlinkSync(stagedPath);
          flushDirectory(dirname(stagedPath));
        }
      }
      if (!equal(observe(pointerPath), pointerBeforeRecovery)) refuse('RECOVERY_RECORD_CHANGED');
      if (restorePointer) {
        if (journal.beforePointer === null) fs.unlinkSync(pointerPath);
        else {
          const previous = Buffer.from(journal.beforePointer, 'base64');
          if (plan.pointer.kind !== 'file' || hash(previous) !== plan.pointer.sha256) refuse('INVALID_RECOVERY_BACKUP');
          const restore = join(directory, 'restore-pointer.json');
          if (priorPointerRestore) {
            if (!equal(observe(restore), priorPointerRestore.state)) refuse('RECOVERY_STAGE_CHANGED');
          } else {
            const restored = createFile(restore, previous);
            createFile(pointerRestoreRecord, json({ state: restored }));
            flushDirectory(directory);
          }
          fs.renameSync(restore, pointerPath);
        }
        flushDirectory(state);
      }
      createFile(recoveredPath, json({ version: 1, run, pointer: observe(pointerPath),
        observations: plan.entries.map(e => observe(absolute(base, e.path))) }));
      flushDirectory(directory);
      if (!equal(observe(active), lockState)) refuse('RECOVERY_LOCK_MISMATCH');
      fs.unlinkSync(active);
      flushDirectory(state);
      result.outcome = 'recovered';
      delete result.recovery;
    } catch (e) {
      result.outcome = result.recovery ? 'partial' : 'blocked';
      result.errors.push({ runtime: 'recovery', path: baseDir, code: code(e), error: 'Recovery preserved unresolved evidence (' + code(e) + ').' });
    }
    return result;
  }
  return { preview, apply, recover, resultFor };
}

export const pilotTargetExecutor = createPilotTargetExecutor();
