import AVFoundation
import Foundation
import XCTest
@testable import PortholeStageCore

final class CaptureShutdownTests: XCTestCase {
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

    func testStopAndWriterShareOneDeadlineRatherThanEachGettingFullBudget() async throws {
        let deadline = CaptureShutdownDeadline(seconds: 0.08)
        try await deadline.wait(phase: "stop") { callback in
            DispatchQueue.global().asyncAfter(deadline: .now() + 0.04) { callback(nil) }
        }
        // Spend the remainder explicitly, then prove no second framework call
        // is made after the absolute deadline already expired.
        try await Task.sleep(for: .milliseconds(60))
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
