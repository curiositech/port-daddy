import XCTest
@testable import FleetBar

final class DoctrineStoreTests: XCTestCase {
    func testAdmissionReadinessRejectsPromptOnlyOrMismatchedTreatment() {
        let experiment = makeExperiment(
            runs: [
                makeRun(id: "control", arm: "control", fidelity: .matched),
                makeRun(id: "treatment", arm: "treatment", fidelity: .mismatched),
            ]
        )

        let readiness = fleetDoctrineAdmissionReadiness(experiment)

        XCTAssertFalse(readiness.isReady)
        XCTAssertEqual(readiness.label, "Evidence incomplete")
        XCTAssertTrue(readiness.detail.contains("matched treatment"))
    }

    func testAdmissionReadinessRequiresBothMatchedFactualArms() {
        let experiment = makeExperiment(
            runs: [
                makeRun(id: "control", arm: "control", fidelity: .matched),
                makeRun(id: "treatment", arm: "treatment", fidelity: .matched),
                makeRun(id: "sham", arm: "sham", fidelity: .notRun),
            ]
        )

        let readiness = fleetDoctrineAdmissionReadiness(experiment)

        XCTAssertTrue(readiness.isReady)
        XCTAssertEqual(readiness.label, "Factual gate met")
    }

    func testCandidateEvidenceCitationsDeduplicateAdmissionAndEpisodeReceipts() {
        let candidate = FleetDoctrineCandidateSnapshot(
            id: "candidate-1",
            doctrineId: "doctrine:candidate-1",
            episodeId: "episode-1",
            projectDir: "/repo",
            actorId: "steward",
            citations: ["receipt://episode", "receipt://shared"],
            occurredAt: "2026-08-26T00:00:00Z",
            decisionClass: "integration.merge",
            title: "Evidence-weighted merge gate",
            when: "a merge has review evidence",
            prefer: "inspect the evidence",
            over: "counting open threads",
            because: "thread state may be a proxy",
            unless: [],
            school: nil,
            skillRefs: [],
            status: .provisional,
            reviewerId: "reviewer",
            experimentId: "experiment-1",
            admissionCitations: ["receipt://admission", "receipt://shared"],
            contestedReason: nil
        )

        XCTAssertEqual(candidate.evidenceCitations, ["receipt://admission", "receipt://episode", "receipt://shared"])
    }

    private func makeExperiment(runs: [FleetDoctrineTreatmentRunSnapshot]) -> FleetDoctrineExperimentSnapshot {
        FleetDoctrineExperimentSnapshot(
            id: "experiment-1",
            candidateId: "candidate-1",
            projectDir: "/repo",
            actorId: "researcher",
            citations: ["receipt://experiment"],
            occurredAt: "2026-08-26T00:00:00Z",
            hypothesis: "Thread state and technical evidence have separate effects.",
            primaryOutcome: "merge decision",
            control: "factual control",
            treatment: "technical concern changed",
            sham: "wording-only sham",
            runs: runs
        )
    }

    private func makeRun(id: String, arm: String, fidelity: FleetDoctrineFidelity) -> FleetDoctrineTreatmentRunSnapshot {
        FleetDoctrineTreatmentRunSnapshot(
            id: id,
            experimentId: "experiment-1",
            arm: arm,
            action: "hold",
            outcome: "recorded",
            fidelity: fidelity,
            notes: nil,
            occurredAt: "2026-08-26T00:00:00Z",
            citations: ["receipt://\(id)"]
        )
    }
}
