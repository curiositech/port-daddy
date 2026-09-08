import XCTest
import Foundation
@testable import PortDaddyKit

/// These pin the relay's REAL paths. Every one was read out of
/// apps/relay/src/index.ts, which routes with a hand-rolled if/else chain on
/// url.pathname — there is no router table and no naming convention to
/// extrapolate from, so a plausible-looking path is a guess, and a guess is a
/// 404 in front of an operator.
final class RelayClientTests: XCTestCase {

    private func client(base: String = "https://relay.portdaddy.dev", token: String? = "pdu_testtoken") -> RelayClient {
        let store = InMemoryRelayTokenStore(credential: token.map { RelayCredential(token: $0) })
        return RelayClient(baseURL: URL(string: base)!, tokenStore: store)
    }

    // MARK: - Route pins

    func testRoutesMatchTheRelay() {
        XCTAssertEqual(RelayRoute.deviceStart, "/auth/device/start")
        XCTAssertEqual(RelayRoute.deviceToken, "/auth/device/token")
        XCTAssertEqual(RelayRoute.whoami, "/auth/whoami")
        XCTAssertEqual(RelayRoute.harbors, "/v1/harbors")
        XCTAssertEqual(RelayRoute.interruptions, "/v1/interruptions")
        XCTAssertEqual(RelayRoute.accountInterruptions, "/account/interruptions")
        XCTAssertEqual(RelayRoute.apnsDevices, "/v1/push/apns/devices")
    }

    func testHarborRoutesAreBuiltFromNamespaceAndName() {
        XCTAssertEqual(RelayRoute.harbor(namespace: "erichowens", name: "fleet"), "/v1/harbors/erichowens/fleet")
        XCTAssertEqual(
            RelayRoute.harborPresence(namespace: "erichowens", name: "fleet"),
            "/v1/harbors/erichowens/fleet/presence"
        )
    }

    // A slash inside a NAME must not become another path segment. `.urlPathAllowed`
    // is the RFC 3986 path grammar, `path = *( pchar / "/" )`, so `/` is a member
    // of it — encoding a component with that set is a no-op for exactly the
    // character that decides where a segment ends.
    func testASlashInsideAHarborNameIsEncodedRatherThanSplittingTheRoute() {
        XCTAssertEqual(
            RelayRoute.harbor(namespace: "erichowens", name: "a/b"),
            "/v1/harbors/erichowens/a%2Fb"
        )
        // The case that names the defect: the relay routes on a hand-rolled
        // pathname chain, so an unencoded slash here addresses the PRESENCE
        // route of harbor "fleet" instead of a harbor named "fleet/presence".
        XCTAssertNotEqual(
            RelayRoute.harbor(namespace: "erichowens", name: "fleet/presence"),
            RelayRoute.harborPresence(namespace: "erichowens", name: "fleet")
        )
        // ...and a namespace with a slash cannot climb into another account's.
        XCTAssertEqual(
            RelayRoute.harbor(namespace: "alice/../bob", name: "fleet"),
            "/v1/harbors/alice%2F..%2Fbob/fleet"
        )
    }

    func testQueryAndFragmentDelimitersStayEncodedInAName() {
        // These are excluded from pchar, so they were already handled; the
        // assertion exists so narrowing the set later cannot widen them.
        XCTAssertEqual(RelayRoute.harbor(namespace: "n", name: "a?b"), "/v1/harbors/n/a%3Fb")
        XCTAssertEqual(RelayRoute.harbor(namespace: "n", name: "a#b"), "/v1/harbors/n/a%23b")
    }

    // MARK: - Request shape

    func testRequestsCarryTheBearerTokenAndNoOriginHeader() throws {
        let request = try client().makeRequest(path: RelayRoute.harbors)
        XCTAssertEqual(request.url?.absoluteString, "https://relay.portdaddy.dev/v1/harbors")
        XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer pdu_testtoken")
        // isSameOrigin() treats a request with neither Origin nor Referer as
        // same-origin. Setting an Origin that is not the relay's turns 200s
        // into 403 CROSS_ORIGIN on every route that checks.
        XCTAssertNil(request.value(forHTTPHeaderField: "Origin"))
        XCTAssertNil(request.value(forHTTPHeaderField: "Referer"))
    }

    // The encoding above survives URL construction only because makeRequest
    // assigns through `percentEncodedPath`. `URLComponents.path` takes a DECODED
    // value, so assigning the already-encoded route through it turns `%2F` back
    // into `/` and reinstates the extra segment — the fix needs both halves,
    // and this is the half a route-level assertion alone would not catch.
    func testTheEncodedSlashSurvivesIntoTheRequestURL() throws {
        let request = try client().makeRequest(
            path: RelayRoute.harbor(namespace: "erichowens", name: "fleet/presence")
        )
        XCTAssertEqual(
            request.url?.absoluteString,
            "https://relay.portdaddy.dev/v1/harbors/erichowens/fleet%2Fpresence"
        )
    }

    func testInterruptionStateBecomesAValidatedQueryParameter() throws {
        let request = try client().makeRequest(
            path: RelayRoute.interruptions,
            query: [URLQueryItem(name: "state", value: InterruptionState.open.rawValue)]
        )
        XCTAssertEqual(request.url?.absoluteString, "https://relay.portdaddy.dev/v1/interruptions?state=open")
    }

    /// The relay validates `state` against ['open','acked','answered','expired']
    /// and 400s anything else, which is why the client takes the enum.
    func testEveryInterruptionStateIsOneTheRelayAccepts() {
        XCTAssertEqual(
            InterruptionState.allCases.map(\.rawValue),
            ["open", "acked", "answered", "expired"]
        )
    }

    func testMissingTokenFailsBeforeAnyNetworkCall() {
        XCTAssertThrowsError(try client(token: nil).makeRequest(path: RelayRoute.harbors)) { error in
            guard let relayError = error as? RelayError, case .unauthenticated = relayError else {
                return XCTFail("expected .unauthenticated, got \(error)")
            }
        }
    }

    func testCredentialShapeIsChecked() {
        XCTAssertTrue(RelayCredential(token: "pdu_abcdefghij").looksWellFormed)
        XCTAssertFalse(RelayCredential(token: "ghp_abcdefghij").looksWellFormed, "only pdu_ tokens are relay device tokens")
        XCTAssertFalse(RelayCredential(token: "pdu_").looksWellFormed)
    }

    // MARK: - Unbuilt server pieces / not-yet-wired client pieces

    /// The roadmap projection route is real server-side (#9223); this client
    /// just isn't wired to call it yet (D1 has no live network wiring for any
    /// tab). It throws rather than returning a fixture dressed as live data —
    /// a scaffold that silently serves its own fixture is how a demo becomes
    /// a false claim.
    func testRoadmapFetchThrowsUnbuiltRatherThanReturningAFixture() async {
        do {
            _ = try await client().fetchRoadmapProjection()
            XCTFail("fetchRoadmapProjection must not succeed — this client has no live-fetch wiring yet")
        } catch let error as RelayError {
            guard case .serverSideUnbuilt(let reason) = error else {
                return XCTFail("expected .serverSideUnbuilt, got \(error)")
            }
            XCTAssertTrue(reason.contains("roadmap"))
        } catch {
            XCTFail("expected RelayError, got \(error)")
        }
    }

    /// There is deliberately no `answerInterruption` on this client. The
    /// public surface for answering is a URL, and this test exists so that
    /// staying true remains a conscious decision.
    func testAnswerPathIsAHandoffURLNotARequest() {
        let handoff = client().answerHandoff(
            for: OperatorInterruption(
                id: "oi_1",
                sourceAgent: "pd-relay-deploy",
                title: "Deploy or hold?",
                urgency: .critical,
                createdAt: 1_755_820_380
            )
        )
        XCTAssertEqual(handoff.url.path, RelayRoute.accountInterruptions)
        XCTAssertEqual(handoff.url.host, "relay.portdaddy.dev")
    }

    func testErrorsReadAsSentencesAnOperatorCanActishOn() {
        XCTAssertTrue(RelayError.unauthenticated("no device token").description.contains("not signed in"))
        XCTAssertTrue(RelayError.transport("offline").description.contains("could not reach the relay"))
        XCTAssertTrue(
            RelayError.http(status: 404, code: "NOT_FOUND", message: "no such harbor").description.contains("no such harbor")
        )
    }
}
