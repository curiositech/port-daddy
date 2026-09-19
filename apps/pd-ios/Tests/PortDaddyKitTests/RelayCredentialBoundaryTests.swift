import Foundation
import XCTest
@testable import PortDaddyKit

final class RelayCredentialBoundaryTests: XCTestCase {
    private let validToken = "pdu_" + String(repeating: "a", count: 64)

    private final class CountingStore: RelayTokenStore {
        var reads = 0
        private var value: RelayCredential?
        init(_ token: String?) { value = token.map(RelayCredential.init) }
        var credential: RelayCredential? {
            get { reads += 1; return value }
            set { value = newValue }
        }
    }

    private final class Transport: URLProtocol {
        static let lock = NSLock()
        nonisolated(unsafe) static var observed: [URLRequest] = []
        static func reset() {
            lock.lock(); defer { lock.unlock() }
            observed = []
        }
        static func requests() -> [URLRequest] {
            lock.lock(); defer { lock.unlock() }; return observed
        }
        override class func canInit(with request: URLRequest) -> Bool { true }
        override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
        override func startLoading() {
            Self.lock.lock()
            Self.observed.append(request)
            Self.lock.unlock()
            let response = HTTPURLResponse(url: request.url!, statusCode: 200,
                                           httpVersion: "HTTP/1.1", headerFields: nil)!
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: Data("{\"harbors\":[]}".utf8))
            client?.urlProtocolDidFinishLoading(self)
        }
        override func stopLoading() {}
    }

    private func session() -> URLSession {
        let config = RelayClient.privateConfiguration()
        config.protocolClasses = [Transport.self]
        config.timeoutIntervalForRequest = 2
        config.timeoutIntervalForResource = 3
        return URLSession(configuration: config)
    }

    func testBadDestinationsNeverReadCredentialsOrReachTransport() async throws {
        let invalid = ["http://relay.example", "https://alice@relay.example",
                       "https://:secret@relay.example", "https://relay.example?",
                       "https://relay.example#", "https://relay.example/subpath",
                       "https://relay.example:0", "https://relay.example:65536",
                       "//relay.example", "file:///relay.example"]
        for text in invalid {
            Transport.reset()
            let store = CountingStore(validToken)
            let transport = session(); defer { transport.invalidateAndCancel() }
            let relay = RelayClient(baseURL: try XCTUnwrap(URL(string: text)), tokenStore: store, session: transport)
            do { _ = try await relay.fetchHarbors(); XCTFail("accepted \(text)") }
            catch { guard case RelayError.transport = error else { return XCTFail("wrong error \(error)") } }
            XCTAssertEqual(store.reads, 0, text)
            XCTAssertTrue(Transport.requests().isEmpty, text)
        }
    }

    func testMalformedCredentialsNeverReachTransport() async {
        for token in [nil, "", "pdu_testtoken", validToken + "\r\nX: injected",
                      "pdu_" + String(repeating: "g", count: 64), validToken + " ",
                      String(validToken.dropLast()), "Bearer " + validToken] {
            Transport.reset()
            let store = CountingStore(token)
            let transport = session(); defer { transport.invalidateAndCancel() }
            let relay = RelayClient(baseURL: URL(string: "https://relay.example")!, tokenStore: store, session: transport)
            do { _ = try await relay.fetchHarbors(); XCTFail("accepted malformed credential") }
            catch { guard case RelayError.unauthenticated = error else { return XCTFail("wrong error \(error)") } }
            XCTAssertEqual(store.reads, 1)
            XCTAssertTrue(Transport.requests().isEmpty)
        }
    }

    func testSelfHostedHTTPSPositivePathUsesOnlyConfiguredOrigin() async throws {
        Transport.reset()
        let store = CountingStore(validToken)
        let transport = session(); defer { transport.invalidateAndCancel() }
        let relay = RelayClient(baseURL: URL(string: "https://private-relay.example:9443/")!, tokenStore: store, session: transport)
        let harbors = try await relay.fetchHarbors()
        XCTAssertTrue(harbors.isEmpty)
        let request = try XCTUnwrap(Transport.requests().first)
        XCTAssertEqual(Transport.requests().count, 1)
        XCTAssertEqual(request.url?.absoluteString, "https://private-relay.example:9443/v1/harbors")
        XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer " + validToken)
        XCTAssertFalse(request.httpShouldHandleCookies)
        XCTAssertEqual(store.reads, 1)
    }

    func testSendRejectsTamperedOriginBeforeTransport() async throws {
        Transport.reset()
        let transport = session(); defer { transport.invalidateAndCancel() }
        let relay = RelayClient(baseURL: URL(string: "https://relay.example")!,
            tokenStore: CountingStore(validToken), session: transport)
        for destination in ["https://other.example/", "http://relay.example/", "https://relay.example:444/", "https://user@relay.example/"] {
            var request = try relay.makeRequest(path: RelayRoute.harbors)
            request.url = URL(string: destination)
            do { let _: [String] = try await relay.send(request, as: [String].self); XCTFail("origin escaped") }
            catch { guard case RelayError.transport = error else { return XCTFail("wrong error \(error)") } }
        }
        XCTAssertTrue(Transport.requests().isEmpty)
    }

    func testRedirectDelegateRefusesEveryDestination() throws {
        let transport = session(); defer { transport.invalidateAndCancel() }
        let original = URL(string: "https://relay.example/v1/harbors")!
        let task = transport.dataTask(with: original)
        for destination in ["https://relay.example/next", "https://other.example/", "http://relay.example/"] {
            let done = expectation(description: destination)
            RelayRedirectRefusal().urlSession(transport, task: task,
                willPerformHTTPRedirection: HTTPURLResponse(url: original, statusCode: 302, httpVersion: nil, headerFields: nil)!,
                newRequest: URLRequest(url: URL(string: destination)!)) { request in
                    XCTAssertNil(request); done.fulfill()
                }
            wait(for: [done], timeout: 1)
        }
        task.cancel()
    }

    /// Exercises the public fetch -> per-task delegate handoff. This session
    /// simulates Foundation's redirect callback; it does not claim real TLS or
    /// wire-level redirect proof (custom URLProtocol redirects crash Foundation
    /// on the tested macOS SDK).
    private final class RedirectSession: RelayTransport {
        let destination: URL
        var followed = false
        init(destination: URL) { self.destination = destination }
        func data(for request: URLRequest, delegate: (any URLSessionTaskDelegate)?) async throws -> (Data, URLResponse) {
            let response = HTTPURLResponse(url: request.url!, statusCode: 302, httpVersion: nil,
                                           headerFields: ["Location": destination.absoluteString])!
            let next = URLRequest(url: destination)
            let approved: URLRequest? = await withCheckedContinuation { continuation in
                guard let delegate else { continuation.resume(returning: next); return }
                let support = URLSession(configuration: .ephemeral)
                let task = support.dataTask(with: request)
                delegate.urlSession?(support, task: task, willPerformHTTPRedirection: response,
                    newRequest: next) { approved in
                        task.cancel(); support.invalidateAndCancel()
                        continuation.resume(returning: approved)
                    }
            }
            followed = approved != nil
            if followed {
                return (Data("{\"harbors\":[]}".utf8), HTTPURLResponse(url: destination, statusCode: 200, httpVersion: nil, headerFields: nil)!)
            }
            return (Data(), response)
        }
    }

    func testPublicFetchSuppliesRefusingDelegateEvenToInjectedSession() async throws {
        for destination in ["https://other.example/", "https://relay.example/next", "http://relay.example/"] {
            let transport = RedirectSession(destination: URL(string: destination)!)
            let relay = RelayClient(baseURL: URL(string: "https://relay.example")!,
                tokenStore: CountingStore(validToken), session: transport)
            do { _ = try await relay.fetchHarbors(); XCTFail("redirect succeeded") }
            catch { XCTAssertEqual(error as? RelayError, .http(status: 302, code: "HTTP_302", message: "the relay returned 302")) }
            XCTAssertFalse(transport.followed)
        }
    }

    func testProductionConfigurationHasNoCookieCredentialOrCacheStore() {
        let configuration = RelayClient.privateConfiguration()
        XCTAssertNil(configuration.httpCookieStorage)
        XCTAssertNil(configuration.urlCredentialStorage)
        XCTAssertNil(configuration.urlCache)
        XCTAssertFalse(configuration.httpShouldSetCookies)
        XCTAssertEqual(configuration.requestCachePolicy, .reloadIgnoringLocalCacheData)
        XCTAssertEqual(configuration.timeoutIntervalForRequest, 15)
        XCTAssertEqual(configuration.timeoutIntervalForResource, 30)
    }
}
