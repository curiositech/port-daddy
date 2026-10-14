import AppKit
import CryptoKit
import Darwin
import Foundation
import XCTest
@testable import PortholeStageCore

final class AutomationControlTests: XCTestCase {
    func testParserAcceptsPingAndRejectsUnknownFieldsAndBounds() throws {
        let ping = try PortholeAutomationProtocol.decode(Data(#"{"id":"one","command":"ping"}"#.utf8))
        XCTAssertEqual(ping.command, .ping)

        for invalid in [
            #"{"id":"one","command":"ping","catalog":true}"#,
            #"{"id":"one","command":"ping","approvalID":"smuggled"}"#,
            #"{"id":"one","command":"open-picker"}"#,
            #"{"id":"one","command":"approve","reviewID":"r","scope":"exact-window","capabilities":{"preview":false,"liveShare":false,"persistRecording":false}}"#,
            #"{"id":"one","command":"wait"}"#,
        ] {
            XCTAssertThrowsError(try PortholeAutomationProtocol.decode(Data(invalid.utf8)))
        }
        XCTAssertThrowsError(try PortholeAutomationProtocol.decode(
            Data(repeating: 0x61, count: PortholeAutomationProtocol.maximumLineBytes + 1)))
    }

    func testParserRejectsNestedAndOversizedBatch() throws {
        let nested = #"{"id":"outer","command":"batch","steps":[{"id":"inner","command":"batch","steps":[{"id":"ping","command":"ping"}]}]}"#
        XCTAssertThrowsError(try PortholeAutomationProtocol.decode(Data(nested.utf8)))

        let steps = (0 ... PortholeAutomationProtocol.maximumBatchSteps).map {
            PortholeAutomationRequest(id: "step-\($0)", command: .ping)
        }
        let oversized = PortholeAutomationRequest(id: "batch", command: .batch, steps: steps)
        XCTAssertThrowsError(try PortholeAutomationProtocol.decode(JSONEncoder().encode(oversized)))
    }

    func testSocketPathParserDefaultsAndRejectsAmbiguity() throws {
        let home = URL(fileURLWithPath: "/Users/example")
        XCTAssertEqual(
            try PortholeAutomationSocketPath.parse(arguments: ["Porthole"], homeDirectory: home).path,
            "/Users/example/Library/Application Support/Porthole/control.sock"
        )
        XCTAssertThrowsError(try PortholeAutomationSocketPath.parse(
            arguments: ["Porthole", "--control-socket", "relative.sock"], homeDirectory: home))
        XCTAssertThrowsError(try PortholeAutomationSocketPath.parse(
            arguments: ["Porthole", "--control-socket", "/a", "--control-socket", "/b"],
            homeDirectory: home))
    }

    func testNewOutputDirectoryRefusesCollisionAndSymlinkAncestors() throws {
        let root = try scratchDirectory()
        defer { try? FileManager.default.removeItem(at: root) }
        let output = root.appendingPathComponent("new", isDirectory: true)
        try PortholeAutomationOutputDirectory.createNew(output)
        var info = stat()
        XCTAssertEqual(lstat(output.path, &info), 0)
        XCTAssertEqual(info.st_mode & 0o777, 0o700)
        XCTAssertThrowsError(try PortholeAutomationOutputDirectory.createNew(output))

        let real = root.appendingPathComponent("real", isDirectory: true)
        try FileManager.default.createDirectory(at: real, withIntermediateDirectories: false)
        let link = root.appendingPathComponent("link", isDirectory: true)
        try FileManager.default.createSymbolicLink(at: link, withDestinationURL: real)
        XCTAssertThrowsError(try PortholeAutomationOutputDirectory.createNew(
            link.appendingPathComponent("proof", isDirectory: true)))
    }

    func testAutomationPersistenceRequiresCurrentExactWindowAndClearPrivacy() {
        let exact = BoundaryFixtures.approval()
        XCTAssertTrue(PortholeAutomationPersistencePolicy.evaluate(
            approval: exact,
            sourceIsCurrent: true,
            assessment: PrivacyAssessment(status: .clear, reason: "test", assessedAtMonotonicNanos: 1)
        ).allowed)
        XCTAssertFalse(PortholeAutomationPersistencePolicy.evaluate(
            approval: BoundaryFixtures.approval(scope: .runningInstance),
            sourceIsCurrent: true,
            assessment: PrivacyAssessment(status: .clear, reason: "test", assessedAtMonotonicNanos: 1)
        ).allowed)
        XCTAssertFalse(PortholeAutomationPersistencePolicy.evaluate(
            approval: exact,
            sourceIsCurrent: true,
            assessment: PrivacyAssessment(status: .unknown, reason: "test", assessedAtMonotonicNanos: 1)
        ).allowed)
        XCTAssertFalse(PortholeAutomationPersistencePolicy.evaluate(
            approval: exact,
            sourceIsCurrent: false,
            assessment: PrivacyAssessment(status: .clear, reason: "test", assessedAtMonotonicNanos: 1)
        ).allowed)
    }

    func testRecordingAdmissionAndRepeatedMonitorTicksKeepSamePersistencePolicy() {
        let approval = BoundaryFixtures.approval()
        for tick in 0...40 {
            let assessment = PrivacyAssessment(status: .clear, reason: "test", assessedAtMonotonicNanos: UInt64(tick))
            XCTAssertTrue(PortholeAutomationPersistencePolicy.evaluateActiveMode(
                automationRecording: true, approval: approval, sourceIsCurrent: true, assessment: assessment,
                explicitFixtureApproval: false, verifiedFixture: false).allowed)
            XCTAssertFalse(PortholeAutomationPersistencePolicy.evaluateActiveMode(
                automationRecording: false, approval: approval, sourceIsCurrent: true, assessment: assessment,
                explicitFixtureApproval: false, verifiedFixture: false).allowed)
        }
        for privacy: PrivacyStatus in [.clear, .unknown, .protected] {
            XCTAssertFalse(PortholeAutomationPersistencePolicy.evaluateActiveMode(
                automationRecording: true, approval: approval, sourceIsCurrent: false,
                assessment: PrivacyAssessment(status: privacy, reason: "revoked", assessedAtMonotonicNanos: 41),
                explicitFixtureApproval: false, verifiedFixture: false).allowed)
        }
    }

    @MainActor
    func testCoordinatorEnforcesPendingReviewAndRevocation() async throws {
        let fake = FakeAutomationController()
        let coordinator = PortholeAutomationCoordinator(controller: fake)
        let denied = await coordinator.handle(PortholeAutomationRequest(
            id: "approve", command: .approve, reviewID: "wrong", scope: .exactWindow,
            capabilities: SourceCapabilities(preview: true, liveShare: false, persistRecording: true)))
        XCTAssertFalse(denied.ok)
        XCTAssertEqual(denied.error?.code, "authority-required")

        fake.pending = PortholeAutomationPendingReview(
            reviewID: "review-a", displayTitle: "Approved Window", programDisplayTitle: "Fixture",
            sourceKind: .window, supportedScopes: [.exactWindow])
        let approved = await coordinator.handle(PortholeAutomationRequest(
            id: "approve", command: .approve, reviewID: "review-a", scope: .exactWindow,
            capabilities: SourceCapabilities(preview: true, liveShare: false, persistRecording: true)))
        XCTAssertTrue(approved.ok)
        XCTAssertEqual(fake.approved.count, 1)

        let revoked = await coordinator.handle(PortholeAutomationRequest(
            id: "revoke", command: .revoke, approvalID: "approval-a"))
        XCTAssertTrue(revoked.ok)
        XCTAssertTrue(fake.approved.isEmpty)
        XCTAssertEqual(fake.lifecycle, .stopped)
    }

    @MainActor
    func testBatchAbortsAtFirstFailureAndReturnsOrderedReceipts() async throws {
        let fake = FakeAutomationController()
        let coordinator = PortholeAutomationCoordinator(controller: fake)
        let response = await coordinator.handle(PortholeAutomationRequest(
            id: "batch", command: .batch, steps: [
                PortholeAutomationRequest(id: "one", command: .ping),
                PortholeAutomationRequest(id: "two", command: .select, approvalID: "unknown"),
                PortholeAutomationRequest(id: "three", command: .ping),
            ]))
        XCTAssertFalse(response.ok)
        XCTAssertEqual(response.error?.code, "batch-aborted")
        XCTAssertEqual(response.result?.steps?.map(\.id), ["one", "two"])
        XCTAssertEqual(response.result?.steps?.map(\.ok), [true, false])
    }

    @MainActor
    func testWaitTimesOutWithoutMutatingAuthority() async throws {
        let fake = FakeAutomationController()
        let coordinator = PortholeAutomationCoordinator(controller: fake)
        let response = await coordinator.handle(PortholeAutomationRequest(
            id: "wait", command: .wait, lifecycle: .live, timeoutMilliseconds: 5))
        XCTAssertFalse(response.ok)
        XCTAssertEqual(response.error?.code, "timed-out")
        XCTAssertTrue(fake.approved.isEmpty)
    }

    @MainActor
    func testLifecycleCommandsFailClosedOutsideTheirStates() async throws {
        let fake = FakeAutomationController()
        let coordinator = PortholeAutomationCoordinator(controller: fake)
        let pause = await coordinator.handle(PortholeAutomationRequest(id: "pause", command: .pause))
        XCTAssertFalse(pause.ok)
        XCTAssertEqual(pause.error?.code, "invalid-state")
        fake.installApprovedSource()
        let start = await coordinator.handle(PortholeAutomationRequest(id: "start", command: .start))
        XCTAssertTrue(start.ok)
        let paused = await coordinator.handle(PortholeAutomationRequest(id: "pause-live", command: .pause))
        XCTAssertTrue(paused.ok)
        let resumed = await coordinator.handle(PortholeAutomationRequest(id: "resume", command: .resume))
        XCTAssertTrue(resumed.ok)
        XCTAssertEqual(fake.lifecycle, .live)
    }

    @MainActor
    func testFiniteRecordReturnsProofReceipt() async throws {
        let root = try scratchDirectory()
        defer { try? FileManager.default.removeItem(at: root) }
        let fake = FakeAutomationController()
        fake.installApprovedSource()
        let coordinator = PortholeAutomationCoordinator(controller: fake)
        let response = await coordinator.handle(PortholeAutomationRequest(
            id: "record", command: .record,
            outputDirectory: root.appendingPathComponent("recording").path,
            durationSeconds: 2))
        XCTAssertTrue(response.ok)
        XCTAssertEqual(response.result?.artifact?.schema, PortholeAutomationArtifactReceipt.schemaName)
        XCTAssertEqual(response.result?.artifact?.kind, "recording")
        XCTAssertEqual(fake.lifecycle, .stopped)
    }

    func testRecordingReceiptHashesMediaAndNeverOverwrites() throws {
        let root = try scratchDirectory()
        defer { try? FileManager.default.removeItem(at: root) }
        let output = root.appendingPathComponent("proof", isDirectory: true)
        try PortholeAutomationOutputDirectory.createNew(output)
        let media = Data("approved exact-window pixels".utf8)
        try media.write(to: output.appendingPathComponent("stage-source.mov"))
        let approval = BoundaryFixtures.approval()
        let frame = BoundaryFixtures.frame()
        let lease = CaptureLeaseIdentity(leaseID: frame.captureLeaseID, approvalID: approval.approvalID,
            displayTitle: frame.sourceDisplayTitle, sourceKind: .window, sourceWindowID: frame.sourceWindowID)
        let receipt = try PortholeAutomationArtifactWriter.writeRecordingReceipt(
            outputDirectory: output, approval: approval, lease: lease,
            firstFrame: frame, lastFrame: frame, frameCount: 1)
        XCTAssertEqual(receipt.artifactSHA256.count, 64)
        XCTAssertEqual(receipt.artifactSHA256, "68ecd646c9779f36954528e6160e9a20c4876ee1399b90ca0a670f2dd73809b1")
        XCTAssertEqual(receipt.sourceWindowID, 77)
        XCTAssertTrue(FileManager.default.fileExists(atPath: output.appendingPathComponent("receipt.json").path))
        XCTAssertThrowsError(try PortholeAutomationArtifactWriter.writeRecordingReceipt(
            outputDirectory: output, approval: approval, lease: lease,
            firstFrame: frame, lastFrame: frame, frameCount: 1))
    }

    func testRecordingHashStreamsLargeOwnerFileAndRejectsSymlink() throws {
        let root = try scratchDirectory()
        defer { try? FileManager.default.removeItem(at: root) }
        let media = Data(repeating: 0x5a, count: 3 * 1_048_576 + 17)
        let mediaURL = root.appendingPathComponent("large.mov")
        try media.write(to: mediaURL)
        let streamed = try PortholeAutomationArtifactWriter.streamingSHA256(at: mediaURL)
        XCTAssertEqual(streamed.byteCount, Int64(media.count))
        XCTAssertEqual(
            streamed.digest,
            SHA256.hash(data: media).map { String(format: "%02x", $0) }.joined()
        )

        let linked = root.appendingPathComponent("linked.mov")
        try FileManager.default.createSymbolicLink(at: linked, withDestinationURL: mediaURL)
        XCTAssertThrowsError(try PortholeAutomationArtifactWriter.streamingSHA256(at: linked))
    }

    func testServerCreatesOwnerOnlySocketServesPingAndRejectsSecondProcess() async throws {
        let root = try scratchDirectory()
        defer { try? FileManager.default.removeItem(at: root) }
        let socketURL = root.appendingPathComponent("control.sock")
        let server = PortholeAutomationServer(socketURL: socketURL) { request in
            .success(request, result: PortholeAutomationResult(message: "pong"))
        }
        try server.start()
        defer { server.stop() }
        var info = stat()
        XCTAssertEqual(lstat(socketURL.path, &info), 0)
        XCTAssertEqual(info.st_mode & 0o777, 0o600)

        let second = PortholeAutomationServer(socketURL: socketURL) { request in
            .success(request, result: PortholeAutomationResult(message: "wrong"))
        }
        XCTAssertThrowsError(try second.start()) { error in
            XCTAssertEqual(error as? PortholeAutomationSocketError, .alreadyRunning)
        }
        let response = try socketRequest(socketURL, #"{"id":"ping","command":"ping"}"#)
        XCTAssertTrue(response.ok)
        XCTAssertEqual(response.result?.message, "pong")
    }

    func testSecondClientRespondsWhileFirstClientIsIdle() throws {
        let root = try scratchDirectory()
        defer { try? FileManager.default.removeItem(at: root) }
        let url = root.appendingPathComponent("idle.sock")
        let server = PortholeAutomationServer(socketURL: url) { request in
            .success(request, result: PortholeAutomationResult(message: "pong"))
        }
        try server.start()
        defer { server.stop() }
        let idle = try connectSocket(url)
        defer { Darwin.close(idle) }
        let response = try socketRequest(url, #"{"id":"second","command":"ping"}"#)
        XCTAssertTrue(response.ok, "second client must respond within its one-second read deadline")
    }

    func testNinthConcurrentClientIsClosedWithoutQueueingAndStopClosesIdleClients() throws {
        let root = try scratchDirectory()
        defer { try? FileManager.default.removeItem(at: root) }
        let url = root.appendingPathComponent("cap.sock")
        let handled = DispatchSemaphore(value: 0)
        let server = PortholeAutomationServer(socketURL: url) { request in
            handled.signal()
            return .success(request, result: PortholeAutomationResult(message: "pong"))
        }
        try server.start()
        defer { server.stop() }
        var descriptors: [Int32] = []
        defer { for descriptor in descriptors { Darwin.close(descriptor) } }
        for _ in 0..<PortholeAutomationServer.maximumConcurrentClients {
            let descriptor = try connectSocket(url)
            descriptors.append(descriptor)
            let data = Data((#"{"id":"hold","command":"ping"}"# + "\n").utf8)
            _ = data.withUnsafeBytes { Darwin.write(descriptor, $0.baseAddress, data.count) }
            XCTAssertEqual(handled.wait(timeout: .now() + 1), .success)
            var byte: UInt8 = 0
            while Darwin.read(descriptor, &byte, 1) == 1, byte != 0x0a {}
        }
        let refused = try connectSocket(url)
        defer { Darwin.close(refused) }
        var byte: UInt8 = 0
        XCTAssertEqual(Darwin.read(refused, &byte, 1), 0, "capacity refusal is prompt EOF, not a queued idle request")
        server.stop()
        for descriptor in descriptors { XCTAssertEqual(Darwin.read(descriptor, &byte, 1), 0) }
    }

    func testSecondClientRespondsWhileFirstCommandAwaitsLongOperation() throws {
        let root = try scratchDirectory()
        defer { try? FileManager.default.removeItem(at: root) }
        let url = root.appendingPathComponent("long.sock")
        let entered = DispatchSemaphore(value: 0)
        let server = PortholeAutomationServer(socketURL: url) { request in
            if request.command == .wait {
                entered.signal()
                try? await Task.sleep(for: .seconds(3))
            }
            return .success(request, result: PortholeAutomationResult(message: "pong"))
        }
        try server.start()
        defer { server.stop() }
        let long = try connectSocket(url)
        defer { Darwin.close(long) }
        let request = Data((#"{"id":"long","command":"wait","lifecycle":"live"}"# + "\n").utf8)
        _ = request.withUnsafeBytes { Darwin.write(long, $0.baseAddress, request.count) }
        XCTAssertEqual(entered.wait(timeout: .now() + 1), .success)
        XCTAssertTrue(try socketRequest(url, #"{"id":"second","command":"ping"}"#).ok)
    }

    func testServerReturnsStructuredFailureWhenResponseExceedsBound() throws {
        let root = try scratchDirectory()
        defer { try? FileManager.default.removeItem(at: root) }
        let socketURL = root.appendingPathComponent("bounded.sock")
        let server = PortholeAutomationServer(socketURL: socketURL) { request in
            .success(request, result: PortholeAutomationResult(
                message: String(repeating: "x", count: PortholeAutomationProtocol.maximumResponseBytes)
            ))
        }
        try server.start()
        defer { server.stop() }
        let response = try socketRequest(socketURL, #"{"id":"large","command":"ping"}"#)
        XCTAssertFalse(response.ok)
        XCTAssertEqual(response.id, "large")
        XCTAssertEqual(response.command, "ping")
        XCTAssertEqual(response.error?.code, "response-too-large")
    }

    func testServerRemovesOnlyOwnerOwnedStaleSocketAndRejectsSymlink() throws {
        let root = try scratchDirectory()
        defer { try? FileManager.default.removeItem(at: root) }
        let stale = root.appendingPathComponent("stale.sock")
        try bindStaleSocket(stale)
        let server = PortholeAutomationServer(socketURL: stale) { request in
            .success(request, result: PortholeAutomationResult(message: "pong"))
        }
        try server.start()
        server.stop()
        XCTAssertFalse(FileManager.default.fileExists(atPath: stale.path))

        let target = root.appendingPathComponent("target")
        try Data().write(to: target)
        let linked = root.appendingPathComponent("linked.sock")
        try FileManager.default.createSymbolicLink(at: linked, withDestinationURL: target)
        let unsafe = PortholeAutomationServer(socketURL: linked) { request in
            .success(request, result: PortholeAutomationResult(message: "never"))
        }
        XCTAssertThrowsError(try unsafe.start())
        XCTAssertTrue(FileManager.default.fileExists(atPath: target.path))
    }

    private func scratchDirectory() throws -> URL {
        let parent = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("coding/tmp", isDirectory: true)
        let root = parent.appendingPathComponent("porthole-automation-test-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: false)
        return root
    }

    private func socketRequest(
        _ socketURL: URL,
        _ line: String
    ) throws -> PortholeAutomationResponse {
        let descriptor = try connectSocket(socketURL)
        defer { Darwin.close(descriptor) }
        let request = Data((line + "\n").utf8)
        _ = request.withUnsafeBytes { Darwin.write(descriptor, $0.baseAddress, request.count) }
        var response = Data()
        var byte: UInt8 = 0
        while Darwin.read(descriptor, &byte, 1) == 1, byte != 0x0a { response.append(byte) }
        return try JSONDecoder().decode(PortholeAutomationResponse.self, from: response)
    }

    private func connectSocket(_ socketURL: URL) throws -> Int32 {
        let descriptor = Darwin.socket(AF_UNIX, SOCK_STREAM, 0)
        guard descriptor >= 0 else { throw CocoaError(.fileReadUnknown) }
        var timeout = timeval(tv_sec: 1, tv_usec: 0)
        _ = setsockopt(descriptor, SOL_SOCKET, SO_RCVTIMEO, &timeout, socklen_t(MemoryLayout<timeval>.size))
        var address = sockaddr_un()
        address.sun_family = sa_family_t(AF_UNIX)
        let capacity = MemoryLayout.size(ofValue: address.sun_path)
        socketURL.path.withCString { source in
            withUnsafeMutablePointer(to: &address.sun_path) {
                $0.withMemoryRebound(to: CChar.self, capacity: capacity) { _ = strlcpy($0, source, capacity) }
            }
        }
        let connected = withUnsafePointer(to: &address) {
            $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                Darwin.connect(descriptor, $0, socklen_t(MemoryLayout<sockaddr_un>.size))
            }
        }
        guard connected == 0 else { Darwin.close(descriptor); throw CocoaError(.fileReadUnknown) }
        return descriptor
    }

    private func bindStaleSocket(_ socketURL: URL) throws {
        let descriptor = Darwin.socket(AF_UNIX, SOCK_STREAM, 0)
        guard descriptor >= 0 else { throw CocoaError(.fileWriteUnknown) }
        defer { Darwin.close(descriptor) }
        var address = sockaddr_un()
        address.sun_family = sa_family_t(AF_UNIX)
        let capacity = MemoryLayout.size(ofValue: address.sun_path)
        socketURL.path.withCString { source in
            withUnsafeMutablePointer(to: &address.sun_path) {
                $0.withMemoryRebound(to: CChar.self, capacity: capacity) { _ = strlcpy($0, source, capacity) }
            }
        }
        let bound = withUnsafePointer(to: &address) {
            $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                Darwin.bind(descriptor, $0, socklen_t(MemoryLayout<sockaddr_un>.size))
            }
        }
        guard bound == 0 else { throw CocoaError(.fileWriteUnknown) }
    }
}

@MainActor
private final class FakeAutomationController: PortholeAutomationControlling {
    var lifecycle: CaptureLifecycle = .ready
    var frameCount = 0
    var pending: PortholeAutomationPendingReview?
    var approved: [PortholeAutomationApprovedSource] = []
    var selectedApprovalID: String?
    var artifact: PortholeAutomationArtifactReceipt?

    func automationStatus() -> PortholeAutomationStatus {
        PortholeAutomationStatus(
            processID: 42, lifecycle: lifecycle, frameCount: frameCount,
            selectedApprovalID: selectedApprovalID,
            activeApprovalID: lifecycle == .live ? selectedApprovalID : nil,
            hasPendingReview: pending != nil, approvedSourceCount: approved.count,
            persistenceAllowed: lifecycle == .live && approved.first?.capabilities.persistRecording == true,
            artifact: artifact)
    }

    func automationPendingReview() -> PortholeAutomationPendingReview? { pending }
    func automationApprovedSources() -> [PortholeAutomationApprovedSource] { approved }
    func automationOpenPicker(_ sourceKind: ApprovedSourceKind) async {}

    func automationApprove(
        reviewID: String,
        scope: SourceApprovalScopeKind,
        capabilities: SourceCapabilities
    ) throws {
        guard pending?.reviewID == reviewID else {
            throw PortholeAutomationError.authorityRequired("review mismatch")
        }
        approved = [PortholeAutomationApprovedSource(
            approvalID: "approval-a", displayTitle: "Approved Window", sourceKind: .window,
            scope: scope, capabilities: capabilities, selected: true, pickerBindingCurrent: true)]
        selectedApprovalID = "approval-a"
        pending = nil
    }

    func automationCancelReview() { pending = nil }

    func automationSelect(_ approvalID: String) async throws {
        guard approved.contains(where: { $0.approvalID == approvalID }) else {
            throw PortholeAutomationError.authorityRequired("unknown approval")
        }
        selectedApprovalID = approvalID
    }

    func automationRevoke(_ approvalID: String) async throws {
        guard approved.contains(where: { $0.approvalID == approvalID }) else {
            throw PortholeAutomationError.authorityRequired("unknown approval")
        }
        approved.removeAll { $0.approvalID == approvalID }
        selectedApprovalID = nil
        lifecycle = .stopped
        frameCount = 0
    }

    func automationStart() async throws {
        guard selectedApprovalID != nil, [.ready, .stopped].contains(lifecycle) else {
            throw PortholeAutomationError.invalidState("start denied")
        }
        lifecycle = .live
        frameCount = 1
    }
    func automationPause() async throws {
        guard lifecycle == .live else { throw PortholeAutomationError.invalidState("pause denied") }
        lifecycle = .paused
    }
    func automationResume() async throws {
        guard lifecycle == .paused else { throw PortholeAutomationError.invalidState("resume denied") }
        lifecycle = .live
    }
    func automationStop() async { lifecycle = .stopped; frameCount = 0 }

    func automationWriteStill(to outputDirectory: URL) throws -> PortholeAutomationArtifactReceipt {
        guard selectedApprovalID != nil else { throw PortholeAutomationError.authorityRequired("no approval") }
        return makeArtifact(kind: "still")
    }

    func automationStartRecording(to outputDirectory: URL, durationSeconds: Double) async throws {
        guard selectedApprovalID != nil else { throw PortholeAutomationError.authorityRequired("no approval") }
        lifecycle = .stopped
        frameCount = 60
        artifact = makeArtifact(kind: "recording")
    }

    func installApprovedSource() {
        approved = [PortholeAutomationApprovedSource(
            approvalID: "approval-a", displayTitle: "Approved Window", sourceKind: .window,
            scope: .exactWindow,
            capabilities: SourceCapabilities(preview: true, liveShare: false, persistRecording: true),
            selected: true, pickerBindingCurrent: true)]
        selectedApprovalID = "approval-a"
    }

    private func makeArtifact(kind: String) -> PortholeAutomationArtifactReceipt {
        PortholeAutomationArtifactReceipt(
            kind: kind, approvalID: "approval-a", captureLeaseID: "lease-a",
            sourceDisplayTitle: "Approved Window", sourceKind: .window, sourceWindowID: 77,
            artifactFilename: kind == "still" ? "stage-source.png" : "stage-source.mov",
            artifactSHA256: String(repeating: "a", count: 64), frameCount: kind == "still" ? 1 : 60,
            firstFrameMonotonicNanos: 1, lastFrameMonotonicNanos: 2,
            statement: "test receipt")
    }
}
