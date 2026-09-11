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
        XCTAssertEqual(calls.count, 11)
        XCTAssertTrue(calls.prefix(6).allSatisfy { $0.action == .disable })
        XCTAssertTrue(calls.suffix(5).allSatisfy { $0.action == .bootout })
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
            _ = try await session.pdBytes(from: url, control: control)
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
}

/// Unsupported real-network scheme plus an intercepting protocol: neither test
/// needs a socket, daemon, provider, credentials, nor the operator's HOME.
private final class OffFixtureProtocol: URLProtocol {
    private static let lock = NSLock()
    nonisolated(unsafe) private static var requests = 0
    static var count: Int { lock.lock(); defer { lock.unlock() }; return requests }
    static func reset() { lock.lock(); requests = 0; lock.unlock() }
    override class func canInit(with request: URLRequest) -> Bool { request.url?.scheme == "off-fixture" }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        Self.lock.lock(); Self.requests += 1; Self.lock.unlock()
        client?.urlProtocol(self, didReceive: URLResponse(url: request.url!, mimeType: "text/plain", expectedContentLength: 7, textEncodingName: "utf-8"), cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data("fixture".utf8))
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}
