import XCTest
import SwiftUI
import ViewInspector
@testable import FleetBar

@MainActor
final class CloudFleetStoreTests: XCTestCase {
    func testDecodesCloudFleetTelemetrySummary() throws {
        let json = """
        {
          "success": true,
          "generatedAt": 1777328400000,
          "since": 1777242000000,
          "totals": {
            "events": 3,
            "uniqueDeliveries": 2,
            "shipEvents": 2,
            "checkRunEvents": 1,
            "commentEvents": 1,
            "errorEvents": 0,
            "costUsd": 0.0132,
            "estimatedCostEvents": 1,
            "unknownCostEvents": 0
          },
          "byRepo": [{
            "owner": "curiositech",
            "repo": "port-daddy",
            "events": 3,
            "pullRequests": 1,
            "costUsd": 0.0132,
            "lastSeen": 1777328300000
          }],
          "byShip": [{
            "ship": "red-team",
            "events": 2,
            "clean": 1,
            "findings": 1,
            "errors": 0,
            "costUsd": 0.0132,
            "lastSeen": 1777328300000
          }],
          "byBackend": [{
            "backend": "cloudflare",
            "model": "@cf/qwen/qwen3-30b-a3b-fp8",
            "events": 3,
            "costUsd": 0.0132,
            "estimatedCostEvents": 1
          }],
          "recent": [{
            "id": "delivery-4:red-team",
            "ts": 1777328300000,
            "source": "github-app-receiver",
            "provider": "github",
            "appSlug": "port-daddy-cloud-fleet",
            "deliveryId": "delivery-4",
            "event": "pull_request",
            "action": "synchronize",
            "owner": "curiositech",
            "repo": "port-daddy",
            "prNumber": 628,
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
            "commentUrl": "https://github.com/curiositech/port-daddy/pull/628#issuecomment-1",
            "checkRunId": 42,
            "metadata": {}
          }]
        }
        """.data(using: .utf8)!

        let decoded = try JSONDecoder().decode(CloudFleetTelemetrySummary.self, from: json)

        XCTAssertEqual(decoded.totals.events, 3)
        XCTAssertEqual(decoded.byRepo.first?.displayName, "curiositech/port-daddy")
        XCTAssertEqual(decoded.byShip.first?.ship, "red-team")
        XCTAssertEqual(decoded.recent.first?.repoDisplay, "curiositech/port-daddy")
    }

    func testCloudFleetSectionLabelsLocalCloudAndSafetyCopy() throws {
        let localDaemonURL = "http://127.0.0.1:8080"
        let inspected = try CloudFleetSection(
            store: CloudFleetStore(autoStart: false),
            localProjects: [],
            localDaemonURL: localDaemonURL,
            compact: true
        ).inspect()

        XCTAssertNoThrow(try inspected.find(text: "Cloud Fleet"))
        XCTAssertNoThrow(try inspected.find(text: "LOCAL"))
        XCTAssertNoThrow(try inspected.find(text: localDaemonURL))
        XCTAssertNoThrow(try inspected.find(text: "CLOUD"))
        XCTAssertNoThrow(try inspected.find(text: "SAFETY"))
        XCTAssertNoThrow(try inspected.find(text: "writes require approval"))
    }

    func testCloudFleetStoreRefreshFollowsReboundDaemonURL() async throws {
        var requestedHosts: [String] = []
        StubURLProtocol.handler = { request in
            requestedHosts.append(request.url?.host ?? "")
            XCTAssertEqual(request.url?.path, "/telemetry/cloud-app")
            return StubURLProtocol.Stub(status: 200, body: Self.emptyCloudFleetFixture)
        }

        let store = CloudFleetStore(
            autoStart: false,
            baseURL: "https://first-daemon.example",
            session: StubURLProtocol.makeSession()
        )

        await store.refresh()
        store.rebind(baseURL: "https://feature-berth.example")
        await store.refresh()

        XCTAssertEqual(
            requestedHosts.filter { $0.hasSuffix(".example") },
            ["first-daemon.example", "feature-berth.example"]
        )
        XCTAssertEqual(store.resolvedBaseURL, "https://feature-berth.example")
    }

    private static let emptyCloudFleetFixture = """
    {
      "success": true,
      "generatedAt": 1777328400000,
      "since": 1777242000000,
      "totals": {
        "events": 0,
        "uniqueDeliveries": 0,
        "shipEvents": 0,
        "checkRunEvents": 0,
        "commentEvents": 0,
        "errorEvents": 0,
        "costUsd": 0,
        "estimatedCostEvents": 0,
        "unknownCostEvents": 0
      },
      "byRepo": [],
      "byShip": [],
      "byBackend": [],
      "recent": []
    }
    """.data(using: .utf8)!
}
