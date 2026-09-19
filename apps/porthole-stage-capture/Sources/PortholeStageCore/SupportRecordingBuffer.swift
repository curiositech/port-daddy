import Foundation

/// In-memory encoded-media staging, not a capture source or permission grant.
/// The producer must supply independently decodable, already privacy-approved
/// segments. Container/codec validation and sealing belong at the media boundary.
public struct SupportRecordingBuffer: Sendable {
    public struct Segment: Equatable, Sendable {
        public let sequence: UInt64
        public let startNanos: UInt64
        public let endNanos: UInt64
        public let bytes: Data

        public init(sequence: UInt64, startNanos: UInt64, endNanos: UInt64, bytes: Data) {
            self.sequence = sequence
            self.startNanos = startNanos
            self.endNanos = endNanos
            self.bytes = bytes
        }
    }

    public enum Rejection: Error, Equatable {
        case invalidLimit, invalidInterval, emptySegment, oversizedSegment
        case staleSequence, overlappingInterval, wrongGeneration, expiredSegment
    }

    public static let maximumBytes = 256 * 1024 * 1024
    public static let maximumDurationNanos: UInt64 = 120_000_000_000
    public static let maximumSegments = 120
    public let byteLimit: Int
    public let durationLimitNanos: UInt64
    public private(set) var generation = UUID()
    public private(set) var segments: [Segment] = []
    public private(set) var byteCount = 0
    private var lastSequence: UInt64?
    private var lastEndNanos: UInt64?
    private var latestObservedNanos: UInt64 = 0

    /// Both limits apply, including when a caller requests a larger support buffer.
    public init(byteLimit: Int = Self.maximumBytes,
                durationLimitNanos: UInt64 = Self.maximumDurationNanos) throws {
        guard byteLimit > 0, byteLimit <= Self.maximumBytes,
              durationLimitNanos > 0, durationLimitNanos <= Self.maximumDurationNanos
        else { throw Rejection.invalidLimit }
        self.byteLimit = byteLimit
        self.durationLimitNanos = durationLimitNanos
    }

    /// Reject atomically; never evict valid history to accommodate invalid input.
    /// Gaps retain their original timestamps instead of being compacted away.
    /// The generation fences callbacks queued before revocation/reset.
    public mutating func append(_ segment: Segment, generation: UUID) throws {
        guard generation == self.generation else { throw Rejection.wrongGeneration }
        guard segment.endNanos > segment.startNanos,
              segment.endNanos - segment.startNanos <= durationLimitNanos
        else { throw Rejection.invalidInterval }
        guard !segment.bytes.isEmpty else { throw Rejection.emptySegment }
        guard segment.bytes.count <= byteLimit else { throw Rejection.oversizedSegment }
        if let lastSequence, segment.sequence <= lastSequence { throw Rejection.staleSequence }
        if let lastEndNanos, segment.startNanos < lastEndNanos { throw Rejection.overlappingInterval }
        guard latestObservedNanos <= segment.startNanos
                || latestObservedNanos - segment.startNanos <= durationLimitNanos
        else { throw Rejection.expiredSegment }

        // Evict whole segments; slicing encoded bytes can destroy decodability.
        // Subtraction avoids overflow when an adversarial size approaches Int.max.
        while let oldest = segments.first,
              byteCount > byteLimit - segment.bytes.count
                || segment.endNanos - oldest.startNanos > durationLimitNanos
                || segments.count >= Self.maximumSegments {
            byteCount -= segments.removeFirst().bytes.count
        }
        segments.append(segment)
        byteCount += segment.bytes.count
        lastSequence = segment.sequence
        lastEndNanos = segment.endNanos
        latestObservedNanos = max(latestObservedNanos, segment.endNanos)
    }

    /// Expire static/idle capture without requiring another captured frame.
    /// This is monotonic time in the same session, not wall/display time.
    public mutating func expire(atMonotonicNanos now: UInt64, generation: UUID) throws {
        guard generation == self.generation else { throw Rejection.wrongGeneration }
        latestObservedNanos = max(latestObservedNanos, now)
        while let oldest = segments.first, latestObservedNanos >= oldest.startNanos,
              latestObservedNanos - oldest.startNanos > durationLimitNanos {
            byteCount -= segments.removeFirst().bytes.count
        }
    }

    /// Remove owned references and invalidate outstanding callbacks. This does
    /// not claim secure erasure of Data copies held by producers or consumers.
    public mutating func reset() {
        segments.removeAll(keepingCapacity: false)
        byteCount = 0
        lastSequence = nil
        lastEndNanos = nil
        latestObservedNanos = 0
        generation = UUID()
    }
}
