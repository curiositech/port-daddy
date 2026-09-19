import AVFoundation
import XCTest
@testable import PortholeMediaKit

final class SyntheticSegmentTests: XCTestCase {
    private func checkPixels(_ sample: CMSampleBuffer, frame: Int) throws {
        let pixels = try XCTUnwrap(CMSampleBufferGetImageBuffer(sample))
        CVPixelBufferLockBaseAddress(pixels, .readOnly)
        defer { CVPixelBufferUnlockBaseAddress(pixels, .readOnly) }
        let base = try XCTUnwrap(CVPixelBufferGetBaseAddress(pixels))
        let pixel = base.advanced(by: 32 * CVPixelBufferGetBytesPerRow(pixels) + 32 * 4).assumingMemoryBound(to: UInt8.self)
        // H.264 YUV conversion and chroma subsampling are lossy; this bound
        // still rejects black output and wrong frames at the sampled offsets.
        XCTAssertEqual(Int(pixel[0]), (32 + frame) % 256, accuracy: 20)
        XCTAssertEqual(Int(pixel[1]), 32, accuracy: 20)
        XCTAssertEqual(Int(pixel[2]), frame % 256, accuracy: 20)
    }
    private func scratch() throws -> URL {
        let url = URL(fileURLWithPath: #filePath).deletingLastPathComponent().appendingPathComponent("fixture-\(UUID())")
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: false)
        addTeardownBlock { try FileManager.default.removeItem(at: url) }
        return url
    }
    func testInvalidPlans() {
        for size in [-1, 0, 15, 17, Int.max] { XCTAssertThrowsError(try SyntheticSegmentPlan(width: size)) }
        XCTAssertThrowsError(try SyntheticSegmentPlan(frameCount: 151))
        XCTAssertThrowsError(try SyntheticSegmentPlan(framesPerSecond: 59))
        XCTAssertThrowsError(try SyntheticSegmentPlan(maximumBytes: 0))
    }
    func testGapsAndHalfOpenIntervals() throws {
        let id = UUID()
        let timeline = try PlaybackTimeline(intervals: [.init(start: 0, end: 3000, content: .segment(id)),
            .init(start: 3000, end: 4200, content: .gap), .init(start: 4200, end: 7200, content: .segment(UUID()))])
        XCTAssertEqual(timeline.resolve(tick: 2999)?.content, .segment(id))
        XCTAssertEqual(timeline.resolve(tick: 3000)?.content, .gap)
        XCTAssertEqual(timeline.resolve(tick: 4200)?.localTick, 0)
        XCTAssertNil(timeline.resolve(tick: -1)); XCTAssertNil(timeline.resolve(tick: 7200))
        XCTAssertThrowsError(try PlaybackTimeline(intervals: [.init(start: 1, end: 10, content: .gap)]))
        XCTAssertThrowsError(try PlaybackTimeline(intervals: [.init(start: 0, end: 10, content: .gap),
            .init(start: 9, end: 20, content: .gap)]))
    }
    func testIndependentSegmentsRoundTripTimingAndKeyframes() async throws {
        let parent = try scratch()
        for _ in 0..<2 {
            let segment = try await SyntheticSegmentWriter().write(try .init(width: 64, height: 64), in: parent)
            let asset = AVURLAsset(url: segment.movie)
            let tracks = try await asset.loadTracks(withMediaType: .video)
            XCTAssertEqual(tracks.count, 1)
            let audio = try await asset.loadTracks(withMediaType: .audio)
            XCTAssertTrue(audio.isEmpty)
            let duration = try await asset.load(.duration)
            XCTAssertEqual(CMTimeCompare(duration, CMTime(value: 3000, timescale: 600)), 0)
            for decode in [false, true] {
                let reader = try AVAssetReader(asset: asset)
                let output = AVAssetReaderTrackOutput(track: tracks[0], outputSettings: decode ?
                    [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA] : nil)
                reader.add(output); XCTAssertTrue(reader.startReading())
                var count = 0
                var keys: [Int] = []
                while let sample = output.copyNextSampleBuffer() {
                    if !decode && CMSampleBufferGetTotalSampleSize(sample) == 0 { continue }
                    XCTAssertEqual(CMTimeCompare(sample.presentationTimeStamp, CMTime(value: Int64(count) * 20, timescale: 600)), 0)
                    if decode {
                        let pixels = try XCTUnwrap(CMSampleBufferGetImageBuffer(sample))
                        XCTAssertEqual(CVPixelBufferGetWidth(pixels), 64)
                        if count.isMultiple(of: 30) { try checkPixels(sample, frame: count) }
                    } else {
                        let attachments = CMSampleBufferGetSampleAttachmentsArray(sample, createIfNecessary: false) as? [[String: Any]]
                        if attachments?.first?[kCMSampleAttachmentKey_NotSync as String] as? Bool != true { keys.append(count) }
                    }
                    count += 1
                }
                XCTAssertEqual(reader.status, .completed); XCTAssertEqual(count, 150)
                if !decode {
                    XCTAssertEqual(keys.first, 0)
                    for (a, b) in zip(keys, Array(keys.dropFirst()) + [count]) { XCTAssertLessThanOrEqual(b - a, 60) }
                }
            }
            let seeker = try AVAssetReader(asset: asset)
            seeker.timeRange = CMTimeRange(start: CMTime(value: 1800, timescale: 600), duration: CMTime(value: 600, timescale: 600))
            let seekOutput = AVAssetReaderTrackOutput(track: tracks[0], outputSettings:
                [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA])
            seeker.add(seekOutput); XCTAssertTrue(seeker.startReading())
            let sought = try XCTUnwrap(seekOutput.copyNextSampleBuffer())
            XCTAssertEqual(CMTimeCompare(sought.presentationTimeStamp, CMTime(value: 1800, timescale: 600)), 0)
            try checkPixels(sought, frame: 90)
            seeker.cancelReading()
        }
    }
    func testByteLimitCleanup() async throws {
        let parent = try scratch()
        do { _ = try await SyntheticSegmentWriter().write(try .init(width: 64, height: 64, maximumBytes: 1), in: parent); XCTFail() }
        catch { XCTAssertEqual(error as? SegmentError, .byteLimitExceeded) }
        XCTAssertTrue(try FileManager.default.contentsOfDirectory(atPath: parent.path).isEmpty)
    }
    func testCancellationCleanup() async throws {
        let parent = try scratch()
        let task = Task { try await SyntheticSegmentWriter().write(try .init(), in: parent) }
        task.cancel()
        do { _ = try await task.value; XCTFail() } catch { XCTAssertTrue(error is CancellationError) }
        XCTAssertTrue(try FileManager.default.contentsOfDirectory(atPath: parent.path).isEmpty)
    }
    func testInFlightCancellationCleansOnlyOwnedDirectory() async throws {
        let parent = try scratch()
        let sentinel = parent.appendingPathComponent("keep.txt")
        try Data("keep".utf8).write(to: sentinel)
        let gate = FrameGate()
        let writer = SyntheticSegmentWriter(afterFirstFrame: { await gate.pause() })
        let task = Task { try await writer.write(try .init(width: 64, height: 64), in: parent) }
        let deadline = ContinuousClock.now.advanced(by: .seconds(5))
        while !(await gate.paused), ContinuousClock.now < deadline {
            try await Task.sleep(for: .milliseconds(1))
        }
        guard await gate.paused else {
            task.cancel()
            await gate.resume()
            _ = try? await task.value
            return XCTFail("writer did not reach the first-frame seam within five seconds")
        }
        XCTAssertEqual(try FileManager.default.contentsOfDirectory(atPath: parent.path).count, 2)
        do { _ = try await writer.write(try .init(), in: parent); XCTFail("concurrent writer admitted") }
        catch { XCTAssertEqual(error as? SegmentError, .busy) }
        task.cancel()
        await gate.resume()
        do { _ = try await task.value; XCTFail() } catch { XCTAssertTrue(error is CancellationError) }
        XCTAssertEqual(try FileManager.default.contentsOfDirectory(atPath: parent.path), ["keep.txt"])
        XCTAssertEqual(try Data(contentsOf: sentinel), Data("keep".utf8))
        let recovered = try await writer.write(try .init(width: 64, height: 64, frameCount: 1), in: parent)
        XCTAssertTrue(FileManager.default.fileExists(atPath: recovered.movie.path))
    }
}

private actor FrameGate {
    var paused = false
    var released = false
    var continuation: CheckedContinuation<Void, Never>?
    func pause() async {
        guard !paused, !released else { return }
        await withCheckedContinuation { continuation = $0; paused = true }
    }
    func resume() { released = true; continuation?.resume(); continuation = nil }
}
