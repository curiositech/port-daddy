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
        "afterTool":"fleet trace"
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
