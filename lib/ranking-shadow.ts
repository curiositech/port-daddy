/**
 * Shadow-mode ranking: judge with an agent, decide with an agent, log both —
 * and log what actually happened.
 *
 * **The problem this exists to fix.** Every gate in the arrival briefing is a
 * number somebody reasoned their way to and nobody measured: `MIN_SCORE = 0.15`,
 * `SHARED_FILE_WEIGHT > MAX_TEXT_SCORE`, `RRF_K = 60`, `b = 0.25`. Each is
 * defensible in prose and none is evidence. Nothing establishes that 0.15 is the
 * line between "worth interrupting an agent's first turn" and "noise", and a
 * threshold that has never been checked against an outcome is a guess wearing a
 * constant's clothing.
 *
 * The tempting fix — tune the constants until the output looks right — just
 * moves the guess. You cannot tune toward a target you have not defined, and
 * "looks right to whoever is reading today" is not a target.
 *
 * **What this does instead.** For each candidate the briefing is about to show:
 *
 *   1. Compute the cheap scores (BM25, cosine, fused) — they cost microseconds
 *      and are computed anyway.
 *   2. Ask a cheap agent a narrow yes/no: *would this actually help someone
 *      starting this work?*
 *   3. **Decide on the agent's answer**, not the score. Judgement is what we
 *      trust today, because it is the thing that has any claim to correctness.
 *   4. Log all of it — every score, the judgement, the reason — keyed so that
 *      an OUTCOME can be attached later when we learn whether the agent
 *      actually used the suggestion.
 *
 * Once enough rows exist, an offline pass with a stronger model reads the
 * ledger and answers the question this module is really for: **is there a score
 * threshold that reproduces the agent's judgement well enough to replace it?**
 * If yes, the cheap path becomes free and provably equivalent. If no, that is
 * worth knowing too — it means the judgement is carrying information no
 * threshold on these features can express, and the honest move is to keep
 * paying for it.
 *
 * **Why the log is the deliverable.** Neither the scores nor the judgement is
 * self-validating; only an outcome is. Recording all three against one id is
 * what makes the eventual analysis possible at all, and it is the part that
 * cannot be reconstructed after the fact — if the scores are not written down
 * at decision time, no later pass can recover what the ranker saw.
 *
 * Storage is append-only JSONL alongside the VoiceLog, for the same reason that
 * one is: a decision record that can be rewritten is not a record.
 */

import { appendFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** Every cheap score computed for one candidate, recorded verbatim. */
export interface RankingFeatures {
  /** BM25 relevance, squashed to [0,1). */
  readonly lexical: number;
  /** Cosine similarity in [-1,1], or null when the semantic tier did not run. */
  readonly semantic: number | null;
  /** Fused rank score (RRF), or null when only one tier was available. */
  readonly fused: number | null;
  /** Structural evidence: count of files both parties hold. */
  readonly sharedFiles: number;
  /** What the current threshold WOULD have decided, for later comparison. */
  readonly thresholdVerdict: boolean;
}

/** A cheap agent's narrow judgement about one candidate. */
export interface AgentJudgement {
  readonly useful: boolean;
  /** One line, in the agent's words. Read by humans auditing disagreements. */
  readonly reason: string;
  /** Model id, so a later analysis can segment by judge. */
  readonly judge: string;
  readonly latencyMs?: number;
}

/**
 * What actually happened, attached later.
 *
 * Deliberately separate from the decision row: the outcome is not knowable at
 * decision time, and pretending otherwise is how evaluation harnesses end up
 * measuring their own predictions.
 */
export interface RankingOutcome {
  readonly id: string;
  /** Did the agent act on this suggestion — open the file, resume the salvage? */
  readonly acted: boolean;
  /** Free-form note on how we learned that. */
  readonly evidence?: string;
  readonly at: number;
}

export interface ShadowRow {
  readonly id: string;
  readonly at: number;
  readonly actor: string;
  /** Which corpus this candidate came from. */
  readonly kind: string;
  /** The candidate's stable id, so a repeat suggestion is recognisable. */
  readonly candidate: string;
  /** The arriving agent's query, for offline re-scoring with other features. */
  readonly query: string;
  readonly features: RankingFeatures;
  readonly judgement: AgentJudgement | null;
  /** What we actually showed the agent, and on whose authority. */
  readonly shown: boolean;
  readonly decidedBy: 'agent' | 'threshold';
}

/** Judge seam. Returning null means "no judgement available" — never a guess. */
export type JudgeFn = (input: {
  query: string;
  kind: string;
  candidateText: string;
}) => Promise<AgentJudgement | null>;

export interface ShadowLoggerOptions {
  readonly path: string;
  readonly now?: () => number;
  /**
   * Decide with the threshold instead of the judge.
   *
   * The escape hatch that matters operationally: if the judge is slow, down, or
   * over budget, the briefing still works — it just falls back to the guess and
   * SAYS so in `decidedBy`, so the ledger never conflates a judged decision
   * with an unjudged one.
   */
  readonly fallbackToThreshold?: boolean;
}

export function createShadowLogger(options: ShadowLoggerOptions) {
  const now = options.now ?? Date.now;
  let seq = 0;

  function append(line: object): void {
    try {
      mkdirSync(dirname(options.path), { recursive: true });
      appendFileSync(options.path, `${JSON.stringify(line)}\n`, 'utf8');
    } catch {
      // A ledger write must never break the briefing it is observing. Losing a
      // row degrades the eventual analysis; throwing here would degrade the
      // agent's first turn, which is the thing we are trying to improve.
    }
  }

  /**
   * Judge one candidate, decide, and record everything.
   *
   * Returns whether to show it. The decision follows the JUDGE when one is
   * available — that is the whole point of the exercise — and falls back to the
   * threshold only when explicitly permitted.
   */
  async function decide(input: {
    actor: string;
    kind: string;
    candidate: string;
    candidateText: string;
    query: string;
    features: RankingFeatures;
    judge?: JudgeFn;
  }): Promise<{ shown: boolean; row: ShadowRow }> {
    seq += 1;
    const id = `${now().toString(36)}-${seq.toString(36)}`;

    let judgement: AgentJudgement | null = null;
    if (input.judge) {
      const started = now();
      try {
        judgement = await input.judge({
          query: input.query,
          kind: input.kind,
          candidateText: input.candidateText,
        });
        if (judgement && judgement.latencyMs === undefined) {
          judgement = { ...judgement, latencyMs: now() - started };
        }
      } catch {
        judgement = null;
      }
    }

    const canUseJudge = judgement !== null;
    const shown = canUseJudge
      ? judgement!.useful
      : options.fallbackToThreshold !== false && input.features.thresholdVerdict;

    const row: ShadowRow = {
      id,
      at: now(),
      actor: input.actor,
      kind: input.kind,
      candidate: input.candidate,
      query: input.query,
      features: input.features,
      judgement,
      shown,
      decidedBy: canUseJudge ? 'agent' : 'threshold',
    };
    append(row);
    return { shown, row };
  }

  /** Attach an outcome to a decision made earlier. */
  function recordOutcome(outcome: Omit<RankingOutcome, 'at'>): void {
    append({ ...outcome, at: now(), type: 'outcome' });
  }

  return { decide, recordOutcome, path: options.path };
}

export type ShadowLogger = ReturnType<typeof createShadowLogger>;

// ─── offline analysis ────────────────────────────────────────────────────────

export interface AgreementReport {
  readonly rows: number;
  readonly judged: number;
  /** Rows where the threshold and the agent agreed. */
  readonly agreements: number;
  /** Threshold said show, agent said no — the noise the threshold lets through. */
  readonly falsePositives: number;
  /** Threshold said hide, agent said yes — what the threshold silently loses. */
  readonly falseNegatives: number;
  readonly agreementRate: number;
  /**
   * The best single lexical cutoff found, and how well it reproduces the
   * agent's judgement. `null` when there is not enough judged data to say.
   */
  readonly bestLexicalThreshold: { value: number; accuracy: number } | null;
}

/**
 * Read the ledger and report how well the cheap threshold reproduces the agent.
 *
 * This is the question the whole module exists to answer, and it is deliberately
 * plain arithmetic rather than a model call: whether a number can stand in for a
 * judgement is a measurement, and measuring it with another judgement would
 * reintroduce exactly the unfalsifiability being escaped.
 *
 * The sweep is over observed values only — no interpolation onto a grid that
 * has no data behind it — so a reported accuracy always corresponds to a cutoff
 * some real candidate actually sat on.
 */
export function analyzeAgreement(path: string): AgreementReport {
  const empty: AgreementReport = {
    rows: 0, judged: 0, agreements: 0, falsePositives: 0, falseNegatives: 0,
    agreementRate: 0, bestLexicalThreshold: null,
  };
  if (!existsSync(path)) return empty;

  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    return empty;
  }

  const rows: ShadowRow[] = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line);
      if (parsed && parsed.type !== 'outcome' && parsed.features) rows.push(parsed as ShadowRow);
    } catch {
      // A torn final line is normal for an append-only log being read live.
    }
  }

  const judged = rows.filter((r) => r.judgement !== null);
  let agreements = 0;
  let falsePositives = 0;
  let falseNegatives = 0;
  for (const r of judged) {
    const agent = r.judgement!.useful;
    const threshold = r.features.thresholdVerdict;
    if (agent === threshold) agreements += 1;
    else if (threshold && !agent) falsePositives += 1;
    else falseNegatives += 1;
  }

  let best: { value: number; accuracy: number } | null = null;
  if (judged.length >= 10) {
    const candidates = [...new Set(judged.map((r) => r.features.lexical))].sort((a, b) => a - b);
    for (const cut of candidates) {
      let correct = 0;
      for (const r of judged) {
        if ((r.features.lexical >= cut) === r.judgement!.useful) correct += 1;
      }
      const accuracy = correct / judged.length;
      if (!best || accuracy > best.accuracy) best = { value: cut, accuracy };
    }
  }

  return {
    rows: rows.length,
    judged: judged.length,
    agreements,
    falsePositives,
    falseNegatives,
    agreementRate: judged.length ? agreements / judged.length : 0,
    bestLexicalThreshold: best,
  };
}

/** Default ledger location, alongside the VoiceLog. */
export function defaultShadowPath(pdHome: string): string {
  return join(pdHome, 'ranking-shadow.jsonl');
}
