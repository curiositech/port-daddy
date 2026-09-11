import Foundation
import XCTest
#if canImport(FleetBar)
@testable import FleetBar
#endif

final class LocalRuntimeControlTests: XCTestCase {
    private var fixture: URL!
    private let fm = FileManager.default

    override func setUpWithError() throws {
        // Explicit test scratch, never the operator HOME or a runtime prefix.
        fixture = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
            .appendingPathComponent("../../../../.scratch/fleetbar-off-\(UUID().uuidString)").standardizedFileURL
        try fm.createDirectory(at: fixture, withIntermediateDirectories: true)
    }

    override func tearDownWithError() throws { try fm.removeItem(at: fixture) }

    private func root(_ name: String) throws -> URL {
        let result = fixture.appendingPathComponent(name)
        try fm.createDirectory(at: result, withIntermediateDirectories: true)
        return result
    }
    private func marker(_ name: String, _ root: URL, text: String = "operator halt\n") throws {
        try Data(text.utf8).write(to: root.appendingPathComponent(name))
    }

    func testCanonicalAndSelectedStopsAreAdditiveAndSticky() throws {
        for name in ["HALT", "hooks.disabled"] {
            for location in ["canonical", "selected"] {
                let canonical = try root("\(name)-\(location)-canonical")
                let selected = try root("\(name)-\(location)-selected")
                let control = LocalRuntimeControl(canonicalRoot: canonical, environment: ["PD_HOME": selected.path])
                XCTAssertNil(control.blockedReason)
                let target = location == "canonical" ? canonical : selected
                try marker(name, target)
                XCTAssertNotNil(control.blockedReason)
                try fm.removeItem(at: target.appendingPathComponent(name))
                XCTAssertNotNil(control.blockedReason, "A live app must never rearm on disappearance.")
            }
        }
    }

    func testBrokenSymlinkAndUnknownControlsDeny() throws {
        let canonical = try root("canonical")
        let markerURL = canonical.appendingPathComponent("HALT")
        try fm.createSymbolicLink(at: markerURL, withDestinationURL: fixture.appendingPathComponent("absent"))
        XCTAssertNotNil(LocalRuntimeControl(canonicalRoot: canonical).blockedReason)
        let linked = fixture.appendingPathComponent("linked")
        try fm.createSymbolicLink(at: linked, withDestinationURL: canonical)
        XCTAssertNotNil(LocalRuntimeControl(canonicalRoot: linked).blockedReason)
        let unavailable = fixture.appendingPathComponent("absent/parent/control")
        XCTAssertNotNil(LocalRuntimeControl(canonicalRoot: unavailable).blockedReason)
        XCTAssertNotNil(LocalRuntimeControl(canonicalRoot: try root("relative"), environment: ["PD_HOME": "relative"]).blockedReason)
    }

    func testCustomHaltCannotOverrideCanonicalAndUnknownParentDenies() throws {
        let canonical = try root("canonical")
        let empty = fixture.appendingPathComponent("unused-halt").path
        try marker("hooks.disabled", canonical)
        XCTAssertNotNil(LocalRuntimeControl(canonicalRoot: canonical, environment: ["PD_HALT_FILE": empty]).blockedReason)
        let clean = try root("clean")
        XCTAssertNil(LocalRuntimeControl(canonicalRoot: clean, environment: ["PD_HALT_FILE": empty]).blockedReason)
        XCTAssertNotNil(LocalRuntimeControl(canonicalRoot: clean, environment: ["PD_HALT_FILE": "relative"]).blockedReason)
        XCTAssertNotNil(LocalRuntimeControl(canonicalRoot: clean, environment: ["PD_HALT_FILE": fixture.appendingPathComponent("missing/HALT").path]).blockedReason)
        try marker("custom", fixture)
        XCTAssertNotNil(LocalRuntimeControl(canonicalRoot: clean, environment: ["PD_HALT_FILE": fixture.appendingPathComponent("custom").path]).blockedReason)
    }

    func testPersistentOffPreservesOperatorRecordAndSurvivesNewInstance() throws {
        let canonical = try root("canonical")
        let text = "Do not overwrite this operator's existing halt.\n"
        try marker("HALT", canonical, text: text)
        let control = LocalRuntimeControl(canonicalRoot: canonical)
        XCTAssertEqual(control.persistOff(), [])
        XCTAssertEqual(control.persistOff(), [])
        XCTAssertEqual(try String(contentsOf: canonical.appendingPathComponent("HALT"), encoding: .utf8), text)
        XCTAssertTrue(fm.fileExists(atPath: canonical.appendingPathComponent("hooks.disabled").path))
        XCTAssertNotNil(LocalRuntimeControl(canonicalRoot: canonical).blockedReason)
    }

    func testCreatesMissingControlRootAndReportsPartialPersistence() throws {
        let missing = fixture.appendingPathComponent("new")
        XCTAssertEqual(LocalRuntimeControl(canonicalRoot: missing).persistOff(), [])
        XCTAssertNotNil(LocalRuntimeControl(canonicalRoot: missing).blockedReason)
        let partial = try root("partial")
        try fm.createSymbolicLink(at: partial.appendingPathComponent("hooks.disabled"), withDestinationURL: fixture.appendingPathComponent("no-target"))
        let control = LocalRuntimeControl(canonicalRoot: partial)
        XCTAssertEqual(control.persistOff().count, 1)
        XCTAssertTrue(fm.fileExists(atPath: partial.appendingPathComponent("HALT").path), "HALT is persisted before hooks.disabled fails.")
        XCTAssertNotNil(control.blockedReason)
    }

    func testSymlinkedControlRootIsNeverWrittenThrough() throws {
        let target = try root("target")
        let linked = fixture.appendingPathComponent("linked")
        try fm.createSymbolicLink(at: linked, withDestinationURL: target)
        let control = LocalRuntimeControl(canonicalRoot: linked)
        XCTAssertFalse(control.persistOff().isEmpty)
        XCTAssertEqual(try fm.contentsOfDirectory(atPath: target.path), [])
        XCTAssertNotNil(control.blockedReason)
    }

    func testOffRejectsProcessBeforeLaunch() throws {
        let canonical = try root("canonical")
        try marker("HALT", canonical)
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/this-test-must-never-launch-a-process")
        XCTAssertThrowsError(try process.pdRun(control: LocalRuntimeControl(canonicalRoot: canonical))) {
            XCTAssertTrue($0 is LocalRuntimeControl.ControlError)
        }
        XCTAssertFalse(process.isRunning)
    }

    func testStopPlanDisablesBeforeBootoutAndNeverTouchesRivalBosun() {
        var calls: [LocalRuntimeShutdown.Step] = []
        let receipts = LocalRuntimeShutdown.stop(uid: 123, run: { step in
            calls.append(step)
            return step.action == .disable ? 0 : nil
        })
        XCTAssertEqual(calls.count, 14)
        XCTAssertTrue(calls.prefix(8).allSatisfy { $0.action == .disable })
        XCTAssertTrue(calls.suffix(6).allSatisfy { $0.action == .bootout })
        XCTAssertTrue(calls.contains { $0.action == .disable && $0.target == "gui/123/com.portdaddy.appwatch" })
        XCTAssertTrue(calls.contains { $0.action == .bootout && $0.target == "gui/123/com.portdaddy.appwatch" })
        XCTAssertTrue(calls.contains { $0.action == .disable && $0.target == "gui/123/com.portdaddy.fleetbar.devlatest" })
        XCTAssertTrue(calls.contains { $0.action == .disable && $0.target == "gui/123/com.portdaddy.freshness" })
        XCTAssertTrue(calls.contains { $0.action == .bootout && $0.target == "gui/123/com.portdaddy.freshness" })
        XCTAssertTrue(calls.allSatisfy { $0.target.hasPrefix("gui/123/") })
        XCTAssertFalse(calls.contains { $0.target == "gui/123/com.bosun.daemon" })
        XCTAssertFalse(calls.contains { $0.action == .bootout && $0.target.hasSuffix(".fleetbar") })
        XCTAssertTrue(receipts.last!.summary.contains("not confirmed"))
    }

    func testOffDeniesDataAndStreamBeforeTransport() async throws {
        let canonical = try root("canonical")
        try marker("HALT", canonical)
        let control = LocalRuntimeControl(canonicalRoot: canonical)
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [OffFixtureProtocol.self]
        let session = URLSession(configuration: configuration)
        defer { session.invalidateAndCancel() }
        let url = URL(string: "off-fixture://no-network")!
        OffFixtureProtocol.reset()
        do {
            _ = try await session.pdData(from: url, control: control)
            XCTFail("Off admitted data transport")
        } catch { XCTAssertTrue(error is LocalRuntimeControl.ControlError) }
        do {
            _ = try await session.pdLines(from: url, control: control)
            XCTFail("Off admitted streaming transport")
        } catch { XCTAssertTrue(error is LocalRuntimeControl.ControlError) }
        XCTAssertEqual(OffFixtureProtocol.count, 0)
    }

    func testEnabledTransportPositiveControlIsIntercepted() async throws {
        let canonical = try root("canonical")
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [OffFixtureProtocol.self]
        let session = URLSession(configuration: configuration)
        defer { session.invalidateAndCancel() }
        OffFixtureProtocol.reset()
        let (data, _) = try await session.pdData(from: URL(string: "off-fixture://no-network")!, control: LocalRuntimeControl(canonicalRoot: canonical))
        XCTAssertEqual(String(decoding: data, as: UTF8.self), "fixture")
        XCTAssertEqual(OffFixtureProtocol.count, 1, "The zero-request control must not be a dead counter.")
    }

    func testExplicitOffWaitsForAdmissionAndCancelsTheRegisteredEffect() throws {
        let control = LocalRuntimeControl(canonicalRoot: try root("canonical"))
        let entered = DispatchSemaphore(value: 0)
        let release = DispatchSemaphore(value: 0)
        let requested = DispatchSemaphore(value: 0)
        let stopped = DispatchSemaphore(value: 0)
        let completed = expectation(description: "admission completed")
        let cancelled = expectation(description: "registered effect cancelled")
        DispatchQueue.global().async {
            defer { completed.fulfill() }
            do {
                try control.admit(id: UUID(), cancel: { cancelled.fulfill() }) {
                    entered.signal()
                    XCTAssertEqual(release.wait(timeout: .now() + 2), .success)
                }
            } catch { XCTFail("Unexpected admission failure: \(error)") }
        }
        XCTAssertEqual(entered.wait(timeout: .now() + 2), .success)
        DispatchQueue.global().async {
            requested.signal()
            XCTAssertEqual(control.persistOff(), [])
            stopped.signal()
        }
        XCTAssertEqual(requested.wait(timeout: .now() + 2), .success)
        XCTAssertEqual(stopped.wait(timeout: .now() + .milliseconds(30)), .timedOut,
                       "Off must not miss an effect still inside admission.")
        release.signal()
        wait(for: [completed, cancelled], timeout: 2)
        XCTAssertEqual(stopped.wait(timeout: .now() + 2), .success)
        XCTAssertThrowsError(try control.admit(id: UUID(), cancel: {}) { XCTFail("Effect started after Off") })
    }

    func testExternalOffCancelsAnIdleDataRequestWithoutAnotherCaller() async throws {
        let canonical = try root("canonical")
        let control = LocalRuntimeControl(canonicalRoot: canonical)
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [OffFixtureProtocol.self]
        let session = URLSession(configuration: configuration)
        defer { session.invalidateAndCancel() }
        let started = expectation(description: "in-memory transport started")
        let stopped = expectation(description: "transport cancelled by external marker")
        let returned = expectation(description: "request returned cancellation")
        OffFixtureProtocol.reset(started: { started.fulfill() }, stopped: { stopped.fulfill() })
        let request = Task {
            defer { returned.fulfill() }
            do {
                _ = try await session.pdData(from: URL(string: "off-fixture://no-network/hold")!, control: control)
                XCTFail("An idle cancelled request succeeded")
            } catch { /* Cancellation or the latched Off error are both denials. */ }
        }
        await fulfillment(of: [started], timeout: 2)
        try marker("HALT", canonical)
        await fulfillment(of: [stopped, returned], timeout: 2)
        request.cancel()
    }

    func testExternalOffCancelsOpenStreamAndRejectsBufferedLines() async throws {
        let canonical = try root("canonical")
        let control = LocalRuntimeControl(canonicalRoot: canonical)
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [OffFixtureProtocol.self]
        let session = URLSession(configuration: configuration)
        defer { session.invalidateAndCancel() }
        let stopped = expectation(description: "held-open stream cancelled")
        OffFixtureProtocol.reset(stopped: { stopped.fulfill() })
        let (lines, _) = try await session.pdLines(from: URL(string: "off-fixture://no-network/hold")!, control: control)
        var iterator = lines.makeAsyncIterator()
        let first = try await iterator.next()
        XCTAssertEqual(first, "first")
        try marker("HALT", canonical)
        await fulfillment(of: [stopped], timeout: 2)
        do { _ = try await iterator.next(); XCTFail("A buffered event escaped Off") }
        catch { XCTAssertTrue(error is LocalRuntimeControl.ControlError) }
    }

    func testStreamingHandlesSplitUTF8AndCRLFWithoutNetwork() async throws {
        let control = LocalRuntimeControl(canonicalRoot: try root("canonical"))
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [OffFixtureProtocol.self]
        let session = URLSession(configuration: configuration)
        defer { session.invalidateAndCancel() }
        OffFixtureProtocol.reset()
        let (lines, _) = try await session.pdLines(from: URL(string: "off-fixture://no-network/unicode")!, control: control)
        var actual: [String] = []
        for try await line in lines { actual.append(line) }
        XCTAssertEqual(actual, ["héllo", "second", "third", "tail"])
    }

    func testDroppingAnUnusedStreamCancelsTransport() async throws {
        let control = LocalRuntimeControl(canonicalRoot: try root("canonical"))
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [OffFixtureProtocol.self]
        let session = URLSession(configuration: configuration)
        defer { session.invalidateAndCancel() }
        let stopped = expectation(description: "unconsumed stream released its task")
        OffFixtureProtocol.reset(stopped: { stopped.fulfill() })
        _ = try await session.pdLines(from: URL(string: "off-fixture://no-network/hold")!, control: control)
        await fulfillment(of: [stopped], timeout: 2)
    }

    func testCallerCancellationBeforeStreamHeadersCannotResurrectTransport() async throws {
        let control = LocalRuntimeControl(canonicalRoot: try root("canonical"))
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [OffFixtureProtocol.self]
        let session = URLSession(configuration: configuration)
        defer { session.invalidateAndCancel() }
        let started = expectation(description: "waiting for headers")
        let stopped = expectation(description: "cancelled before headers")
        let returned = expectation(description: "response continuation resumed once")
        OffFixtureProtocol.reset(started: { started.fulfill() }, stopped: { stopped.fulfill() })
        let request = Task {
            defer { returned.fulfill() }
            do {
                _ = try await session.pdLines(from: URL(string: "off-fixture://no-network/noheaders")!, control: control)
                XCTFail("Cancelled header request succeeded")
            } catch { /* Both the Swift and URLSession cancellation errors deny. */ }
        }
        await fulfillment(of: [started], timeout: 2)
        request.cancel()
        await fulfillment(of: [stopped, returned], timeout: 2)
    }

    func testStreamOverflowClosesInsteadOfDroppingEvents() async throws {
        for mode in ["overflow", "longline"] {
            let control = LocalRuntimeControl(canonicalRoot: try root(mode))
            let configuration = URLSessionConfiguration.ephemeral
            configuration.protocolClasses = [OffFixtureProtocol.self]
            let session = URLSession(configuration: configuration)
            defer { session.invalidateAndCancel() }
            let stopped = expectation(description: "\(mode) closed transport")
            OffFixtureProtocol.reset(stopped: { stopped.fulfill() })
            let (lines, _) = try await session.pdLines(from: URL(string: "off-fixture://no-network/\(mode)")!, control: control)
            await fulfillment(of: [stopped], timeout: 2)
            do { for try await _ in lines {}; XCTFail("Overflow was silently accepted") }
            catch { XCTAssertEqual((error as? URLError)?.code, .dataLengthExceedsMaximum) }
        }
    }
}

/// Unsupported real-network scheme plus an intercepting protocol: neither test
/// needs a socket, daemon, provider, credentials, nor the operator's HOME.
private final class OffFixtureProtocol: URLProtocol {
    private static let lock = NSLock()
    nonisolated(unsafe) private static var requests = 0
    nonisolated(unsafe) private static var started: (@Sendable () -> Void)?
    nonisolated(unsafe) private static var stopped: (@Sendable () -> Void)?
    static var count: Int { lock.lock(); defer { lock.unlock() }; return requests }
    static func reset(started: (@Sendable () -> Void)? = nil, stopped: (@Sendable () -> Void)? = nil) {
        lock.lock(); requests = 0; Self.started = started; Self.stopped = stopped; lock.unlock()
    }
    override class func canInit(with request: URLRequest) -> Bool { request.url?.scheme == "off-fixture" }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        Self.lock.lock(); Self.requests += 1; let started = Self.started; Self.lock.unlock()
        started?()
        if request.url?.path == "/noheaders" { return }
        client?.urlProtocol(self, didReceive: URLResponse(url: request.url!, mimeType: "text/plain", expectedContentLength: 7, textEncodingName: "utf-8"), cacheStoragePolicy: .notAllowed)
        if request.url?.path == "/overflow" {
            client?.urlProtocol(self, didLoad: Data(String(repeating: "line\n", count: 160).utf8))
            return
        }
        if request.url?.path == "/longline" {
            client?.urlProtocol(self, didLoad: Data(repeating: 65, count: 1_048_577))
            return
        }
        if request.url?.path == "/hold" {
            client?.urlProtocol(self, didLoad: Data("first\nsecond\n".utf8))
            return
        }
        if request.url?.path == "/unicode" {
            // One byte per callback deliberately splits the accented character
            // and CRLF across chunks. No socket is created for this scheme.
            for byte in Data("héllo\r\nsecond\rthird\ntail".utf8) {
                client?.urlProtocol(self, didLoad: Data([byte]))
            }
            client?.urlProtocolDidFinishLoading(self)
            return
        }
        client?.urlProtocol(self, didLoad: Data("fixture".utf8))
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {
        Self.lock.lock(); let stopped = Self.stopped; Self.lock.unlock()
        stopped?()
    }
}
