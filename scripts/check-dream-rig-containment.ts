#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  auditDreamRigContainmentSpec,
  type DreamRigContainmentSpec,
} from "../lib/harness/dream-rig-containment.js";

const configPath = resolve(
  process.argv[2] ?? "config/harness/dream-rig-containment.json",
);

try {
  const spec = JSON.parse(
    readFileSync(configPath, "utf8"),
  ) as DreamRigContainmentSpec;
  const report = auditDreamRigContainmentSpec(spec);
  process.stdout.write(
    `${JSON.stringify({ configPath, ...report }, null, 2)}\n`,
  );
  if (!report.pass || report.findings.length > 0) process.exitCode = 1;
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(
    `dream-rig containment design check failed: ${message}\n`,
  );
  process.exitCode = 1;
}
