import ViewInspector
import XCTest
@testable import FleetBar

@MainActor
final class FleetControlNightshiftHitlTests: XCTestCase {
    override func tearDown() {
        StubURLProtocol.handler = nil
        super.tearDown()
    }

    func testCriticalAskDisablesApproveButLeavesRejectAndInspectAvailable() async throws {
        StubURLProtocol.handler = { request in
            switch request.url?.path {
            case "/dispatches":
                return Self.json("""
                {"success":true,"dispatches":[{
                  "id":"dispatch-1","intent":"Build account settings",
                  "state":"review_pending","branch":"codex/account",
                  "prUrl":"https://example.test/pr/1","costUsd":1.25,
                  "startedAt":2000000000000,"transcriptId":"transcript-1",
                  "lastEventAt":2000000000000
                }]}
                """)
            case "/dispatches/dispatch-1/transcript-summary":
                return Self.json("{\"success\":true,\"summary\":\"Ready for review.\"}")
            case "/popper/status":
                return Self.json("{\"success\":true,\"queuedCount\":0}")
            case "/harbormaster/status":
                return Self.json("{\"success\":true,\"queueDepth\":0,\"mergingCount\":0}")
            default:
                return StubURLProtocol.Stub(status: 404, body: Data())
            }
        }
        let store = DispatchStore(
            autoStart: false,
            baseURL: "https://daemon.example",
            session: StubURLProtocol.makeSession()
        )
        await store.refresh()
        let reason = "Resolve critical operator ask “Choose deployment target” before starting more work."
        let inspected = try FleetControlNightshiftSection(
            store: store,
            criticalBlockTitle: "Choose deployment target"
        ).inspect()

        XCTAssertTrue(try inspected.find(button: "Approve").isDisabled())
        XCTAssertFalse(try inspected.find(button: "Reject").isDisabled())
        XCTAssertFalse(try inspected.find(button: "View Transcript").isDisabled())
        XCTAssertNoThrow(try inspected.find(text: reason))
    }

    private static func json(_ body: String) -> StubURLProtocol.Stub {
        StubURLProtocol.Stub(status: 200, body: body.data(using: .utf8)!)
    }
}
