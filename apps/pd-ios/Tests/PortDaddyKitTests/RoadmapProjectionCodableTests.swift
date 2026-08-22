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
    /// The `lastEvidenceAt != nil` clause of the LIVE guard had nothing behind
    /// it. Every existing stale case also has `ageMs == nil`, so `let age =
    /// ageMs` fails first and that clause never decides anything — delete it
    /// from the guard and the suite still passes. This is the case where it is
    /// the only thing standing between a projection and a fake LIVE: an age
    /// arrives, it is fresh, and there is still no timestamp saying when the
    /// evidence was seen.
    func testAFreshAgeWithNoEvidenceTimestampIsStillStale() {
        let ageWithoutTimestamp = RoadmapLiveEvidence(
            live: true,
            source: "popper-dispatch",
            dispatchId: "dsp_ghost",
            lastEvidenceAt: nil,
            ageMs: 1_000,
            maxAgeMs: 65_000,
            label: "live — events arriving"
        )
        XCTAssertEqual(ageWithoutTimestamp.displayState, .stale)
    }

    /// The window is inclusive: `age <= maxAgeMs`. The existing expiry case
    /// uses maxAgeMs + 1, so the boundary itself was never pinned and could
    /// flip to exclusive without failing anything. Design law 13 says LIVE
    /// renders with a recent heartbeat; a heartbeat landing exactly on the
    /// server's own deadline is still inside the window it defines.
    func testAgeExactlyAtTheDeadlineIsStillLive() {
        let onTheBoundary = RoadmapLiveEvidence(
            live: true,
            source: "popper-dispatch",
            dispatchId: "dsp_live",
            lastEvidenceAt: 1_755_820_000_000,
            ageMs: 65_000,
            maxAgeMs: 65_000,
            label: "live — events arriving"
        )
        XCTAssertEqual(onTheBoundary.displayState, .live)
    }

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

    /// The `live` clause of the LIVE guard had nothing behind it either.
    ///
    /// Every stale case in the suite and in the fixture fails on a LATER
    /// clause: `ageMs` is nil, or the age is past the window. Not one of them
    /// is stale BECAUSE `live` is false — so delete `live,` from
    /// `RoadmapProjection.swift:225` and the whole suite still passes, while
    /// the phone starts rendering LIVE for a projection whose server said it
    /// was not.
    ///
    /// This is that case, and it is not contrived: a body that stopped and was
    /// settled cleanly has a dispatch, a recent last-evidence timestamp, a
    /// small age — and `live: false`, because the server knows the stream is
    /// closed. Only the flag distinguishes it from a running one.
    func testAProjectionThatSaysNotLiveIsNotLiveEvenWithFreshEvidence() throws {
        let settledButFresh = RoadmapLiveEvidence(
            live: false,
            source: "popper-dispatch",
            dispatchId: "dsp_settled",
            lastEvidenceAt: 1_755_820_780_000,
            ageMs: 4_000,
            maxAgeMs: 65_000,
            label: "settled — dispatch accepted"
        )
        XCTAssertEqual(
            settledButFresh.displayState, .stale,
            "the server's own live flag is the first clause, not a formality"
        )
        // Premise: every OTHER clause of the guard is satisfied here, so `live`
        // is the only thing deciding. Without this the assertion above passes
        // for evidence that was going to be stale anyway.
        XCTAssertNotNil(settledButFresh.dispatchId)
        XCTAssertNotNil(settledButFresh.lastEvidenceAt)
        XCTAssertLessThanOrEqual(try XCTUnwrap(settledButFresh.ageMs), settledButFresh.maxAgeMs)
    }

    // MARK: - The sort clauses under the first two

    /// `inProjectionOrder`'s last two clauses execute ZERO times on the
    /// fixture. Its six items have distinct (status, priority) pairs — (now,1),
    /// (now,2), (merge,2), (backlog,3), (backlog,4), (parked,5) — so the
    /// priority comparison at `RoadmapProjection.swift:321` always decides and
    /// lines 322-323 never run. Reverse the lastTouchedAt comparison, or delete
    /// the slug tie-break entirely, and `testProjectionOrderMatchesTheServerSort`
    /// stays green.
    ///
    /// That matters because the projection's whole job is that the phone, the
    /// console and the web home show the SAME order. A tie-break that only one
    /// of them implements is a list that reorders itself when the operator
    /// switches surfaces.
    func testEqualPrioritiesFallBackToMostRecentlyTouchedFirst() {
        let older = Self.item(slug: "b-older", priority: 3, lastTouchedAt: 1_755_500_000_000)
        let newer = Self.item(slug: "a-newer", priority: 3, lastTouchedAt: 1_755_800_000_000)
        // Input order deliberately puts the older one first AND gives it the
        // slug that would win an ascending slug sort, so neither "unchanged"
        // nor "sorted by slug" produces the expected answer.
        let ordered = RoadmapProjection.inProjectionOrder([older, newer])
        XCTAssertEqual(
            ordered.map(\.slug), ["a-newer", "b-older"],
            "lastTouchedAt is DESCENDING — the item worked on most recently comes first"
        )
    }

    /// The final tie-break. Two items identical on status, priority AND
    /// lastTouchedAt is what a bulk import or a migration produces, and it is
    /// exactly when an unstable sort makes two surfaces disagree.
    func testItemsIdenticalOnEveryOtherKeyBreakTheTieOnSlug() {
        let z = Self.item(slug: "z-item", priority: 3, lastTouchedAt: 1_755_600_000_000)
        let a = Self.item(slug: "a-item", priority: 3, lastTouchedAt: 1_755_600_000_000)
        XCTAssertEqual(RoadmapProjection.inProjectionOrder([z, a]).map(\.slug), ["a-item", "z-item"])
        XCTAssertEqual(
            RoadmapProjection.inProjectionOrder([a, z]).map(\.slug), ["a-item", "z-item"],
            "the same two items in the other input order must produce the same output order"
        )
    }

    /// And the clause ordering itself: priority must not outrank status. A
    /// parked item with priority 1 sorts after a now item with priority 9.
    func testStatusRankOutranksPriority() {
        let parkedUrgent = Self.item(slug: "parked-urgent", status: .parked, priority: 1, lastTouchedAt: 1_755_800_000_000)
        let nowTrivial = Self.item(slug: "now-trivial", status: .now, priority: 9, lastTouchedAt: 1_755_400_000_000)
        XCTAssertEqual(
            RoadmapProjection.inProjectionOrder([parkedUrgent, nowTrivial]).map(\.slug),
            ["now-trivial", "parked-urgent"]
        )
    }

    /// Minimal item for the ordering tests. Everything the sort does not read
    /// is held constant so a failure names the clause that moved.
    private static func item(
        slug: String,
        status: RoadmapStatus = .backlog,
        priority: Int,
        lastTouchedAt: Double
    ) -> RoadmapProjectionItem {
        RoadmapProjectionItem(
            id: slug,
            slug: slug,
            title: slug,
            status: status,
            priority: priority,
            claim: nil,
            receipts: [],
            liveEvidence: RoadmapLiveEvidence(
                live: false,
                source: nil,
                dispatchId: nil,
                lastEvidenceAt: nil,
                ageMs: nil,
                maxAgeMs: 65_000,
                label: "static — no dispatch receipt trail"
            ),
            lastTouchedAt: lastTouchedAt,
            dependencies: []
        )
    }
}
