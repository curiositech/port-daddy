import AppKit
import SwiftUI
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

    @MainActor
    func testRenderSignedUpdateStatesWhenRequested() throws {
        guard let output = ProcessInfo.processInfo.environment["FLEETBAR_UPDATE_SNAPSHOT_DIR"] else {
            throw XCTSkip("Set FLEETBAR_UPDATE_SNAPSHOT_DIR to render signed-update visual proof.")
        }
        let outputURL = URL(fileURLWithPath: output, isDirectory: true)
        try FileManager.default.createDirectory(at: outputURL, withIntermediateDirectories: true)
        let states: [(String, FleetBarUpdateState)] = [
            ("01-ready", .idle),
            ("02-verifying", .installing(version: "3.30.5")),
            ("03-failed", .failed(message: "macOS did not accept the downloaded app as notarized. Nothing was installed.")),
        ]

        for (name, state) in states {
            let updater = FleetBarUpdater(initialState: state)
            let root = FleetBarUpdateCard(
                appVersion: SemanticVersion("3.30.4")!,
                daemonVersion: SemanticVersion("3.30.5")!,
                updater: updater
            )
            .frame(width: 440)
            .padding(20)
            .background(Color(red: 0.08, green: 0.08, blue: 0.08))
            .preferredColorScheme(.dark)
            let host = NSHostingView(rootView: root)
            host.frame = NSRect(x: 0, y: 0, width: 480, height: 230)
            host.layoutSubtreeIfNeeded()

            guard let bitmap = host.bitmapImageRepForCachingDisplay(in: host.bounds) else {
                return XCTFail("could not allocate update-card bitmap")
            }
            host.cacheDisplay(in: host.bounds, to: bitmap)
            guard let png = bitmap.representation(using: .png, properties: [:]) else {
                return XCTFail("could not encode update-card PNG")
            }
            try png.write(to: outputURL.appendingPathComponent("\(name).png"), options: .atomic)
        }
    }
}
