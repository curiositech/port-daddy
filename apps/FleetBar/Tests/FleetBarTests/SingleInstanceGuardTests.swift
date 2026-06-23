import XCTest
@testable import FleetBar

/// Newest-wins single-instance semantics ("close the older one for the new one").
/// The decision logic is pure so the mutual-kill edge case is provable without
/// spawning real processes.
final class SingleInstanceGuardTests: XCTestCase {

    private func at(_ seconds: TimeInterval) -> Date { Date(timeIntervalSince1970: seconds) }

    func testSoleInstanceWhenNoPeers() {
        let me = RunningInstance(pid: 100, launchDate: at(10))
        XCTAssertEqual(SingleInstanceGuard.decide(me: me, peers: [me]), .soleInstance)
        XCTAssertEqual(SingleInstanceGuard.decide(me: me, peers: []), .soleInstance)
    }

    func testNewestReapsOlderPeers() {
        let me = RunningInstance(pid: 100, launchDate: at(30))
        let older1 = RunningInstance(pid: 101, launchDate: at(10))
        let older2 = RunningInstance(pid: 102, launchDate: at(20))
        let decision = SingleInstanceGuard.decide(me: me, peers: [older1, me, older2])
        XCTAssertEqual(decision, .reapOlder([101, 102]))
    }

    func testYieldsToANewerPeer() {
        let me = RunningInstance(pid: 100, launchDate: at(10))
        let newer = RunningInstance(pid: 101, launchDate: at(50))
        XCTAssertEqual(SingleInstanceGuard.decide(me: me, peers: [me, newer]), .yield)
    }

    func testAllUnknownDatesCurrentInstanceWins() {
        // When nothing reports a launch date, the running instance reaps the rest
        // rather than deadlocking — a deterministic tiebreak.
        let me = RunningInstance(pid: 100, launchDate: nil)
        let peer = RunningInstance(pid: 101, launchDate: nil)
        XCTAssertEqual(SingleInstanceGuard.decide(me: me, peers: [me, peer]), .reapOlder([101]))
    }

    func testUnknownSelfNeverYields() {
        // Self with no launch date must NOT yield to a dated peer — refusing to
        // launch (the old behaviour) stranded a fresh app against a stale
        // LaunchServices registration. Unknown self defaults to newest → reap.
        let me = RunningInstance(pid: 100, launchDate: nil)
        let peer = RunningInstance(pid: 101, launchDate: at(5))
        XCTAssertEqual(SingleInstanceGuard.decide(me: me, peers: [me, peer]), .reapOlder([101]))
    }
}
