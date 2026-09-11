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
    private var sessions: [ObjectIdentifier: URLSession] = [:]

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
        defer { lock.unlock() }
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

    func track(_ session: URLSession) {
        lock.lock()
        sessions[ObjectIdentifier(session)] = session
        lock.unlock()
    }

    /// Latch first; persist HALT before hooks.disabled; never erase existing
    /// operator text. Each inode and its directory are synced before success.
    /// Partial persistence is returned honestly, and no failed write rearms us.
    func persistOff() -> [String] {
        lock.lock()
        latchedReason = "Local Off was requested. This app will not restart Port Daddy."
        let activeSessions = Array(sessions.values)
        lock.unlock()
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
        // This cancels this app's known transport tasks, not external processes.
        for session in activeSessions { session.getAllTasks { $0.forEach { $0.cancel() } } }
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
        control.track(self)
        try control.requireEnabled()
        let result = try await data(for: request)
        try control.requireEnabled()
        return result
    }

    func pdData(from url: URL, control: LocalRuntimeControl = .shared) async throws -> (Data, URLResponse) {
        try await pdData(for: URLRequest(url: url), control: control)
    }

    func pdBytes(from url: URL, control: LocalRuntimeControl = .shared) async throws -> (URLSession.AsyncBytes, URLResponse) {
        control.track(self)
        try control.requireEnabled()
        let result = try await bytes(from: url)
        try control.requireEnabled()
        return result
    }
}

extension Process {
    /// Every normal child process uses the same admission decision. The dedicated
    /// stop-only shutdown runner is deliberately the sole exception.
    func pdRun(control: LocalRuntimeControl = .shared) throws {
        try control.requireEnabled()
        try run()
    }
}
