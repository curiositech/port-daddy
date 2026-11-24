import XCTest
import Foundation
@testable import PortDaddyKit

/// The status-to-error mapping in `RelayClient.send`, driven through a real
/// URLSession with a stubbed transport.
///
/// `RelayClientTests` asserts routes, request building, and the WORDING of each
/// `RelayError` — by constructing the error value and reading `.description`.
/// That proves the sentences. It does not prove the client ever produces them:
/// no test in that file sends a request or sees a response, so the whole
/// `if status < 200 || status >= 300` ladder had nothing behind it, including
/// the two branches that are not merely cosmetic.
///
/// Those two are the reason this file exists. A 401 must surface as
/// `.unauthenticated` and a `CROSS_ORIGIN` code as `.crossOriginRefused`,
/// because the operator-facing consequences differ: one means "pair this phone
/// again", the other means "a proxy is attaching an Origin header" — and the
/// generic `.http` says neither. Collapsing either into `.http` is a silent
/// regression that no assertion on a hand-built error value can see.
final class RelayClientTransportTests: XCTestCase {

    // MARK: - Stub transport

    /// Answers every request with whatever `next` holds. Registered on an
    /// ephemeral configuration so it cannot touch the network or a cache.
    final class StubURLProtocol: URLProtocol {
        nonisolated(unsafe) static var next: (status: Int, body: Data) = (200, Data("{}".utf8))

        override class func canInit(with request: URLRequest) -> Bool { true }
        override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

        override func startLoading() {
            guard let url = request.url else {
                client?.urlProtocol(self, didFailWithError: URLError(.badURL))
                return
            }
            let (status, body) = StubURLProtocol.next
            guard
                let response = HTTPURLResponse(
                    url: url, statusCode: status, httpVersion: "HTTP/1.1", headerFields: nil
                )
            else {
                client?.urlProtocol(self, didFailWithError: URLError(.cannotParseResponse))
                return
            }
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: body)
            client?.urlProtocolDidFinishLoading(self)
        }

        override func stopLoading() {}
    }

    private func client(status: Int, body: String) -> RelayClient {
        StubURLProtocol.next = (status, Data(body.utf8))
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [StubURLProtocol.self]
        return RelayClient(
            baseURL: URL(string: "https://relay.portdaddy.dev")!,
            tokenStore: InMemoryRelayTokenStore(credential: RelayCredential(token: "pdu_" + String(repeating: "a", count: 64))),
            session: URLSession(configuration: config)
        )
    }

    /// Exercise the existing typed read, not a push- or device-registration route.
    private func errorFromRead(status: Int, body: String) async -> Error? {
        let relay = client(status: status, body: body)
        do {
            _ = try await relay.fetchInterruptions()
            XCTFail("expected \(status) to throw")
            return nil
        } catch {
            return error
        }
    }

    // MARK: - The mapping

    /// Keep the typed error and status, without reflecting the server's text.
    func testA404CarriesTheRecognizedCodeNotTheServerMessage() async throws {
        let error = await errorFromRead(
            status: 404, body: #"{"code":"NOT_FOUND","error":"no such route"}"#
        )
        let relayError = try XCTUnwrap(error as? RelayError, "expected a RelayError, got \(String(describing: error))")
        guard case .http(let status, let code, let message) = relayError else {
            return XCTFail("expected RelayError.http, got \(relayError)")
        }
        XCTAssertEqual(status, 404)
        XCTAssertEqual(code, "NOT_FOUND")
        XCTAssertEqual(message, "the relay returned 404")
    }

    /// 401 is NOT a generic http error. The operator's next action differs —
    /// pair the phone again — and `.unauthenticated` is what the view keys on.
    func testA401IsUnauthenticatedNotAGenericHttpError() async throws {
        let error = await errorFromRead(
            status: 401, body: #"{"code":"UNAUTHENTICATED","error":"token expired"}"#
        )
        let unwrapped = try XCTUnwrap(error as? RelayError, "expected a RelayError, got \(String(describing: error))")
        guard case .unauthenticated(let message) = unwrapped else {
            return XCTFail("expected .unauthenticated, got \(unwrapped)")
        }
        XCTAssertEqual(message, "the relay did not accept this credential")
        // No separate "must not also be .http" check here: `unwrapped` is a
        // `let` already proven `.unauthenticated` by the guard above, and a
        // Swift enum value is exactly one case at a time, so re-testing it
        // against `.http` after that guard can never be true. What actually
        // guards against a refactor collapsing the ladder is the guard's own
        // `else`: if `send` ever mapped 401 to `.http`, THAT branch is what
        // would fail, not a second check on a value already pinned.
    }

    /// CROSS_ORIGIN is keyed on the relay's CODE, not the status, because the
    /// relay answers 403 for it and 403 is otherwise a plain http error. The
    /// client sets no Origin header on purpose (RelayClient.swift:189-194); if
    /// this ever fires, a proxy is attaching one.
    func testCrossOriginIsKeyedOnTheCodeNotTheStatus() async throws {
        let error = await errorFromRead(
            status: 403, body: #"{"code":"CROSS_ORIGIN","error":"origin not allowed"}"#
        )
        let unwrapped = try XCTUnwrap(error as? RelayError, "expected a RelayError, got \(String(describing: error))")
        guard case .crossOriginRefused(let message) = unwrapped else {
            return XCTFail("expected .crossOriginRefused, got \(unwrapped)")
        }
        XCTAssertEqual(message, "the relay refused the request origin")
    }

    /// A 403 that is NOT cross-origin stays a plain http error — the pair above
    /// and below is what pins "keyed on the code", since both share a status.
    func testAPlain403StaysAGenericHttpError() async throws {
        let error = await errorFromRead(
            status: 403, body: #"{"code":"FORBIDDEN","error":"not yours"}"#
        )
        let relayError = try XCTUnwrap(error as? RelayError, "expected a RelayError, got \(String(describing: error))")
        guard case .http(let status, let code, _) = relayError else {
            return XCTFail("expected RelayError.http, got \(relayError)")
        }
        XCTAssertEqual(status, 403)
        XCTAssertEqual(code, "FORBIDDEN")
    }

    /// An error body that is not the relay's JSON envelope — an HTML error page
    /// from a proxy, say — must not become a decoding failure. The status is
    /// still the truth, and the fallback names it rather than reporting that
    /// the app could not read an answer it never got.
    func testANonJsonErrorBodyFallsBackToTheStatusRatherThanFailingToDecode() async throws {
        let error = await errorFromRead(status: 502, body: "<html>bad gateway</html>")
        let unwrapped = try XCTUnwrap(error as? RelayError, "expected a RelayError, got \(String(describing: error))")
        guard case .http(let status, let code, let message) = unwrapped else {
            return XCTFail("expected RelayError.http, got \(unwrapped)")
        }
        XCTAssertEqual(status, 502)
        XCTAssertEqual(code, "HTTP_502")
        XCTAssertTrue(message.contains("502"), "the fallback message should name the status: \(message)")
        // Same reasoning as testA401IsUnauthenticatedNotAGenericHttpError: the
        // guard above already proved `unwrapped` is `.http`, so a value that
        // can only ever be one case at a time cannot also match `.decoding`
        // here — that guard's `else` is what a regression would actually trip.
    }

    /// The success path, so the failures above are known to be failing for the
    /// right reason. Without this, a client broken enough to throw on every
    /// response would make all five tests above pass.
    func testA200DecodesAnOpenCriticalInterruption() async throws {
        let relay = client(status: 200, body: """
        {"code":"OK","error":null,"openCount":1,"interruptions":[
            {"id":"fixture-ask","title":"Review the deploy","urgency":"critical","state":"open","installationId":42}
        ]}
        """)
        let inbox = try await relay.fetchInterruptions()
        XCTAssertEqual(inbox.openCount, 1)
        XCTAssertEqual(inbox.interruptions.first?.installationId, 42)
        XCTAssertEqual(InterruptionInbox.blockingCritical(inbox.interruptions)?.id, "fixture-ask")
    }

    func testErrorAndDecodeFailuresDoNotEchoUntrustedFields() async throws {
        let marker = "pdu_" + String(repeating: "f", count: 64)
        let failures = [
            (502, #"{"code":"\#(marker)","error":"\#(marker)"}"#),
            (200, #"{"openCount":1,"interruptions":[{"id":"fixture-ask","\#(marker)":"bad"}]}"#),
        ]
        for (status, body) in failures {
            let failure = await errorFromRead(status: status, body: body)
            let error = try XCTUnwrap(failure as? RelayError)
            XCTAssertFalse(String(describing: error).contains(marker))
            if status == 200 {
                guard case .decoding = error else { return XCTFail("expected a typed decode error") }
            } else {
                XCTAssertEqual(error, .http(status: 502, code: "HTTP_502", message: "the relay returned 502"))
            }
        }
    }
}
