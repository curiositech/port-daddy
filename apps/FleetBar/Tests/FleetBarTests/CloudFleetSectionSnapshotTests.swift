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
            switch request.url?.path {
            case "/v1/fleet/health":
                return StubURLProtocol.Stub(status: 200, body: Self.healthFixture)
            case "/v1/fleet/activity":
                return StubURLProtocol.Stub(status: 200, body: Self.activityFixture)
            case "/v1/fleet/runs/intent%3Adelivery-live", "/v1/fleet/runs/intent:delivery-live":
                return StubURLProtocol.Stub(status: 200, body: Self.detailFixture)
            case "/v1/fleet/runs/intent%3Adelivery-queued", "/v1/fleet/runs/intent:delivery-queued":
                return StubURLProtocol.Stub(status: 200, body: Self.queuedDetailFixture)
            default:
                XCTFail("Unexpected Cloud Fleet snapshot path: \(request.url?.absoluteString ?? "nil")")
                return StubURLProtocol.Stub(status: 404, body: Data())
            }
        }

        let account = OperatorAccount(
            token: "pdu_snapshot_fixture",
            relayUrl: "https://relay.example",
            login: "operator"
        )
        let store = CloudFleetStore(
            autoStart: false,
            session: StubURLProtocol.makeSession(),
            loadAccount: { account }
        )
        await store.refresh()
        XCTAssertEqual(store.health?.knownIntents, 23)
        XCTAssertEqual(store.runs.count, 3)
        XCTAssertEqual(store.steps.count, 4)
        if env["FLEETBAR_CLOUD_FLEET_SNAPSHOT_SELECTION"] == "queued",
           let queued = store.runs.first(where: { $0.state == "queued" }) {
            await store.select(queued)
            XCTAssertEqual(store.selectedRun?.prNumber, 9003)
            XCTAssertEqual(store.steps.count, 2)
        }

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

    private static let healthFixture = """
    {
      "code": "OK",
      "error": null,
      "paused": false,
      "lastRunAgeSec": 9,
      "queueDepthEstimate": 7,
      "running": 1,
      "retrying": 0,
      "superseded": 12,
      "failedAdmission": 1,
      "oldestQueuedAgeSec": 488,
      "knownIntents": 23
    }
    """.data(using: .utf8)!

    private static let activityFixture = """
    {
      "code": "OK",
      "error": null,
      "runs": [
        {
          "id": "intent:delivery-live",
          "deliveryId": "delivery-live",
          "repo": "curiositech/port-daddy",
          "prNumber": 8996,
          "prUrl": "https://github.com/curiositech/port-daddy/pull/8996",
          "headSha": "f03a307",
          "conclusion": null,
          "ships": ["red-team", "qa", "systems"],
          "neurons": 48,
          "elapsedMs": 55000,
          "createdAt": 1787412000,
          "state": "running",
          "generation": 3,
          "attemptCount": 4,
          "queuedAt": 1787411900,
          "startedAt": 1787411950,
          "lastProgressAt": 1787412040,
          "finishedAt": null,
          "expectedStartAt": 1787411950,
          "expectedFinishAt": 1787412300,
          "queueAheadEstimate": 0,
          "hasTranscript": true,
          "supersededBy": null,
          "lastError": null
        },
        {
          "id": "intent:delivery-queued",
          "deliveryId": "delivery-queued",
          "repo": "curiositech/port-daddy",
          "prNumber": 9003,
          "prUrl": "https://github.com/curiositech/port-daddy/pull/9003",
          "headSha": "af44d20",
          "conclusion": null,
          "ships": [],
          "neurons": 0,
          "elapsedMs": 0,
          "createdAt": 1787411980,
          "state": "queued",
          "generation": 2,
          "attemptCount": 1,
          "queuedAt": 1787411980,
          "startedAt": null,
          "lastProgressAt": 1787411980,
          "finishedAt": null,
          "expectedStartAt": 1787412360,
          "expectedFinishAt": 1787412750,
          "queueAheadEstimate": 6,
          "hasTranscript": true,
          "supersededBy": null,
          "lastError": null
        },
        {
          "id": "run:delivery-failed",
          "deliveryId": "delivery-failed",
          "repo": "curiositech/port-daddy",
          "prNumber": 8889,
          "prUrl": "https://github.com/curiositech/port-daddy/pull/8889",
          "headSha": "749b4dc",
          "conclusion": "failure",
          "ships": ["red-team", "qa"],
          "neurons": 31,
          "elapsedMs": 396637,
          "createdAt": 1787390085,
          "state": "completed",
          "generation": 1,
          "attemptCount": 4,
          "queuedAt": 1787389600,
          "startedAt": 1787389688,
          "lastProgressAt": 1787390080,
          "finishedAt": 1787390085,
          "expectedStartAt": 1787389688,
          "expectedFinishAt": 1787390080,
          "queueAheadEstimate": 0,
          "hasTranscript": true,
          "supersededBy": null,
          "lastError": "Required Fleet verdict contained blocking findings"
        }
      ]
    }
    """.data(using: .utf8)!

    private static let detailFixture = """
    {
      "code": "OK",
      "error": null,
      "run": {
        "id": "intent:delivery-live",
        "deliveryId": "delivery-live",
        "repo": "curiositech/port-daddy",
        "prNumber": 8996,
        "prUrl": "https://github.com/curiositech/port-daddy/pull/8996",
        "headSha": "f03a307cde1e5e25c4c488005a3241aa6ba51605",
        "conclusion": null,
        "ships": ["red-team", "qa", "systems"],
        "neurons": 48,
        "elapsedMs": 55000,
        "createdAt": 1787412000,
        "state": "running",
        "generation": 3,
        "attemptCount": 4,
        "queuedAt": 1787411900,
        "startedAt": 1787411950,
        "lastProgressAt": 1787412040,
        "finishedAt": null,
        "expectedStartAt": 1787411950,
        "expectedFinishAt": 1787412300,
        "queueAheadEstimate": 0,
        "hasTranscript": true,
        "supersededBy": null,
        "lastError": null
      },
      "steps": [
        {
          "seq": 1,
          "kind": "delivery-attempt",
          "ship": null,
          "title": "Delivery attempt 4 received",
          "createdAt": 1787412000
        },
        {
          "seq": 2,
          "kind": "checkpoint-reused",
          "ship": "red-team",
          "title": "Reused completed red-team verdict",
          "createdAt": 1787412010
        },
        {
          "seq": 3,
          "kind": "map-chunk",
          "ship": "qa",
          "title": "QA inspecting chunk 3 of 8",
          "createdAt": 1787412030
        },
        {
          "seq": 4,
          "kind": "checkpoint-written",
          "ship": "qa",
          "title": "QA progress checkpoint persisted",
          "createdAt": 1787412040
        }
      ]
    }
    """.data(using: .utf8)!

    private static let queuedDetailFixture = """
    {
      "code": "OK",
      "error": null,
      "run": {
        "id": "intent:delivery-queued",
        "deliveryId": "delivery-queued",
        "repo": "curiositech/port-daddy",
        "prNumber": 9003,
        "prUrl": "https://github.com/curiositech/port-daddy/pull/9003",
        "headSha": "af44d20b2f9a5f29dc7a7e2dfa6d6723625b8c4f",
        "conclusion": null,
        "ships": [],
        "neurons": 0,
        "elapsedMs": 0,
        "createdAt": 1787411980,
        "state": "queued",
        "generation": 2,
        "attemptCount": 1,
        "queuedAt": 1787411980,
        "startedAt": null,
        "lastProgressAt": 1787411980,
        "finishedAt": null,
        "expectedStartAt": 1787412360,
        "expectedFinishAt": 1787412750,
        "queueAheadEstimate": 6,
        "hasTranscript": true,
        "supersededBy": null,
        "lastError": null
      },
      "steps": [
        {
          "seq": 1,
          "kind": "delivery-attempt",
          "ship": null,
          "title": "Delivery accepted into the durable queue",
          "createdAt": 1787411980
        },
        {
          "seq": 2,
          "kind": "checkpoint-written",
          "ship": null,
          "title": "Queue position estimate recorded",
          "createdAt": 1787411982
        }
      ]
    }
    """.data(using: .utf8)!

}
