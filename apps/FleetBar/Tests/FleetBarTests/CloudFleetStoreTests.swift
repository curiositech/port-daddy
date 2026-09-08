import XCTest
import SwiftUI
import ViewInspector
@testable import FleetBar

@MainActor
final class CloudFleetStoreTests: XCTestCase {
    override func tearDown() {
        StubURLProtocol.handler = nil
        super.tearDown()
    }

    func testDecodesLogicalRunHealthAndTranscriptShape() throws {
        let json = """
        {
          "id": "intent:delivery-4",
          "deliveryId": "delivery-4",
          "repo": "curiositech/port-daddy",
          "prNumber": 8996,
          "prUrl": "https://github.com/curiositech/port-daddy/pull/8996",
          "headSha": "f03a307cde1e",
          "conclusion": null,
          "ships": ["red-team", "qa"],
          "neurons": 48,
          "elapsedMs": 12500,
          "createdAt": 1787412000,
          "state": "retrying",
          "generation": 3,
          "attemptCount": 4,
          "queuedAt": 1787411900,
          "startedAt": 1787411950,
          "lastProgressAt": 1787412000,
          "finishedAt": null,
          "expectedStartAt": 1787412060,
          "expectedFinishAt": 1787412300,
          "queueAheadEstimate": 2,
          "hasTranscript": true,
          "supersededBy": null,
          "lastError": "GitHub completion not confirmed"
        }
        """.data(using: .utf8)!

        let run = try JSONDecoder().decode(CloudFleetRun.self, from: json)
        XCTAssertEqual(run.repo, "curiositech/port-daddy")
        XCTAssertEqual(run.state, "retrying")
        XCTAssertEqual(run.generation, 3)
        XCTAssertEqual(run.attemptCount, 4)
        XCTAssertEqual(run.queueAheadEstimate, 2)
        XCTAssertTrue(run.hasTranscript)
        XCTAssertEqual(run.attemptLabel, "generation 3 · 4 deliveries")

        let stepJSON = """
        {"seq":4,"kind":"check-completion-retry","ship":null,"title":"GitHub completion deferred","createdAt":1787412010}
        """.data(using: .utf8)!
        let step = try JSONDecoder().decode(CloudFleetStep.self, from: stepJSON)
        XCTAssertTrue(step.explanation.contains("rate-limited"))
        XCTAssertNil(step.expectedAt, "The client must not fabricate a per-step ETA.")
    }

    func testAdmissionAndFailedAdmissionStatesMatchTheRelayContract() throws {
        let admitting = try JSONDecoder().decode(CloudFleetRun.self, from: """
        {
          "id":"intent:admitting","repo":"curiositech/port-daddy","prNumber":8996,
          "headSha":"abc1234","state":"admitting","generation":0,"attemptCount":-3,
          "queueAheadEstimate":-2
        }
        """.data(using: .utf8)!)
        XCTAssertTrue(admitting.isActive)
        XCTAssertFalse(admitting.isFailure)
        XCTAssertEqual(admitting.generation, 1)
        XCTAssertEqual(admitting.attemptCount, 0, "No delivery may be invented before queue handoff.")
        XCTAssertNil(admitting.queueAheadEstimate, "A corrupt negative estimate is unknown, not zero.")

        let failed = try JSONDecoder().decode(CloudFleetRun.self, from: """
        {"id":"intent:failed","repo":"curiositech/port-daddy","prNumber":8996,
         "headSha":"abc1234","state":"enqueue_failed","attemptCount":0}
        """.data(using: .utf8)!)
        XCTAssertTrue(failed.isFailure)
        XCTAssertFalse(failed.isActive)
    }

    func testQueuedRetryingAndCompletedStatesMatchTheRelayContract() throws {
        let cases: [(state: String, conclusion: String?, active: Bool)] = [
            ("queued", nil, true),
            ("retrying", nil, true),
            ("completed", "success", false),
        ]

        for item in cases {
            let conclusion = item.conclusion.map { "\"\($0)\"" } ?? "null"
            let payload = """
            {"id":"intent:\(item.state)","repo":"curiositech/port-daddy","prNumber":8996,
             "headSha":"abc1234","state":"\(item.state)","generation":2,"attemptCount":1,
             "conclusion":\(conclusion)}
            """.data(using: .utf8)!
            let run = try JSONDecoder().decode(CloudFleetRun.self, from: payload)

            XCTAssertEqual(run.state, item.state)
            XCTAssertEqual(run.isActive, item.active)
            XCTAssertFalse(run.isFailure)
        }
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
        XCTAssertNoThrow(try inspected.find(text: "read-only · account scoped"))
    }

    func testRefreshUsesSignedInRelayAndLoadsLiveTranscript() async throws {
        let account = OperatorAccount(
            token: "pdu_fixture",
            relayUrl: "https://relay.example",
            login: "operator"
        )
        var requestedPaths: [String] = []
        StubURLProtocol.handler = { request in
            requestedPaths.append(request.url?.path ?? "")
            XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer pdu_fixture")
            switch request.url?.path {
            case "/v1/fleet/health":
                return StubURLProtocol.Stub(status: 200, body: Self.healthFixture)
            case "/v1/fleet/activity":
                XCTAssertEqual(request.url?.query, "limit=40")
                return StubURLProtocol.Stub(status: 200, body: Self.activityFixture)
            case "/v1/fleet/runs/intent%3Adelivery-live", "/v1/fleet/runs/intent:delivery-live":
                return StubURLProtocol.Stub(status: 200, body: Self.detailFixture)
            default:
                XCTFail("Unexpected Cloud Fleet path: \(request.url?.absoluteString ?? "nil")")
                return StubURLProtocol.Stub(status: 404, body: Data())
            }
        }

        let store = CloudFleetStore(
            autoStart: false,
            session: StubURLProtocol.makeSession(),
            loadAccount: { account },
            now: { Date(timeIntervalSince1970: 1787412050) }
        )

        await store.refresh()

        XCTAssertEqual(requestedPaths, [
            "/v1/fleet/health",
            "/v1/fleet/activity",
            "/v1/fleet/runs/intent:delivery-live",
        ])
        XCTAssertEqual(store.accountLabel, "@operator")
        XCTAssertEqual(store.health?.queueDepthEstimate, 7)
        XCTAssertEqual(store.runs.first?.attemptCount, 4)
        XCTAssertEqual(store.selectedRun?.id, "intent:delivery-live")
        XCTAssertEqual(store.steps.map(\.kind), ["delivery-attempt", "checkpoint-reused"])
        XCTAssertEqual(store.lastRefresh, Date(timeIntervalSince1970: 1787412050))
        XCTAssertNil(store.lastError)
    }

    func testEmptyActivityIsAValidCloudFleetState() async {
        let account = OperatorAccount(
            token: "pdu_fixture",
            relayUrl: "https://relay.example",
            login: "operator"
        )
        StubURLProtocol.handler = { request in
            switch request.url?.path {
            case "/v1/fleet/health":
                return StubURLProtocol.Stub(status: 200, body: Self.healthFixture)
            case "/v1/fleet/activity":
                return StubURLProtocol.Stub(
                    status: 200,
                    body: "{\"code\":\"OK\",\"runs\":[]}".data(using: .utf8)!
                )
            default:
                XCTFail("An empty activity response must not request a transcript.")
                return StubURLProtocol.Stub(status: 404, body: Data())
            }
        }
        let store = CloudFleetStore(
            autoStart: false,
            session: StubURLProtocol.makeSession(),
            loadAccount: { account }
        )

        await store.refresh()

        XCTAssertTrue(store.runs.isEmpty)
        XCTAssertNil(store.selectedRun)
        XCTAssertTrue(store.steps.isEmpty)
        XCTAssertNil(store.lastError)
        XCTAssertNil(store.detailError)
    }

    func testMalformedTranscriptIsVisibleWithoutDiscardingActivity() async {
        let account = OperatorAccount(
            token: "pdu_fixture",
            relayUrl: "https://relay.example",
            login: "operator"
        )
        StubURLProtocol.handler = { request in
            switch request.url?.path {
            case "/v1/fleet/health":
                return StubURLProtocol.Stub(status: 200, body: Self.healthFixture)
            case "/v1/fleet/activity":
                return StubURLProtocol.Stub(status: 200, body: Self.activityFixture)
            case "/v1/fleet/runs/intent%3Adelivery-live", "/v1/fleet/runs/intent:delivery-live":
                return StubURLProtocol.Stub(
                    status: 200,
                    body: "{\"run\":{\"id\":\"intent:delivery-live\",\"state\":\"running\"}}"
                        .data(using: .utf8)!
                )
            default:
                XCTFail("Unexpected malformed-transcript path: \(request.url?.absoluteString ?? "nil")")
                return StubURLProtocol.Stub(status: 404, body: Data())
            }
        }
        let store = CloudFleetStore(
            autoStart: false,
            session: StubURLProtocol.makeSession(),
            loadAccount: { account }
        )

        await store.refresh()

        XCTAssertEqual(store.runs.count, 1)
        XCTAssertEqual(store.selectedRun?.id, "intent:delivery-live")
        XCTAssertTrue(store.steps.isEmpty)
        XCTAssertTrue(store.detailError?.contains("could not be decoded") == true)
        XCTAssertNil(store.lastError)
    }

    func testSignedOutRefreshMakesNoRelayRequest() async {
        var requestCount = 0
        StubURLProtocol.handler = { _ in
            requestCount += 1
            return StubURLProtocol.Stub(status: 500, body: Data())
        }
        let store = CloudFleetStore(
            autoStart: false,
            session: StubURLProtocol.makeSession(),
            loadAccount: { nil }
        )

        await store.refresh()

        XCTAssertEqual(requestCount, 0)
        XCTAssertTrue(store.isSignedOut)
        XCTAssertNil(store.lastError)
        XCTAssertTrue(store.runs.isEmpty)
    }

    func testRejectedTokenStopsFastPollingAndPointsToCredentials() async {
        let account = OperatorAccount(
            token: "pdu_expired_fixture",
            relayUrl: "https://relay.example",
            login: "operator"
        )
        StubURLProtocol.handler = { _ in
            StubURLProtocol.Stub(status: 401, body: Data())
        }
        let store = CloudFleetStore(
            autoStart: false,
            session: StubURLProtocol.makeSession(),
            loadAccount: { account }
        )

        await store.refresh()

        XCTAssertTrue(store.needsReauthentication)
        XCTAssertEqual(store.consecutiveFailures, 4)
        XCTAssertEqual(store.accountLabel, "session expired")
        XCTAssertTrue(store.lastError?.contains("FleetBar Credentials") == true)
    }

    func testHTTPFailuresDistinguishCredentialRejectionFromServiceErrors() async {
        let account = OperatorAccount(
            token: "pdu_fixture",
            relayUrl: "https://relay.example",
            login: "operator"
        )

        for status in [403, 404, 500] {
            StubURLProtocol.handler = { _ in
                StubURLProtocol.Stub(status: status, body: Data())
            }
            let store = CloudFleetStore(
                autoStart: false,
                session: StubURLProtocol.makeSession(),
                loadAccount: { account }
            )

            await store.refresh()

            if status == 403 {
                XCTAssertTrue(store.needsReauthentication)
                XCTAssertEqual(store.consecutiveFailures, 4)
                XCTAssertTrue(store.lastError?.contains("FleetBar Credentials") == true)
            } else {
                XCTAssertFalse(store.needsReauthentication)
                XCTAssertEqual(store.consecutiveFailures, 1)
                XCTAssertTrue(store.lastError?.contains("HTTP \(status)") == true)
            }
        }
    }

    func testPollCadenceIsFastOnlyForActiveRunsAndBacksOffWithJitter() {
        XCTAssertEqual(
            CloudFleetStore.nextPollDelay(hasActiveRuns: true, consecutiveFailures: 0),
            5
        )
        XCTAssertEqual(
            CloudFleetStore.nextPollDelay(hasActiveRuns: false, consecutiveFailures: 0),
            20
        )
        XCTAssertEqual(
            CloudFleetStore.nextPollDelay(
                hasActiveRuns: true,
                consecutiveFailures: 3,
                random: { $0.upperBound }
            ),
            40
        )
        XCTAssertEqual(
            CloudFleetStore.nextPollDelay(
                hasActiveRuns: true,
                consecutiveFailures: 10,
                random: { $0.upperBound }
            ),
            80,
            "Active polling caps the exponent before it can multiply provider load."
        )
        XCTAssertEqual(
            CloudFleetStore.nextPollDelay(
                hasActiveRuns: false,
                consecutiveFailures: 10,
                random: { $0.upperBound }
            ),
            CloudFleetStore.failurePollCapSeconds
        )
        XCTAssertEqual(
            CloudFleetStore.nextPollDelay(
                hasActiveRuns: false,
                consecutiveFailures: 10,
                random: { $0.lowerBound }
            ),
            0,
            "Full jitter must retain the whole zero-to-ceiling range."
        )
    }

    private static let healthFixture = """
    {
      "code": "OK",
      "error": null,
      "paused": false,
      "lastRunAgeSec": 12,
      "queueDepthEstimate": 7,
      "running": 1,
      "retrying": 1,
      "superseded": 3,
      "failedAdmission": 0,
      "oldestQueuedAgeSec": 480,
      "knownIntents": 23
    }
    """.data(using: .utf8)!

    private static let activityFixture = """
    {
      "code": "OK",
      "error": null,
      "runs": [{
        "id": "intent:delivery-live",
        "deliveryId": "delivery-live",
        "repo": "curiositech/port-daddy",
        "prNumber": 8996,
        "prUrl": "https://github.com/curiositech/port-daddy/pull/8996",
        "headSha": "f03a307",
        "conclusion": null,
        "ships": ["red-team", "qa"],
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
      }]
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
        "ships": ["red-team", "qa"],
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
        }
      ]
    }
    """.data(using: .utf8)!
}
