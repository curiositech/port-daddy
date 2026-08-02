import XCTest
@testable import FleetBar

private actor SquidCallRecorder {
    var values: [[String]] = []
    func append(_ value: [String]) { values.append(value) }
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
    }

    func testInvalidStatusBecomesVisibleInsteadOfPretendingOff() async {
        let store = SquidHarnessStore { _ in
            SquidCommandResult(status: 1, stdout: "not json", stderr: "packaged asset missing")
        }
        await store.refresh(projectDir: "/work/repo")
        XCTAssertNil(store.snapshot)
        XCTAssertEqual(store.message, "packaged asset missing")
    }
}
