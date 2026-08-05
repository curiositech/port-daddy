import XCTest
@testable import FleetBar

/// Counts every outbound request that reaches `URLSession.shared`. Registered
/// globally for the duration of a test so we can assert that FleetBar builds
/// *no* request when the control plane is unavailable.
final class RequestCountingProtocol: URLProtocol {
    nonisolated(unsafe) static var count = 0
    static let lock = NSLock()

    static func reset() { lock.lock(); count = 0; lock.unlock() }
    static func total() -> Int { lock.lock(); defer { lock.unlock() }; return count }

    override class func canInit(with request: URLRequest) -> Bool {
        lock.lock(); count += 1; lock.unlock()
        return true
    }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        client?.urlProtocol(self, didFailWithError: URLError(.notConnectedToInternet))
    }
    override func stopLoading() {}
}

/// The behavioral half of the endpoint invariant: an unavailable control plane
/// means no network request is constructed, and berth identity is derived from
/// provenance rather than a preferred port number.
@MainActor
final class EndpointFailClosedTests: XCTestCase {

    override func setUp() {
        super.setUp()
        URLProtocol.registerClass(RequestCountingProtocol.self)
        RequestCountingProtocol.reset()
    }

    override func tearDown() {
        URLProtocol.unregisterClass(RequestCountingProtocol.self)
        super.tearDown()
    }

    func testNoRequestIsBuiltWhenControlPlaneUnavailable() async {
        let store = FleetStore(autoStart: false)
        // Force an unavailable endpoint via an invalid operator selection.
        store.rebind(to: "not-a-daemon-url")
        XCTAssertFalse(store.isControlPlaneAvailable)
        XCTAssertNil(store.daemonURL)

        RequestCountingProtocol.reset()
        await store.refresh()

        XCTAssertEqual(RequestCountingProtocol.total(), 0,
                       "refresh() must construct no request when the control plane is unavailable")
        XCTAssertFalse(store.isDaemonRunning)
    }

    func testCounterActuallyObservesRequestsWhenAvailable() async {
        // Positive control: with a resolved endpoint, refresh() DOES issue a
        // request (which our protocol intercepts and fails). Proves the
        // zero-count above is a real fail-closed, not a dead counter.
        let store = FleetStore(autoStart: false)
        store.rebind(to: "http://127.0.0.1:59999")
        XCTAssertTrue(store.isControlPlaneAvailable)

        RequestCountingProtocol.reset()
        await store.refresh()

        XCTAssertGreaterThan(RequestCountingProtocol.total(), 0)
        XCTAssertFalse(store.isDaemonRunning) // request was failed by the mock
    }

    func testIsCanonicalDaemonReflectsProvenanceNotPort() {
        let store = FleetStore(autoStart: false)
        // An operator-selected berth is an explicit URL — never "canonical",
        // regardless of which port number it happens to carry.
        store.rebind(to: "http://127.0.0.1:59999")
        XCTAssertFalse(store.isCanonicalDaemon)
        XCTAssertEqual(store.endpointSource, .explicitURL)
    }
}
