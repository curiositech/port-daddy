import XCTest
@testable import FleetBar

final class FleetBarUpdaterTests: XCTestCase {
    func testReleaseArtifactPinsExactTagAndArchitecture() throws {
        let artifact = try XCTUnwrap(FleetBarReleaseArtifact(version: "3.30.5", architecture: "arm64"))
        XCTAssertEqual(artifact.archiveName, "PortDaddy-FleetBar-macOS-arm64.zip")
        XCTAssertEqual(
            artifact.archiveURL.absoluteString,
            "https://github.com/curiositech/port-daddy/releases/download/v3.30.5/PortDaddy-FleetBar-macOS-arm64.zip"
        )
        XCTAssertEqual(
            artifact.checksumURL.absoluteString,
            "https://github.com/curiositech/port-daddy/releases/download/v3.30.5/PortDaddy-FleetBar-macOS-arm64.zip.sha256"
        )
    }

    func testReleaseArtifactRejectsMutableOrMalformedVersions() {
        XCTAssertNil(FleetBarReleaseArtifact(version: "latest", architecture: "arm64"))
        XCTAssertNil(FleetBarReleaseArtifact(version: "3.30.5/../../latest", architecture: "arm64"))
        XCTAssertNil(FleetBarReleaseArtifact(version: "3.30.5", architecture: "unknown"))
    }

    func testChecksumParserRequiresExactArchiveName() throws {
        let digest = String(repeating: "a", count: 64)
        XCTAssertEqual(
            try FleetBarReleaseInstaller.expectedChecksum(
                from: "\(digest)  PortDaddy-FleetBar-macOS-arm64.zip\n",
                archiveName: "PortDaddy-FleetBar-macOS-arm64.zip"
            ),
            digest
        )
        XCTAssertThrowsError(
            try FleetBarReleaseInstaller.expectedChecksum(
                from: "\(digest)  another.zip\n",
                archiveName: "PortDaddy-FleetBar-macOS-arm64.zip"
            )
        ) { error in
            XCTAssertEqual(error as? FleetBarUpdateError, .checksumFilenameMismatch)
        }
    }

    func testChecksumParserRejectsAmbiguousOrInvalidFiles() {
        let digest = String(repeating: "b", count: 64)
        XCTAssertThrowsError(
            try FleetBarReleaseInstaller.expectedChecksum(
                from: "\(digest)  FleetBar.zip\n\(digest)  FleetBar.zip\n",
                archiveName: "FleetBar.zip"
            )
        )
        XCTAssertThrowsError(
            try FleetBarReleaseInstaller.expectedChecksum(
                from: "not-a-digest  FleetBar.zip\n",
                archiveName: "FleetBar.zip"
            )
        )
    }

    func testBusyStateCoversInstallAndRelaunchOnly() {
        XCTAssertFalse(FleetBarUpdateState.idle.isBusy)
        XCTAssertTrue(FleetBarUpdateState.installing(version: "3.30.5").isBusy)
        XCTAssertTrue(FleetBarUpdateState.relaunching(version: "3.30.5").isBusy)
        XCTAssertFalse(FleetBarUpdateState.failed(message: "offline").isBusy)
    }
}
