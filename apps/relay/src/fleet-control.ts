/**
 * Fleet control-plane API (operator-gated) for the Port Daddy Relay.
 *
 * Five endpoints under /v1/fleet/ that let pd-console read, validate, smoke-test,
 * optimize, and persist fleet definitions (pd-fleet.yml + fleet/ships/*.md).
 *
 * ZERO-TRUST INVARIANT: {@link commitFilesAndOpenPr} is the ONLY mutation core
 * and it NEVER hot-mutates the runtime fleet definition or D1. It commits to a
 * NEW git branch and opens a PR to the trusted ref (main). The fleet-executor
 * always reads config from main, so a PR editing pd-fleet.yml cannot redefine
 * its own gating. All mutations are git-backed, auditable, and gated by PR
 * review/merge. Two routes flow through it: {@link handleFleetSave} (operator
 * token, the relay's own repo) and the Shipwright's session-scoped PR route
 * (shipwright.ts, the signed-in user's own installation) — neither has any
 * other way to write.
 *
 * Shared envelope: every response is JSON `{ code, error, ... }`. `code` starts
 * with OK on success (HTTP 200); BAD_* → 400; UNAUTHORIZED → 401;
 * *_NOT_FOUND / NOT_FOUND → 404 (config ref rejection is 400 per its contract);
 * *_ERROR → 500. Operator gate is shared with the rest of the relay via
 * {@link operatorOnly} (timing-safe token compare).
 */

import { CF_ROLE_MODELS } from '../../shared/model-registry.generated.js';
import { operatorOnly } from './handlers.js';
import { validateFleetYaml, parseAllShips } from './fleet-parser.js';
import {
  getRepoToken,
  fetchRepoFile,
  listShipFiles,
  getBranchSha,
  createBranch,
  putFile,
  createPr,
} from './github-app.js';
import type { Env } from './types.js';

// ── Envelope helpers ──────────────────────────────────────────────────────────

function envelope(status: number, body: Record<string, unknown>): Response {
  return Response.json(body, { status });
}

function fleetErr(code: string, error: string, status: number): Response {
  return envelope(status, { code, error });
}

// Per-request bounds to protect Workers AI quota.
const MAX_SAMPLE_DIFF_CHARS = 12_000;
const MAX_PROMPT_CHARS = 8_000;
const SMOKE_TEST_MAX_TOKENS = 2_000;
const OPTIMIZE_MAX_TOKENS = 1_500;

// Trusted-ref allowlist for the read path. The executor reads from the default
// branch; operators may also inspect a stable mirror or a release line. PR head
// SHAs are NEVER in this list (zero-trust).
function isTrustedRef(ref: string, defaultBranch: string): boolean {
  if (ref === defaultBranch) return true;
  if (ref === 'main' || ref === 'main-stable') return true;
  return /^release\/[A-Za-z0-9._\-/]+$/.test(ref);
}

async function readJson<T>(request: Request): Promise<T | null> {
  try {
    return (await request.json()) as T;
  } catch {
    return null;
  }
}

// ── 1. GET /v1/fleet/config ─────────────────────────────────────────────────

/**
 * Fetch the current pd-fleet.yml and ship-file list from a trusted ref.
 * Reads only — never mutates. Resolves a repo-scoped GitHub App token.
 */
export async function handleFleetConfig(request: Request, env: Env): Promise<Response> {
  const denied = operatorOnly(request, env);
  if (denied) return denied;

  const url = new URL(request.url);
  const defaultBranch = env.DEFAULT_BRANCH ?? 'main';
  const ref = url.searchParams.get('ref') ?? defaultBranch;

  if (!isTrustedRef(ref, defaultBranch)) {
    // Per the config contract this rejection is a 400 with code NOT_FOUND.
    return fleetErr('NOT_FOUND', `Ref '${ref}' not in trusted refs allowlist`, 400);
  }

  const owner = env.GITHUB_OWNER;
  const repo = env.GITHUB_REPO;
  if (!owner || !repo || !env.GITHUB_APP_ID || !env.GITHUB_APP_PRIVATE_KEY) {
    return fleetErr('INTERNAL_ERROR', 'GitHub App not configured', 500);
  }

  try {
    const token = await getRepoToken(
      env.GITHUB_APP_ID,
      env.GITHUB_APP_PRIVATE_KEY,
      owner,
      repo,
      env.KV,
    );
    const [yaml, ships] = await Promise.all([
      fetchRepoFile(owner, repo, 'pd-fleet.yml', ref, token),
      listShipFiles(owner, repo, ref, token),
    ]);
    if (yaml === null) {
      return fleetErr('NOT_FOUND', `pd-fleet.yml not found at ref '${ref}'`, 404);
    }
    return envelope(200, { code: 'OK', error: null, ref, yaml, ships });
  } catch (e) {
    return fleetErr('INTERNAL_ERROR', `config read failed: ${publicError(e)}`, 500);
  }
}

// ── 2. POST /v1/fleet/validate ──────────────────────────────────────────────

interface ValidateBody {
  yaml?: string;
}

/**
 * Deterministically parse and schema-validate a pd-fleet.yml string. No AI, no
 * network — pure. Returns a structured ship list on success and structured
 * errors on failure.
 */
export async function handleFleetValidate(request: Request, env: Env): Promise<Response> {
  const denied = operatorOnly(request, env);
  if (denied) return denied;

  const body = await readJson<ValidateBody>(request);
  if (!body || typeof body.yaml !== 'string') {
    return fleetErr('BAD_JSON', 'Request body must be JSON {yaml: string}', 400);
  }

  const result = validateFleetYaml(body.yaml);
  const status = result.code === 'OK_VALID' ? 200 : 400;
  return envelope(status, {
    code: result.code,
    error: result.message,
    valid: result.valid,
    ships: result.ships,
    errors: result.errors,
  });
}

// ── 3. POST /v1/fleet/smoke-test ─────────────────────────────────────────────

interface SmokeTestBody {
  ship?: string;
  yaml?: string;
  sampleDiff?: string;
}

/**
 * Run ONE ship once on Workers AI against a sample diff. Bounded (max_tokens +
 * diff cap) and cheap. Returns the ship output, a coarse verdict, and elapsed
 * wall time.
 */
export async function handleFleetSmokeTest(request: Request, env: Env): Promise<Response> {
  const denied = operatorOnly(request, env);
  if (denied) return denied;

  const body = await readJson<SmokeTestBody>(request);
  if (!body || typeof body.ship !== 'string' || typeof body.yaml !== 'string') {
    return fleetErr('BAD_JSON', 'Request body must be JSON {ship, yaml, sampleDiff}', 400);
  }

  const ships = parseAllShips(body.yaml);
  const ship = ships.find((s) => s.name === body.ship);
  if (!ship) {
    return fleetErr('SHIP_NOT_FOUND', `Ship '${body.ship}' not found in parsed YAML`, 404);
  }

  if (!env.AI) {
    return fleetErr('AI_ERROR', 'Workers AI binding not configured', 500);
  }

  const sampleDiff = (body.sampleDiff ?? '').slice(0, MAX_SAMPLE_DIFF_CHARS);
  const userMessage = `${ship.prompt}\n\n--- SAMPLE DIFF ---\n${sampleDiff}`;
  const start = Date.now();

  try {
    const res = (await env.AI.run(ship.cfModel as Parameters<typeof env.AI.run>[0], {
      messages: [
        { role: 'system', content: ship.role },
        { role: 'user', content: userMessage },
      ],
      max_tokens: SMOKE_TEST_MAX_TOKENS,
    })) as { response?: string };
    const ms = Date.now() - start;
    const output = (res.response ?? '').trim();
    return envelope(200, {
      code: 'OK_TESTED',
      error: null,
      output,
      verdict: output ? 'OK' : 'ERROR',
      ms,
    });
  } catch (e) {
    return fleetErr('AI_ERROR', `Workers AI request failed: ${publicError(e)}`, 500);
  }
}

// ── 4. POST /v1/fleet/optimize-prompt ────────────────────────────────────────

interface OptimizeBody {
  ship?: string;
  currentPrompt?: string;
  goal?: string;
}

const OPTIMIZE_MODEL = CF_ROLE_MODELS.optimize;

/**
 * Rewrite a ship prompt for clarity and LLM execution quality. The metaprompt
 * asks for an `IMPROVED:`/`RATIONALE:` block which we parse into the two fields.
 */
export async function handleFleetOptimizePrompt(request: Request, env: Env): Promise<Response> {
  const denied = operatorOnly(request, env);
  if (denied) return denied;

  const body = await readJson<OptimizeBody>(request);
  if (!body || typeof body.currentPrompt !== 'string') {
    return fleetErr('BAD_JSON', 'Request body must be JSON {ship, currentPrompt, goal?}', 400);
  }

  if (!env.AI) {
    return fleetErr('AI_ERROR', 'Workers AI binding not configured', 500);
  }

  const currentPrompt = body.currentPrompt.slice(0, MAX_PROMPT_CHARS);
  const goal = typeof body.goal === 'string' && body.goal.trim()
    ? body.goal.trim()
    : 'clarity, specificity, and reliable LLM execution';

  const system =
    'You are a prompt engineer. Rewrite the given ship prompt to improve ' +
    `${goal}. Preserve the original intent and constraints. ` +
    'Respond in EXACTLY this format and nothing else:\n' +
    'IMPROVED:\n<the full improved prompt>\n' +
    'RATIONALE:\n<one-line explanation of what changed and why>';

  try {
    const res = (await env.AI.run(OPTIMIZE_MODEL as Parameters<typeof env.AI.run>[0], {
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: body.ship ? `Ship: ${promptLabel(body.ship)}\n\n${currentPrompt}` : currentPrompt },
      ],
      max_tokens: OPTIMIZE_MAX_TOKENS,
    })) as { response?: string };

    const { improvedPrompt, rationale } = parseOptimizeResponse(res.response ?? '', currentPrompt);
    return envelope(200, { code: 'OK', error: null, improvedPrompt, rationale });
  } catch (e) {
    return fleetErr('AI_ERROR', `Workers AI request failed: ${publicError(e)}`, 500);
  }
}

/**
 * Split an `IMPROVED:`/`RATIONALE:` response into its two fields. Falls back to
 * the raw response as the improved prompt (and an empty rationale) when the
 * markers are absent, so a non-conforming model never breaks the endpoint.
 */
export function parseOptimizeResponse(
  raw: string,
  fallbackPrompt: string,
): { improvedPrompt: string; rationale: string } {
  const improvedMatch = raw.match(/IMPROVED:\s*([\s\S]*?)(?:\n\s*RATIONALE:|$)/i);
  const rationaleMatch = raw.match(/RATIONALE:\s*([\s\S]*)$/i);
  const improvedPrompt = improvedMatch?.[1]?.trim() || raw.trim() || fallbackPrompt;
  const rationale = rationaleMatch?.[1]?.trim() ?? '';
  return { improvedPrompt, rationale };
}

// ── 5. POST /v1/fleet/save ───────────────────────────────────────────────────

interface SaveBody {
  files?: Record<string, string>;
  message?: string;
  branchName?: string;
}

const BRANCH_PREFIX = 'fleet-control-plane-';
const BRANCH_RE = /^fleet-control-plane-[A-Za-z0-9.\-]+$/;

function generateBranchName(): string {
  const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const rand = Math.random().toString(36).slice(2, 8);
  return `${BRANCH_PREFIX}${date}-${rand}`;
}

/** Reject path traversal / absolute paths. */
function safePath(path: string): boolean {
  return (
    path.length > 0 &&
    !path.startsWith('/') &&
    !path.includes('..') &&
    !path.includes('\\')
  );
}

/**
 * The single git-mutation core (zero-trust invariant): create a NEW branch off
 * `baseBranch`, commit `files` onto it, and open a PR back into `baseBranch`.
 * It never touches D1 and never pushes to an existing branch — review/merge of
 * the PR is the only way any of these bytes take effect. Both fleet mutation
 * routes ({@link handleFleetSave} and the Shipwright's open-PR route) call
 * THIS, so there is exactly one code path capable of writing.
 *
 * @returns The created PR's html_url.
 * @throws On any GitHub API failure — callers translate to their own envelope.
 */
export async function commitFilesAndOpenPr(m: {
  owner: string;
  repo: string;
  /** The trusted ref the branch forks from and the PR merges into. */
  baseBranch: string;
  branchName: string;
  files: Record<string, string>;
  commitMessage: string;
  prTitle: string;
  prBody: string;
  token: string;
}): Promise<string> {
  // 1. base SHA → 2. new branch
  const baseSha = await getBranchSha(m.owner, m.repo, m.baseBranch, m.token);
  await createBranch(m.owner, m.repo, m.branchName, baseSha, m.token);

  // 3. commit each file (base SHA looked up against the trusted ref)
  for (const p of Object.keys(m.files)) {
    await putFile(m.owner, m.repo, p, m.files[p]!, m.commitMessage, m.branchName, m.baseBranch, m.token);
  }

  // 4. open the PR — this is the gate; nothing runs against this branch.
  return createPr(m.owner, m.repo, m.prTitle, m.prBody, m.branchName, m.baseBranch, m.token);
}

/**
 * Commit the changed files to a NEW branch and open a PR to the trusted ref.
 * NEVER mutates runtime/D1 fleet state — the executor reads from main, and the
 * PR review/merge is the gate (zero-trust invariant).
 */
export async function handleFleetSave(request: Request, env: Env): Promise<Response> {
  const denied = operatorOnly(request, env);
  if (denied) return denied;

  const body = await readJson<SaveBody>(request);
  if (!body || typeof body.files !== 'object' || body.files === null) {
    return fleetErr('BAD_JSON', 'Request body must be JSON {files, message, branchName?}', 400);
  }
  const message = typeof body.message === 'string' && body.message.trim()
    ? body.message.trim()
    : 'fleet: update fleet definition via control-plane';

  const files = body.files;
  const paths = Object.keys(files);
  if (paths.length === 0) {
    return fleetErr('BAD_REQUEST', 'files must contain at least one path', 400);
  }
  for (const p of paths) {
    if (!safePath(p) || typeof files[p] !== 'string') {
      return fleetErr('BAD_REQUEST', `Invalid file path or content: ${p}`, 400);
    }
  }

  const branchName = body.branchName ?? generateBranchName();
  if (!branchName.startsWith(BRANCH_PREFIX)) {
    return fleetErr('BAD_REQUEST', `branchName must start with ${BRANCH_PREFIX}`, 400);
  }
  if (!BRANCH_RE.test(branchName)) {
    return fleetErr('BAD_REQUEST', 'branchName must be alphanumeric with dashes only', 400);
  }

  const owner = env.GITHUB_OWNER;
  const repo = env.GITHUB_REPO;
  if (!owner || !repo || !env.GITHUB_APP_ID || !env.GITHUB_APP_PRIVATE_KEY) {
    return fleetErr('INTERNAL_ERROR', 'GitHub App not configured', 500);
  }
  const baseBranch = env.DEFAULT_BRANCH ?? 'main';

  try {
    const token = await getRepoToken(
      env.GITHUB_APP_ID,
      env.GITHUB_APP_PRIVATE_KEY,
      owner,
      repo,
      env.KV,
    );

    const prBody = [
      'Automated fleet definition change via the Port Daddy relay control-plane.',
      '',
      `**Files changed:** ${paths.map((p) => `\`${p}\``).join(', ')}`,
      '',
      'Zero-trust: this PR targets a new branch only. The fleet-executor reads',
      `config from \`${baseBranch}\`, so this change does not take effect until`,
      'this PR is reviewed and merged.',
    ].join('\n');

    const prUrl = await commitFilesAndOpenPr({
      owner,
      repo,
      baseBranch,
      branchName,
      files,
      commitMessage: message,
      prTitle: message,
      prBody,
      token,
    });
    return envelope(200, { code: 'OK_PR_CREATED', error: null, prUrl, branch: branchName });
  } catch (e) {
    return fleetErr('INTERNAL_ERROR', `GitHub API save failed: ${publicError(e)}`, 500);
  }
}

// ── shared ──────────────────────────────────────────────────────────────────

function promptLabel(raw: string): string {
  return raw.replace(/[\r\n\t]+/g, ' ').replace(/[^\w .:-]/g, '').trim().slice(0, 80) || 'ship';
}

function publicError(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e);
  return raw
    .replace(/gh[pousr]_[A-Za-z0-9_]+/g, '[redacted-token]')
    .replace(/-----BEGIN [^-]+-----[\s\S]*?-----END [^-]+-----/g, '[redacted-key]')
    .replace(/[A-Za-z0-9+/=]{80,}/g, '[redacted-long-secret]')
    .slice(0, 240);
}
