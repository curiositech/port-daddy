import AVFoundation
import Foundation
import XCTest
@testable import PortholeStageCore

final class CaptureShutdownTests: XCTestCase {
    @MainActor
    func testControllerClosesDeliveryBeforeAwaitAndPublishesOnlyAfterFinalization() async throws {
        var order: [String] = []
        let approval = BoundaryFixtures.approval()
        let controller = try StageCaptureController(shutdownWork: CaptureShutdownWork(approval: approval,
            closeDelivery: { order.append("closed") }, stop: { _ in order.append("stopped") },
            finalize: { _ in order.append("finished") }, publish: { order.append("published"); return nil },
            cancel: { order.append("cancelled") }), approval: approval)
        await controller.stopCapture()
        XCTAssertEqual(order, ["closed", "stopped", "finished", "published"])
        XCTAssertEqual(controller.lifecycle, .stopped)
        XCTAssertNil(controller.activeCaptureLease)
    }

    @MainActor
    func testControllerCancellationAfterSuccessfulFinalizationCannotPublishReceipt() async throws {
        var published = false
        var cancelled = false
        let approval = BoundaryFixtures.approval()
        let controller = try StageCaptureController(shutdownWork: CaptureShutdownWork(approval: approval,
            closeDelivery: {}, stop: { _ in }, finalize: { _ in withUnsafeCurrentTask { $0?.cancel() } },
            publish: { published = true; return nil }, cancel: { cancelled = true }), approval: approval)
        let task = Task { await controller.stopCapture() }
        await task.value
        XCTAssertFalse(published)
        XCTAssertTrue(cancelled)
        XCTAssertNil(controller.proofReceipt)
        XCTAssertEqual(controller.lifecycle, .failed)
    }

    @MainActor
    func testControllerSecondStopRetiresFirstAndDoesNotDoubleFinalize() async throws {
        var continuation: CheckedContinuation<Void, Never>?
        let entered = expectation(description: "first stop waiting")
        var finalized = 0
        var published = 0
        var cancelled = 0
        let approval = BoundaryFixtures.approval()
        let controller = try StageCaptureController(shutdownWork: CaptureShutdownWork(approval: approval,
            closeDelivery: {}, stop: { _ in await withCheckedContinuation { continuation = $0; entered.fulfill() } },
            finalize: { _ in finalized += 1 }, publish: { published += 1; return nil },
            cancel: { cancelled += 1 }), approval: approval)
        let first = Task { await controller.stopCapture() }
        await fulfillment(of: [entered], timeout: 1)
        await controller.stopCapture()
        continuation?.resume()
        await first.value
        XCTAssertEqual(finalized, 0)
        XCTAssertEqual(published, 0)
        XCTAssertEqual(cancelled, 1)
        XCTAssertEqual(controller.lifecycle, .stopped)
        XCTAssertNil(controller.activeCaptureLease)
    }

    @MainActor
    func testControllerRevocationDuringWriterWaitRetiresReceiptAndApproval() async throws {
        var continuation: CheckedContinuation<Void, Never>?
        let entered = expectation(description: "writer waiting")
        var published = false
        var cancelled = false
        let approval = BoundaryFixtures.approval()
        let controller = try StageCaptureController(shutdownWork: CaptureShutdownWork(approval: approval,
            closeDelivery: {}, stop: { _ in },
            finalize: { _ in await withCheckedContinuation { continuation = $0; entered.fulfill() } },
            publish: { published = true; return nil }, cancel: { cancelled = true }), approval: approval)
        let stop = Task { await controller.stopCapture() }
        await fulfillment(of: [entered], timeout: 1)
        await controller.revokeApproval(approval.approvalID)
        XCTAssertTrue(controller.statusMessage.contains("pending proof is invalidated"))
        continuation?.resume()
        await stop.value
        XCTAssertFalse(published)
        XCTAssertTrue(cancelled)
        XCTAssertTrue(controller.approvedSources.isEmpty)
        XCTAssertNil(controller.activeCaptureLease)
        XCTAssertEqual(controller.lifecycle, .stopped)
    }

    @MainActor
    func testControllerTimedOutRevokeDoesNotReplaceFailureWithStoppedClaim() async throws {
        let approval = BoundaryFixtures.approval()
        let controller = try StageCaptureController(shutdownWork: CaptureShutdownWork(approval: approval,
            closeDelivery: {}, stop: { _ in throw CaptureShutdownError.timedOut("Screen capture") },
            finalize: { _ in XCTFail("revocation must not finalize") },
            publish: { XCTFail("revocation must not publish"); return nil }, cancel: {}), approval: approval)
        await controller.revokeApproval(approval.approvalID)
        XCTAssertEqual(controller.lifecycle, .failed)
        XCTAssertTrue(controller.statusMessage.contains("system shutdown is unconfirmed"))
        XCTAssertFalse(controller.statusMessage.contains("Streams stopped"))
        XCTAssertTrue(controller.approvedSources.isEmpty)
    }

    func testSynchronousSuccessAndDuplicateCallbackResumeOnlyOnce() async throws {
        try await CaptureShutdownDeadline(seconds: 1).wait(phase: "stop") { callback in
            callback(nil)
            callback(CaptureShutdownError.timedOut("duplicate"))
            callback(nil)
        }
    }

    func testFrameworkErrorIsNotConvertedToSuccess() async {
        let error = NSError(domain: "synthetic-framework", code: 42)
        do {
            try await CaptureShutdownDeadline(seconds: 1).wait(phase: "stop") { $0(error) }
            XCTFail("framework denial must propagate")
        } catch { XCTAssertEqual((error as NSError).code, 42) }
    }

    func testNeverReplyingFrameworkReturnsAtDeadlineAndLateRepliesStayRetired() async {
        var late: ((Error?) -> Void)?
        let start = ContinuousClock.now
        do {
            try await CaptureShutdownDeadline(seconds: 0.04).wait(phase: "stop") { late = $0 }
            XCTFail("missing callback must not succeed")
        } catch { XCTAssertEqual(error as? CaptureShutdownError, .timedOut("stop")) }
        XCTAssertLessThan(start.duration(to: .now), .seconds(1))
        late?(nil)
        late?(NSError(domain: "late", code: 1))
    }

    @MainActor
    func testStopAndWriterShareOneDeadlineRatherThanEachGettingFullBudget() async throws {
        var stopDeadline: UInt64?
        var writerDeadline: UInt64?
        var published = false
        let approval = BoundaryFixtures.approval()
        let controller = try StageCaptureController(shutdownWork: CaptureShutdownWork(approval: approval,
            closeDelivery: {}, stop: { stopDeadline = $0.deadline.uptimeNanoseconds },
            finalize: { writerDeadline = $0.deadline.uptimeNanoseconds },
            publish: { published = true; return nil }, cancel: {}), approval: approval)
        await controller.stopCapture()
        // Observe the actual controller's forwarding rather than require a
        // synthetic callback to win a millisecond race on a loaded CI runner.
        XCTAssertEqual(try XCTUnwrap(stopDeadline), try XCTUnwrap(writerDeadline))
        XCTAssertTrue(published)
        XCTAssertEqual(controller.lifecycle, .stopped)
    }

    func testExpiredDeadlineDoesNotStartAnotherFrameworkPhase() async throws {
        let deadline = CaptureShutdownDeadline(seconds: 0.001)
        // Only a lower-bound wait is needed. Scheduler delay cannot turn this
        // into a race, and the expired absolute deadline must reject startup.
        try await Task.sleep(for: .milliseconds(2))
        do {
            try await deadline.wait(phase: "writer") { _ in XCTFail("expired budget must not start writer") }
            XCTFail("expired budget must fail")
        } catch { XCTAssertEqual(error as? CaptureShutdownError, .timedOut("writer")) }
    }

    func testCancellationReleasesWaitWithoutRequiringFrameworkCallback() async {
        let entered = expectation(description: "registered stop callback")
        let task = Task {
            try await CaptureShutdownDeadline(seconds: 10).wait(phase: "stop") { _ in entered.fulfill() }
        }
        await fulfillment(of: [entered], timeout: 1)
        task.cancel()
        do { try await task.value; XCTFail("cancelled stop must not succeed") }
        catch { XCTAssertTrue(error is CancellationError) }
    }

    func testAlreadyCancelledTaskDoesNotLaunchFrameworkOperation() async {
        let task = Task {
            withUnsafeCurrentTask { $0?.cancel() }
            try await CaptureShutdownDeadline(seconds: 10).wait(phase: "stop") { _ in
                XCTFail("cancelled caller must not initiate a writer")
            }
        }
        do { try await task.value; XCTFail("cancellation must propagate") }
        catch { XCTAssertTrue(error is CancellationError) }
    }

    func testRealWriterFinishesSyntheticFrameAndRejectsFramesAfterCutoff() async throws {
        let root = try fixtureDirectory()
        defer { try? FileManager.default.removeItem(at: root) }
        let url = root.appendingPathComponent("synthetic.mov")
        let recorder = try ApprovedProofRecorder(outputURL: url, width: 32, height: 32)
        let sample = try syntheticSample()
        recorder.append(sample)
        XCTAssertEqual(recorder.recordedFrameCount, 1)
        recorder.suspend()
        recorder.append(sample)
        XCTAssertEqual(recorder.recordedFrameCount, 1, "cutoff is synchronous, before OS shutdown")
        try await recorder.finish(deadline: CaptureShutdownDeadline())
        let tracks = try await AVURLAsset(url: url).loadTracks(withMediaType: .video)
        XCTAssertEqual(tracks.count, 1)
        XCTAssertGreaterThan(try Data(contentsOf: url).count, 0)
        XCTAssertFalse(FileManager.default.fileExists(atPath: root.appendingPathComponent("receipt.json").path),
                       "a media file is not an approved capture receipt")
    }

    func testCancelledShutdownStillRequestsSystemCleanupWithoutWaitingForAcknowledgment() async {
        let requested = expectation(description: "system stop requested despite task cancellation")
        let task = Task {
            withUnsafeCurrentTask { $0?.cancel() }
            try await CaptureShutdownDeadline(seconds: 10).wait(phase: "stop", alwaysRequestCleanup: true) { _ in
                requested.fulfill()
            }
        }
        do { try await task.value; XCTFail("cleanup request is not successful acknowledgment") }
        catch { XCTAssertTrue(error is CancellationError) }
        await fulfillment(of: [requested], timeout: 1)
    }

    func testRealWriterWithNoFramesCannotPublishMediaSuccess() async throws {
        let root = try fixtureDirectory()
        defer { try? FileManager.default.removeItem(at: root) }
        let recorder = try ApprovedProofRecorder(outputURL: root.appendingPathComponent("empty.mov"), width: 32, height: 32)
        do { try await recorder.finish(deadline: CaptureShutdownDeadline()); XCTFail("empty proof must fail") }
        catch { XCTAssertTrue(error is StageCaptureError) }
        recorder.cancel()
    }

    private func fixtureDirectory() throws -> URL {
        let parent = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("coding/tmp", isDirectory: true)
        let root = parent.appendingPathComponent("porthole-shutdown-test-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        return root
    }

    private func syntheticSample() throws -> CMSampleBuffer {
        var buffer: CVPixelBuffer?
        XCTAssertEqual(CVPixelBufferCreate(kCFAllocatorDefault, 32, 32, kCVPixelFormatType_32BGRA,
            [kCVPixelBufferIOSurfacePropertiesKey: [:]] as CFDictionary, &buffer), kCVReturnSuccess)
        let image = try XCTUnwrap(buffer)
        CVPixelBufferLockBaseAddress(image, [])
        memset(CVPixelBufferGetBaseAddress(image), 0, CVPixelBufferGetDataSize(image))
        CVPixelBufferUnlockBaseAddress(image, [])
        var format: CMVideoFormatDescription?
        XCTAssertEqual(CMVideoFormatDescriptionCreateForImageBuffer(allocator: kCFAllocatorDefault,
            imageBuffer: image, formatDescriptionOut: &format), noErr)
        var timing = CMSampleTimingInfo(duration: CMTime(value: 1, timescale: 30),
            presentationTimeStamp: .zero, decodeTimeStamp: .invalid)
        var sample: CMSampleBuffer?
        XCTAssertEqual(CMSampleBufferCreateReadyWithImageBuffer(allocator: kCFAllocatorDefault, imageBuffer: image,
            formatDescription: try XCTUnwrap(format), sampleTiming: &timing, sampleBufferOut: &sample), noErr)
        return try XCTUnwrap(sample)
    }
}
