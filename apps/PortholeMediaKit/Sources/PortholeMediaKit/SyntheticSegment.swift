import AVFoundation
import Foundation

public enum SegmentError: Error, Equatable {
    case invalidPlan, codecFailure, deadlineExceeded, byteLimitExceeded, busy
}

/// Offline fixture only. Never accepts screen pixels or confers capture/disclosure authority.
public struct SyntheticSegmentPlan: Sendable {
    public static let timescale: Int32 = 600
    public let width: Int
    public let height: Int
    public let frameCount: Int
    public let framesPerSecond: Int
    public let maximumBytes: Int

    public init(width: Int = 320, height: Int = 180, frameCount: Int = 150,
                framesPerSecond: Int = 30, maximumBytes: Int = 16 * 1_024 * 1_024) throws {
        guard (16...1920).contains(width), (16...1080).contains(height),
              width.isMultiple(of: 2), height.isMultiple(of: 2),
              (1...60).contains(framesPerSecond), 600.isMultiple(of: framesPerSecond),
              (1...(framesPerSecond * 5)).contains(frameCount),
              (1...(32 * 1_024 * 1_024)).contains(maximumBytes) else { throw SegmentError.invalidPlan }
        self.width = width; self.height = height; self.frameCount = frameCount
        self.framesPerSecond = framesPerSecond; self.maximumBytes = maximumBytes
    }

    public var ticksPerFrame: Int64 { Int64(600 / framesPerSecond) }
    public var durationTicks: Int64 { Int64(frameCount) * ticksPerFrame }
}

public struct SyntheticSegment: Sendable {
    public let directory: URL
    public let movie: URL
    public let plan: SyntheticSegmentPlan
}

/// Each segment has its own codec session, zero-based PTS and first keyframe.
/// Callers own successful files. Failed/cancelled attempts remove only their fresh UUID directory.
public actor SyntheticSegmentWriter {
    private var writing = false
    private let afterFirstFrame: (@Sendable () async -> Void)?
    public init() { afterFirstFrame = nil }
    internal init(afterFirstFrame: @escaping @Sendable () async -> Void) { self.afterFirstFrame = afterFirstFrame }

    public func write(_ plan: SyntheticSegmentPlan, in parent: URL) async throws -> SyntheticSegment {
        try Task.checkCancellation()
        guard !writing else { throw SegmentError.busy }
        writing = true
        defer { writing = false }
        guard parent.isFileURL else { throw SegmentError.invalidPlan }
        let directory = parent.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: false,
                                               attributes: [.posixPermissions: 0o700])
        var successful = false
        defer { if !successful { try? FileManager.default.removeItem(at: directory) } }
        let movie = directory.appendingPathComponent("synthetic.mov")
        let writer = try AVAssetWriter(outputURL: movie, fileType: .mov)
        defer { if !successful { writer.cancelWriting() } }
        let input = AVAssetWriterInput(mediaType: .video, outputSettings: [
            AVVideoCodecKey: AVVideoCodecType.h264,
            AVVideoWidthKey: plan.width, AVVideoHeightKey: plan.height,
            AVVideoCompressionPropertiesKey: [
                AVVideoAverageBitRateKey: 2_000_000,
                AVVideoMaxKeyFrameIntervalKey: plan.framesPerSecond * 2,
                AVVideoMaxKeyFrameIntervalDurationKey: 2,
                AVVideoAllowFrameReorderingKey: false
            ]
        ])
        input.expectsMediaDataInRealTime = false
        let adaptor = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: input,
            sourcePixelBufferAttributes: [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
                kCVPixelBufferWidthKey as String: plan.width, kCVPixelBufferHeightKey as String: plan.height])
        guard writer.canAdd(input) else { throw SegmentError.codecFailure }
        writer.add(input)
        guard writer.startWriting() else { throw writer.error ?? SegmentError.codecFailure }
        writer.startSession(atSourceTime: .zero)
        let deadline = ContinuousClock.now.advanced(by: .seconds(30))
        func check() throws {
            try Task.checkCancellation()
            guard ContinuousClock.now < deadline else { throw SegmentError.deadlineExceeded }
            let attributes = try FileManager.default.attributesOfItem(atPath: movie.path)
            let size = (attributes[.size] as? NSNumber)?.intValue ?? 0
            guard size <= plan.maximumBytes else { throw SegmentError.byteLimitExceeded }
        }
        for index in 0..<plan.frameCount {
            try check()
            while !input.isReadyForMoreMediaData {
                guard writer.status == .writing else { throw writer.error ?? SegmentError.codecFailure }
                try check()
                try await Task.sleep(for: .milliseconds(2))
            }
            var optionalBuffer: CVPixelBuffer?
            guard let pool = adaptor.pixelBufferPool,
                  CVPixelBufferPoolCreatePixelBuffer(nil, pool, &optionalBuffer) == kCVReturnSuccess,
                  let buffer = optionalBuffer else { throw SegmentError.codecFailure }
            CVPixelBufferLockBaseAddress(buffer, [])
            if let base = CVPixelBufferGetBaseAddress(buffer) {
                let stride = CVPixelBufferGetBytesPerRow(buffer)
                for y in 0..<plan.height {
                    let row = base.advanced(by: y * stride).assumingMemoryBound(to: UInt8.self)
                    for x in 0..<plan.width {
                        row[x * 4] = UInt8((x + index) % 256)
                        row[x * 4 + 1] = UInt8(y % 256)
                        row[x * 4 + 2] = UInt8(index % 256)
                        row[x * 4 + 3] = 255
                    }
                }
            } else {
                CVPixelBufferUnlockBaseAddress(buffer, [])
                throw SegmentError.codecFailure
            }
            CVPixelBufferUnlockBaseAddress(buffer, [])
            guard adaptor.append(buffer, withPresentationTime: CMTime(value: Int64(index) * plan.ticksPerFrame,
                timescale: SyntheticSegmentPlan.timescale)) else { throw writer.error ?? SegmentError.codecFailure }
            if index == 0 { await afterFirstFrame?() }
        }
        writer.endSession(atSourceTime: CMTime(value: plan.durationTicks, timescale: SyntheticSegmentPlan.timescale))
        input.markAsFinished()
        writer.finishWriting {}
        while writer.status == .writing {
            try check()
            try await Task.sleep(for: .milliseconds(2))
        }
        try check()
        guard writer.status == .completed else { throw writer.error ?? SegmentError.codecFailure }
        successful = true
        return SyntheticSegment(directory: directory, movie: movie, plan: plan)
    }
}

/// Source-time mapping is explicit. Gaps are never synthesized as a held video frame.
public struct PlaybackTimeline: Sendable {
    public enum Content: Equatable, Sendable { case segment(UUID), gap }
    public struct Interval: Sendable {
        public let start: Int64
        public let end: Int64
        public let content: Content
        public init(start: Int64, end: Int64, content: Content) {
            self.start = start; self.end = end; self.content = content
        }
    }
    public let intervals: [Interval]
    public init(intervals: [Interval]) throws {
        guard !intervals.isEmpty, intervals.count <= 10_000 else { throw SegmentError.invalidPlan }
        var previousEnd: Int64 = 0
        for interval in intervals {
            guard interval.start == previousEnd, interval.end > interval.start else { throw SegmentError.invalidPlan }
            previousEnd = interval.end
        }
        self.intervals = intervals
    }
    public func resolve(tick: Int64) -> (content: Content, localTick: Int64)? {
        guard let interval = intervals.first(where: { $0.start <= tick && tick < $0.end }) else { return nil }
        return (interval.content, tick - interval.start)
    }
}
