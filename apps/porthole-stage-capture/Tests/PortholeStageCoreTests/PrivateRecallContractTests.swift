import Foundation
import XCTest
@testable import PortholeStageCore

final class PrivateRecallContractTests: XCTestCase {
    private let window = PortholeMomentInterval(start: 2, end: 5)
    private let bytes = Data("certificate error".utf8)

    private func source(revision: String = "r1", lineage: String = "session-1",
                        scope: String = "project-a", policy: String = "p1") -> PortholeRecallSource {
        .init(id: "source-1", revision: revision, lineage: lineage, scope: scope, policyRevision: policy)
    }
    private func moment(source: PortholeRecallSource? = nil, version: Int = 1,
                        interval: PortholeMomentInterval? = nil,
                        gaps: [PortholeMomentInterval] = [], revision: String = "m1",
                        evidence: PortholeEvidenceClass = .derived) -> PortholeMomentReference {
        .init(schemaVersion: version, id: "moment-1", revision: revision, source: source ?? self.source(),
              interval: interval ?? window, gaps: gaps, transformations: ["ocr:v1"], evidenceClass: evidence)
    }
    private func grant(_ operation: PortholeRecallOperation = .disclosure,
                       issued: Double = 1, expiry: Double = 20,
                       interval: PortholeMomentInterval? = nil) -> PortholeRecallGrant {
        .init(source: source(), operation: operation, principal: "agent-a", purpose: "debug",
              interval: interval ?? window, issuedAt: issued, expiresAt: expiry)
    }
    private func state(source: PortholeRecallSource? = nil, revoked: Bool = false,
                       expiry: Double = 30, checked: Double = 10,
                       interval: PortholeMomentInterval? = nil) -> PortholeRecallState {
        .init(source: source ?? self.source(), retainedInterval: interval ?? window,
              retainedUntil: expiry, revoked: revoked, checkedAt: checked)
    }
    private func approval(moment: PortholeMomentReference? = nil, issued: Double = 1,
                          expiry: Double = 20) -> PortholeExcerptApproval {
        .init(moment: moment ?? self.moment(), excerpt: bytes, destination: "provider/account-a",
              principal: "agent-a", purpose: "debug", issuedAt: issued, expiresAt: expiry)
    }
    private func cloud(bytes: Data? = nil, destination: String = "provider/account-a",
                       moment: PortholeMomentReference? = nil, grant: PortholeRecallGrant? = nil,
                       approval: PortholeExcerptApproval? = nil, state: PortholeRecallState? = nil,
                       now: Double = 10, principal: String = "agent-a", purpose: String = "debug") -> Bool {
        PortholeRecallPolicy.permitsCloudExcerpt(bytes ?? self.bytes, destination: destination,
            moment: moment ?? self.moment(), principal: principal, purpose: purpose,
            grant: grant ?? self.grant(), approval: approval ?? self.approval(),
            state: state ?? self.state(), now: now)
    }

    func testClosedEvidenceVocabularyAndRoundTrip() throws {
        XCTAssertEqual(Set(PortholeEvidenceClass.allCases.map(\.rawValue)),
                       Set(["witnessed", "reported", "derived", "inferred", "unavailable"]))
        XCTAssertThrowsError(try JSONDecoder().decode(PortholeEvidenceClass.self, from: Data("\"accepted\"".utf8)))
        for evidence in PortholeEvidenceClass.allCases {
            let value = moment(evidence: evidence)
            XCTAssertEqual(try JSONDecoder().decode(PortholeMomentReference.self,
                           from: JSONEncoder().encode(value)), value)
        }
        XCTAssertFalse(moment(version: 2).isValid)
    }

    func testIntervalsRejectInvalidTimesAndPreserveHalfOpenBoundaries() {
        for interval in [PortholeMomentInterval(start: -1, end: 2), .init(start: 2, end: 2),
                         .init(start: 3, end: 2), .init(start: .nan, end: 2),
                         .init(start: 0, end: .infinity)] {
            XCTAssertFalse(moment(interval: interval).isValid)
            XCTAssertFalse(cloud(moment: moment(interval: interval)))
        }
        XCTAssertTrue(window.contains(window))
        XCTAssertFalse(window.contains(.init(start: 5, end: 6)))
        XCTAssertFalse(cloud(grant: grant(interval: .init(start: 2, end: 4))))
        XCTAssertFalse(cloud(state: state(interval: .init(start: 3, end: 5))))
    }

    func testGapsRemainBoundedOrderedNonoverlappingAndPartOfExactApproval() {
        let gaps = [PortholeMomentInterval(start: 2, end: 3), .init(start: 3, end: 4)]
        XCTAssertTrue(moment(gaps: gaps).isValid)
        XCTAssertFalse(moment(gaps: Array(gaps.reversed())).isValid)
        XCTAssertFalse(moment(gaps: [.init(start: 2, end: 4), .init(start: 3, end: 5)]).isValid)
        XCTAssertFalse(moment(gaps: [.init(start: 1, end: 3)]).isValid)
        XCTAssertFalse(moment(gaps: Array(repeating: .init(start: 2, end: 3), count: 257)).isValid)
        XCTAssertFalse(cloud(moment: moment(gaps: gaps)))
        XCTAssertTrue(cloud(moment: moment(gaps: gaps), approval: approval(moment: moment(gaps: gaps))))
    }

    func testEveryPermissionIsIndependent() {
        for requested in PortholeRecallOperation.allCases {
            for granted in PortholeRecallOperation.allCases {
                XCTAssertEqual(PortholeRecallPolicy.permits(requested, moment: moment(),
                    principal: "agent-a", purpose: "debug", grant: grant(granted), state: state(), now: 10),
                    requested == granted && requested != .disclosure)
            }
        }
        XCTAssertFalse(cloud(grant: grant(.indexing)))
        XCTAssertFalse(cloud(grant: grant(.localAgentRecall)))
    }

    func testExactExcerptDestinationAndPurposeCannotBeSubstituted() {
        XCTAssertTrue(cloud())
        XCTAssertFalse(cloud(bytes: Data("certificate error ".utf8)))
        XCTAssertFalse(cloud(bytes: Data()))
        XCTAssertFalse(cloud(bytes: Data(repeating: 1, count: PortholeRecallPolicy.maximumExcerptBytes + 1)))
        XCTAssertFalse(cloud(destination: "provider/account-b"))
        XCTAssertFalse(cloud(destination: " "))
        XCTAssertFalse(cloud(principal: "agent-b"))
        XCTAssertFalse(cloud(purpose: "train"))
        XCTAssertFalse(PortholeRecallPolicy.permitsCloudExcerpt(bytes, destination: "provider/account-a",
            moment: moment(), principal: "agent-a", purpose: "debug", grant: grant(), approval: nil,
            state: state(), now: 10))
        // Published SHA256 vector: digest concerns exact bytes, not sealing or approval authenticity.
        XCTAssertEqual(PortholeRecallPolicy.digest(Data("abc".utf8)),
                       "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")
    }

    func testCurrentSourceAndDerivativeIdentityAreRequired() {
        for changed in [source(revision: "r2"), source(lineage: "session-2"),
                        source(scope: "project-b"), source(policy: "p2")] {
            XCTAssertFalse(cloud(state: state(source: changed)))
            XCTAssertFalse(cloud(moment: moment(source: changed)))
        }
        XCTAssertFalse(cloud(moment: moment(revision: "m2")))
        XCTAssertFalse(cloud(moment: moment(evidence: .witnessed)))
        XCTAssertFalse(moment(source: source(scope: " ")).isValid)
        for invalid in [" ", "\n\t", String(repeating: "a", count: 1025)] {
            XCTAssertFalse(PortholeMomentReference(id: invalid, revision: "m1", source: source(),
                interval: window, evidenceClass: .derived).isValid)
            XCTAssertFalse(PortholeMomentReference(id: "m", revision: invalid, source: source(),
                interval: window, evidenceClass: .derived).isValid)
            XCTAssertFalse(PortholeMomentReference(id: "m", revision: "m1", source: source(),
                interval: window, transformations: [invalid], evidenceClass: .derived).isValid)
        }
    }

    func testExpiryRevocationDeletionAndStaleSnapshotsFailClosed() {
        XCTAssertFalse(cloud(state: state(revoked: true)))
        XCTAssertFalse(cloud(state: state(expiry: 10)))
        XCTAssertFalse(cloud(state: state(expiry: .infinity)))
        XCTAssertFalse(cloud(state: state(checked: 9)))
        XCTAssertFalse(cloud(state: state(checked: 11)))
        // No surviving source interval after deletion; index hits do not restore access.
        XCTAssertFalse(cloud(state: state(interval: .init(start: 0, end: 0))))
        for time in [Double.nan, .infinity, -1] { XCTAssertFalse(cloud(now: time)) }
        for invalid in [grant(issued: 11), grant(issued: -.infinity), grant(expiry: 10), grant(expiry: .infinity)] {
            XCTAssertFalse(cloud(grant: invalid))
        }
        for invalid in [approval(issued: 11), approval(issued: -.infinity),
                        approval(expiry: 10), approval(expiry: .infinity)] {
            XCTAssertFalse(cloud(approval: invalid))
        }
    }
}
