import XCTest
@testable import PortDaddyKit

/// MaritimeSignals.swift is a hand-written port of lib/maritime-signals.ts.
/// These tests are the mechanism that stops the two from drifting apart in
/// silence: every constant is compared against a fixture GENERATED from the
/// TypeScript by scripts/generate-pd-ios-fixtures.ts, escape sequences and
/// em-dashes included.
///
/// If one of these fails, the TypeScript is right and the Swift is wrong —
/// unless the fixture is stale, which CI checks separately before it gets
/// here.
final class MaritimeSignalsParityTests: XCTestCase {

    private func fixture() throws -> [String: Any] {
        try PortDaddyFixtures.object(.maritimeSignals)
    }

    /// Named stringMap, not map: a bare `map(...)` inside an XCTestCase would
    /// read like Sequence.map at a glance.
    private func stringMap(_ fixture: [String: Any], _ key: String) throws -> [String: String] {
        try XCTUnwrap(fixture[key] as? [String: String], "fixture key '\(key)' is missing or not a string map")
    }

    func testCoordinationStatesMatchInDeclarationOrder() throws {
        let expected = try XCTUnwrap(try fixture()["coordinationStates"] as? [String])
        XCTAssertEqual(CoordinationState.allCases.map(\.rawValue), expected)
        // The order is not cosmetic: signalFor()'s throw message interpolates
        // Object.keys(SIGNAL_FOR_STATE), so a reordering changes user-visible
        // error text on both surfaces.
        XCTAssertEqual(MaritimeSignals.knownStatesJoined, expected.joined(separator: ", "))
    }

    func testSignalCodesAreTheFullAlphabet() throws {
        let expected = try XCTUnwrap(try fixture()["signalCodes"] as? [String])
        XCTAssertEqual(expected.count, 26)
        XCTAssertEqual(SignalCode.allCases.map(\.rawValue).sorted(), expected.sorted())
    }

    func testSignalForStateMatches() throws {
        // Assert the KEY SET before touching signal(for:). signalForState is a
        // dictionary literal, not a switch, so it gets no exhaustiveness
        // checking from the compiler — a new CoordinationState case compiles
        // clean and only shows up at the preconditionFailure in signal(for:).
        // A preconditionFailure inside XCTest aborts the whole test process
        // rather than failing one case, so without this line a missing entry
        // takes the rest of the suite down with it and reports as a crash
        // instead of naming the state that is missing.
        XCTAssertEqual(
            Set(MaritimeSignals.signalForState.keys),
            Set(CoordinationState.allCases),
            "signalForState is missing an entry for a CoordinationState case (or has one for a state that no longer exists)"
        )

        let expected = try stringMap(try fixture(), "signalForState")
        XCTAssertEqual(expected.count, CoordinationState.allCases.count)
        for state in CoordinationState.allCases {
            let want = try XCTUnwrap(expected[state.rawValue], "no fixture flag for \(state.rawValue)")
            XCTAssertEqual(MaritimeSignals.signal(for: state).rawValue, want, "flag drift on \(state.rawValue)")
        }
    }

    func testStateForSignalIsTheExactPartialInverse() throws {
        let expected = try stringMap(try fixture(), "stateForSignal")
        // Fourteen mapped letters; the other twelve must stay unmapped rather
        // than resolving to a nearby state.
        XCTAssertEqual(expected.count, 14)
        for code in SignalCode.allCases {
            let got = MaritimeSignals.state(for: code)?.rawValue
            XCTAssertEqual(got, expected[code.rawValue], "inverse drift on \(code.rawValue)")
        }
    }

    func testIcsMeaningsMatchByteForByte() throws {
        let expected = try stringMap(try fixture(), "icsMeaning")
        for code in SignalCode.allCases {
            let want = try XCTUnwrap(expected[code.rawValue])
            XCTAssertEqual(MaritimeSignals.icsMeaning[code], want, "ICS meaning drift on \(code.rawValue)")
        }
    }

    func testNatoPhoneticsMatch() throws {
        let expected = try stringMap(try fixture(), "natoPhonetic")
        for code in SignalCode.allCases {
            let want = try XCTUnwrap(expected[code.rawValue])
            XCTAssertEqual(MaritimeSignals.natoPhonetic[code], want, "phonetic drift on \(code.rawValue)")
        }
        // Two spellings that look like typos and are not.
        XCTAssertEqual(MaritimeSignals.natoPhonetic[.J], "Juliett")
        XCTAssertEqual(MaritimeSignals.natoPhonetic[.X], "X-ray")
    }

    func testColourBucketsMatchTheAnsiLaw() throws {
        let expected = try stringMap(try fixture(), "signalAnsi")
        for code in SignalCode.allCases {
            let want = try XCTUnwrap(expected[code.rawValue])
            let got = try XCTUnwrap(MaritimeSignals.bucketForSignal[code], "no bucket for \(code.rawValue)").ansi
            XCTAssertEqual(got, want, "colour drift on \(code.rawValue)")
        }
        XCTAssertEqual(MaritimeSignals.ansiReset, try XCTUnwrap(try fixture()["ansiReset"] as? String))
    }

    /// The documented port hazard, pinned so nobody "fixes" it on the phone:
    /// burning-cash is B, and B is GRAY, not red or amber.
    func testBurningCashIsGrayNotRed() {
        XCTAssertEqual(MaritimeSignals.signal(for: .burningCash), .B)
        XCTAssertEqual(MaritimeSignals.bucket(for: .burningCash), .gray)
    }

    func testFormatSignalMatches() throws {
        let expected = try stringMap(try fixture(), "formatSignal")
        for state in CoordinationState.allCases {
            XCTAssertEqual(MaritimeSignals.formatSignal(state), try XCTUnwrap(expected[state.rawValue]))
        }
    }

    func testColorizeMatchesWithAndWithoutALabel() throws {
        let plain = try stringMap(try fixture(), "colorize")
        let labelled = try stringMap(try fixture(), "colorizeWithLabel")
        for state in CoordinationState.allCases {
            XCTAssertEqual(MaritimeSignals.colorize(state), try XCTUnwrap(plain[state.rawValue]))
            XCTAssertEqual(
                MaritimeSignals.colorize(state, label: "\(state.rawValue) label"),
                try XCTUnwrap(labelled[state.rawValue])
            )
        }
    }

    func testHoistsMatchIncludingTheKnownWart() throws {
        let expected = try XCTUnwrap(try fixture()["hoists"] as? [String: [String: Any]])
        XCTAssertEqual(Set(MaritimeSignals.hoists.keys), Set(expected.keys))
        for (key, want) in expected {
            let hoist = try XCTUnwrap(MaritimeSignals.hoists[key], "missing hoist \(key)")
            XCTAssertEqual(hoist.letters.map(\.rawValue), try XCTUnwrap(want["letters"] as? [String]), "letters drift on \(key)")
            XCTAssertEqual(hoist.meaning, try XCTUnwrap(want["meaning"] as? String), "meaning drift on \(key)")
        }
        // K-1 carries only the letter. The numeric pennant lives in the prose,
        // exactly as the TypeScript leaves it. Widening SignalCode is the real
        // fix and it belongs in the TypeScript first.
        XCTAssertEqual(MaritimeSignals.hoists["K-1"]?.letters, [.K])
    }

    func testUnknownStateThrowsTheSameSentence() throws {
        let fixture = try self.fixture()
        let prefix = try XCTUnwrap(fixture["unknownStateErrorPrefix"] as? String)
        let known = try XCTUnwrap(fixture["unknownStateErrorKnownStates"] as? String)

        XCTAssertThrowsError(try MaritimeSignals.signal(forRawState: "not-a-state")) { error in
            guard let error = error as? UnknownCoordinationStateError else {
                return XCTFail("expected UnknownCoordinationStateError, got \(error)")
            }
            XCTAssertEqual(error.state, "not-a-state")
            XCTAssertEqual(error.knownStates, known)
            XCTAssertEqual(error.description, "\(prefix)not-a-state. Known states: \(known)")
        }
    }

    /// A known state must NOT throw — the throwing path is for genuinely
    /// unknown input, not a general escape hatch.
    func testKnownRawStateResolves() throws {
        XCTAssertEqual(try MaritimeSignals.signal(forRawState: "conflict"), .V)
    }
}
