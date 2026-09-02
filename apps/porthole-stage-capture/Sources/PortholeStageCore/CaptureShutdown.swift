import Foundation

enum CaptureShutdownError: Error, Equatable, LocalizedError {
    case timedOut(String)

    var errorDescription: String? {
        switch self {
        case let .timedOut(phase):
            return "\(phase) did not acknowledge shutdown before the deadline. The local frame boundary is closed; system shutdown is unconfirmed."
        }
    }
}

/// One monotonic deadline is shared by stream stop and proof finalization.
/// Callback APIs may never reply: a task-group race would still wait for its
/// uncooperative child. This one-shot bridge retires late/duplicate callbacks
/// without keeping the caller (or its main-actor operation ticket) suspended.
struct CaptureShutdownDeadline: Sendable {
    let deadline: DispatchTime

    init(seconds: Double = 5) {
        precondition(seconds.isFinite && seconds > 0)
        deadline = .now() + seconds
    }

    func wait(phase: String, alwaysRequestCleanup: Bool = false,
              start: (@escaping @Sendable (Error?) -> Void) -> Void) async throws {
        let reply = ShutdownReply()
        try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { continuation in
                guard reply.install(continuation) else {
                    if alwaysRequestCleanup { start { _ in } }
                    return
                }
                guard DispatchTime.now() < deadline else {
                    if alwaysRequestCleanup { start { _ in } }
                    reply.resolve(.failure(CaptureShutdownError.timedOut(phase)))
                    return
                }
                let timer = DispatchWorkItem { reply.resolve(.failure(CaptureShutdownError.timedOut(phase))) }
                reply.install(timer)
                DispatchQueue.global(qos: .userInitiated).asyncAfter(deadline: deadline, execute: timer)
                start { error in
                    reply.resolve(error.map { .failure($0) } ?? .success(()))
                }
            }
        } onCancel: {
            reply.resolve(.failure(CancellationError()))
        }
    }
}

private final class ShutdownReply: @unchecked Sendable {
    private let lock = NSLock()
    private var result: Result<Void, Error>?
    private var continuation: CheckedContinuation<Void, Error>?
    private var timer: DispatchWorkItem?

    func install(_ continuation: CheckedContinuation<Void, Error>) -> Bool {
        let completed = lock.withLock { () -> Result<Void, Error>? in
            if let result { return result }
            self.continuation = continuation
            return nil
        }
        if let completed { continuation.resume(with: completed); return false }
        return true
    }

    func install(_ timer: DispatchWorkItem) {
        lock.withLock {
            if result != nil { timer.cancel() } else { self.timer = timer }
        }
    }

    func resolve(_ result: Result<Void, Error>) {
        let waiting = lock.withLock { () -> CheckedContinuation<Void, Error>? in
            guard self.result == nil else { return nil }
            self.result = result
            timer?.cancel()
            timer = nil
            defer { continuation = nil }
            return continuation
        }
        waiting?.resume(with: result)
    }
}
