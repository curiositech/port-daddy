import XCTest
@testable import FleetBar

/// Pins the wire contracts the berth manager reads: `GET /whoami` and the
/// `~/.port-daddy/dev-daemons.json` registry. A daemon-side rename or a dropped
/// field would otherwise silently empty the switcher.
final class BerthDirectoryTests: XCTestCase {

    func testDecodesWhoamiResponse() throws {
        let json = """
        {
          "service": "port-daddy",
          "version": "3.20.0",
          "pid": 11467,
          "daemon": {
            "tier": "dev-latest",
            "label": "dev-latest",
            "color": "#3B82F6",
            "sourceDir": "/Users/me/coding/tmp/cut-run",
            "gitBranch": "fix/cut-fleetbar-zip-name",
            "gitRev": "e5fc5b75",
            "builtAt": "2026-06-19T08:35:46.293Z",
            "port": 9886,
            "canonical": false
          }
        }
        """
        let who = try JSONDecoder().decode(WhoamiResponse.self, from: Data(json.utf8))
        XCTAssertEqual(who.version, "3.20.0")
        XCTAssertEqual(who.pid, 11467)
        XCTAssertEqual(who.daemon.tier, "dev-latest")
        XCTAssertEqual(who.daemon.port, 9886)
        XCTAssertFalse(who.daemon.canonical)
        XCTAssertEqual(who.daemon.gitBranch, "fix/cut-fleetbar-zip-name")
    }

    func testDecodesStableWhoami() throws {
        let json = """
        {
          "service": "port-daddy", "version": "3.20.0", "pid": 75439,
          "daemon": {
            "tier": "stable", "label": "stable", "color": "#E6A23C",
            "sourceDir": null, "gitBranch": "main", "gitRev": "01a27a96e1",
            "builtAt": "2026-06-19T06:15:55.338Z", "port": 43121, "canonical": true
          }
        }
        """
        let who = try JSONDecoder().decode(WhoamiResponse.self, from: Data(json.utf8))
        XCTAssertTrue(who.daemon.canonical)
        XCTAssertNil(who.daemon.sourceDir)
        XCTAssertEqual(who.daemon.port, 43121)
    }

    func testDecodesDevDaemonRegistry() throws {
        let json = """
        [
          {
            "label": "dev-latest", "tier": "dev-latest", "port": 9886,
            "sourceDir": "/Users/me/coding/tmp/cut-run", "pid": 11467,
            "gitRev": "e5fc5b75", "color": "#3B82F6",
            "startedAt": "2026-06-19T08:35:46.548Z"
          }
        ]
        """
        let records = try JSONDecoder().decode([DevDaemonRecord].self, from: Data(json.utf8))
        XCTAssertEqual(records.count, 1)
        XCTAssertEqual(records[0].label, "dev-latest")
        XCTAssertEqual(records[0].port, 9886)
        XCTAssertEqual(records[0].pid, 11467)
        XCTAssertEqual(records[0].color, "#3B82F6")
    }

    func testCanonicalBerthSourceSummary() {
        let stable = Berth(
            tier: "stable", label: "stable", port: 43121, colorHex: "#E6A23C",
            canonical: true, sourceDir: nil, gitBranch: nil, gitRev: nil, pid: nil,
            reachable: true, version: "3.20.0")
        XCTAssertEqual(stable.sourceSummary, "brew release · canonical")
        // Build the expected URL from the canonical resolver, never a literal.
        XCTAssertEqual(stable.url, "http://127.0.0.1:\(DaemonLocation.canonicalPreferredPort)")
    }

    func testDevBerthSourceSummaryJoinsBranchRevAndDir() {
        let dev = Berth(
            tier: "dev-latest", label: "dev-latest", port: 9886, colorHex: "#3B82F6",
            canonical: false, sourceDir: "/Users/me/coding/tmp/cut-run",
            gitBranch: "fix/cut-fleetbar-zip-name", gitRev: "e5fc5b75", pid: 11467,
            reachable: true, version: "3.20.0")
        let summary = dev.sourceSummary
        XCTAssertTrue(summary.contains("fix/cut-fleetbar-zip-name"))
        XCTAssertTrue(summary.contains("@e5fc5b75"))
        XCTAssertTrue(summary.contains("·"))
    }

    func testBerthColorParsesHexAndFallsBack() {
        let good = Berth(
            tier: "dev-latest", label: "x", port: 1, colorHex: "#3B82F6",
            canonical: false, sourceDir: nil, gitBranch: nil, gitRev: nil, pid: nil,
            reachable: true, version: nil)
        // A parseable hex resolves; a malformed one falls back to the dormant tone
        // rather than crashing or rendering nothing.
        XCTAssertEqual(good.color, Fleet.Color.hex("#3B82F6"))
        let bad = Berth(
            tier: "codebase", label: "y", port: 2, colorHex: "not-a-color",
            canonical: false, sourceDir: nil, gitBranch: nil, gitRev: nil, pid: nil,
            reachable: false, version: nil)
        XCTAssertEqual(bad.color, Fleet.Color.dormant)
    }
}
