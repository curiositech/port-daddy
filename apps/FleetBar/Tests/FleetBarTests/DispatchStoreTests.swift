import XCTest
@testable import FleetBar

@MainActor
final class DispatchStoreTests: XCTestCase {

    // MARK: - DispatchState

    func testDispatchStateRawValuesMatchProtocol() {
        // These raw values are the wire contract with PR #143 / #163.
        // If the daemon emits a different string the UI will silently drop
        // the row — so we pin them.
        XCTAssertEqual(DispatchState.proposed.rawValue, "proposed")
        XCTAssertEqual(DispatchState.claimed.rawValue, "claimed")
        XCTAssertEqual(DispatchState.inProgress.rawValue, "in_progress")
        XCTAssertEqual(DispatchState.produced.rawValue, "produced")
        XCTAssertEqual(DispatchState.reviewPending.rawValue, "review_pending")
        XCTAssertEqual(DispatchState.accepted.rawValue, "accepted")
        XCTAssertEqual(DispatchState.rejected.rawValue, "rejected")
        XCTAssertEqual(DispatchState.settled.rawValue, "settled")
        XCTAssertEqual(DispatchState.salvage.rawValue, "salvage")
        XCTAssertEqual(DispatchState.failed.rawValue, "failed")
    }

    func testInFlightBucketsCoverPreReviewStates() {
        let inFlight: [DispatchState] = [.proposed, .claimed, .inProgress, .produced]
        for state in inFlight {
            XCTAssertEqual(state.bucket, .inFlight, "\(state.rawValue) should be in flight")
        }
    }

    func testReviewPendingIsItsOwnBucket() {
        XCTAssertEqual(DispatchState.reviewPending.bucket, .awaitingReview)
    }

    func testTerminalStatesBucketAsRecent() {
        let terminal: [DispatchState] = [.accepted, .rejected, .settled, .salvage, .failed]
        for state in terminal {
            XCTAssertEqual(state.bucket, .recent, "\(state.rawValue) should be recent")
        }
    }

    // MARK: - DispatchSnapshot formatters

    func testCostDisplayFormatsTwoDecimalPlaces() {
        let snap = makeSnapshot(costUsd: 0.347)
        XCTAssertEqual(snap.costDisplay, "$0.35")
    }

    func testCostDisplayZero() {
        let snap = makeSnapshot(costUsd: 0)
        XCTAssertEqual(snap.costDisplay, "$0.00")
    }

    func testElapsedDisplayFormatsMinutes() {
        let started = Date().addingTimeInterval(-47 * 60)
        let snap = makeSnapshot(startedAt: started)
        XCTAssertEqual(snap.elapsedDisplay, "47m")
    }

    func testElapsedDisplayFormatsHoursForLongRuns() {
        let started = Date().addingTimeInterval(-2.5 * 3600)
        let snap = makeSnapshot(startedAt: started)
        XCTAssertEqual(snap.elapsedDisplay, "2.5h")
    }

    func testElapsedDisplayMissingStartReturnsDash() {
        let snap = makeSnapshot(startedAt: nil)
        XCTAssertEqual(snap.elapsedDisplay, "—")
    }

    // MARK: - Helpers

    private func makeSnapshot(
        id: String = "dispatch-1",
        state: DispatchState = .reviewPending,
        startedAt: Date? = Date().addingTimeInterval(-60),
        completedAt: Date? = nil,
        costUsd: Double = 0
    ) -> DispatchSnapshot {
        DispatchSnapshot(
            id: id,
            intent: "test intent",
            state: state,
            branch: "fleet/test",
            prUrl: "https://example.com/pr/1",
            costUsd: costUsd,
            startedAt: startedAt,
            completedAt: completedAt,
            transcriptId: "t-1",
            summary: "Built test scaffolding.",
            lastEventAt: startedAt
        )
    }
}
