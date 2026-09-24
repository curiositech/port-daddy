import Foundation
import XCTest
@testable import PortholeStageCore

final class SupportRecordingBufferTests: XCTestCase {
    private func segment(_ sequence: UInt64, _ start: UInt64, _ end: UInt64,
                         _ bytes: Int = 3) -> SupportRecordingBuffer.Segment {
        .init(sequence: sequence, startNanos: start, endNanos: end,
              bytes: Data(repeating: UInt8(sequence % 256), count: bytes))
    }

    func testLimitsCannotSilentlyWidenSupportCapture() throws {
        for limit in [0, -1, Int.max, SupportRecordingBuffer.maximumBytes + 1] {
            XCTAssertThrowsError(try SupportRecordingBuffer(byteLimit: limit))
        }
        for duration: UInt64 in [0, UInt64.max, SupportRecordingBuffer.maximumDurationNanos + 1] {
            XCTAssertThrowsError(try SupportRecordingBuffer(durationLimitNanos: duration))
        }
        let buffer = try SupportRecordingBuffer()
        XCTAssertEqual(buffer.byteLimit, 268_435_456)
        XCTAssertEqual(buffer.durationLimitNanos, 120_000_000_000)
    }

    func testByteLimitEvictsWholeSegmentsAndKeepsExactBoundary() throws {
        var buffer = try SupportRecordingBuffer(byteLimit: 6, durationLimitNanos: 100)
        let generation = buffer.generation
        for sequence: UInt64 in 1 ... 3 {
            try buffer.append(segment(sequence, sequence * 10, sequence * 10 + 5), generation: generation)
        }
        XCTAssertEqual(buffer.segments.map(\.sequence), [2, 3])
        XCTAssertEqual(buffer.byteCount, 6)
    }

    func testDurationIncludesGapsAndStaticIdleExpiresWithoutNewFrames() throws {
        var buffer = try SupportRecordingBuffer(byteLimit: 100, durationLimitNanos: 20)
        let generation = buffer.generation
        try buffer.append(segment(1, 10, 15), generation: generation)
        try buffer.append(segment(2, 25, 30), generation: generation)
        XCTAssertEqual(buffer.segments.count, 2)
        try buffer.expire(atMonotonicNanos: 31, generation: generation)
        XCTAssertEqual(buffer.segments.map(\.sequence), [2])
        XCTAssertEqual(buffer.segments.first?.startNanos, 25)
        try buffer.expire(atMonotonicNanos: 46, generation: generation)
        XCTAssertEqual(buffer.byteCount, 0)
        XCTAssertThrowsError(try buffer.append(segment(1, 50, 55), generation: generation))
    }

    func testRejectedAppendsAreAtomic() throws {
        var buffer = try SupportRecordingBuffer(byteLimit: 6, durationLimitNanos: 20)
        let generation = buffer.generation
        try buffer.append(segment(1, 10, 15), generation: generation)
        let before = buffer.segments
        for invalid in [segment(1, 15, 20), segment(2, 14, 20), segment(2, 20, 20),
                        segment(2, 30, 29), segment(2, 20, 41), segment(2, 20, 25, 0),
                        segment(2, 20, 25, 7)] {
            XCTAssertThrowsError(try buffer.append(invalid, generation: generation))
            XCTAssertEqual(buffer.segments, before)
            XCTAssertEqual(buffer.byteCount, 3)
        }
        try buffer.append(segment(2, 15, 20), generation: generation)
        XCTAssertEqual(buffer.segments.count, 2)
    }

    func testResetFencesLateProducerAndAllowsNewSessionClock() throws {
        var buffer = try SupportRecordingBuffer()
        let oldGeneration = buffer.generation
        try buffer.append(segment(1, 100, 105), generation: oldGeneration)
        buffer.reset()
        XCTAssertEqual(buffer.byteCount, 0)
        XCTAssertTrue(buffer.segments.isEmpty)
        XCTAssertThrowsError(try buffer.append(segment(2, 105, 110), generation: oldGeneration))
        try buffer.append(segment(1, 0, 5), generation: buffer.generation)
        XCTAssertEqual(buffer.segments.count, 1)
    }

    func testClockExtremesDoNotOverflowOrExpireOnBackwardSample() throws {
        var buffer = try SupportRecordingBuffer(byteLimit: 6, durationLimitNanos: 20)
        let generation = buffer.generation
        try buffer.append(segment(UInt64.max, UInt64.max - 5, UInt64.max), generation: generation)
        try buffer.expire(atMonotonicNanos: 0, generation: generation)
        XCTAssertEqual(buffer.segments.count, 1)
        XCTAssertThrowsError(try buffer.append(segment(0, 0, 5), generation: generation))
    }

    func testTinySegmentsCannotExhaustMetadataMemory() throws {
        var buffer = try SupportRecordingBuffer()
        for n: UInt64 in 0 ..< 1_000 {
            try buffer.append(segment(n, n, n + 1, 1), generation: buffer.generation)
        }
        XCTAssertEqual(buffer.segments.count, 120)
        XCTAssertEqual(buffer.byteCount, 120)
        XCTAssertEqual(buffer.segments.first?.sequence, 880)
    }

    func testExpiredQueuedSegmentCannotResurrectEvenAfterClockMovesBackward() throws {
        var buffer = try SupportRecordingBuffer(durationLimitNanos: 20)
        let generation = buffer.generation
        try buffer.append(segment(1, 10, 15), generation: generation)
        try buffer.expire(atMonotonicNanos: 1_000, generation: generation)
        try buffer.expire(atMonotonicNanos: 20, generation: generation)
        XCTAssertThrowsError(try buffer.append(segment(2, 20, 25), generation: generation)) {
            XCTAssertEqual($0 as? SupportRecordingBuffer.Rejection, .expiredSegment)
        }
        XCTAssertEqual(buffer.byteCount, 0)
        try buffer.append(segment(2, 980, 985), generation: generation)
        XCTAssertEqual(buffer.segments.count, 1)
    }

    func testTimerFromPreviousGenerationCannotExpireNewSession() throws {
        var buffer = try SupportRecordingBuffer(durationLimitNanos: 20)
        let oldGeneration = buffer.generation
        buffer.reset()
        try buffer.append(segment(1, 0, 5), generation: buffer.generation)
        XCTAssertThrowsError(try buffer.expire(atMonotonicNanos: 1_000, generation: oldGeneration))
        XCTAssertEqual(buffer.byteCount, 3)
        try buffer.append(segment(2, 5, 10), generation: buffer.generation)
    }
}
