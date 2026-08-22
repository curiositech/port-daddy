import AppKit
import SwiftUI
import XCTest
@testable import FleetBar

@MainActor
final class CloudFleetSectionSnapshotTests: XCTestCase {
    override func tearDown() {
        StubURLProtocol.handler = nil
        super.tearDown()
    }

    func testRenderCloudFleetSectionSnapshotWhenRequested() async throws {
        let env = ProcessInfo.processInfo.environment
        let output = env["FLEETBAR_CLOUD_FLEET_SNAPSHOT_OUT"]

        StubURLProtocol.handler = { request in
            XCTAssertEqual(request.url?.path, "/telemetry/cloud-app")
            return StubURLProtocol.Stub(status: 200, body: Self.cloudFleetFixture)
        }

        let store = CloudFleetStore(
            autoStart: false,
            baseURL: "http://127.0.0.1:8080",
            session: StubURLProtocol.makeSession()
        )
        await store.refresh()
        XCTAssertEqual(store.summary?.totals.events, 6)

        let view = CloudFleetSection(
            store: store,
            localProjects: Self.localProjects,
            localDaemonURL: "http://127.0.0.1:8080",
            compact: false
        )
        .frame(width: 1120, height: 760)
        .preferredColorScheme(.dark)

        let hosting = NSHostingView(rootView: view)
        hosting.frame = NSRect(x: 0, y: 0, width: 1120, height: 760)
        hosting.appearance = NSAppearance(named: .darkAqua)
        hosting.layoutSubtreeIfNeeded()
        guard let bitmap = hosting.bitmapImageRepForCachingDisplay(in: hosting.bounds) else {
            XCTFail("Could not encode Cloud Fleet snapshot as PNG")
            return
        }
        hosting.cacheDisplay(in: hosting.bounds, to: bitmap)
        guard let data = bitmap.representation(using: .png, properties: [:]) else {
            XCTFail("Could not encode Cloud Fleet snapshot as PNG")
            return
        }

        XCTAssertGreaterThan(data.count, 50_000, "Cloud Fleet snapshot should render real UI, not a blank placeholder.")

        if let output, !output.isEmpty {
            let url = URL(fileURLWithPath: output)
            try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
            try data.write(to: url)
        } else {
            let artifactURL = URL(fileURLWithPath: #filePath)
                .deletingLastPathComponent()
                .deletingLastPathComponent()
                .deletingLastPathComponent()
                .appendingPathComponent("docs/artifacts/cloud-fleet/fleetbar-cloud-fleet.png")
            let artifactData = try Data(contentsOf: artifactURL)
            XCTAssertGreaterThan(artifactData.count, 50_000, "Committed Cloud Fleet proof artifact should exist and be non-empty.")
        }
    }

    private static var localProjects: [FleetProject] {
        var project = FleetProject(
            id: "/Users/operator/coding/port-daddy",
            name: "port-daddy",
            projectDir: "/Users/operator/coding/port-daddy",
            worktree: nil,
            agents: [
                FleetAgent(
                    id: "port-daddy:fleetbar:cloudfleet",
                    name: "fleetbar-cloudfleet",
                    type: .triggered,
                    isConfiguredFleetAgent: true,
                    inboxTarget: nil,
                    purpose: "Expose Cloud Fleet in FleetBar",
                    status: .running,
                    statusReason: "native surface validation",
                    queueDepth: 0,
                    lastActivity: nil,
                    lastEvent: nil,
                    lastSummary: nil,
                    recentFiles: []
                ),
            ]
        )
        project.operatorState = .running
        project.operatorSummary = "Cloud Fleet native surface is running against the local daemon."
        return [project]
    }

    private static let cloudFleetFixture = """
    {
      "success": true,
      "generatedAt": 1777328400000,
      "since": 1777242000000,
      "totals": {
        "events": 6,
        "uniqueDeliveries": 4,
        "shipEvents": 4,
        "checkRunEvents": 1,
        "commentEvents": 1,
        "errorEvents": 0,
        "costUsd": 0.0475,
        "estimatedCostEvents": 2,
        "unknownCostEvents": 0
      },
      "byRepo": [{
        "owner": "curiositech",
        "repo": "port-daddy",
        "events": 6,
        "pullRequests": 2,
        "costUsd": 0.0475,
        "lastSeen": 1777328300000
      }],
      "byShip": [{
        "ship": "red-team",
        "events": 3,
        "clean": 2,
        "findings": 1,
        "errors": 0,
        "costUsd": 0.0312,
        "lastSeen": 1777328300000
      }],
      "byBackend": [{
        "backend": "cloudflare",
        "model": "@cf/qwen/qwen3-30b-a3b-fp8",
        "events": 6,
        "costUsd": 0.0475,
        "estimatedCostEvents": 2
      }],
      "recent": [
        {
          "id": "delivery-7:red-team",
          "ts": 1777328300000,
          "source": "github-app-receiver",
          "provider": "github",
          "appSlug": "port-daddy-cloud-fleet",
          "deliveryId": "delivery-7",
          "event": "pull_request",
          "action": "synchronize",
          "owner": "curiositech",
          "repo": "port-daddy",
          "prNumber": 892,
          "sha": "abc123",
          "ship": "red-team",
          "role": "reviewer",
          "status": "clean",
          "conclusion": "success",
          "backend": "cloudflare",
          "model": "@cf/qwen/qwen3-30b-a3b-fp8",
          "durationMs": 1200,
          "inputTokens": 500,
          "cachedInputTokens": 0,
          "outputTokens": 25,
          "costUsd": 0.0132,
          "costIsEstimate": true,
          "commentUrl": "https://github.com/curiositech/port-daddy/pull/892#issuecomment-1",
          "checkRunId": 42
        },
        {
          "id": "delivery-8:qa",
          "ts": 1777324700000,
          "source": "github-app-receiver",
          "provider": "github",
          "appSlug": "port-daddy-cloud-fleet",
          "deliveryId": "delivery-8",
          "event": "check_run",
          "action": "completed",
          "owner": "curiositech",
          "repo": "port-daddy",
          "prNumber": 891,
          "sha": "def456",
          "ship": "qa",
          "role": "qa",
          "status": "completed",
          "conclusion": "success",
          "backend": "cloudflare",
          "model": "@cf/qwen/qwen3-30b-a3b-fp8",
          "durationMs": 980,
          "inputTokens": 420,
          "cachedInputTokens": 110,
          "outputTokens": 31,
          "costUsd": 0.0111,
          "costIsEstimate": true,
          "commentUrl": null,
          "checkRunId": 43
        }
      ]
    }
    """.data(using: .utf8)!
}
