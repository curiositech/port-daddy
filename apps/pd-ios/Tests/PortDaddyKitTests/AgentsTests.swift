import XCTest
@testable import PortDaddyKit

// Agents surface (durable cast + transcript). The fixture is hand-authored, so
// these tests are the contract that keeps it decodable through the same Codable
// path a real roster endpoint would use, and that the derived labels/colour
// buckets stay honest.
final class AgentsTests: XCTestCase {

    func testRosterFixtureDecodes() throws {
        let roster = try PortDaddyFixtures.agents()
        XCTAssertEqual(roster.agents.count, 5)
        // Spark is the one ephemeral agent; the rest are durable.
        XCTAssertEqual(roster.durableCount, 4)
        XCTAssertEqual(roster.agents.first?.id, "cartographer")
    }

    func testAgeLabelNilRendersDashNotZero() {
        let idle = DurableAgent(
            id: "x", name: "X", initials: "X", state: .idle, statusLine: "Idle",
            ageSeconds: nil, following: false, durable: true,
            lineage: nil, body: nil, contextPercent: nil, costUSD: nil, transcript: []
        )
        // nil age is "—", which is not the same claim as "0s".
        XCTAssertEqual(idle.ageLabel, "—")
    }

    func testCostLabelFormatsOrIsNil() {
        let priced = DurableAgent(
            id: "x", name: "X", initials: "X", state: .claimActive, statusLine: "",
            ageSeconds: 1, following: false, durable: true,
            lineage: nil, body: nil, contextPercent: nil, costUSD: 0.04, transcript: []
        )
        XCTAssertEqual(priced.costLabel, "$0.04")

        let unpriced = DurableAgent(
            id: "y", name: "Y", initials: "Y", state: .idle, statusLine: "",
            ageSeconds: nil, following: false, durable: true,
            lineage: nil, body: nil, contextPercent: nil, costUSD: nil, transcript: []
        )
        XCTAssertNil(unpriced.costLabel)
    }

    func testTranscriptKindsMapToExpectedColourBuckets() {
        // The colour law: a transcript kind is a coordination state, so the
        // tail and the roster and FleetBar cannot disagree on which red is red.
        XCTAssertEqual(MaritimeSignals.bucket(for: TranscriptEvent.Kind.agent.state), .blue)
        XCTAssertEqual(MaritimeSignals.bucket(for: TranscriptEvent.Kind.tool.state), .yellow)
        XCTAssertEqual(MaritimeSignals.bucket(for: TranscriptEvent.Kind.denied.state), .red)
        XCTAssertEqual(MaritimeSignals.bucket(for: TranscriptEvent.Kind.ok.state), .green)
    }

    func testEveryFixtureAgentStateIsRenderable() throws {
        // A state off the fixture that MaritimeSignals cannot flag would crash
        // the row at render; assert every one resolves to a signal + bucket.
        for agent in try PortDaddyFixtures.agents().agents {
            _ = MaritimeSignals.signal(for: agent.state)
            _ = MaritimeSignals.bucket(for: agent.state)
        }
    }
}
