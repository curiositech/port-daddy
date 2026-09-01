/**
 * Build an ADR-0118 handoff capsule from a dead body's own transcript.
 *
 * WHY THIS EXISTS. The whole handoff machinery was already built and wired —
 * `HandoffCapsuleV0`, the fail-closed sanitizer, `renderHandoffSuccessorPrompt`,
 * `POST /memory/handoffs`, and the `/continue` route that resolves native resume
 * versus sanitized handoff — and NOTHING in the repo ever constructed a capsule.
 * Every path took one from a client. So a dispatch that died had, in practice,
 * no way to brief its successor, and cross-backend continuation was a contract
 * with no producer. This module is that producer.
 *
 * THE DESIGN CHOICE THAT MATTERS: a capsule is a BRIEF, not a replay. It would
 * be easy — and wrong — to hand the successor the predecessor's full transcript.
 * A transcript is the wrong shape for a new body in three ways: it is mostly
 * tokens the successor does not need, it re-asserts tool results that may no
 * longer be true of the repository, and it invites the successor to continue a
 * conversation rather than re-derive the state. So this extracts the small set
 * of things that survive a body change honestly:
 *
 *   telos          the objective, which is the only thing that must not change
 *   operatorTurns  what a human actually said, which the successor cannot re-derive
 *   tail           a bounded slice of recent context, as orientation only
 *   artifacts      pointers, so the successor can go LOOK rather than believe
 *   workspace      where the work lives, so the successor verifies rather than assumes
 *
 * Everything else is deliberately dropped. The rendered prompt says so in its
 * own header: revalidate repository and runtime truth before acting.
 *
 * FAIL-OPEN, BY DESIGN. Every function here returns null rather than throwing.
 * It runs while a dispatch failure is already being unwound, and the caller's
 * fallback — a cold successor carrying the original goal — is a real outcome,
 * not an error state. An exception here would convert a recoverable failure into
 * a dead dispatch, which is exactly the situation the module exists to prevent.
 * The one thing it will NOT do is degrade quietly past the secret scanner: if
 * sanitization fails, there is no capsule, and the successor goes cold.
 */

import { randomUUID } from 'node:crypto';
import {
  HANDOFF_CAPSULE_SCHEMA,
  sanitizeHandoffCapsule,
  renderHandoffSuccessorPrompt,
  type HandoffArtifact,
  type HandoffCapsuleV0,
  type HandoffTailItem,
  type HandoffTextItem,
  type SanitizeHandoffOptions,
} from '../handoff-capsule.js';
import type { Dispatch } from './queue.js';
import type { TranscriptEntry, TranscriptsModule } from '../transcripts.js';

/**
 * How much recent context rides along, in messages.
 *
 * Small on purpose. The tail is orientation — "this is roughly where the last
 * body was" — not evidence. A larger tail costs tokens the successor needs for
 * its own work and, worse, makes stale tool output look authoritative.
 */
const TAIL_MESSAGES = 8;

/** Per-item character cap, so one enormous message cannot become the whole brief. */
const MAX_ITEM_CHARS = 2_000;

/** Token budget handed to the sanitizer's own trimming pass. */
const DEFAULT_TOKEN_BUDGET = 6_000;

/** What the caller gets back when a warm handoff was possible. */
export interface HandoffFromTranscript {
  /** The successor's goal text: a rendered, sanitized successor brief. */
  goal: string;
  /** The capsule id, recorded on the successor row as its handoff episode. */
  episodeId: string;
  /** The sanitized capsule itself, for callers that want to persist it. */
  capsule: HandoffCapsuleV0;
}

/** Dependencies, injected so this is testable without a daemon. */
export interface HandoffFromTranscriptDeps {
  transcripts: Pick<TranscriptsModule, 'listTranscripts' | 'getTranscript'>;
  /** Sanitizer options — chiefly the gitleaks runner, which tests stub. */
  sanitizeOptions?: SanitizeHandoffOptions;
  /** Injected clock, so a capsule's timestamp is deterministic under test. */
  now?: () => number;
}

/**
 * Find the transcript a dispatch's body actually wrote.
 *
 * Keyed on `spawnedAgentId`, which is why that column had to exist: transcripts
 * are stored against the Conductor's `Launch.agentId`, and until the dispatch row
 * carried it there was no join at all between a dispatch and what its body did.
 *
 * @param dispatch The dispatch whose body has finished or died.
 * @param deps The transcript reader.
 * @returns The most recent matching transcript, or null when there is no link.
 */
export function findTranscriptForDispatch(
  dispatch: Dispatch,
  deps: HandoffFromTranscriptDeps,
): TranscriptEntry | null {
  const agentId = dispatch.spawnedAgentId;
  if (!agentId) return null;
  try {
    const rows = deps.transcripts.listTranscripts({ agentId, limit: 5 });
    if (!rows.length) return null;
    // listTranscripts omits messages; re-read the newest one in full.
    const newest = rows.reduce((a, b) => (b.started_at > a.started_at ? b : a));
    return deps.transcripts.getTranscript(newest.id) ?? newest;
  } catch {
    return null;
  }
}

/**
 * Trim and normalize one text item for the capsule.
 *
 * The cap exists so a single enormous message cannot become the entire brief —
 * the design intent being a bounded orientation, not a proportional replay.
 *
 * @param text Raw message content.
 * @returns The trimmed text, or null when there is nothing worth carrying.
 */
function clip(text: unknown): string | null {
  if (typeof text !== 'string') return null;
  const trimmed = text.trim();
  if (!trimmed) return null;
  return trimmed.length > MAX_ITEM_CHARS
    ? `${trimmed.slice(0, MAX_ITEM_CHARS)}\n…[truncated for the handoff brief]`
    : trimmed;
}

/**
 * Build an UNSANITIZED capsule from a dispatch and its transcript.
 *
 * Exported for tests, whose purpose is inspecting what was selected before the
 * sanitizer rewrites it. Production callers should use
 * {@link buildHandoffFromTranscript}, which is the only path that guarantees the
 * fail-closed scan ran.
 *
 * @param dispatch The dead dispatch.
 * @param transcript Its body's transcript.
 * @param fromBackend The backend that failed.
 * @param toBackend The backend the successor will run on.
 * @param now Injected clock.
 * @returns A capsule shaped for the sanitizer.
 */
export function draftCapsule(
  dispatch: Dispatch,
  transcript: TranscriptEntry | null,
  fromBackend: string,
  toBackend: string,
  now: () => number = Date.now,
): HandoffCapsuleV0 {
  const messages = transcript?.messages ?? [];
  const operatorTurns: HandoffTextItem[] = [];
  for (const m of messages) {
    if (m.role !== 'user') continue;
    const text = clip(m.content);
    if (!text) continue;
    operatorTurns.push({
      id: `turn-${operatorTurns.length}`,
      at: new Date(m.timestamp).toISOString(),
      text,
    });
  }

  const tail: HandoffTailItem[] = [];
  for (const m of messages.slice(-TAIL_MESSAGES)) {
    const text = clip(m.content);
    if (!text) continue;
    tail.push({
      id: `tail-${tail.length}`,
      at: new Date(m.timestamp).toISOString(),
      text,
      role: toHandoffRole(m.role),
    });
  }

  const artifacts: HandoffArtifact[] = (transcript?.outputs ?? [])
    .map((o) => ({
      path: o.url ?? o.type,
      kind: o.type ?? null,
      summary: clip(o.summary),
      sourceBlockId: null,
    }))
    .filter((a) => Boolean(a.path));

  return {
    schema: HANDOFF_CAPSULE_SCHEMA,
    capsuleId: `handoff_${randomUUID().replace(/-/g, '')}`,
    capturedAt: new Date(now()).toISOString(),
    source: {
      adapter: fromBackend,
      sessionId: dispatch.sessionId ?? dispatch.id,
      agentId: dispatch.spawnedAgentId,
      workflowId: dispatch.id,
      transcriptRef: transcript?.id ?? null,
    },
    target: { adapter: toBackend, agentId: null },
    identity: {
      project: transcript?.project ?? null,
      projectDir: dispatch.worktreePath,
      harbor: null,
    },
    workspace: {
      cwd: dispatch.worktreePath,
      repoRoot: dispatch.worktreePath,
      branch: dispatch.branch,
      worktreeId: dispatch.id,
      gitHead: null,
      dirtyFiles: [],
    },
    // The objective is the ONE thing that must survive a body change unchanged.
    telos: dispatch.goal,
    // Keep only the last few operator turns: a successor needs what a human
    // actually asked for, which it cannot re-derive, but not the whole thread.
    operatorTurns: operatorTurns.slice(-4),
    decisions: [],
    coordination: [],
    artifacts,
    tail,
    budget: {
      requestedTokens: DEFAULT_TOKEN_BUDGET,
      estimatedTokens: 0,
      omitted: { tail: Math.max(0, messages.length - tail.length), artifacts: 0 },
    },
    safety: {
      state: 'clean',
      allowlistedFieldsOnly: true,
      redactedValues: 0,
      localScanner: 'port-daddy-gitleaks-rules',
      externalScanner: 'gitleaks-stdin',
      failClosed: true,
    },
    integrity: { algorithm: 'sha256', contentHash: '' },
  };
}

/**
 * Map a transcript role onto the capsule's narrower role vocabulary.
 *
 * The design: the capsule deliberately has fewer roles than a transcript — a successor only
 * needs to know whether a line came from the operator, the body, a tool, or the
 * system. Anything unrecognised is called `assistant` rather than dropped —
 * losing a line silently is worse than labelling it conservatively.
 *
 * @param role The transcript's role string.
 * @returns The capsule role.
 */
function toHandoffRole(role: string): HandoffTailItem['role'] {
  if (role === 'user') return 'operator';
  if (role === 'system') return 'system';
  if (role === 'tool') return 'tool';
  return 'assistant';
}

/**
 * Build the successor's warm brief from a dead dispatch.
 *
 * By design this returns null — never throws — when there is no transcript to
 * draw on, or when the fail-closed sanitizer refuses. Both mean the same thing to the caller:
 * mint a cold successor with the original goal. That is a worse successor, not a
 * failed one, and the continuation receipt records which it got.
 *
 * @param args The dead dispatch, the backends either side of the hop, and deps.
 * @returns The successor's goal and episode id, or null for a cold handoff.
 */
export async function buildHandoffFromTranscript(args: {
  dispatch: Dispatch;
  fromBackend: string;
  toBackend: string;
  deps: HandoffFromTranscriptDeps;
}): Promise<HandoffFromTranscript | null> {
  const { dispatch, fromBackend, toBackend, deps } = args;
  try {
    const transcript = findTranscriptForDispatch(dispatch, deps);
    // No transcript means no warm context worth the risk of pretending. A brief
    // built from nothing but the goal IS the cold path — say so by returning null
    // rather than dressing the goal up as a handoff.
    if (!transcript || (transcript.messages?.length ?? 0) === 0) return null;

    const draft = draftCapsule(dispatch, transcript, fromBackend, toBackend, deps.now);
    const capsule = sanitizeHandoffCapsule(draft, {
      tokenBudget: DEFAULT_TOKEN_BUDGET,
      ...(deps.sanitizeOptions ?? {}),
    });

    const goal = renderHandoffSuccessorPrompt(
      capsule,
      // The continuation request, not the raw goal: it names the succession so
      // the successor knows it is picking work up rather than starting it.
      `Continue this work on ${toBackend}. The previous body on ${fromBackend} did not finish. ` +
        `Objective: ${dispatch.goal}`,
    );

    return { goal, episodeId: capsule.capsuleId, capsule };
  } catch {
    // Includes HandoffSecretError: a capsule that cannot be proven clean is not
    // sent at a lower standard. The successor goes cold.
    return null;
  }
}
