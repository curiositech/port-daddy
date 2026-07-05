/**
 * Destructive-action policy matrix — binder ch18 Work Order C5.
 *
 * Classifies every destructive/gated action an agent body can attempt into
 * block / approve / allow tiers across the five frozen categories
 * (git, filesystem, network, shell, github), and classifies a proposed
 * command string against that matrix BEFORE it runs.
 *
 * Grafted lenses:
 * - destructive-action-policy-matrix: the taxonomy, the tier decision test
 *   (classify by WORST CASE, not typical case), and the audit shape
 *   (`policyMatrixSpec()` matches the skill's policy-matrix.schema.json so
 *   scripts/policy_matrix_audit.mjs can score it deterministically).
 * - fleet-event-spawn-trust: allowlist-not-denylist posture where possible,
 *   fail-closed classification (an unresolvable target is worst-cased), and
 *   reuse of lib/fleet/url-guard for network egress classification instead of
 *   a string blocklist.
 * - sandboxed-adversarial-test-harness: fail-closed on ambiguity — a path we
 *   cannot resolve is treated as OUTSIDE the workspace root, a URL we cannot
 *   parse is held for approval, never waved through.
 *
 * Classification is structured argv matching (command names, subcommands, and
 * flags are structured fields we control the grammar of) — never free-text
 * keyword NLP over prose.
 */

import { resolve, isAbsolute, sep } from 'node:path';
import { homedir } from 'node:os';
import { isBlockedHost } from '../../fleet/url-guard.js';

export type ActionCategory = 'git' | 'filesystem' | 'network' | 'shell' | 'github';
export type ActionTier = 'block' | 'approve' | 'allow';

/** One row of the matrix, in the shape the skill's audit script consumes. */
export interface PolicyMatrixRow {
  name: string;
  category: ActionCategory;
  tier: ActionTier;
  hasPreToolGate: boolean;
  hasDenialReceipt: boolean;
  emitsTranscriptEvent: boolean;
  /** Concrete, runnable non-destructive path. Required for block tier. */
  safeAlternative?: string;
  /**
   * True ONLY because tests/unit/agent-harbor-governance.test.js runs the
   * negative fixture for this row (real scratch repo/dir, gate denies, state
   * snapshot proven byte-identical). If you add a block row, add its fixture
   * command to `exampleCommand` or the matrix audit test will fail closed.
   */
  sideEffectFreeOnBlockFixture: boolean;
  /** A representative command exercised by the negative-fixture test. */
  exampleCommand?: string;
}

export interface ClassificationContext {
  /** Jail root for filesystem containment decisions. Unknown → worst case. */
  workspaceRoot?: string;
  /** Hosts already allowlisted for egress; anything else is first-time. */
  networkAllowlist?: string[];
}

export interface ClassifiedAction {
  actionName: string;
  category: ActionCategory;
  tier: Extract<ActionTier, 'block' | 'approve'>;
  reason: string;
  safeAlternative?: string;
  /** The command segment that matched (chained commands classify worst-first). */
  matchedSegment: string;
}

const SENSITIVE_SEGMENTS = ['.ssh', '.aws', '.gnupg', 'LaunchAgents', 'LaunchDaemons', '.git/hooks'];
const WRITE_COMMANDS = new Set(['rm', 'mv', 'cp', 'ln', 'tee', 'chmod', 'chown', 'touch', 'truncate', 'dd', 'install']);
const SHELL_WRAPPERS = new Set(['sudo', 'env', 'nohup', 'command', 'time', 'nice', 'caffeinate']);
const NETWORK_COMMANDS = new Set(['curl', 'wget']);

/**
 * The frozen v0 matrix. One row per destructive/gated action; canonical
 * examples from the skill taxonomy. allow-tier rows are deliberately absent:
 * an action not in this matrix is an ordinary command, but it is recorded as
 * unmatched on the envelope, never silently promoted to a governed "allow".
 */
export const DESTRUCTIVE_ACTION_POLICY_MATRIX: PolicyMatrixRow[] = [
  // --- git -----------------------------------------------------------------
  {
    name: 'git reset --hard',
    category: 'git',
    tier: 'block',
    hasPreToolGate: true,
    hasDenialReceipt: true,
    emitsTranscriptEvent: true,
    safeAlternative: 'git stash push -m "<reason>" (recoverable), or git checkout -- <path> for a scoped revert',
    sideEffectFreeOnBlockFixture: true,
    exampleCommand: 'git reset --hard HEAD~1',
  },
  {
    name: 'git clean -f',
    category: 'git',
    tier: 'block',
    hasPreToolGate: true,
    hasDenialReceipt: true,
    emitsTranscriptEvent: true,
    safeAlternative: 'git clean -n (dry run) to preview, then git stash push -u -m "<reason>" to preserve untracked files',
    sideEffectFreeOnBlockFixture: true,
    exampleCommand: 'git clean -fd',
  },
  {
    name: 'git push --force',
    category: 'git',
    tier: 'block',
    hasPreToolGate: true,
    hasDenialReceipt: true,
    emitsTranscriptEvent: true,
    safeAlternative: 'git push --force-with-lease (held for approval) — refuses to overwrite unseen remote commits',
    sideEffectFreeOnBlockFixture: true,
    exampleCommand: 'git push --force origin main',
  },
  {
    name: 'git push --mirror',
    category: 'git',
    tier: 'block',
    hasPreToolGate: true,
    hasDenialReceipt: true,
    emitsTranscriptEvent: true,
    safeAlternative: 'push the specific branch you changed: git push origin <branch>',
    sideEffectFreeOnBlockFixture: true,
    exampleCommand: 'git push --mirror origin',
  },
  {
    name: 'git branch -D',
    category: 'git',
    tier: 'block',
    hasPreToolGate: true,
    hasDenialReceipt: true,
    emitsTranscriptEvent: true,
    safeAlternative: 'git branch -d <branch> (merged-only), or tag the tip first: git tag archive/<branch> <branch>',
    sideEffectFreeOnBlockFixture: true,
    exampleCommand: 'git branch -D feature/unmerged',
  },
  {
    name: 'git push --force-with-lease',
    category: 'git',
    tier: 'approve',
    hasPreToolGate: true,
    hasDenialReceipt: true,
    emitsTranscriptEvent: true,
    sideEffectFreeOnBlockFixture: false,
    exampleCommand: 'git push --force-with-lease origin feature',
  },
  {
    name: 'git stash drop/clear',
    category: 'git',
    tier: 'approve',
    hasPreToolGate: true,
    hasDenialReceipt: true,
    emitsTranscriptEvent: true,
    sideEffectFreeOnBlockFixture: false,
    exampleCommand: 'git stash clear',
  },
  // --- filesystem ----------------------------------------------------------
  {
    name: 'rm -rf outside workspace root',
    category: 'filesystem',
    tier: 'block',
    hasPreToolGate: true,
    hasDenialReceipt: true,
    emitsTranscriptEvent: true,
    safeAlternative: 'operate inside the workspace root, or move the target to a review dir: mv <path> ~/coding/tmp/review-<date>/',
    sideEffectFreeOnBlockFixture: true,
    exampleCommand: 'rm -rf /usr/local/share/example',
  },
  {
    name: 'write to sensitive path (~/.ssh, ~/.aws, LaunchAgents, .git/hooks, ...)',
    category: 'filesystem',
    tier: 'block',
    hasPreToolGate: true,
    hasDenialReceipt: true,
    emitsTranscriptEvent: true,
    safeAlternative: 'write inside the workspace and ask the operator to install/copy; sensitive dotfile and persistence surfaces are operator-only',
    sideEffectFreeOnBlockFixture: true,
    exampleCommand: 'rm -rf ~/.ssh',
  },
  {
    name: 'rm -rf inside workspace root',
    category: 'filesystem',
    tier: 'approve',
    hasPreToolGate: true,
    hasDenialReceipt: true,
    emitsTranscriptEvent: true,
    sideEffectFreeOnBlockFixture: false,
    exampleCommand: 'rm -rf ./build',
  },
  // --- network -------------------------------------------------------------
  {
    name: 'egress to metadata/loopback/internal address',
    category: 'network',
    tier: 'block',
    hasPreToolGate: true,
    hasDenialReceipt: true,
    emitsTranscriptEvent: true,
    safeAlternative: 'use the daemon-provided config/credentials API instead of instance metadata or loopback probing',
    sideEffectFreeOnBlockFixture: true,
    exampleCommand: 'curl http://169.254.169.254/latest/meta-data/',
  },
  {
    name: 'first-time outbound host not on allowlist',
    category: 'network',
    tier: 'approve',
    hasPreToolGate: true,
    hasDenialReceipt: true,
    emitsTranscriptEvent: true,
    sideEffectFreeOnBlockFixture: false,
    exampleCommand: 'curl https://unknown-host.example.net/data',
  },
  // --- shell ---------------------------------------------------------------
  {
    name: 'shell -c interpolation of agent-authored strings',
    category: 'shell',
    tier: 'block',
    hasPreToolGate: true,
    hasDenialReceipt: true,
    emitsTranscriptEvent: true,
    safeAlternative: 'run the underlying command as fixed argv (no sh -c wrapper), so arguments cannot re-enter a shell parser',
    sideEffectFreeOnBlockFixture: true,
    exampleCommand: 'sh -c "rm -rf $TARGET"',
  },
  {
    name: 'eval of agent-authored strings',
    category: 'shell',
    tier: 'block',
    hasPreToolGate: true,
    hasDenialReceipt: true,
    emitsTranscriptEvent: true,
    safeAlternative: 'call the intended command directly with fixed argv',
    sideEffectFreeOnBlockFixture: true,
    exampleCommand: 'eval "$PAYLOAD"',
  },
  // --- github --------------------------------------------------------------
  {
    name: 'gh repo delete',
    category: 'github',
    tier: 'block',
    hasPreToolGate: true,
    hasDenialReceipt: true,
    emitsTranscriptEvent: true,
    safeAlternative: 'gh repo archive <repo> (reversible), or open an issue asking the operator to delete',
    sideEffectFreeOnBlockFixture: true,
    exampleCommand: 'gh repo delete owner/repo --yes',
  },
  {
    name: 'gh pr merge --admin',
    category: 'github',
    tier: 'block',
    hasPreToolGate: true,
    hasDenialReceipt: true,
    emitsTranscriptEvent: true,
    safeAlternative: 'fix the failing required gate, then enqueue normally: gh pr merge --auto',
    sideEffectFreeOnBlockFixture: true,
    exampleCommand: 'gh pr merge 123 --admin',
  },
  {
    name: 'gh pr merge',
    category: 'github',
    tier: 'approve',
    hasPreToolGate: true,
    hasDenialReceipt: true,
    emitsTranscriptEvent: true,
    sideEffectFreeOnBlockFixture: false,
    exampleCommand: 'gh pr merge 123 --squash',
  },
  {
    name: 'gh release delete',
    category: 'github',
    tier: 'approve',
    hasPreToolGate: true,
    hasDenialReceipt: true,
    emitsTranscriptEvent: true,
    sideEffectFreeOnBlockFixture: false,
    exampleCommand: 'gh release delete v1.0.0',
  },
];

/**
 * The matrix + containment claim in the exact input shape of the skill's
 * scripts/policy_matrix_audit.mjs. sameUidBodyMarkedContained is hardwired
 * false: every v0 body is a same-UID process — governed, never contained.
 */
export function policyMatrixSpec(): {
  actions: PolicyMatrixRow[];
  containmentClaim: { sameUidBodyMarkedContained: false };
} {
  return {
    actions: DESTRUCTIVE_ACTION_POLICY_MATRIX.map((row) => ({ ...row })),
    containmentClaim: { sameUidBodyMarkedContained: false },
  };
}

// ---------------------------------------------------------------------------
// Command tokenization (structured argv, quote-aware, chain-splitting)
// ---------------------------------------------------------------------------

/** Split a raw command line into segments on unquoted `&&`, `||`, `;`, `|`. */
export function splitCommandSegments(command: string): string[] {
  const segments: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < command.length; i += 1) {
    const ch = command[i];
    if (quote) {
      current += ch;
      if (ch === quote && command[i - 1] !== '\\') quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
      continue;
    }
    if (ch === '&' && command[i + 1] === '&') { segments.push(current); current = ''; i += 1; continue; }
    if (ch === '|' && command[i + 1] === '|') { segments.push(current); current = ''; i += 1; continue; }
    if (ch === ';' || ch === '|' || ch === '\n') { segments.push(current); current = ''; continue; }
    current += ch;
  }
  segments.push(current);
  return segments.map((s) => s.trim()).filter((s) => s.length > 0);
}

/** Tokenize one segment into argv (minimal quote handling, no expansion). */
export function tokenize(segment: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  let sawAny = false;
  for (const ch of segment) {
    if (quote) {
      if (ch === quote) { quote = null; continue; }
      current += ch;
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; sawAny = true; continue; }
    if (/\s/.test(ch)) {
      if (sawAny) { tokens.push(current); current = ''; sawAny = false; }
      continue;
    }
    current += ch;
    sawAny = true;
  }
  if (sawAny) tokens.push(current);
  return tokens;
}

/** Drop leading VAR=VAL assignments and benign wrappers (sudo/env/nohup/...). */
function unwrapArgv(argv: string[]): string[] {
  let i = 0;
  while (i < argv.length) {
    const tok = argv[i];
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(tok)) { i += 1; continue; }
    if (SHELL_WRAPPERS.has(tok)) {
      i += 1;
      // `env` may carry its own VAR=VAL args; the loop above re-consumes them.
      continue;
    }
    break;
  }
  return argv.slice(i);
}

function expandHome(p: string): string {
  if (p === '~') return homedir();
  if (p.startsWith('~/')) return resolve(homedir(), p.slice(2));
  return p;
}

function isInside(child: string, parent: string): boolean {
  const c = resolve(child);
  const p = resolve(parent);
  return c === p || c.startsWith(p + sep);
}

function findRow(name: string): PolicyMatrixRow {
  const row = DESTRUCTIVE_ACTION_POLICY_MATRIX.find((r) => r.name === name);
  /* istanbul ignore next -- matrix rows are compile-time constants */
  if (!row) throw new Error(`policy matrix drift: no row named "${name}"`);
  return row;
}

function matchFromRow(name: string, segment: string, reason: string): ClassifiedAction {
  const row = findRow(name);
  return {
    actionName: row.name,
    category: row.category,
    tier: row.tier as 'block' | 'approve',
    reason,
    safeAlternative: row.safeAlternative,
    matchedSegment: segment,
  };
}

// ---------------------------------------------------------------------------
// Per-category classifiers (structured argv matching)
// ---------------------------------------------------------------------------

function classifyGit(argv: string[], segment: string): ClassifiedAction | null {
  // Skip git global options (-C <path>, -c k=v, --git-dir=..., etc.).
  let i = 1;
  while (i < argv.length) {
    const tok = argv[i];
    if (tok === '-C' || tok === '-c') { i += 2; continue; }
    if (tok.startsWith('--git-dir') || tok.startsWith('--work-tree')) { i += 1; continue; }
    break;
  }
  const sub = argv[i];
  const rest = argv.slice(i + 1);
  if (sub === 'reset' && rest.includes('--hard')) {
    return matchFromRow('git reset --hard', segment, 'destroys uncommitted working-tree state irrecoverably');
  }
  if (sub === 'clean' && rest.some((t) => /^-[a-zA-Z]*f/.test(t) || t === '--force')) {
    return matchFromRow('git clean -f', segment, 'deletes untracked files irrecoverably');
  }
  if (sub === 'push') {
    if (rest.includes('--mirror')) {
      return matchFromRow('git push --mirror', segment, 'overwrites every remote ref, including other agents\' branches');
    }
    if (rest.some((t) => t.startsWith('--force-with-lease'))) {
      return matchFromRow('git push --force-with-lease', segment, 'history rewrite — safer than --force but can still drop another agent\'s unseen commits');
    }
    if (rest.includes('--force') || rest.some((t) => /^-[a-zA-Z]*f/.test(t) && !t.startsWith('--'))) {
      return matchFromRow('git push --force', segment, 'overwrites remote history unconditionally');
    }
  }
  if (sub === 'branch' && rest.includes('-D')) {
    return matchFromRow('git branch -D', segment, 'deletes a possibly-unmerged branch, orphaning its commits');
  }
  if (sub === 'stash' && (rest.includes('drop') || rest.includes('clear'))) {
    return matchFromRow('git stash drop/clear', segment, 'discards stashed work');
  }
  return null;
}

function classifyFilesystem(argv: string[], segment: string, ctx: ClassificationContext): ClassifiedAction | null {
  const cmd = argv[0];
  if (!WRITE_COMMANDS.has(cmd)) return null;
  // Relative targets resolve against the workspace root (the jail the agent
  // believes it is in), not this process's cwd.
  const base = ctx.workspaceRoot ?? process.cwd();
  const paths = argv.slice(1)
    .filter((t) => !t.startsWith('-'))
    .map(expandHome)
    .map((p) => (isAbsolute(p) ? resolve(p) : resolve(base, p)));

  // Sensitive-surface writes are blocked regardless of workspace containment.
  for (const p of paths) {
    const resolved = resolve(p);
    const relHome = resolved.startsWith(homedir() + sep) ? resolved.slice(homedir().length + 1) : resolved;
    if (SENSITIVE_SEGMENTS.some((s) => relHome === s || relHome.includes(`${s}${sep}`) || relHome.endsWith(s) || resolved.includes(`${sep}${s}${sep}`) || resolved.endsWith(`${sep}${s}`))) {
      return matchFromRow(
        'write to sensitive path (~/.ssh, ~/.aws, LaunchAgents, .git/hooks, ...)',
        segment,
        `targets sensitive surface: ${p}`,
      );
    }
  }

  if (cmd === 'rm') {
    const flags = argv.slice(1).filter((t) => t.startsWith('-') && !t.startsWith('--'));
    const recursive = flags.some((f) => f.includes('r') || f.includes('R')) || argv.includes('--recursive');
    const force = flags.some((f) => f.includes('f')) || argv.includes('--force');
    if (recursive && force) {
      // Fail closed: no workspace root known, or any target outside it → worst case.
      const outside = !ctx.workspaceRoot || paths.length === 0
        || paths.some((p) => !isInside(p, ctx.workspaceRoot as string));
      if (outside) {
        return matchFromRow('rm -rf outside workspace root', segment, ctx.workspaceRoot
          ? `recursive force delete targets a path outside workspace root ${ctx.workspaceRoot}`
          : 'recursive force delete with no known workspace root — worst-cased as outside');
      }
      return matchFromRow('rm -rf inside workspace root', segment, 'recursive force delete inside the workspace root');
    }
  }
  return null;
}

function classifyNetwork(argv: string[], segment: string, ctx: ClassificationContext): ClassifiedAction | null {
  if (!NETWORK_COMMANDS.has(argv[0])) return null;
  const urlish = argv.slice(1).filter((t) => !t.startsWith('-'));
  for (const raw of urlish) {
    let host: string | null = null;
    try {
      const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `http://${raw}`);
      host = url.hostname;
    } catch {
      // Unparseable target: fail closed to approval, never allow.
      return matchFromRow('first-time outbound host not on allowlist', segment, `unparseable egress target "${raw}" — held for approval (fail closed)`);
    }
    if (isBlockedHost(host)) {
      return matchFromRow('egress to metadata/loopback/internal address', segment, `egress to blocked host ${host} (metadata/loopback/private/link-local)`);
    }
    const allow = (ctx.networkAllowlist ?? []).map((h) => h.toLowerCase());
    if (!allow.includes(host.toLowerCase())) {
      return matchFromRow('first-time outbound host not on allowlist', segment, `host ${host} is not on the egress allowlist`);
    }
  }
  return null;
}

function classifyShell(argv: string[], segment: string): ClassifiedAction | null {
  const cmd = argv[0];
  if ((cmd === 'sh' || cmd === 'bash' || cmd === 'zsh' || cmd === 'dash') && argv.includes('-c')) {
    return matchFromRow('shell -c interpolation of agent-authored strings', segment, 'agent-authored string re-enters a shell parser');
  }
  if (cmd === 'eval') {
    return matchFromRow('eval of agent-authored strings', segment, 'eval executes an agent-authored string as shell');
  }
  return null;
}

function classifyGithub(argv: string[], segment: string): ClassifiedAction | null {
  if (argv[0] !== 'gh') return null;
  const [, a, b] = argv;
  if (a === 'repo' && b === 'delete') {
    return matchFromRow('gh repo delete', segment, 'irreversibly deletes a hosted repository');
  }
  if (a === 'pr' && b === 'merge') {
    if (argv.includes('--admin')) {
      return matchFromRow('gh pr merge --admin', segment, 'bypasses required gates with admin privilege');
    }
    return matchFromRow('gh pr merge', segment, 'merges to a shared branch — held for review');
  }
  if (a === 'release' && b === 'delete') {
    return matchFromRow('gh release delete', segment, 'removes a published release');
  }
  if (a === 'api' && argv.some((t, idx) => (t === '-X' || t === '--method') && /^delete$/i.test(argv[idx + 1] ?? ''))) {
    return matchFromRow('gh repo delete', segment, 'raw DELETE against the GitHub API — worst-cased as destructive');
  }
  return null;
}

const TIER_ORDER: Record<'block' | 'approve', number> = { block: 2, approve: 1 };

/**
 * Classify a proposed command against the matrix. Chained commands
 * (`a && b; c | d`) classify every segment; the WORST match wins, so a
 * destructive tail cannot hide behind a benign head. Returns null when no
 * segment matches a governed action (an ordinary command).
 */
export function classifyCommand(command: string, ctx: ClassificationContext = {}): ClassifiedAction | null {
  let worst: ClassifiedAction | null = null;
  for (const segment of splitCommandSegments(command)) {
    const argv = unwrapArgv(tokenize(segment));
    if (argv.length === 0) continue;
    const match = argv[0] === 'git' ? classifyGit(argv, segment)
      : argv[0] === 'gh' ? classifyGithub(argv, segment)
      : classifyShell(argv, segment)
        ?? classifyNetwork(argv, segment, ctx)
        ?? classifyFilesystem(argv, segment, ctx);
    if (match && (!worst || TIER_ORDER[match.tier] > TIER_ORDER[worst.tier])) {
      worst = match;
    }
    if (worst?.tier === 'block') break;
  }
  return worst;
}
