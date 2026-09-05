import SwiftUI
import ViewInspector
import XCTest
@testable import FleetBar

@MainActor
final class FleetControlCenterHitlTests: XCTestCase {
    func testCriticalAttentionBlocksEveryNewWorkAction() {
        let newWork: [CriticalAttentionAction] = [
            .startFleet, .assignProposal, .proposeDispatch, .approveDispatch,
        ]
        for action in newWork {
            XCTAssertEqual(
                CriticalAttentionGate.blockReason(for: action, criticalTitle: "Choose deployment target"),
                "Resolve critical operator ask “Choose deployment target” before starting more work."
            )
        }
    }

    func testCriticalAttentionPreservesStopRejectInspectAndRecovery() {
        let safeActions: [CriticalAttentionAction] = [.stopFleet, .reject, .inspect, .recovery]
        for action in safeActions {
            XCTAssertNil(
                CriticalAttentionGate.blockReason(for: action, criticalTitle: "Choose deployment target")
            )
        }
    }

    func testNoCriticalAskLeavesEveryActionAvailable() {
        for action in CriticalAttentionAction.allCases {
            XCTAssertNil(CriticalAttentionGate.blockReason(for: action, criticalTitle: nil))
        }
    }

    func testUntitledCriticalAskStillBlocksNewWork() {
        XCTAssertEqual(
            CriticalAttentionGate.blockReason(for: .startFleet, criticalTitle: "  \n"),
            "Resolve critical operator ask “Untitled critical request” before starting more work."
        )
    }

    func testCriticalBannerNamesTheAskInsteadOfShowingGenericDisabledState() throws {
        let reason = try XCTUnwrap(
            CriticalAttentionGate.blockReason(for: .startFleet, criticalTitle: "Choose deployment target")
        )
        let inspected = try CriticalAttentionBanner(reason: reason).inspect()
        XCTAssertNoThrow(try inspected.find(text: reason))
    }
}
