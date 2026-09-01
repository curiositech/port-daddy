import XCTest
@testable import FleetBar

private actor SquidCallRecorder {
    var values: [[String]] = []
    func append(_ value: [String]) { values.append(value) }
}

private actor SquidResultQueue {
    private var values: [SquidCommandResult]

    init(_ values: [SquidCommandResult]) {
        self.values = values
    }

    func next() -> SquidCommandResult {
        guard !values.isEmpty else {
            return SquidCommandResult(status: 1, stdout: "", stderr: "No queued Squid result")
        }
        return values.removeFirst()
    }
}

private final class ContextContinuityURLProtocol: URLProtocol {
    static let statusCode = 200
    static let body = Data("""
    {
      "schemaVersion": 1,
      "capturedAt": "2026-08-23T12:00:00.000Z",
      "counts": {"observed":1,"packetReady":1,"successorRequired":0,"continuing":1,"completed":0,"verificationFailed":0},
      "items": [{
        "agentNodeId":"agent-context-1",
        "sessionId":"session-context-1",
        "runId":"run-context-1",
        "transcriptId":"transcript-context-1",
        "model":"gpt-5",
        "sourceAdapter":"cli:codex",
        "envelopeId":"ctx_1",
        "measuredAt":"2026-08-23T12:00:00.000Z",
        "pressure": {
          "band":"critical","ratio":0.95,"action":"require_compaction_or_successor",
          "windowTokens":1000,"usedTokensEstimate":950,"estimateMode":"exact",
          "strategy":"max-daemon-and-adapter","selfReportDrift":[]
        },
        "packet": {
          "packetId":"cpk_1","createdAt":"2026-08-23T12:00:00.000Z","validatorPassed":true,
          "sourceHeadEventId":"evt_head","sourceHeadHash":"abc123","transcriptEventId":"evt_packet"
        },
        "handoffEpisodeId":42,
        "continuation": {
          "id":"continuation-1","status":"accepted","targetAdapter":"claude-code",
          "successorRunId":null,"successorSessionId":null,"updatedAt":1787500000000
        },
        "readiness":"continuing"
      }],
      "failures": []
    }
    """.utf8)

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        let response = HTTPURLResponse(
            url: request.url!,
            statusCode: Self.statusCode,
            httpVersion: nil,
            headerFields: ["Content-Type": "application/json"]
        )!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Self.body)
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}
}

@MainActor
final class SquidHarnessStoreTests: XCTestCase {
    private let readyJSON = """
    {
      "schemaVersion": 1,
      "state": "READY",
      "workspace": "/work/repo",
      "daemonAlive": false,
      "tentaclesStaged": true,
      "providers": [
        {"name":"Claude Code","slug":"claude","detected":true,"expectedScope":"project","wired":true},
        {"name":"Codex CLI","slug":"codex","detected":true,"expectedScope":"user","wired":true}
      ],
      "identity": {
        "statuslineStaged": true,
        "statuslineProject": true,
        "statuslineUser": false,
        "slashCommand": true,
        "pilotSessionStart": true,
        "daemonAlive": false
      },
      "value": {
        "beforeTurn":"fresh context",
        "beforeEdit":"collision gate",
        "afterTool":"no per-tool process; cumulative session evidence"
      }
    }
    """

    private let debugJSON = """
    {
      "schemaVersion": 1,
      "enabled": true,
      "enabledAt": "2026-08-21T20:00:00.000Z",
      "capturedAt": "2026-08-21T20:00:02.000Z",
      "workspace": "/work/repo",
      "privacy": "Sanitized timing only: no argv, environment snapshot, prompts, tool inputs, tool results, stdout, or stderr are captured.",
      "retention": {"maxBytes":2097152,"eventPath":"/home/.port-daddy/squid/hook-events.log"},
      "sessions": [{
        "id":"codex-codex:42-repo",
        "runtimeSessionId":"codex:42",
        "provider":"codex",
        "providerLabel":"Codex",
        "workspace":"/work/repo",
        "workspaceLabel":"repo",
        "state":"overdue",
        "startedAt":"2026-08-21T20:00:00.000Z",
        "lastActivityAt":"2026-08-21T20:00:00.000Z",
        "steps":[{
          "id":"run-1",
          "phase":"edit",
          "label":"PD EDIT",
          "hook":"pd-hook-pre-tool",
          "state":"overdue",
          "startedAt":"2026-08-21T20:00:00.000Z",
          "expectedBy":"2026-08-21T20:00:01.000Z",
          "finishedAt":null,
          "durationMs":null,
          "deadlineMs":1000,
          "outcome":null,
          "exitCode":null,
          "description":"PD EDIT is checking project ownership and destructive-command safety before mutation. No completion arrived by the deadline."
        }]
      }]
    }
    """

    func testRefreshDecodesMachineReadableSquidStatus() async {
        let json = readyJSON
        let calls = SquidCallRecorder()
        let store = SquidHarnessStore { arguments in
            await calls.append(arguments)
            return SquidCommandResult(status: 0, stdout: json, stderr: "")
        }
        await store.refresh(projectDir: "/work/repo")
        let recorded = await calls.values
        XCTAssertEqual(recorded, [["squid", "status", "--json", "--cwd", "/work/repo"]])
        XCTAssertEqual(store.snapshot?.state, .ready)
        XCTAssertEqual(store.snapshot?.wiredProviderCount, 2)
        XCTAssertEqual(store.snapshot?.detectedProviderCount, 2)
        XCTAssertNil(store.message)
    }

    func testRefreshShowsVerifiedContextPacketAndContinuationReceipt() async {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [ContextContinuityURLProtocol.self]
        let session = URLSession(configuration: configuration)
        let ready = readyJSON
        let store = SquidHarnessStore(baseURL: "https://continuity.test", session: session) { _ in
            SquidCommandResult(status: 0, stdout: ready, stderr: "")
        }

        await store.refresh(projectDir: "/work/repo")

        XCTAssertEqual(store.continuitySnapshot?.counts.packetReady, 1)
        XCTAssertEqual(store.continuitySnapshot?.items.first?.packet?.validatorPassed, true)
        XCTAssertEqual(store.continuitySnapshot?.items.first?.continuation?.id, "continuation-1")
        XCTAssertEqual(store.continuitySnapshot?.items.first?.readiness, "continuing")
        XCTAssertNil(store.continuityMessage)
    }

    func testRefreshSurfacesOpenHookCircuitWithFleetBarRepairLanguage() async {
        let degraded = """
        {
          "schemaVersion": 1,
          "state": "DEGRADED",
          "workspace": "/work/repo",
          "daemonAlive": true,
          "tentaclesStaged": true,
          "providers": [],
          "identity": {
            "statuslineStaged": true, "statuslineProject": true, "statuslineUser": false,
            "slashCommand": true, "pilotSessionStart": true, "daemonAlive": true
          },
          "value": {"beforeTurn":"context","beforeEdit":"gate","afterTool":"cumulative"},
          "health": {
            "degraded": true,
            "capturedAt": "2026-08-21T20:00:02.000Z",
            "thresholds": {"consecutiveFailures":3,"slowMs":250,"cooldownMs":300000},
            "circuits": [{
              "hook":"pd-hook-pre-tool","label":"PD EDIT","state":"open","consecutiveFailures":3,
              "openedAt":"2026-08-21T20:00:00.000Z","retryAt":"2026-08-21T20:05:00.000Z",
              "lastReason":"exit_127","lastDurationMs":4,"lastExitCode":127,"updatedAt":"2026-08-21T20:00:00.000Z"
            }],
            "remediation":"Open FleetBar, select Giant Squid, and choose Repair."
          }
        }
        """
        let store = SquidHarnessStore { _ in SquidCommandResult(status: 0, stdout: degraded, stderr: "") }

        await store.refresh(projectDir: "/work/repo")

        XCTAssertEqual(store.snapshot?.state, .degraded)
        XCTAssertEqual(store.snapshot?.health?.circuits.first?.state, .open)
        XCTAssertEqual(store.message, "PD EDIT disabled itself after repeated exit 127 events. Choose Repair.")
    }

    func testRefreshDistinguishesAnActiveRecoveryProbeFromADisabledHook() async {
        let recovering = """
        {
          "schemaVersion": 1,
          "state": "DEGRADED",
          "workspace": "/work/repo",
          "daemonAlive": true,
          "tentaclesStaged": true,
          "providers": [],
          "identity": {
            "statuslineStaged": true, "statuslineProject": true, "statuslineUser": false,
            "slashCommand": true, "pilotSessionStart": true, "daemonAlive": true
          },
          "value": {"beforeTurn":"context","beforeEdit":"gate","afterTool":"cumulative"},
          "health": {
            "degraded": true,
            "capturedAt": "2026-09-01T03:00:02.000Z",
            "thresholds": {"consecutiveFailures":3,"slowMs":250,"cooldownMs":300000},
            "circuits": [{
              "hook":"pd-hook-prompt","label":"PD TURN","state":"half_open","consecutiveFailures":9,
              "openedAt":"2026-09-01T02:55:00.000Z","retryAt":"2026-09-01T03:00:00.000Z",
              "lastReason":"slow","lastDurationMs":770,"lastExitCode":0,"updatedAt":"2026-09-01T02:55:00.000Z",
              "probeState":"active","probeStartedAt":"2026-09-01T03:00:01.000Z",
              "probeExpectedBy":"2026-09-01T03:00:06.000Z","recoveryReady":false
            }],
            "remediation":"A single bounded recovery probe is running and should finish by 2026-09-01T03:00:06.000Z."
          }
        }
        """
        let store = SquidHarnessStore { _ in SquidCommandResult(status: 0, stdout: recovering, stderr: "") }

        await store.refresh(projectDir: "/work/repo")

        let circuit = store.snapshot?.health?.circuits.first
        XCTAssertEqual(circuit?.state, .halfOpen)
        XCTAssertEqual(circuit?.probeState, .active)
        XCTAssertEqual(circuit?.timingLine, "Probe started 2026-09-01T03:00:01.000Z · expected by 2026-09-01T03:00:06.000Z")
        XCTAssertEqual(store.message, "PD TURN is running one bounded recovery probe; expected by 2026-09-01T03:00:06.000Z.")
    }

    func testArmUsesFullHarnessCommandThenRefreshes() async {
        let json = readyJSON
        let calls = SquidCallRecorder()
        let store = SquidHarnessStore { arguments in
            await calls.append(arguments)
            return arguments.contains("status")
                ? SquidCommandResult(status: 0, stdout: json, stderr: "")
                : SquidCommandResult(status: 0, stdout: "armed", stderr: "")
        }
        await store.arm(projectDir: "/work/repo")
        let recorded = await calls.values
        XCTAssertEqual(recorded[0], ["squid", "on", "--cwd", "/work/repo"])
        XCTAssertEqual(recorded[1], ["squid", "status", "--json", "--cwd", "/work/repo"])
        XCTAssertEqual(store.snapshot?.state, .ready)
        XCTAssertEqual(store.message, "Squid armed. New agent sessions will show ◆ PD.")
    }

    func testMutationFailureSurvivesStatusRefresh() async {
        let json = readyJSON
        let store = SquidHarnessStore { arguments in
            return arguments.contains("status")
                ? SquidCommandResult(status: 0, stdout: json, stderr: "")
                : SquidCommandResult(status: 1, stdout: "", stderr: "Pilot asset is missing; run Repair again.")
        }
        await store.arm(projectDir: "/work/repo")
        XCTAssertEqual(store.snapshot?.state, .ready)
        XCTAssertEqual(store.message, "Pilot asset is missing; run Repair again.")
    }

    func testInvalidStatusBecomesVisibleInsteadOfPretendingOff() async {
        let store = SquidHarnessStore { _ in
            SquidCommandResult(status: 1, stdout: "not json", stderr: "packaged asset missing")
        }
        await store.refresh(projectDir: "/work/repo")
        XCTAssertNil(store.snapshot)
        XCTAssertEqual(store.message, "packaged asset missing")
    }

    func testRefreshDebugDecodesPerSessionDeadlineTimeline() async {
        let json = debugJSON
        let calls = SquidCallRecorder()
        let store = SquidHarnessStore { arguments in
            await calls.append(arguments)
            return SquidCommandResult(status: 0, stdout: json, stderr: "")
        }

        await store.refreshDebug(projectDir: "/work/repo")

        let recorded = await calls.values
        XCTAssertEqual(recorded, [["squid", "debug", "status", "--json", "--cwd", "/work/repo"]])
        XCTAssertEqual(store.debugSnapshot?.enabled, true)
        XCTAssertEqual(store.debugSnapshot?.overdueCount, 1)
        XCTAssertEqual(store.debugSnapshot?.sessions.first?.steps.first?.expectedBy, "2026-08-21T20:00:01.000Z")
        XCTAssertNil(store.debugMessage)
    }

    func testMalformedDebugJSONClearsStaleTimelineAndSurfacesCLIError() async {
        let queue = SquidResultQueue([
            SquidCommandResult(status: 0, stdout: debugJSON, stderr: ""),
            SquidCommandResult(status: 1, stdout: "{not-json", stderr: "debug timeline unreadable"),
        ])
        let store = SquidHarnessStore { _ in await queue.next() }

        await store.refreshDebug(projectDir: "/work/repo")
        XCTAssertNotNil(store.debugSnapshot)

        await store.refreshDebug(projectDir: "/work/repo")
        XCTAssertNil(store.debugSnapshot)
        XCTAssertEqual(store.debugMessage, "debug timeline unreadable")
    }

    func testIncompleteDebugJSONDoesNotMasqueradeAsAnEmptyTimeline() async {
        let incomplete = """
        {
          "schemaVersion": 1,
          "enabled": true,
          "enabledAt": null,
          "capturedAt": "2026-08-21T20:00:02.000Z",
          "workspace": "/work/repo",
          "privacy": "Sanitized timing only.",
          "retention": {"maxBytes":2097152,"eventPath":"/hook-events.log"}
        }
        """
        let store = SquidHarnessStore { _ in
            SquidCommandResult(status: 0, stdout: incomplete, stderr: "")
        }

        await store.refreshDebug(projectDir: "/work/repo")

        XCTAssertNil(store.debugSnapshot)
        XCTAssertEqual(store.debugMessage, "Squid hook timing is unavailable.")
    }

    func testUnsupportedDebugSchemaClearsStaleTimelineAndFailsClosed() async {
        let unsupported = debugJSON.replacingOccurrences(of: "\"schemaVersion\": 1", with: "\"schemaVersion\": 2")
        let queue = SquidResultQueue([
            SquidCommandResult(status: 0, stdout: debugJSON, stderr: ""),
            SquidCommandResult(status: 0, stdout: unsupported, stderr: ""),
        ])
        let store = SquidHarnessStore { _ in await queue.next() }

        await store.refreshDebug(projectDir: "/work/repo")
        XCTAssertNotNil(store.debugSnapshot)

        await store.refreshDebug(projectDir: "/work/repo")
        XCTAssertNil(store.debugSnapshot)
        XCTAssertEqual(store.debugMessage, "Squid hook timing uses an unsupported data format. Update FleetBar before relying on it.")
    }

    func testDebugCaptureToggleUsesMachineReadableOperatorSurface() async {
        let json = debugJSON
        let calls = SquidCallRecorder()
        let store = SquidHarnessStore { arguments in
            await calls.append(arguments)
            return SquidCommandResult(status: 0, stdout: json, stderr: "")
        }

        await store.setDebugCapture(true, projectDir: "/work/repo")

        let recorded = await calls.values
        XCTAssertEqual(recorded, [["squid", "debug", "on", "--json", "--cwd", "/work/repo"]])
        XCTAssertEqual(store.debugMessage, "Capturing sanitized hook timing for new invocations.")
    }
}
