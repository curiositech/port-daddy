import Foundation

/// A bounded SSE line sequence with an Off check before and after every await.
/// The task owner cancels transport when the caller drops the stream, including
/// an early return after a non-200 response. Buffered events never bypass Off.
struct LocalResponseLines: AsyncSequence, Sendable {
    typealias Element = String
    fileprivate let stream: AsyncThrowingStream<String, Error>
    fileprivate let control: LocalRuntimeControl
    fileprivate let owner: Owner

    fileprivate final class Owner: @unchecked Sendable {
        let cancellation: LocalRequestCancellation
        init(_ cancellation: LocalRequestCancellation) { self.cancellation = cancellation }
        deinit { cancellation.cancel() }
    }

    struct AsyncIterator: AsyncIteratorProtocol {
        fileprivate var iterator: AsyncThrowingStream<String, Error>.Iterator
        fileprivate let control: LocalRuntimeControl
        fileprivate let owner: Owner
        mutating func next() async throws -> String? {
            try control.requireEnabled()
            let line = try await iterator.next()
            try control.requireEnabled()
            return line
        }
    }

    func makeAsyncIterator() -> AsyncIterator {
        AsyncIterator(iterator: stream.makeAsyncIterator(), control: control, owner: owner)
    }
}

extension URLSession {
    /// Explicit suspended task creation, registration and resume share the Off
    /// lock. Foundation's async bytes convenience hides that admission point.
    /// See https://developer.apple.com/documentation/foundation/urlsessiontask/delegate
    func pdLines(from url: URL, control: LocalRuntimeControl = .shared) async throws -> (LocalResponseLines, URLResponse) {
        let cancellation = LocalRequestCancellation()
        let id = UUID()
        let pair = AsyncThrowingStream<String, Error>.makeStream(bufferingPolicy: .bufferingOldest(128))
        let delegate = LocalLineDelegate(control: control, id: id, output: pair.continuation)
        pair.continuation.onTermination = { _ in cancellation.cancel() }
        let response: URLResponse = try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { continuation in
                delegate.setResponseContinuation(continuation)
                do {
                    try control.admit(id: id, cancel: {
                        cancellation.cancel()
                        delegate.finish(LocalRuntimeControl.ControlError("Local Off cancelled the stream."))
                    }) {
                        try cancellation.start {
                            let task = dataTask(with: url)
                            task.delegate = delegate
                            return task
                        }
                    }
                } catch { delegate.finish(error) }
            }
        } onCancel: {
            cancellation.cancel()
            delegate.finish(CancellationError())
        }
        do { try control.requireEnabled() }
        catch { cancellation.cancel(); throw error }
        return (LocalResponseLines(stream: pair.stream, control: control, owner: .init(cancellation)), response)
    }
}

/// URLSession serializes its delegate callbacks; the lock additionally orders
/// cancellation and initial-response delivery from other threads. A full queue
/// or an oversized single line closes the stream, never silently drops events.
private final class LocalLineDelegate: NSObject, URLSessionDataDelegate, @unchecked Sendable {
    private let lock = NSLock()
    private let control: LocalRuntimeControl
    private let id: UUID
    private let output: AsyncThrowingStream<String, Error>.Continuation
    private var response: CheckedContinuation<URLResponse, Error>?
    private var finished = false
    private var line = Data()
    private var skipLF = false

    init(control: LocalRuntimeControl, id: UUID, output: AsyncThrowingStream<String, Error>.Continuation) {
        self.control = control
        self.id = id
        self.output = output
    }

    func setResponseContinuation(_ continuation: CheckedContinuation<URLResponse, Error>) {
        lock.lock()
        let wasFinished = finished
        if !wasFinished { response = continuation }
        lock.unlock()
        if wasFinished { continuation.resume(throwing: CancellationError()) }
    }

    func finish(_ error: Error?) {
        lock.lock()
        guard !finished else { lock.unlock(); return }
        finished = true
        let pending = response
        response = nil
        lock.unlock()
        control.finish(id)
        pending?.resume(throwing: error ?? URLError(.badServerResponse))
        if let error { output.finish(throwing: error) }
        else { output.finish() }
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse,
                    completionHandler: @escaping @Sendable (URLSession.ResponseDisposition) -> Void) {
        do { try control.requireEnabled() }
        catch { finish(error); completionHandler(.cancel); return }
        lock.lock()
        let pending = self.response
        self.response = nil
        let wasFinished = finished
        lock.unlock()
        if wasFinished { completionHandler(.cancel); return }
        pending?.resume(returning: response)
        completionHandler(.allow)
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        do { try control.requireEnabled() }
        catch { finish(error); return }
        // Only delegate callbacks touch the partial line; Off only closes output.
        for byte in data {
            if skipLF { skipLF = false; if byte == 10 { continue } }
            if byte == 10 || byte == 13 {
                skipLF = byte == 13
                guard emitLine() else { return }
            } else {
                guard line.count < 1_048_576 else { finish(URLError(.dataLengthExceedsMaximum)); return }
                line.append(byte)
            }
        }
    }

    private func emitLine() -> Bool {
        let value = String(decoding: line, as: UTF8.self)
        line.removeAll(keepingCapacity: true)
        switch output.yield(value) {
        case .enqueued: return true
        case .dropped: finish(URLError(.dataLengthExceedsMaximum)); return false
        case .terminated: return false
        @unknown default: finish(URLError(.unknown)); return false
        }
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        if error == nil && !line.isEmpty { _ = emitLine() }
        finish(error)
    }
}
