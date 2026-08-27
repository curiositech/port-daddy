/**
 * Dream Rig containment authority.
 *
 * Porthole is allowed to explain a run. It is never allowed to confer trust on
 * one. A Dream Rig WorkReceipt becomes strong only after this module proves
 * that every declared hostile case was contained and carries machine evidence.
 */

export const DREAM_RIG_THREAT_CLASSES = [
  "ssrf",
  "path-traversal",
  "secret-exfil",
  "resource-exhaustion",
  "side-effect-write",
] as const;

export const DREAM_RIG_ISOLATION_DIMENSIONS = [
  "filesystem",
  "network",
  "process",
  "secrets",
  "resources",
] as const;

export type DreamRigThreatClass = (typeof DREAM_RIG_THREAT_CLASSES)[number];
export type DreamRigIsolationDimension =
  (typeof DREAM_RIG_ISOLATION_DIMENSIONS)[number];

export interface DreamRigAdversarialCase {
  id: string;
  invariant: string;
  threatClass: DreamRigThreatClass;
  expected: "contained";
  failMode: "fail-closed" | "fail-open";
  mechanism?: string;
}

export interface DreamRigContainmentSpec {
  schema: "pd.agent-harbor.dream-rig-containment-spec.v0";
  name: string;
  isolationDimensions: DreamRigIsolationDimension[];
  egressPolicy: {
    mode: "allowlist" | "denylist";
    default: "allow" | "deny";
    allow?: string[];
    deny?: string[];
  };
  pathPolicy: {
    mode: "allowlist" | "denylist";
    jailRoot: string;
    allowedRoots?: string[];
    realpathChecked?: boolean;
  };
  secretHandling: {
    mode: "fake-credentials" | "redacted" | "real" | "none";
    exposedToSandbox: boolean;
  };
  adversarialCases: DreamRigAdversarialCase[];
  failMode: "fail-closed" | "fail-open";
}

export interface ThreatClassCoverage {
  total: number;
  containedAssertions: number;
  evidencedContainments: number;
  containmentRate: number;
}

export interface DreamRigProbeResult {
  caseId: string;
  threatClass: DreamRigThreatClass;
  contained: boolean;
  mechanism: string;
  /** A real process exit code or a durable artifact is required for evidence. */
  exitCode?: number | null;
  artifactPath?: string | null;
  detail?: string;
}

export interface DreamRigContainmentReport {
  schema: "pd.agent-harbor.dream-rig-containment-report.v0";
  reportId: string;
  specName: string;
  pass: boolean;
  coverageByThreatClass: Record<DreamRigThreatClass, ThreatClassCoverage>;
  findings: string[];
  recommendations: string[];
  residualRisks: string[];
  probeResults: DreamRigProbeResult[];
  generatedAt: string;
}

export interface DreamRigDesignAudit {
  pass: boolean;
  coverageByThreatClass: Record<
    DreamRigThreatClass,
    Omit<ThreatClassCoverage, "evidencedContainments">
  >;
  findings: string[];
  recommendations: string[];
}

export class DreamRigContainmentBlockedError extends Error {
  readonly code = "DREAM_RIG_CONTAINMENT_BLOCKED";

  constructor(message: string) {
    super(message);
    this.name = "DreamRigContainmentBlockedError";
  }
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function hasMachineEvidence(result: DreamRigProbeResult): boolean {
  return typeof result.exitCode === "number" || nonEmpty(result.artifactPath);
}

function designCoverage(
  cases: readonly DreamRigAdversarialCase[],
): DreamRigDesignAudit["coverageByThreatClass"] {
  return Object.fromEntries(
    DREAM_RIG_THREAT_CLASSES.map((threatClass) => {
      const scoped = cases.filter(
        (testCase) => testCase.threatClass === threatClass,
      );
      const containedAssertions = scoped.filter(
        (testCase) => testCase.expected === "contained",
      ).length;
      return [
        threatClass,
        {
          total: scoped.length,
          containedAssertions,
          containmentRate:
            scoped.length === 0 ? 0 : containedAssertions / scoped.length,
        },
      ];
    }),
  ) as DreamRigDesignAudit["coverageByThreatClass"];
}

/** Audit whether a harness specification could prove containment at all. */
export function auditDreamRigContainmentSpec(
  spec: DreamRigContainmentSpec,
): DreamRigDesignAudit {
  const findings: string[] = [];
  const recommendations: string[] = [];
  const coverageByThreatClass = designCoverage(spec.adversarialCases ?? []);

  if (spec.schema !== "pd.agent-harbor.dream-rig-containment-spec.v0") {
    findings.push(
      "The containment spec has an unknown or missing schema discriminator.",
    );
  }
  if (!nonEmpty(spec.name))
    findings.push("The containment spec must have a non-empty name.");

  for (const dimension of DREAM_RIG_ISOLATION_DIMENSIONS) {
    if (!spec.isolationDimensions?.includes(dimension)) {
      findings.push(`Isolation dimension '${dimension}' is not declared.`);
      recommendations.push(
        `Declare '${dimension}' and add a hostile probe that exercises it.`,
      );
    }
  }

  for (const threatClass of DREAM_RIG_THREAT_CLASSES) {
    if (coverageByThreatClass[threatClass].total === 0) {
      findings.push(
        `No adversarial case exercises threat class '${threatClass}'.`,
      );
      recommendations.push(
        `Add at least one fail-closed '${threatClass}' case.`,
      );
    }
  }

  const unknownThreatClasses = [
    ...new Set(
      (spec.adversarialCases ?? []).map(
        (testCase) => testCase.threatClass as string,
      ),
    ),
  ].filter(
    (threatClass) =>
      !(DREAM_RIG_THREAT_CLASSES as readonly string[]).includes(threatClass),
  );
  for (const threatClass of unknownThreatClasses) {
    findings.push(
      `Adversarial case references unknown threat class '${threatClass}'.`,
    );
  }

  const unknownDimensions = [
    ...new Set(
      (spec.isolationDimensions ?? []).map((dimension) => dimension as string),
    ),
  ].filter(
    (dimension) =>
      !(DREAM_RIG_ISOLATION_DIMENSIONS as readonly string[]).includes(
        dimension,
      ),
  );
  for (const dimension of unknownDimensions) {
    findings.push(
      `Containment spec references unknown isolation dimension '${dimension}'.`,
    );
  }

  if (spec.egressPolicy?.mode !== "allowlist") {
    findings.push("Network egress must use an allowlist, not a denylist.");
  }
  if (spec.egressPolicy?.default !== "deny") {
    findings.push("Network egress must default to deny.");
  }
  if (spec.pathPolicy?.mode !== "allowlist") {
    findings.push("Filesystem access must use an allowlist, not a denylist.");
  }
  if (!nonEmpty(spec.pathPolicy?.jailRoot)) {
    findings.push("Filesystem containment must name a jail root.");
  }
  if (spec.pathPolicy?.realpathChecked !== true) {
    findings.push(
      "Filesystem containment must canonicalize existing prefixes with realpath.",
    );
  }
  if (
    spec.secretHandling?.mode === "real" &&
    spec.secretHandling.exposedToSandbox
  ) {
    findings.push(
      "Real credentials must never be exposed to an adversarial scenario.",
    );
  }
  if (spec.secretHandling?.mode === "none") {
    findings.push(
      "Secret isolation cannot be claimed without a redacted or fake canary credential.",
    );
  }
  if (spec.failMode !== "fail-closed") {
    findings.push("The harness-wide failure mode must be fail-closed.");
  }

  const seenIds = new Set<string>();
  for (const testCase of spec.adversarialCases ?? []) {
    if (!nonEmpty(testCase.id) || seenIds.has(testCase.id)) {
      findings.push(
        `Adversarial case id '${testCase.id}' is empty or duplicated.`,
      );
    }
    seenIds.add(testCase.id);
    if (testCase.failMode !== "fail-closed") {
      findings.push(`Adversarial case '${testCase.id}' is fail-open.`);
    }
    if (testCase.expected !== "contained") {
      findings.push(
        `Adversarial case '${testCase.id}' does not require containment.`,
      );
    }
  }

  return {
    pass: findings.length === 0,
    coverageByThreatClass,
    findings,
    recommendations,
  };
}

/**
 * Combine design policy and executed probe evidence. A declared containment is
 * not evidence: every case needs a real exit code or durable artifact.
 */
export function buildDreamRigContainmentReport(
  spec: DreamRigContainmentSpec,
  probeResults: readonly DreamRigProbeResult[],
  metadata: {
    reportId: string;
    generatedAt?: string;
    residualRisks?: string[];
  },
): DreamRigContainmentReport {
  const design = auditDreamRigContainmentSpec(spec);
  const findings = [...design.findings];
  const recommendations = [...design.recommendations];
  const resultsByCase = new Map<string, DreamRigProbeResult>();
  const knownCases = new Map(
    spec.adversarialCases.map((testCase) => [testCase.id, testCase]),
  );

  for (const result of probeResults) {
    if (resultsByCase.has(result.caseId)) {
      findings.push(`Probe result '${result.caseId}' is duplicated.`);
      continue;
    }
    if (!knownCases.has(result.caseId)) {
      findings.push(
        `Probe result '${result.caseId}' has no declared adversarial case.`,
      );
    }
    resultsByCase.set(result.caseId, result);
  }

  for (const testCase of spec.adversarialCases) {
    const result = resultsByCase.get(testCase.id);
    if (!result) {
      findings.push(
        `Adversarial case '${testCase.id}' has no runtime probe result.`,
      );
      continue;
    }
    if (result.threatClass !== testCase.threatClass) {
      findings.push(
        `Probe '${testCase.id}' reports '${result.threatClass}' but the spec declares '${testCase.threatClass}'.`,
      );
    }
    if (!result.contained) {
      findings.push(
        `Adversarial case '${testCase.id}' escaped or could not prove containment.`,
      );
    }
    if (!hasMachineEvidence(result)) {
      findings.push(
        `Adversarial case '${testCase.id}' has no machine-verifiable evidence.`,
      );
    }
  }

  const coverageByThreatClass = Object.fromEntries(
    DREAM_RIG_THREAT_CLASSES.map((threatClass) => {
      const scopedCases = spec.adversarialCases.filter(
        (testCase) => testCase.threatClass === threatClass,
      );
      const evidencedContainments = scopedCases.filter((testCase) => {
        const result = resultsByCase.get(testCase.id);
        return result?.contained === true && hasMachineEvidence(result);
      }).length;
      return [
        threatClass,
        {
          total: scopedCases.length,
          containedAssertions:
            design.coverageByThreatClass[threatClass].containedAssertions,
          evidencedContainments,
          containmentRate:
            scopedCases.length === 0
              ? 0
              : evidencedContainments / scopedCases.length,
        },
      ];
    }),
  ) as DreamRigContainmentReport["coverageByThreatClass"];

  for (const threatClass of DREAM_RIG_THREAT_CLASSES) {
    if (coverageByThreatClass[threatClass].containmentRate !== 1) {
      recommendations.push(
        `Keep '${threatClass}' blocked until every declared case has containment evidence.`,
      );
    }
  }

  return {
    schema: "pd.agent-harbor.dream-rig-containment-report.v0",
    reportId: metadata.reportId,
    specName: spec.name,
    pass:
      findings.length === 0 &&
      DREAM_RIG_THREAT_CLASSES.every(
        (threatClass) =>
          coverageByThreatClass[threatClass].containmentRate === 1,
      ),
    coverageByThreatClass,
    findings,
    recommendations: [...new Set(recommendations)],
    residualRisks: [...(metadata.residualRisks ?? [])],
    probeResults: [...probeResults],
    generatedAt: metadata.generatedAt ?? new Date().toISOString(),
  };
}

/** Refuse to confer receipt authority on a red, incomplete, or ambiguous run. */
export function assertDreamRigReceiptContainment(
  report: DreamRigContainmentReport,
): void {
  const reasons = Array.isArray(report.findings)
    ? [...report.findings]
    : ["Containment findings are missing or malformed."];
  if (report.schema !== "pd.agent-harbor.dream-rig-containment-report.v0") {
    reasons.push("Unknown or missing containment report schema discriminator.");
  }
  if (!nonEmpty(report.reportId))
    reasons.push("Missing containment report id.");
  if (!nonEmpty(report.specName))
    reasons.push("Missing containment spec name.");
  if (!nonEmpty(report.generatedAt))
    reasons.push("Missing containment generation timestamp.");
  if (!Array.isArray(report.recommendations))
    reasons.push("Containment recommendations are missing or malformed.");
  if (!Array.isArray(report.residualRisks))
    reasons.push("Containment residual risks are missing or malformed.");

  const coverageKeys =
    report.coverageByThreatClass &&
    typeof report.coverageByThreatClass === "object" &&
    !Array.isArray(report.coverageByThreatClass)
      ? Object.keys(report.coverageByThreatClass)
      : [];
  const unknownCoverageKeys = coverageKeys.filter(
    (key) => !(DREAM_RIG_THREAT_CLASSES as readonly string[]).includes(key),
  );
  if (unknownCoverageKeys.length > 0) {
    reasons.push(`Unknown threat coverage: ${unknownCoverageKeys.join(", ")}.`);
  }

  const probeResults = Array.isArray(report.probeResults)
    ? report.probeResults
    : [];
  if (!Array.isArray(report.probeResults))
    reasons.push("Containment probe results are missing or malformed.");
  const seenCaseIds = new Set<string>();
  for (const result of probeResults) {
    if (!result || typeof result !== "object") {
      reasons.push("A containment probe result is malformed.");
      continue;
    }
    if (!nonEmpty(result.caseId)) reasons.push("A probe has no case id.");
    if (seenCaseIds.has(result.caseId))
      reasons.push(`Duplicate probe result '${result.caseId}'.`);
    seenCaseIds.add(result.caseId);
    if (
      !(DREAM_RIG_THREAT_CLASSES as readonly string[]).includes(
        result.threatClass,
      )
    ) {
      reasons.push(
        `Probe '${result.caseId}' has unknown threat class '${result.threatClass}'.`,
      );
    }
    if (!nonEmpty(result.mechanism))
      reasons.push(`Probe '${result.caseId}' has no containment mechanism.`);
    if (!result.contained || !hasMachineEvidence(result)) {
      reasons.push(
        `Probe '${result.caseId}' is red or lacks machine evidence.`,
      );
    }
  }

  const incomplete: DreamRigThreatClass[] = [];
  for (const threatClass of DREAM_RIG_THREAT_CLASSES) {
    const coverage = report.coverageByThreatClass?.[threatClass];
    const results = probeResults.filter(
      (result) => result.threatClass === threatClass,
    );
    const evidenced = results.filter(
      (result) => result.contained && hasMachineEvidence(result),
    ).length;
    if (
      !coverage ||
      coverage.total < 1 ||
      coverage.containedAssertions !== coverage.total ||
      coverage.evidencedContainments !== coverage.total ||
      coverage.containmentRate !== 1 ||
      results.length !== coverage.total ||
      evidenced !== coverage.total
    ) {
      incomplete.push(threatClass);
    }
  }
  if (incomplete.length > 0)
    reasons.push(`Incomplete threat coverage: ${incomplete.join(", ")}`);

  if (report.pass !== true || reasons.length > 0) {
    throw new DreamRigContainmentBlockedError(
      `Dream Rig receipt remains blocked: ${reasons.join("; ") || "containment did not pass"}`,
    );
  }
}

/** Attach containment without mutating the caller's normalized WorkReceipt. */
export function attachDreamRigContainment<T extends Record<string, unknown>>(
  receipt: T,
  report: DreamRigContainmentReport,
): T & { containment: DreamRigContainmentReport } {
  assertDreamRigReceiptContainment(report);
  return { ...receipt, containment: report };
}
