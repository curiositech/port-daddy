import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  assertSafeOutboundUrl,
  SsrfBlockedError,
} from "../../lib/fleet/url-guard.js";
import { containPath, PathEscapeError } from "../../lib/fleet/path-guard.js";
import { scrubRawSecretsFromEnv } from "../../lib/coast-guard.js";
import {
  attachDreamRigContainment,
  auditDreamRigContainmentSpec,
  buildDreamRigContainmentReport,
  DreamRigContainmentBlockedError,
  type DreamRigContainmentSpec,
  type DreamRigProbeResult,
} from "../../lib/harness/dream-rig-containment.js";

const spec = JSON.parse(
  readFileSync(
    new URL("../../config/harness/dream-rig-containment.json", import.meta.url),
    "utf8",
  ),
) as DreamRigContainmentSpec;

function evidencedResults(): DreamRigProbeResult[] {
  return spec.adversarialCases.map((testCase) => ({
    caseId: testCase.id,
    threatClass: testCase.threatClass,
    contained: true,
    mechanism: testCase.mechanism ?? "test-mechanism",
    artifactPath: `blob:${testCase.id}`,
  }));
}

describe("Dream Rig adversarial containment authority", () => {
  let scratchRoot: string;

  beforeEach(() => {
    const durableScratch = join(homedir(), "coding", "tmp");
    mkdirSync(durableScratch, { recursive: true });
    scratchRoot = mkdtempSync(
      join(durableScratch, "pd-dream-rig-containment-"),
    );
  });

  afterEach(() => {
    rmSync(scratchRoot, { recursive: true, force: true });
  });

  it("accepts the fail-closed five-threat design specification", () => {
    const audit = auditDreamRigContainmentSpec(spec);
    expect(audit.pass).toBe(true);
    expect(audit.findings).toEqual([]);
    expect(
      Object.values(audit.coverageByThreatClass).every(
        (coverage) => coverage.containmentRate === 1,
      ),
    ).toBe(true);
  });

  it.each([
    "http://169.254.169.254/latest/meta-data/",
    "http://2852039166/latest/meta-data/",
    "http://0xA9FEA9FE/latest/meta-data/",
    "http://0177.0.0.1:9876/",
    "http://[::ffff:a9fe:a9fe]/",
    "http://localhost:9876/",
  ])("contains SSRF destination %s before socket use", (url) => {
    expect(() =>
      assertSafeOutboundUrl(url, { allowlist: ["proof.portdaddy.invalid"] }),
    ).toThrow(SsrfBlockedError);
  });

  it("contains direct traversal and pre-planted symlink escapes", () => {
    const jail = join(scratchRoot, "jail");
    const outside = join(scratchRoot, "outside");
    mkdirSync(jail);
    mkdirSync(outside);

    expect(() => containPath("../outside/loot", { roots: [jail] })).toThrow(
      PathEscapeError,
    );

    symlinkSync(outside, join(jail, "escape-link"), "dir");
    expect(() =>
      containPath(join(jail, "escape-link", "loot"), { roots: [jail] }),
    ).toThrow(PathEscapeError);
  });

  it("scrubs a fake canary credential before the scenario receives its environment", () => {
    const canaryKey = "PD_DREAM_RIG_CANARY";
    const canaryValue = "pd_canary_not_a_real_credential_01";
    const result = scrubRawSecretsFromEnv(
      { PATH: "/usr/bin", [canaryKey]: canaryValue },
      [canaryKey],
    );
    expect(result.scrubbed).toContain(canaryKey);
    expect(result.env[canaryKey]).toBeUndefined();
    expect(Object.values(result.env)).not.toContain(canaryValue);
  });

  it("refuses persistence side effects even when they are lexically inside the jail", () => {
    const jail = join(scratchRoot, "repo");
    mkdirSync(join(jail, ".git", "hooks"), { recursive: true });
    expect(() =>
      containPath(join(jail, ".git", "hooks", "post-commit"), {
        roots: [jail],
      }),
    ).toThrow(PathEscapeError);
  });

  it("keeps a receipt blocked when resource containment cannot be proven", () => {
    const results = evidencedResults().map((result) =>
      result.threatClass === "resource-exhaustion"
        ? {
            ...result,
            contained: false,
            detail: "No scenario-local hard process/memory cap is active.",
          }
        : result,
    );
    const report = buildDreamRigContainmentReport(spec, results, {
      reportId: "containment_resource_red",
      generatedAt: "2026-08-26T12:00:00.000Z",
      residualRisks: [
        "Forced egress and hard macOS resource limits are not yet structural.",
      ],
    });

    expect(report.pass).toBe(false);
    expect(
      report.coverageByThreatClass["resource-exhaustion"].containmentRate,
    ).toBe(0);
    expect(() =>
      attachDreamRigContainment(
        { schema: "pd.agent-harbor.work-receipt.v0" },
        report,
      ),
    ).toThrow(DreamRigContainmentBlockedError);
  });

  it("refuses a prose-only containment claim with no exit code or artifact", () => {
    const results = evidencedResults();
    results[0] = { ...results[0], artifactPath: null };
    const report = buildDreamRigContainmentReport(spec, results, {
      reportId: "containment_missing_evidence",
      generatedAt: "2026-08-26T12:00:00.000Z",
    });
    expect(report.pass).toBe(false);
    expect(report.findings).toContain(
      "Adversarial case 'ssrf-metadata' has no machine-verifiable evidence.",
    );
  });

  it("refuses a missing hostile case rather than treating absence as success", () => {
    const report = buildDreamRigContainmentReport(
      spec,
      evidencedResults().slice(1),
      {
        reportId: "containment_missing_case",
        generatedAt: "2026-08-26T12:00:00.000Z",
      },
    );
    expect(report.pass).toBe(false);
    expect(report.findings).toContain(
      "Adversarial case 'ssrf-metadata' has no runtime probe result.",
    );
  });

  it("rejects a forged green summary whose underlying probe is red", () => {
    const report = buildDreamRigContainmentReport(spec, evidencedResults(), {
      reportId: "containment_forged_summary",
      generatedAt: "2026-08-26T12:00:00.000Z",
    });
    report.probeResults[0] = { ...report.probeResults[0], contained: false };

    expect(() =>
      attachDreamRigContainment(
        { schema: "pd.agent-harbor.work-receipt.v0" },
        report,
      ),
    ).toThrow(DreamRigContainmentBlockedError);
  });

  it("attaches a complete containment report without mutating the normalized receipt", () => {
    const report = buildDreamRigContainmentReport(spec, evidencedResults(), {
      reportId: "containment_green",
      generatedAt: "2026-08-26T12:00:00.000Z",
      residualRisks: [
        "The fixture proves receipt authority, not current host-level forced egress.",
      ],
    });
    const receipt = {
      schema: "pd.agent-harbor.work-receipt.v0",
      receiptId: "receipt_01",
    };
    const sealed = attachDreamRigContainment(receipt, report);

    expect(report.pass).toBe(true);
    expect(sealed.containment.reportId).toBe("containment_green");
    expect(receipt).not.toHaveProperty("containment");
  });
});
