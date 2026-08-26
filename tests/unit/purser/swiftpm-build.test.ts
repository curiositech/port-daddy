// swiftpm-build.test.ts – verifies that the iOS SwiftPM project can be built.
import path from "path";
import { execSync } from "child_process";

// Resolve the repository root reliably regardless of whether __filename or __dirname is used.
// __dirname points to the directory containing this file (repo_root/tests/unit/purser).
// Moving three levels up lands at the repository root.
const REPO_ROOT = path.resolve(__dirname, "../../..");

const PD_IOS = path.join(REPO_ROOT, "apps", "pd-ios");

describe("iOS SwiftPM build", () => {
  it("should build the PortDaddy iOS target without errors", () => {
    // Run `swift build` inside the iOS app directory.
    // The command is executed in a child process; any non‑zero exit code will cause the test to fail.
    execSync("swift build", { cwd: PD_IOS, stdio: "inherit" });
  });
});
