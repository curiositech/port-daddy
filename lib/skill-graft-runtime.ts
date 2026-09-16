/**
 * One runtime resolver for every Tool2Vec caller.
 *
 * Building synthetic trigger centroids is materially more expensive than
 * reading an already-warm cache, so it is enabled only by the explicit
 * PD_SKILL_GRAFT_BACKEND actor pin. Daemon reconciliation, the CLI, setup,
 * and fleet ranking all use this resolver; none may invent its own backend
 * cascade or silently inherit the fleet default.
 */

import { transportToAdapter } from './coordination-judge.js';
import { resolveLLMBackend } from './llm-backend-resolver.js';
import { createLLMClient, type LLMClient } from './llm-call.js';

export interface SkillGraftRuntime {
  backend: 'cloudflare' | 'ollama';
  model: string;
  client: LLMClient;
}

/**
 * Determines whether Ollama resolves to the local machine. The privacy design
 * rejects malformed and remote hosts for automatic reconciliation instead of
 * assuming that an Ollama backend is necessarily local.
 *
 * @param env Environment containing the optional OLLAMA_HOST override.
 * @returns True only for an unset host or an explicit loopback hostname.
 */
function isLoopbackOllama(env: NodeJS.ProcessEnv): boolean {
  const raw = env.OLLAMA_HOST?.trim();
  if (!raw) return true;
  try {
    const parsed = new URL(raw.includes('://') ? raw : `http://${raw}`);
    return parsed.hostname === 'localhost'
      || parsed.hostname === '127.0.0.1'
      || parsed.hostname === '::1'
      || parsed.hostname === '[::1]';
  } catch {
    return false;
  }
}

/**
 * Resolves the actor-pinned Tool2Vec generator without inheriting Fleet's
 * default backend. The purpose is one auditable policy boundary shared by
 * manual queries, Fleet ranking, setup, and daemon reconciliation.
 *
 * @param env Environment used to resolve the skill-graft actor backend.
 * @param policy Whether remote/cloud generation is allowed for this caller.
 * @returns A bounded LLM runtime, or null when policy/configuration rejects it.
 */
export function resolveSkillGraftRuntime(
  env: NodeJS.ProcessEnv = process.env,
  policy: { allowRemote?: boolean } = {},
): SkillGraftRuntime | null {
  const resolved = resolveLLMBackend({ actor: 'skill-graft', env });
  if (
    !resolved ||
    resolved.source !== 'actor-env' ||
    (resolved.backend !== 'cloudflare' && resolved.backend !== 'ollama')
  ) {
    return null;
  }
  if (
    policy.allowRemote === false &&
    (resolved.backend !== 'ollama' || !isLoopbackOllama(env))
  ) return null;

  return {
    backend: resolved.backend,
    model: resolved.model,
    client: createLLMClient({
      adapter: transportToAdapter(resolved.transport),
      model: resolved.model,
      timeoutMs: 15_000,
      // A catalog reconcile is deliberately gradual. This local limit is a
      // second brake behind the reconciler's bounded batch size.
      callsPerMinute: 30,
      env,
    }),
  };
}
