import XCTest
import Foundation
@testable import PortDaddyKit

/// ADR-0125 §6. The verdict that matters most is `unknown`, and the property
/// that matters most about it is that it is NOT `impossible`.
final class HarborReachabilityTests: XCTestCase {

    private func presence(daemonsOnline: Int, usersOnline: Int = 0) -> PresenceSnapshot {
        var entries: [PresenceEntry] = []
        for index in 0..<daemonsOnline {
            entries.append(PresenceEntry(kind: "daemon", member: "daemon\(index)", tier: "verified", lastSeenAt: 1_755_820_000))
        }
        for index in 0..<usersOnline {
            entries.append(PresenceEntry(kind: "user", member: "user\(index)", tier: "verified", lastSeenAt: 1_755_820_000))
        }
        return PresenceSnapshot(online: entries, ttlSeconds: 90)
    }

    func testAllDaemonsLiveIsPossible() {
        let reading = Reachability.derive(totalDaemonMembers: 2, presence: presence(daemonsOnline: 2))
        XCTAssertEqual(reading.verdict, .possible)
        XCTAssertEqual(reading.onlineDaemons, 2)
    }

    func testSomeDaemonsLiveIsDegraded() {
        let reading = Reachability.derive(totalDaemonMembers: 3, presence: presence(daemonsOnline: 1))
        XCTAssertEqual(reading.verdict, .degraded)
    }

    func testNoDaemonsLiveIsImpossible() {
        let reading = Reachability.derive(totalDaemonMembers: 2, presence: presence(daemonsOnline: 0))
        XCTAssertEqual(reading.verdict, .impossible)
    }

    /// Reads oddly and is correct: a harbor with no daemon in it cannot reach
    /// anything. That is what `impossible` means, and it is not an error.
    func testHarborWithNoDaemonMembersIsImpossibleNotUnknown() {
        let reading = Reachability.derive(totalDaemonMembers: 0, presence: presence(daemonsOnline: 0, usersOnline: 3))
        XCTAssertEqual(reading.verdict, .impossible)
        XCTAssertEqual(reading.totalDaemons, 0)
    }

    /// Online users do not make a harbor reachable. Only daemons carry work.
    func testOnlineUsersDoNotCountTowardsReachability() {
        let reading = Reachability.derive(totalDaemonMembers: 2, presence: presence(daemonsOnline: 0, usersOnline: 5))
        XCTAssertEqual(reading.verdict, .impossible)
        XCTAssertEqual(reading.onlineDaemons, 0)
    }

    // MARK: - The split-plane law

    func testUnreadablePresenceIsUnknownNeverImpossible() {
        let reading = Reachability.derive(totalDaemonMembers: 2, presence: nil)
        XCTAssertEqual(reading.verdict, .unknown)
        XCTAssertNotEqual(reading.verdict, .impossible)
    }

    /// Which guard wins when BOTH "no daemon members" and "presence could not
    /// be read" hold at once. Two tests covered the halves — (2, nil) and
    /// (0, presence) — and neither pinned the pair, so the order of the two
    /// guards in `derive` was free to flip.
    ///
    /// Unknown wins, and it has to. `impossible` is the only verdict that gates
    /// a capability; a membership count read as 0 because the read FAILED would
    /// otherwise lock the operator out of a harbor that is fine. Swap the
    /// `guard let presence` at Harbors.swift:209 below the
    /// `totalDaemonMembers <= 0` check and this is the test that goes red.
    func testUnreadablePresenceIsUnknownEvenWhenTheMemberCountIsAlsoZero() {
        let reading = Reachability.derive(totalDaemonMembers: 0, presence: nil)
        XCTAssertEqual(reading.verdict, .unknown, "a failed read must not masquerade as an empty harbor")
        XCTAssertFalse(reading.verdict.gatesRemoteCapability)
    }

    /// The consequence that has teeth: only `impossible` may gate a
    /// capability. `unknown` must not, or a flaky network silently becomes an
    /// app-wide lockout.
    func testOnlyImpossibleGatesACapability() {
        XCTAssertTrue(ReachabilityVerdict.impossible.gatesRemoteCapability)
        XCTAssertFalse(ReachabilityVerdict.unknown.gatesRemoteCapability)
        XCTAssertFalse(ReachabilityVerdict.degraded.gatesRemoteCapability)
        XCTAssertFalse(ReachabilityVerdict.possible.gatesRemoteCapability)
    }

    /// A failed refresh keeps the last verdict and marks it cached, with its
    /// original observation time preserved so the age shown is real.
    func testFailedRefreshKeepsTheLastVerdictAndItsAge() {
        let observed = Date(timeIntervalSince1970: 1_755_820_000)
        let fresh = ReachabilityReading(verdict: .possible, onlineDaemons: 2, totalDaemons: 2, observedAt: observed)
        let now = observed.addingTimeInterval(180)

        let cached = ReachabilityReading.cached(from: fresh, now: now)
        XCTAssertEqual(cached.verdict, .possible, "a failed read does not change the verdict")
        XCTAssertTrue(cached.isCached)
        XCTAssertEqual(cached.observedAt, observed, "the age shown must be the age of the reading, not of the failure")
        XCTAssertEqual(cached.age(now: now), 180, accuracy: 0.001)
        XCTAssertTrue(cached.caption(now: now).contains("3m"))
    }

    /// With nothing cached, a failed read falls back to `unknown` — never to
    /// `impossible`, and never to an optimistic `possible`.
    func testFailedRefreshWithNoCacheFallsBackToUnknown() {
        let reading = ReachabilityReading.cached(from: nil, now: Date(timeIntervalSince1970: 1_755_820_000))
        XCTAssertEqual(reading.verdict, .unknown)
        XCTAssertFalse(reading.isCached)
    }

    func testEveryVerdictHasAFlagAndAnExplanation() {
        for verdict in ReachabilityVerdict.allCases {
            XCTAssertNotNil(MaritimeSignals.signalForState[verdict.coordinationState])
            XCTAssertFalse(verdict.explanation.isEmpty)
        }
    }

    // MARK: - Fixture coverage

    /// The fixture must keep exercising all four verdicts, including the one
    /// that is easiest to forget.
    func testFixtureCoversAllFourVerdicts() throws {
        let fixture = try PortDaddyFixtures.harbors()
        let verdicts = Set(fixture.entries.map { $0.reachability.verdict })
        XCTAssertEqual(verdicts, Set(ReachabilityVerdict.allCases))
    }

    func testRelativeAgeFormatting() {
        XCTAssertEqual(RelativeAge.short(0), "0s")
        XCTAssertEqual(RelativeAge.short(59), "59s")
        XCTAssertEqual(RelativeAge.short(60), "1m")
        XCTAssertEqual(RelativeAge.short(3_599), "59m")
        XCTAssertEqual(RelativeAge.short(3_600), "1h")
        XCTAssertEqual(RelativeAge.short(86_400), "1d")
        XCTAssertEqual(RelativeAge.short(-5), "0s", "a clock skew must not print a negative age")
    }
}
