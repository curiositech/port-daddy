import XCTest
@testable import FleetBar

final class BuildInfoTests: XCTestCase {

    // MARK: - SemanticVersion parsing

    func testParsesPlainTriple() {
        let v = SemanticVersion("3.18.0")
        XCTAssertNotNil(v)
        XCTAssertEqual(v?.major, 3)
        XCTAssertEqual(v?.minor, 18)
        XCTAssertEqual(v?.patch, 0)
        XCTAssertEqual(v?.isPrerelease, false)
    }

    func testToleratesVPrefixAndBuildMetadata() {
        XCTAssertEqual(SemanticVersion("v3.18.0"), SemanticVersion("3.18.0"))
        XCTAssertEqual(SemanticVersion("3.18.0+build.42"), SemanticVersion("3.18.0"))
    }

    func testParsesPrereleaseAndSortsBelowRelease() {
        let rc = SemanticVersion("3.14.1-rc.1")
        let release = SemanticVersion("3.14.1")
        XCTAssertEqual(rc?.isPrerelease, true)
        XCTAssertNotNil(rc)
        XCTAssertNotNil(release)
        XCTAssertLessThan(rc!, release!)
    }

    func testRejectsGarbage() {
        XCTAssertNil(SemanticVersion("not-a-version"))
        XCTAssertNil(SemanticVersion(""))
        XCTAssertNil(SemanticVersion("3"))
    }

    func testNumericNotLexicographicOrdering() {
        // The whole point: 3.9.0 < 3.10.0 even though "9" > "1" as text.
        XCTAssertLessThan(SemanticVersion("3.9.0")!, SemanticVersion("3.10.0")!)
        XCTAssertLessThan(SemanticVersion("3.18.0")!, SemanticVersion("3.18.1")!)
        XCTAssertLessThan(SemanticVersion("3.18.0")!, SemanticVersion("4.0.0")!)
    }

    // MARK: - Skew evaluation

    func testAppBehindDaemonIsFlagged() {
        let skew = FleetVersion.evaluate(appVersion: "3.17.0", daemonVersion: "3.19.0")
        guard case let .appBehindDaemon(app, daemon) = skew else {
            return XCTFail("expected appBehindDaemon, got \(skew)")
        }
        XCTAssertEqual(app, SemanticVersion("3.17.0"))
        XCTAssertEqual(daemon, SemanticVersion("3.19.0"))
        XCTAssertTrue(skew.needsAttention)
    }

    func testDaemonBehindAppIsFlagged() {
        let skew = FleetVersion.evaluate(appVersion: "3.19.0", daemonVersion: "3.18.0")
        guard case .daemonBehindApp = skew else {
            return XCTFail("expected daemonBehindApp, got \(skew)")
        }
        XCTAssertTrue(skew.needsAttention)
    }

    func testEqualVersionsAreUpToDate() {
        let skew = FleetVersion.evaluate(appVersion: "3.18.0", daemonVersion: "3.18.0")
        XCTAssertEqual(skew, .upToDate)
        XCTAssertFalse(skew.needsAttention)
    }

    func testUnknownVersionNeverNags() {
        // A dev build (nil app version) or an undecodable daemon version must
        // never produce a false staleness warning.
        XCTAssertEqual(FleetVersion.evaluate(appVersion: nil, daemonVersion: "3.18.0"), .upToDate)
        XCTAssertEqual(FleetVersion.evaluate(appVersion: "3.18.0", daemonVersion: nil), .upToDate)
        XCTAssertEqual(FleetVersion.evaluate(appVersion: "garbage", daemonVersion: "3.18.0"), .upToDate)
        XCTAssertEqual(FleetVersion.evaluate(appVersion: "1.0", daemonVersion: "3.18.0"), .appBehindDaemon(app: SemanticVersion("1.0")!, daemon: SemanticVersion("3.18.0")!))
    }

    func testDownloadPageIsHttps() {
        XCTAssertEqual(FleetVersion.downloadPageURL.scheme, "https")
        XCTAssertEqual(FleetVersion.downloadPageURL.host, "portdaddy.dev")
    }
}
