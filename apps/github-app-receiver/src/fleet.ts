/**
 * Fleet config parser for the cloud executor.
 *
 * Reads pd-fleet.yml from the repo and extracts ships whose trigger matches
 * a given event. The model selected is the first cloudflare fallback entry,
 * falling back to a sane default per ship.
 *
 * This is a minimal parser — it handles the YAML subset that pd-fleet.yml
 * actually uses (block scalars, nested maps, sequences) without pulling in
 * a full YAML library. Cloud executor only needs the `fleet.agents` section.
 */

export interface ShipConfig {
  name: string;
  trigger: string | string[];
  prompt: string;
  cfModel: string;
  role: string;
  telos: string;
  /** When true, ship needs execution (bash/write) — dispatch to GHA instead */
  needsExecution: boolean;
}

// Default Cloudflare AI model per ship if not declared in fallbacks
const DEFAULT_CF_MODEL = '@cf/qwen/qwen3-30b-a3b-fp8';
const CODER_CF_MODEL = '@cf/qwen/qwen2.5-coder-32b-instruct';

// Tools that require local execution (can't run in a Worker)
const EXECUTION_TOOLS_RE = /Bash\((?!gh)[^)]*\)/;

/**
 * Very minimal YAML extraction. Instead of a full YAML parse, we use
 * Workers AI itself to extract the fleet config as JSON — meta, but
 * accurate and zero-dependency.
 *
 * Returns null if the extraction fails; callers fall back to built-in defaults.
 */
export async function parseFleetShips(
  fleetYaml: string,
  trigger: string,
  ai: Ai,
): Promise<ShipConfig[] | null> {
  const prompt = `Extract all ships from this pd-fleet.yml that have trigger "${trigger}" or "${trigger.split(':')[0]}:*".

Return ONLY a JSON array, no markdown fences, no explanation. Each element:
{
  "name": "<ship-name>",
  "trigger": "<trigger-value>",
  "prompt": "<full prompt text>",
  "cfModel": "<first @cf/ model from fallbacks array, or null>",
  "role": "<telos field value, or first sentence of prompt>",
  "telos": "<telos field value or empty>",
  "allowedTools": "<allowedTools value or empty>"
}

pd-fleet.yml:
\`\`\`yaml
${fleetYaml.slice(0, 12000)}
\`\`\``;

  try {
    const res = (await ai.run('@cf/qwen/qwen3-30b-a3b-fp8', {
      messages: [{ role: 'user', content: prompt }],
    })) as { response?: string };

    const text = (res.response ?? '').trim();
    // Strip markdown fences if model added them
    const json = text.replace(/^```[a-z]*\n?/m, '').replace(/\n?```$/m, '').trim();
    const raw = JSON.parse(json) as Array<{
      name: string;
      trigger: string;
      prompt: string;
      cfModel: string | null;
      role: string;
      telos: string;
      allowedTools: string;
    }>;

    return raw.map(s => ({
      name: s.name,
      trigger: s.trigger,
      prompt: s.prompt,
      cfModel: s.cfModel ?? (s.name.includes('reviewer') ? CODER_CF_MODEL : DEFAULT_CF_MODEL),
      role: s.telos || s.role || `${s.name} ship`,
      telos: s.telos,
      needsExecution: EXECUTION_TOOLS_RE.test(s.allowedTools ?? ''),
    }));
  } catch {
    return null;
  }
}

/**
 * Built-in fallback ship configs for the four PR-review ships.
 * Used when pd-fleet.yml can't be fetched or parsed.
 */
export function defaultPRShips(): ShipConfig[] {
  return [
    {
      name: 'code-reviewer',
      trigger: 'pull_request:opened',
      prompt: `You are pd-reviewer, a code reviewer for the Port Daddy project.

Review the PR diff below. Look for:
- Bugs, logic errors, off-by-one errors, null dereferences
- Security issues (injection, auth bypass, secret leaks)
- Violations of patterns established in existing code
- TypeScript type safety issues
- Missing error handling at system boundaries

Output format:
- Severity-ranked list of findings (HIGH / MED / LOW)
- Each finding: file:line, severity, description, suggested fix
- If nothing notable: output nothing (silence = clean)
- No praise, no "looks good", no filler

Be direct. Cite specific lines. Flag ADR violations if you see them.`,
      cfModel: CODER_CF_MODEL,
      role: 'Catch the bugs the diff would otherwise ship.',
      telos: 'Catch the bugs the diff would otherwise ship; cite ADRs.',
      needsExecution: false,
    },
    {
      name: 'qa',
      trigger: 'pull_request:opened',
      prompt: `You are pd-qa, a QA analyst for the Port Daddy project.

Review the PR diff for:
- Missing test coverage for changed logic
- Edge cases not handled (empty inputs, concurrent calls, error paths)
- Coordination invariants that could break (port claims, sessions, locks)
- Schema migrations without rollback paths
- Breaking changes to public APIs without version bumps

Output:
- List of QA gaps by severity
- Specific test scenarios that should exist but don't
- Silence if the PR is well-tested`,
      cfModel: DEFAULT_CF_MODEL,
      role: 'Find the test gaps and edge cases the author missed.',
      telos: 'Find the edge cases.',
      needsExecution: false,
    },
    {
      name: 'red-team',
      trigger: 'pull_request:opened',
      prompt: `You are pd-redteam, a security adversary for the Port Daddy project.

Surface gate: only proceed if the diff touches auth, crypto, secrets, capabilities, file claims, cost tracking, bonds, or arbiter code. Otherwise output nothing.

If gated in, probe for:
- Capability escalation (can an agent exceed its declared permissions?)
- Replay attacks on tokens or messages
- Race conditions in claim/lock acquisition
- Cost overrun via malicious inputs
- Auth bypass in route handlers
- TOCTOU in file operations

For each finding: write the falsifiable attack construction and its impact. Be adversarial, not polite.`,
      cfModel: DEFAULT_CF_MODEL,
      role: 'Probe for security vulnerabilities in auth and capability surfaces.',
      telos: 'Find the attack before an adversary does.',
      needsExecution: false,
    },
  ];
}
