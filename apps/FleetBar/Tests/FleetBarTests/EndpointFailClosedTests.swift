import XCTest
@testable import FleetBar

/// Counts every outbound request that reaches `URLSession.shared`. Registered
/// globally for the duration of a test so we can assert that FleetBar builds
/// *no* request when the control plane is unavailable.
final class RequestCountingProtocol: URLProtocol {
    nonisolated(unsafe) static var count = 0
    nonisolated(unsafe) static var urls: [URL] = []
    static let lock = NSLock()

    static func reset() { lock.lock(); count = 0; urls = []; lock.unlock() }
    static func total() -> Int { lock.lock(); defer { lock.unlock() }; return count }
    static func requestedURLs() -> [URL] { lock.lock(); defer { lock.unlock() }; return urls }

    override class func canInit(with request: URLRequest) -> Bool {
        lock.lock()
        count += 1
        if let url = request.url { urls.append(url) }
        lock.unlock()
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

    private func controlRoot(_ name: String) throws -> URL {
        let root = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
            .appendingPathComponent("../../../../.scratch/endpoint-control-\(name)-\(UUID().uuidString)")
            .standardizedFileURL
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        addTeardownBlock { try FileManager.default.removeItem(at: root) }
        return root
    }

    override func setUp() {
        super.setUp()
        URLProtocol.registerClass(RequestCountingProtocol.self)
        RequestCountingProtocol.reset()
    }

    override func tearDown() {
        URLProtocol.unregisterClass(RequestCountingProtocol.self)
        super.tearDown()
    }

    func testInvalidOperatorEndpointBuildsNoRequestWhileRuntimeControlIsOpen() async {
        let control = fixtureRuntimeControl()
        XCTAssertNil(control.blockedReason,
                     "the endpoint failure must be independent of runtime-control denial")
        let store = FleetStore(autoStart: false, control: control)

        // Force an unavailable endpoint via FleetStore's real operator-selection
        // validation while the independent runtime control remains open.
        store.rebind(to: "not-a-daemon-url")
        XCTAssertEqual(store.controlPlaneUnavailableReason,
                       .invalidExplicitURL("not-a-daemon-url"))
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
        let store = FleetStore(autoStart: false, control: fixtureRuntimeControl())
        store.rebind(to: "http://127.0.0.1:59999")
        XCTAssertTrue(store.isControlPlaneAvailable)

        RequestCountingProtocol.reset()
        await store.refresh()

        XCTAssertGreaterThan(RequestCountingProtocol.total(), 0)
        XCTAssertFalse(store.isDaemonRunning) // request was failed by the mock
    }

    func testOffAndUnknownControlSuppressOtherwiseValidEndpointWithoutARequest() async throws {
        let offRoot = try controlRoot("off")
        try Data().write(to: offRoot.appendingPathComponent("HALT"))
        let unknownRoot = offRoot.appendingPathComponent("missing/parent/control")
        let cases: [(LocalRuntimeControl.State, LocalRuntimeControl)] = [
            (.off, LocalRuntimeControl(canonicalRoot: offRoot)),
            (.unknown, LocalRuntimeControl(canonicalRoot: unknownRoot)),
        ]

        for (expectedState, control) in cases {
            XCTAssertEqual(control.observation.state, expectedState)
            let store = FleetStore(
                autoStart: false,
                endpointResolver: {
                    .available(url: "http://127.0.0.1:59999", source: .publishedPortFile)
                },
                control: control
            )
            XCTAssertNil(store.daemonURL)
            XCTAssertFalse(store.isControlPlaneAvailable)

            RequestCountingProtocol.reset()
            await store.refresh()
            XCTAssertEqual(RequestCountingProtocol.total(), 0)
        }
    }

    func testIsCanonicalDaemonReflectsProvenanceNotPort() {
        let store = FleetStore(autoStart: false, control: fixtureRuntimeControl())
        // An operator-selected berth is an explicit URL — never "canonical",
        // regardless of which port number it happens to carry.
        store.rebind(to: "http://127.0.0.1:59999")
        XCTAssertFalse(store.isCanonicalDaemon)
        XCTAssertEqual(store.endpointSource, .explicitURL)
    }

    func testUnavailableDiscoveryRecoversWhenDaemonPublishes() async {
        var discovered: DaemonEndpoint = .unavailable(.noPublication)
        let store = FleetStore(
            autoStart: false,
            endpointResolver: { discovered },
            control: fixtureRuntimeControl()
        )
        XCTAssertNil(store.daemonURL)

        discovered = .available(
            url: "http://127.0.0.1:54321",
            source: .publishedPortFile)
        RequestCountingProtocol.reset()
        await store.refresh()

        XCTAssertEqual(store.daemonURL, "http://127.0.0.1:54321")
        XCTAssertEqual(store.endpointSource, .publishedPortFile)
        XCTAssertTrue(RequestCountingProtocol.requestedURLs().contains {
            $0.absoluteString == "http://127.0.0.1:54321/fleet"
        })
    }

    func testPublishedEndpointFollowsRepublishedPort() async {
        var discovered = DaemonEndpoint.available(
            url: "http://127.0.0.1:54321",
            source: .publishedPortFile)
        let store = FleetStore(
            autoStart: false,
            endpointResolver: { discovered },
            control: fixtureRuntimeControl()
        )

        discovered = .available(
            url: "http://127.0.0.1:54322",
            source: .publishedPortFile)
        RequestCountingProtocol.reset()
        await store.refresh()

        XCTAssertEqual(store.daemonURL, "http://127.0.0.1:54322")
        XCTAssertTrue(RequestCountingProtocol.requestedURLs().contains {
            $0.absoluteString == "http://127.0.0.1:54322/fleet"
        })
        XCTAssertFalse(RequestCountingProtocol.requestedURLs().contains {
            $0.host == "127.0.0.1" && $0.port == 54321
        })
    }

    func testOperatorSelectedEndpointSurvivesDiscoveryChanges() async {
        var discovered = DaemonEndpoint.available(
            url: "http://127.0.0.1:54321",
            source: .publishedPortFile)
        let store = FleetStore(
            autoStart: false,
            endpointResolver: { discovered },
            control: fixtureRuntimeControl()
        )

        RequestCountingProtocol.reset()
        store.rebind(to: "http://127.0.0.1:59999")
        discovered = .available(
            url: "http://127.0.0.1:54322",
            source: .publishedPortFile)
        await store.refresh()
        await Task.yield()

        XCTAssertEqual(store.daemonURL, "http://127.0.0.1:59999")
        XCTAssertEqual(store.endpointSource, .explicitURL)
        XCTAssertFalse(RequestCountingProtocol.requestedURLs().contains {
            $0.host == "127.0.0.1" && $0.port == 54322
        })
    }
}
