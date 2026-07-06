import XCTest
@testable import FleetBar

@MainActor
final class FleetProposalStoreTests: XCTestCase {

    func testFleetProposalStatusRawValuesMatchWireContract() {
        XCTAssertEqual(FleetProposalStatus.pending.rawValue, "pending")
        XCTAssertEqual(FleetProposalStatus.approved.rawValue, "approved")
        XCTAssertEqual(FleetProposalStatus.rejected.rawValue, "rejected")
        XCTAssertEqual(FleetProposalStatus.dispatched.rawValue, "dispatched")
    }

    func testSourceDisplayCombinesShipRepoAndPr() {
        let snap = makeSnapshot()
        XCTAssertEqual(snap.sourceDisplay, "spark · curiositech/port-daddy · PR #642")
    }

    func testAssignmentDisplayFallsBackWhenNoSpecialistProvided() {
        let snap = makeSnapshot(targetSpecialist: nil)
        XCTAssertEqual(snap.assignmentDisplay, "auto-route specialist")
    }

    func testBudgetDisplayFormatsCaps() {
        XCTAssertEqual(makeSnapshot(budgetUsd: 3.25).budgetDisplay, "$3.25 cap")
        XCTAssertEqual(makeSnapshot(budgetUsd: nil).budgetDisplay, "no proposal cap")
    }

    private func makeSnapshot(
        targetSpecialist: String? = "ui-expert",
        budgetUsd: Double? = 2
    ) -> FleetProposalSnapshot {
        FleetProposalSnapshot(
            id: "proposal-1",
            title: "Build approval lane",
            summary: "Spark proposes a richer approval lane.",
            proposalMarkdown: "Proposal body.",
            sourceShip: "spark",
            sourceKind: "cloud-fleet",
            sourceRunId: "run-1",
            repoFullName: "curiositech/port-daddy",
            prNumber: 642,
            targetSpecialist: targetSpecialist,
            assignmentType: "specialist-pr",
            budgetUsd: budgetUsd,
            baseBranch: "main",
            writePolicy: "approved-dispatch-only",
            validationPlan: "Run focused tests.",
            expectedArtifacts: ["tested PR"],
            links: [],
            status: .pending,
            dispatchId: nil,
            decisionNote: nil,
            decidedBy: nil,
            createdAt: Date(timeIntervalSince1970: 1_800_000_000),
            decidedAt: nil,
            dispatchedAt: nil
        )
    }
}
