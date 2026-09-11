import AppKit
import SwiftUI
import ViewInspector
import XCTest
@testable import FleetBar

@MainActor
final class FleetProposalSectionSnapshotTests: XCTestCase {
    override func tearDown() {
        StubURLProtocol.handler = nil
        super.tearDown()
    }

    func testCriticalAskDisablesAssignmentButLeavesRejectionAvailable() async throws {
        StubURLProtocol.handler = { _ in
            StubURLProtocol.Stub(status: 200, body: Self.pendingProposalEnvelope)
        }
        let store = FleetProposalStore(
            autoStart: false,
            baseURL: "https://daemon.example",
            session: StubURLProtocol.makeSession()
        )
        await store.refresh()
        let reason = "Resolve critical operator ask “Choose deployment target” before starting more work."
        let inspected = try FleetProposalSection(
            store: store,
            criticalBlockTitle: "Choose deployment target"
        ).inspect()

        XCTAssertTrue(try inspected.find(button: "Yes, Assign").isDisabled())
        XCTAssertFalse(try inspected.find(button: "No").isDisabled())
        XCTAssertNoThrow(try inspected.find(text: reason))
    }

    func testRenderFleetProposalSectionSnapshotWhenRequested() async throws {
        let env = ProcessInfo.processInfo.environment
        guard let output = env["FLEETBAR_PROPOSAL_SNAPSHOT_OUT"], !output.isEmpty else {
            throw XCTSkip("Set FLEETBAR_PROPOSAL_SNAPSHOT_OUT to render the Fleet Proposals visual artifact.")
        }
        let baseURL = env["FLEETBAR_PROPOSAL_SNAPSHOT_BASE_URL"]
            ?? "http://127.0.0.1:8080"
        let store = FleetProposalStore(autoStart: false, baseURL: baseURL)
        await store.refresh()
        XCTAssertGreaterThan(store.pending.count, 0, "snapshot fixture daemon should expose pending proposals")

        let view = FleetProposalSection(store: store)
            .frame(width: 1120, height: 760)
            .preferredColorScheme(.dark)

        let hosting = NSHostingView(rootView: view)
        hosting.frame = NSRect(x: 0, y: 0, width: 1120, height: 760)
        hosting.appearance = NSAppearance(named: .darkAqua)
        hosting.layoutSubtreeIfNeeded()
        guard let bitmap = hosting.bitmapImageRepForCachingDisplay(in: hosting.bounds) else {
            XCTFail("Could not encode Fleet Proposals snapshot as PNG")
            return
        }
        hosting.cacheDisplay(in: hosting.bounds, to: bitmap)
        guard let data = bitmap.representation(using: .png, properties: [:]) else {
            XCTFail("Could not encode Fleet Proposals snapshot as PNG")
            return
        }

        let url = URL(fileURLWithPath: output)
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try data.write(to: url)
    }

    private static let pendingProposalEnvelope = """
    {
      "success": true,
      "pendingCount": 1,
      "proposals": [{
        "id": "proposal-1",
        "title": "Build the account lane",
        "summary": "Add native account settings.",
        "proposalMarkdown": "A focused proposal.",
        "sourceShip": "spark",
        "sourceKind": "cloud-fleet",
        "assignmentType": "specialist-pr",
        "baseBranch": "main",
        "writePolicy": "approved-dispatch-only",
        "expectedArtifacts": [],
        "links": [],
        "status": "pending",
        "createdAt": 2000000000000
      }]
    }
    """.data(using: .utf8)!
}
