/**
 * Type surface for the frozen contract artifact
 * schemas/agent-harbor/v0/compliance-invariants.mjs (ADR-0095 §8).
 * The .mjs file is normative and language-neutral; this declaration only
 * types the TypeScript consumers — it never redefines behavior.
 */
declare module '*/compliance-invariants.mjs' {
  export const LADDER: readonly string[];
  export function levelOrder(level: unknown): number;
  export function levelIsWitnessed(probe: unknown, level: string): boolean;
  export function witnessedComplianceLevel(probe: unknown): string;
  export function checkProbeWitnessing(probe: unknown): {
    valid: boolean;
    witnessedLevel: string;
    violations: string[];
  };
  export function assertProbeWitnessing(probe: unknown): void;
  export function checkNodeWitnessing(
    node: unknown,
    probe: unknown,
  ): { valid: boolean; violations: string[] };
  export function assertNodeWitnessing(node: unknown, probe: unknown): void;
}
