import XCTest
import Foundation
@testable import PortDaddyKit

/// The roadmap projection is produced by lib/roadmap-projection.ts and merely
/// rendered here. These tests cover the two ways that can go wrong on the
/// client: decoding it incorrectly, and rendering it more confidently than the
/// evidence allows.
final class RoadmapProjectionCodableTests: XCTestCase {

    private func projection() throws -> RoadmapProjection {
        try PortDaddyFixtures.roadmapProjection()
    }

    // MARK: - Codable

    func testDecodesTheFixture() throws {
        let projection = try self.projection()
        XCTAssertEqual(projection.v, RoadmapProjection.knownVersion)
        XCTAssertTrue(projection.isKnownVersion)
        XCTAssertEqual(projection.harbor, "fleet")
        XCTAssertFalse(projection.items.isEmpty)
        XCTAssertFalse(projection.doThisNext.isEmpty)
        XCTAssertLessThanOrEqual(projection.doThisNext.count, RoadmapProjection.doThisNextMax)
    }

    func testRoundTripsThroughEncodeAndDecode() throws {
        let original = try projection()
        let encoded = try JSONEncoder().encode(original)
        let decoded = try JSONDecoder().decode(RoadmapProjection.self, from: encoded)
        XCTAssertEqual(decoded, original, "a re-encode must survive a re-decode unchanged")
    }

    /// Optionals must survive the round trip as optionals. An item with no
    /// claim must not come back claimed, and a receipt with no author must not
    /// come back attributed to someone.
    func testNullsSurviveTheRoundTrip() throws {
        let original = try projection()
        let decoded = try JSONDecoder().decode(RoadmapProjection.self, from: try JSONEncoder().encode(original))

        let backlog = try XCTUnwrap(decoded.items.first { $0.slug == "roadmap-projection-route" })
        XCTAssertNil(backlog.claim)
        XCTAssertNil(backlog.liveEvidence.dispatchId)
        XCTAssertNil(backlog.liveEvidence.source)
        XCTAssertNil(backlog.liveEvidence.ageMs)

        let live = try XCTUnwrap(decoded.items.first { $0.slug == "ios-operator-surface" })
        let unattributed = try XCTUnwrap(live.receipts.first { $0.detail.contains("scaffold") })
        XCTAssertNil(unattributed.by)
    }

    /// Tolerant reader: a status this build has never heard of must decode and
    /// sort after the known ones, not throw and blank the home screen.
    func testUnknownStatusDecodesAndSortsLast() throws {
        let json = """
        {
          "v": 1,
          "harbor": "fleet",
          "generatedAt": 1755820800000,
          "items": [
            {
              "id": "rm_x",
              "slug": "invented-status",
              "title": "An item with a status from the future",
              "status": "marooned",
              "priority": 1,
              "claim": null,
              "receipts": [],
              "liveEvidence": {
                "live": false, "source": null, "dispatchId": null,
                "lastEvidenceAt": null, "ageMs": null, "maxAgeMs": 65000,
                "label": "static — no dispatch receipt trail"
              },
              "lastTouchedAt": 1755820800000,
              "dependencies": []
            }
          ],
          "doThisNext": []
        }
        """
        let decoded = try JSONDecoder().decode(RoadmapProjection.self, from: Data(json.utf8))
        let item = try XCTUnwrap(decoded.items.first)
        XCTAssertEqual(item.status.rawValue, "marooned")
        XCTAssertFalse(item.status.isKnown)
        XCTAssertGreaterThan(item.status.rank, RoadmapStatus.done.rank)
    }

    /// A newer projection version still renders; the surface just says so.
    func testNewerVersionIsFlaggedNotRejected() throws {
        let json = """
        { "v": 2, "harbor": "fleet", "generatedAt": 1, "items": [], "doThisNext": [] }
        """
        let decoded = try JSONDecoder().decode(RoadmapProjection.self, from: Data(json.utf8))
        XCTAssertFalse(decoded.isKnownVersion)
    }

    // MARK: - Ordering

    func testProjectionOrderMatchesTheServerSort() throws {
        let projection = try self.projection()
        let ordered = RoadmapProjection.inProjectionOrder(projection.items)
        XCTAssertEqual(ordered.map(\.slug), projection.items.map(\.slug), "the fixture is already in projection order")

        // STATUS_RANK dominates priority.
        let statusRanks = ordered.map(\.status.rank)
        XCTAssertEqual(statusRanks, statusRanks.sorted())
    }

    // MARK: - Law 13 — never a fake LIVE

    func testLiveChipRequiresRealEvidence() throws {
        let projection = try self.projection()

        let live = try XCTUnwrap(projection.items.first { $0.slug == "ios-operator-surface" })
        XCTAssertEqual(live.liveEvidence.displayState, .live)

        let old = try XCTUnwrap(projection.items.first { $0.slug == "harbor-authority" })
        XCTAssertEqual(old.liveEvidence.displayState, .stale, "evidence older than the window is not live")

        let trailOnly = try XCTUnwrap(projection.items.first { $0.slug == "apns-push-for-interruptions" })
        XCTAssertEqual(trailOnly.liveEvidence.displayState, .stale, "a dispatch trail with no stream evidence is not live")

        let never = try XCTUnwrap(projection.items.first { $0.slug == "roadmap-projection-route" })
        XCTAssertEqual(never.liveEvidence.displayState, .noEvidence, "no dispatch at all is not the same as stale")
    }

    /// The adversarial case: a projection that claims `live: true` with
    /// nothing behind it. The chip must refuse. A stale chip is a small
    /// disappointment; a fake LIVE is an operator acting on a body that
    /// stopped talking.
    func testClaimedLiveWithoutEvidenceRendersStale() {
        let lying = RoadmapLiveEvidence(
            live: true,
            source: "popper-dispatch",
            dispatchId: "dsp_ghost",
            lastEvidenceAt: nil,
            ageMs: nil,
            maxAgeMs: 65_000,
            label: "live — events arriving"
        )
        XCTAssertEqual(lying.displayState, .stale)

        let expired = RoadmapLiveEvidence(
            live: true,
            source: "popper-dispatch",
            dispatchId: "dsp_ghost",
            lastEvidenceAt: 1_755_820_000_000,
            ageMs: 65_001,
            maxAgeMs: 65_000,
            label: "live — events arriving"
        )
        XCTAssertEqual(expired.displayState, .stale, "one millisecond past the window is past the window")

        let noDispatchButLive = RoadmapLiveEvidence(
            live: true,
            source: nil,
            dispatchId: nil,
            lastEvidenceAt: 1_755_820_000_000,
            ageMs: 10,
            maxAgeMs: 65_000,
            label: "live — events arriving"
        )
        XCTAssertEqual(noDispatchButLive.displayState, .noEvidence, "there is no live without a dispatch")
    }

    func testEveryDisplayStateRendersThroughTheSharedSignalVocabulary() {
        for state in [RoadmapLiveEvidence.DisplayState.live, .stale, .noEvidence] {
            XCTAssertFalse(state.label.isEmpty)
            XCTAssertNotNil(MaritimeSignals.signalForState[state.coordinationState])
        }
    }
}
