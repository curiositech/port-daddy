/**
 * MCP output governor: the universal backstop that bounds EVERY tool result
 * the MCP server returns to a calling agent.
 *
 * Contract: an MCP tool result must always fit in the caller's context
 * window. Harnesses hard-fail tool results past ~25k tokens, and a failed
 * awareness call is worse than a truncated one. Per-tool digests (e.g.
 * `lib/swarm-awareness-digest.ts`) are the smart shaping layer — they decide
 * *what matters* for a given tool. This governor is the dumb, unconditional
 * layer underneath: no tool, present or future, can return an unbounded
 * payload, because every result passes through {@link governToolOutput} at
 * the single dispatch choke point in `mcp/server.ts`.
 *
 * Truncation is never silent, and the digest stays a lens rather than a
 * replacement: the appended notice states the tool name, exact shown/total
 * character counts, that the tail is cut (so truncated JSON is knowingly
 * invalid), and how to zoom back to the full artifact — narrower tool
 * arguments or the daemon HTTP API, which retains full fidelity.
 */

/** Character budget for a single MCP tool result. ~15k tokens — comfortably
 * under every harness's tool-result cap, with room for the harness's own
 * envelope. Override per-process with PD_MCP_MAX_OUTPUT_CHARS. */
export const DEFAULT_MAX_TOOL_OUTPUT_CHARS = 60_000;

/** Floor for the env override so a misconfigured value can't make every tool
 * result useless. */
const MIN_BUDGET = 2_000;

function budgetFromEnv(): number {
  const raw = process.env.PD_MCP_MAX_OUTPUT_CHARS;
  if (!raw) return DEFAULT_MAX_TOOL_OUTPUT_CHARS;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= MIN_BUDGET ? parsed : DEFAULT_MAX_TOOL_OUTPUT_CHARS;
}

/**
 * Bound a tool result to the output budget.
 *
 * Under budget: returned untouched. Over budget: the head is kept (tools
 * front-load summaries; the tail is detail) and an explicit governor notice
 * is appended naming the tool, the shown/total counts, and the zoom-back
 * paths. The notice is part of the budget — the returned string never
 * exceeds `maxChars`.
 */
export function governToolOutput(toolName: string, text: string, maxChars?: number): string {
  const budget = maxChars ?? budgetFromEnv();
  if (text.length <= budget) return text;

  const notice =
    `\n…[pd output governor: "${toolName}" produced ${text.length.toLocaleString('en-US')} chars; ` +
    `showing the first {SHOWN} to protect your context window. The tail is cut — if this was JSON it is ` +
    `no longer valid past this point. Zoom back in with narrower arguments (project/limit/since) or via ` +
    `the daemon HTTP API, which keeps full fidelity.]`;

  const head = Math.max(0, budget - (notice.length + 16));
  return text.slice(0, head) + notice.replace('{SHOWN}', head.toLocaleString('en-US'));
}
