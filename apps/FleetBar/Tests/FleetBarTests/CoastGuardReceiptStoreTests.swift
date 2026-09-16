import XCTest
@testable import FleetBar

@MainActor
final class CoastGuardReceiptStoreTests: XCTestCase {
    func testDecodesConfinementMechanismAndEgressTotalsFromSpawnHistory() throws {
        let json = """
        { "success": true, "agents": [
          { "agentId": "spawned-guarded", "coastGuard": {
            "agentId": "spawned-guarded", "backend": "cli:codex", "confined": true,
            "mechanism": "seatbelt", "egress": { "requests": 4, "bytes": 1280, "blocked": 1, "injected": 0 }
          } }
        ] }
        """.data(using: .utf8)!

        let receipts = try CoastGuardReceiptStore.decodeReceipts(json)
        XCTAssertEqual(receipts, [
            CoastGuardReceiptSummary(
                agentId: "spawned-guarded",
                backend: "cli:codex",
                confined: true,
                mechanism: "seatbelt",
                egress: CoastGuardEgressTotals(requests: 4, bytes: 1280, blocked: 1, injected: 0)
            ),
        ])
    }

    func testLeavesReceiptAbsentWhenSpawnHistoryHasNoCoastGuardEvidence() throws {
        let json = """
        { "success": true, "agents": [
          { "agentId": "spawned-api", "backend": "openai" }
        ] }
        """.data(using: .utf8)!

        XCTAssertTrue(try CoastGuardReceiptStore.decodeReceipts(json).isEmpty)
    }
}
