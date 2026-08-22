import XCTest
import Foundation
@testable import PortDaddyKit

/// Pins for ADR-0125 §4. The failure these exist to catch is not a crash —
/// it is a tidy-looking screen that quietly stopped showing `pause` on a
/// backend that cannot pause, leaving the operator to conclude the verb was
/// never considered.
///
/// The matrix is asserted against control-contract.fixture.json, generated
/// from skills/agent-control-command-contract/examples/sample-input.json. An
/// adapter that gains a verb changes that JSON, which turns these red, which
/// is exactly the review moment ADR-0125 §4 asks for.
final class ControlVerbsTests: XCTestCase {

    private struct ContractFixture: Decodable {
        let authorizationSource: String
        let verbs: [String]
        let terminalStates: [[String]]
        let supportedVerbs: [String: [String]]
        let unsupportedVerbs: [String: [String]]
    }

    private func contract() throws -> ContractFixture {
        try PortDaddyFixtures.decode(ContractFixture.self, from: .controlContract)
    }

    // MARK: - The v1 pins

    /// The headline pin. On a remote body — the only kind an iOS operator acts
    /// through — pause and fork are unsupported in v1, and nothing else is.
    func testRemoteBodyUnsupportedVerbsAreExactlyPauseAndFork() {
        XCTAssertEqual(
            ControlVerbs.unsupportedVerbs(for: .cloudflareRemote),
            [.pause, .fork]
        )
    }

    /// The rule that makes the previous test meaningful: unsupported does not
    /// mean absent. Every verb appears in the matrix for every backend.
    func testUnsupportedVerbsAreStillPresentInTheMatrix() {
        for backend in ControlBackend.allCases {
            let rendered = ControlVerbs.matrix(for: backend).map { $0.verb }
            XCTAssertEqual(
                rendered,
                ControlVerb.allCases,
                "\(backend.rawValue) dropped a verb from the matrix — an unsupported verb must render, not vanish"
            )
        }
    }

    /// An unsupported verb without a reason is a hidden verb wearing a
    /// disabled control's clothes. Every one of them must say why.
    func testEveryUnsupportedVerbCarriesANonEmptyReason() {
        for backend in ControlBackend.allCases {
            for availability in ControlVerbs.matrix(for: backend) where !availability.support.isSupported {
                let reason = availability.support.reason ?? ""
                XCTAssertFalse(
                    reason.isEmpty,
                    "\(availability.verb.rawValue) on \(backend.rawValue) is unsupported with no stated reason"
                )
            }
        }
    }

    /// The reason must be about the backend, not about Port Daddy's backlog,
    /// and it must not point the operator at a substitute that does something
    /// different. Pause's reason names checkpoint-then-kill explicitly.
    func testRemotePauseReasonNamesTheSubstituteRatherThanSubstitutingSilently() {
        let support = ControlVerbs.support(for: .pause, on: .cloudflareRemote)
        XCTAssertFalse(support.isSupported)
        let reason = support.reason ?? ""
        XCTAssertTrue(reason.contains("Checkpoint"), "pause's reason should name the real alternative")
        XCTAssertTrue(reason.contains("Kill"), "pause's reason should name the real alternative")
    }

    func testObservedOnlyBackendSupportsNothingAndHidesNothing() {
        XCTAssertEqual(ControlVerbs.supportedVerbs[.hookOnlyObserved], [])
        XCTAssertEqual(ControlVerbs.unsupportedVerbs(for: .hookOnlyObserved), ControlVerb.allCases)
        XCTAssertEqual(ControlVerbs.matrix(for: .hookOnlyObserved).count, ControlVerb.allCases.count)
    }

    func testLocalBackendSupportsEveryVerb() {
        XCTAssertTrue(ControlVerbs.unsupportedVerbs(for: .localSameUID).isEmpty)
    }

    // MARK: - Parity with the contract fixture

    func testMatrixMatchesTheContractFixture() throws {
        let contract = try self.contract()
        XCTAssertEqual(contract.verbs, ControlVerb.allCases.map(\.rawValue))
        for backend in ControlBackend.allCases {
            let supported = try XCTUnwrap(
                contract.supportedVerbs[backend.rawValue],
                "the contract fixture has no row for \(backend.rawValue)"
            )
            XCTAssertEqual(
                (ControlVerbs.supportedVerbs[backend] ?? []).map(\.rawValue),
                supported,
                "supported-verb drift on \(backend.rawValue)"
            )
            let unsupported = try XCTUnwrap(contract.unsupportedVerbs[backend.rawValue])
            XCTAssertEqual(
                ControlVerbs.unsupportedVerbs(for: backend).map(\.rawValue),
                unsupported,
                "unsupported-verb drift on \(backend.rawValue)"
            )
        }
    }

    /// Six, not five. The contract JSON carries `unsupported` as a terminal
    /// state even though ADR-0125's prose enumerates five, and a Swift enum
    /// missing it would fold `unsupported` into `failed` on decode.
    func testCommandStateCarriesAllSixTerminalStates() throws {
        let contract = try self.contract()
        let expected = try XCTUnwrap(contract.terminalStates.first)
        XCTAssertEqual(expected.count, 6)
        XCTAssertEqual(CommandState.allCases.map(\.rawValue), expected)
        for states in contract.terminalStates {
            XCTAssertEqual(states, expected, "verbs must share one lifecycle vocabulary")
        }
    }

    func testAuthorizationSourceIsAuthoritative() throws {
        // ADR-0125 §5: authorization reads authoritative-lease or
        // authoritative-event only — never a cached projection, never UI state.
        XCTAssertEqual(try contract().authorizationSource, "authoritative-lease")
    }

    // MARK: - Lifecycle honesty

    func testOnlyQueuedAndDeliveredAreInFlight() {
        XCTAssertTrue(CommandState.queued.isInFlight)
        XCTAssertTrue(CommandState.delivered.isInFlight)
        for state in [CommandState.acknowledged, .failed, .expired, .unsupported] {
            XCTAssertFalse(state.isInFlight, "\(state.rawValue) is terminal — ADR-0122 §5 allows no third state")
        }
    }

    /// ADR-0122 §5: expiry without delivery is a failure record, not silence.
    /// A terminal non-ack command with no reason is the silent half-control
    /// state the ADR forbids, and the model can spot it.
    func testTerminalFailureWithoutAReasonIsFlagged() {
        let silent = ControlCommand(
            id: "cmd_1",
            verb: .interrupt,
            backend: .cloudflareRemote,
            state: .expired,
            failureReason: nil,
            jti: "jti_1",
            authorityEpoch: 7,
            issuedAt: Date(timeIntervalSince1970: 1_755_820_000)
        )
        XCTAssertTrue(silent.isMissingRequiredReason)

        let recorded = ControlCommand(
            id: "cmd_2",
            verb: .interrupt,
            backend: .cloudflareRemote,
            state: .expired,
            failureReason: "expired before delivery: no daemon claimed the harbor for 90s",
            jti: "jti_2",
            authorityEpoch: 7,
            issuedAt: Date(timeIntervalSince1970: 1_755_820_000)
        )
        XCTAssertFalse(recorded.isMissingRequiredReason)

        let acked = ControlCommand(
            id: "cmd_3",
            verb: .interrupt,
            backend: .cloudflareRemote,
            state: .acknowledged,
            jti: "jti_3",
            authorityEpoch: 7,
            issuedAt: Date(timeIntervalSince1970: 1_755_820_000)
        )
        XCTAssertFalse(acked.isMissingRequiredReason, "an acknowledged command needs no failure reason")
    }

    /// Every lifecycle state renders through the shared maritime vocabulary
    /// rather than a private palette — ADR-0125 §7, "no surface hand-picks
    /// letters".
    func testEveryCommandStateHasACoordinationState() {
        for state in CommandState.allCases {
            let coordination = state.coordinationState
            XCTAssertNotNil(MaritimeSignals.signalForState[coordination])
        }
    }
}
