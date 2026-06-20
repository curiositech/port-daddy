import XCTest
@testable import FleetBar

/// The dev-build label is what tells four stacked FleetBars apart from the one
/// installed app, so the classification rules are pinned here.
final class AppChannelTests: XCTestCase {

    func testProductionBundleIDIsProduction() {
        let channel = AppChannel.classify(bundleID: "ai.portdaddy.FleetBar", displayName: nil)
        XCTAssertEqual(channel, .production)
        XCTAssertTrue(channel.isProduction)
        XCTAssertNil(channel.menuBarBadge)
        XCTAssertEqual(channel.displayLabel, "Production")
    }

    func testDevBundleIDDerivesLabelFromTrailingSegment() {
        let channel = AppChannel.classify(
            bundleID: "dev.portdaddy.fleetbar.devlatest", displayName: nil)
        XCTAssertEqual(channel, .dev(label: "devlatest"))
        XCTAssertEqual(channel.menuBarBadge, "DEV")
        XCTAssertEqual(channel.displayLabel, "Dev · devlatest")
        XCTAssertFalse(channel.isProduction)
    }

    func testDisplayNameParentheticalWinsOverBundleSegment() {
        let channel = AppChannel.classify(
            bundleID: "dev.portdaddy.fleetbar.devlatest",
            displayName: "FleetBar (cut-fleetbar-zip)")
        XCTAssertEqual(channel, .dev(label: "cut-fleetbar-zip"))
        XCTAssertEqual(channel.menuBarBadge, "DEV")
        XCTAssertEqual(channel.displayLabel, "Dev · cut-fleetbar-zip")
    }

    func testMissingBundleIDFallsBackToGenericDev() {
        XCTAssertEqual(AppChannel.classify(bundleID: nil, displayName: nil), .dev(label: "dev"))
        XCTAssertEqual(AppChannel.classify(bundleID: "", displayName: nil), .dev(label: "dev"))
    }

    func testTrailingSegmentEqualToBundleNameFallsBackToDev() {
        // A bundle id whose last segment is just "FleetBar" carries no useful label.
        XCTAssertEqual(
            AppChannel.classify(bundleID: "com.example.FleetBar", displayName: nil),
            .dev(label: "dev"))
    }

    func testParentheticalExtraction() {
        XCTAssertEqual(AppChannel.parenthetical(in: "FleetBar (dev-latest)"), "dev-latest")
        XCTAssertNil(AppChannel.parenthetical(in: "FleetBar"))
        XCTAssertNil(AppChannel.parenthetical(in: "FleetBar ()"))
    }
}
