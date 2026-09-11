import Foundation
import Darwin

/// A filesystem-only stop latch. No daemon discovery, credentials, network or CLI.
/// Removing a marker never rearms an already-stopped app instance. This is a
/// cooperative admission control, not a sandbox against arbitrary same-user code.
final class LocalRuntimeControl: @unchecked Sendable {
    static let shared = LocalRuntimeControl(
        canonicalRoot: FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".port-daddy"),
        environment: ProcessInfo.processInfo.environment
    )

    let canonicalRoot: URL
    private let selectedRoot: URL
    private let customHalt: String?
    private let lock = NSLock()
    private var latchedReason: String?
    private var effects: [UUID: @Sendable () -> Void] = [:]
    private var monitor: DispatchSourceTimer?

    init(canonicalRoot: URL, environment: [String: String] = [:]) {
        self.canonicalRoot = canonicalRoot
        self.selectedRoot = environment["PD_HOME"].map { URL(fileURLWithPath: $0) } ?? canonicalRoot
        self.customHalt = environment["PD_HALT_FILE"]
        if let root = environment["PD_HOME"], !root.hasPrefix("/") {
            latchedReason = "The selected runtime control path is not absolute. Local starts are blocked."
        }
    }

    var blockedReason: String? {
        lock.lock()
        let reason = inspectLocked()
        let cancellations = reason == nil ? [] : drainLocked()
        lock.unlock()
        cancellations.forEach { $0() }
        return reason
    }

    /// Caller holds the admission lock. Observation and explicit Off share the
    /// same latch; observing another app's marker must also cancel active work.
    private func inspectLocked() -> String? {
        if let latchedReason { return latchedReason }
        let reason = Self.inspect(root: canonicalRoot) ?? Self.inspect(root: selectedRoot)
            ?? customHalt.flatMap { path in
                guard path.hasPrefix("/") else { return "The custom halt path is not absolute." }
                let marker = URL(fileURLWithPath: path)
                guard Self.accessibleDirectory(marker.deletingLastPathComponent()) else {
                    return "The custom halt directory cannot be verified."
                }
                return Self.markerReason(marker)
            }
        if let reason { latchedReason = reason }
        return reason
    }

    func requireEnabled() throws {
        if let reason = blockedReason { throw ControlError(reason) }
    }

    /// Register cancellation and synchronously create/start the effect in one
    /// critical section. Explicit Off can precede this admission or cancel the
    /// registered effect after it, never miss an in-between task snapshot.
    /// This is in-process ordering, not atomicity with another process's file write.
    func admit(id: UUID, cancel: @escaping @Sendable () -> Void, start: () throws -> Void) throws {
        lock.lock()
        if let reason = inspectLocked() {
            let cancellations = drainLocked()
            lock.unlock()
            cancellations.forEach { $0() }
            throw ControlError(reason)
        }
        defer { lock.unlock() }
        effects[id] = cancel
        do { try start() }
        catch { effects.removeValue(forKey: id); throw error }
        if monitor == nil {
            let timer = DispatchSource.makeTimerSource(queue: DispatchQueue.global(qos: .utility))
            timer.schedule(deadline: .now() + .milliseconds(100), repeating: .milliseconds(100))
            timer.setEventHandler { [weak self] in _ = self?.blockedReason }
            monitor = timer
            timer.resume()
        }
    }

    func finish(_ id: UUID) {
        lock.lock()
        effects.removeValue(forKey: id)
        if effects.isEmpty { monitor?.cancel(); monitor = nil }
        lock.unlock()
    }

    private func drainLocked() -> [@Sendable () -> Void] {
        let cancellations = Array(effects.values)
        effects.removeAll()
        monitor?.cancel()
        monitor = nil
        return cancellations
    }

    deinit { monitor?.cancel() }

    /// Latch first; persist HALT before hooks.disabled; never erase existing
    /// operator text. Each inode and its directory are synced before success.
    /// Partial persistence is returned honestly, and no failed write rearms us.
    func persistOff() -> [String] {
        lock.lock()
        latchedReason = "Local Off was requested. This app will not restart Port Daddy."
        let cancellations = drainLocked()
        lock.unlock()
        // Do not wait for disk persistence before cancelling this app's work.
        cancellations.forEach { $0() }
        var failures: [String] = []
        do {
            try Self.prepareDirectory(canonicalRoot)
            for name in ["HALT", "hooks.disabled"] {
                do { try Self.persistMarker(name, in: canonicalRoot) }
                catch { failures.append("Could not durably save \(name): \(error.localizedDescription)") }
            }
        } catch {
            failures.append("Could not save local Off: \(error.localizedDescription)")
        }
        return failures
    }

    private static func inspect(root: URL) -> String? {
        var metadata = stat()
        if lstat(root.path, &metadata) != 0 {
            if errno == ENOENT && accessibleDirectory(root.deletingLastPathComponent()) { return nil }
            return "Local control state is unavailable. Local starts are blocked."
        }
        guard accessibleDirectory(root) else { return "Local control directory cannot be verified." }
        return markerReason(root.appendingPathComponent("HALT"))
            ?? markerReason(root.appendingPathComponent("hooks.disabled"))
    }

    private static func accessibleDirectory(_ url: URL) -> Bool {
        var metadata = stat()
        return lstat(url.path, &metadata) == 0 && metadata.st_mode & S_IFMT == S_IFDIR
            && access(url.path, R_OK | X_OK) == 0
    }

    private static func markerReason(_ url: URL) -> String? {
        var metadata = stat()
        if lstat(url.path, &metadata) == 0 { return "Local Off is set (\(url.lastPathComponent))." }
        return errno == ENOENT ? nil : "Local stop state cannot be verified."
    }

    private static func prepareDirectory(_ root: URL) throws {
        // Do not create arbitrary parent chains or follow a substituted control root.
        if mkdir(root.path, 0o700) != 0 && errno != EEXIST { throw posixError() }
        guard accessibleDirectory(root) else { throw ControlError("Control directory is inaccessible or a symbolic link.") }
        let parent = open(root.deletingLastPathComponent().path, O_RDONLY | O_DIRECTORY | O_NOFOLLOW)
        guard parent >= 0 else { throw posixError() }
        defer { close(parent) }
        guard fsync(parent) == 0 else { throw posixError() }
    }

    private static func persistMarker(_ name: String, in root: URL) throws {
        let directory = open(root.path, O_RDONLY | O_DIRECTORY | O_NOFOLLOW)
        guard directory >= 0 else { throw posixError() }
        defer { close(directory) }
        var descriptor = openat(directory, name, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW, 0o600)
        if descriptor < 0 && errno == EEXIST {
            // Existing marker means stop, but don't claim durable persistence of
            // a symlink, directory, device or unreadable file.
            descriptor = openat(directory, name, O_RDONLY | O_NOFOLLOW | O_NONBLOCK)
        }
        guard descriptor >= 0 else { throw posixError() }
        defer { close(descriptor) }
        var metadata = stat()
        guard fstat(descriptor, &metadata) == 0, metadata.st_mode & S_IFMT == S_IFREG else {
            throw ControlError("Existing stop marker is not a regular file.")
        }
        // Presence is the existing protocol. Empty newly-created markers avoid
        // inventing a signed distress record; existing contents remain untouched.
        guard fsync(descriptor) == 0, fsync(directory) == 0 else { throw posixError() }
    }

    private static func posixError() -> NSError { NSError(domain: NSPOSIXErrorDomain, code: Int(errno)) }
    struct ControlError: LocalizedError {
        let message: String
        init(_ message: String) { self.message = message }
        var errorDescription: String? { message }
    }
}

/// All FleetBar URLSession traffic enters here, including injected sessions.
/// Recheck after suspension so a completed response cannot silently restore live
/// UI truth after Off. Already-issued remote effects cannot be recalled.
extension URLSession {
    func pdData(for request: URLRequest, control: LocalRuntimeControl = .shared) async throws -> (Data, URLResponse) {
        let cancellation = LocalRequestCancellation()
        let id = UUID()
        let result: (Data, URLResponse) = try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { continuation in
                do {
                    try control.admit(id: id, cancel: { cancellation.cancel() }) {
                        try cancellation.start {
                            dataTask(with: request) { data, response, error in
                                control.finish(id)
                                if let error { continuation.resume(throwing: error) }
                                else if let data, let response { continuation.resume(returning: (data, response)) }
                                else { continuation.resume(throwing: URLError(.badServerResponse)) }
                            }
                        }
                    }
                } catch { continuation.resume(throwing: error) }
            }
        } onCancel: { cancellation.cancel() }
        try control.requireEnabled()
        return result
    }

    func pdData(from url: URL, control: LocalRuntimeControl = .shared) async throws -> (Data, URLResponse) {
        try await pdData(for: URLRequest(url: url), control: control)
    }

}

extension Process {
    /// Every normal child process uses the same admission decision. The dedicated
    /// stop-only shutdown runner is deliberately the sole exception.
    func pdRun(control: LocalRuntimeControl = .shared) throws {
        let id = UUID()
        let previousHandler = terminationHandler
        terminationHandler = { process in
            control.finish(id)
            previousHandler?(process)
        }
        do {
            try control.admit(id: id, cancel: { [self] in
                if isRunning { terminate() }
            }) { try run() }
        } catch {
            terminationHandler = previousHandler
            throw error
        }
    }
}

/// Swift cancellation can happen before a URLSession task exists. Remember it,
/// so that installing a task cannot resurrect an already-cancelled request.
final class LocalRequestCancellation: @unchecked Sendable {
    private let lock = NSLock()
    private var task: URLSessionTask?
    private var cancelled = false
    func start(_ makeTask: () -> URLSessionTask) throws {
        lock.lock()
        defer { lock.unlock() }
        guard !cancelled else { throw CancellationError() }
        let task = makeTask()
        self.task = task
        task.resume()
    }
    func cancel() {
        lock.lock()
        cancelled = true
        let active = task
        lock.unlock()
        active?.cancel()
    }
}
