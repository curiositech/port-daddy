import Foundation
import Darwin

/// A local, injected stream boundary. Stopping drains in-flight callbacks and
/// resets partial input; an old handler can never feed a restarted reader.
public final class LocalCursorReader {
    private let input: FileHandle
    private let lock = NSRecursiveLock()
    private var decoder: CursorEventLineDecoder
    private var generation: UInt64 = 0
    private var callback: ((CursorEvent) -> Void)?

    public init(input: FileHandle = .standardInput, maximumLineBytes: Int = 65_536) {
        self.input = input
        self.decoder = CursorEventLineDecoder(maximumLineBytes: maximumLineBytes)
    }

    public func start(callback: @escaping (CursorEvent) -> Void) {
        lock.withLock {
            stop()
            self.callback = callback
            let currentGeneration = generation
            input.readabilityHandler = { [weak self] handle in
                guard let self else { return }
                self.lock.withLock {
                    guard self.generation == currentGeneration else { return }
                    // Check generation BEFORE reading: a retired handler must
                    // not consume bytes intended for a restarted reader.
                    // POSIX read returns available pipe bytes; Foundation's
                    // read(upToCount:) can wait for the requested size or EOF.
                    var data = Data(count: 65_536)
                    let count = data.withUnsafeMutableBytes { Darwin.read(handle.fileDescriptor, $0.baseAddress!, $0.count) }
                    if count < 0 && errno == EINTR { return }
                    guard count > 0 else { self.stop(); return }
                    data.count = count
                    for event in self.decoder.append(data) {
                        guard self.generation == currentGeneration else { break }
                        self.callback?(event)
                    }
                }
            }
        }
    }

    public func stop() {
        lock.withLock {
            generation &+= 1
            input.readabilityHandler = nil
            callback = nil
            decoder.reset()
        }
    }

    deinit { input.readabilityHandler = nil }
}

/// Bounded framing for the local cursor pipe. Transport completion discards an
/// unfinished line; bytes from one connection must never become another event.
/// Semantic authority remains in CursorLeasePolicy and CursorStore, not here.
public struct CursorEventLineDecoder: Sendable {
    public let maximumLineBytes: Int
    public private(set) var bufferedByteCount = 0
    private var buffer = Data()
    private var discardingOversizedLine = false

    public init(maximumLineBytes: Int = 65_536) {
        precondition(maximumLineBytes > 0)
        self.maximumLineBytes = maximumLineBytes
    }

    /// Accept arbitrary byte chunks, including split UTF-8 scalars. Oversized
    /// records are discarded through their delimiter so their suffix cannot be
    /// mistaken for a fresh record, and retained memory stays bounded.
    public mutating func append(_ data: Data) -> [CursorEvent] {
        var events: [CursorEvent] = []
        for byte in data {
            if byte == 0x0A {
                if !discardingOversizedLine, !buffer.isEmpty,
                   let event = try? JSONDecoder().decode(CursorEvent.self, from: buffer) {
                    events.append(event)
                }
                buffer.removeAll(keepingCapacity: true)
                discardingOversizedLine = false
            } else if !discardingOversizedLine {
                if buffer.count == maximumLineBytes {
                    buffer.removeAll(keepingCapacity: false)
                    discardingOversizedLine = true
                } else {
                    buffer.append(byte)
                }
            }
        }
        bufferedByteCount = buffer.count
        return events
    }

    /// End this transport generation, releasing partial JSON and its capacity.
    public mutating func reset() {
        buffer = Data()
        bufferedByteCount = 0
        discardingOversizedLine = false
    }
}
