import XCTest
import SwiftUI
@testable import PortDaddyKit

// Artifacts surface. Receipts are the load-bearing case: their meaning is their
// verdict, so the verdict must decode and drive the tint honestly.
final class ArtifactsTests: XCTestCase {

    func testFeedFixtureDecodes() throws {
        let feed = try PortDaddyFixtures.artifacts()
        XCTAssertEqual(feed.artifacts.count, 5)
        XCTAssertEqual(feed.artifacts.filter { $0.kind == .receipt }.count, 2)
    }

    func testReceiptsCarryVerdictsAndOthersDoNot() throws {
        let feed = try PortDaddyFixtures.artifacts()
        for artifact in feed.artifacts {
            if artifact.kind == .receipt {
                XCTAssertNotNil(artifact.verdict, "\(artifact.id) is a receipt and must carry a verdict")
                XCTAssertNotNil(artifact.receiptID)
            } else {
                XCTAssertNil(artifact.verdict, "\(artifact.id) is not a receipt and must not carry a verdict")
            }
        }
    }

    func testVerdictColourBuckets() {
        // Approved is green, denied is red — through the same maritime law.
        XCTAssertEqual(MaritimeSignals.bucket(for: Artifact.Verdict.approved.state), .green)
        XCTAssertEqual(MaritimeSignals.bucket(for: Artifact.Verdict.denied.state), .red)
    }

    func testReceiptTintFollowsVerdictNotKind() {
        let approved = Artifact(id: "a", kind: .receipt, title: "", byLine: "", meta: "",
                                verdict: .approved, receiptID: "r")
        let denied = Artifact(id: "d", kind: .receipt, title: "", byLine: "", meta: "",
                              verdict: .denied, receiptID: "r")
        XCTAssertEqual(approved.tint, PD.color(for: .affirmative))
        XCTAssertEqual(denied.tint, PD.color(for: .refuse))
    }

    func testEveryKindHasLabelAndSymbol() {
        for kind in Artifact.Kind.allCases {
            XCTAssertFalse(kind.label.isEmpty)
            XCTAssertFalse(kind.systemImage.isEmpty)
        }
    }
}
