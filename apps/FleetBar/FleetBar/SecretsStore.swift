import SwiftUI
import AppKit
import Combine

// MARK: - Decodable Models
//
// Mirrors the daemon `/secrets` contract (loopback only) being built on
// branch feat/pd-secret-cli-and-routes:
//
//   GET    /secrets            -> { success, secrets: [{ key, backend, storage, encryptedAtRest, set }] }
//   POST   /secrets            -> { key, value, backend? }       (response never echoes value)
//   POST   /secrets/:key/reveal-> { success, key, value }        (only value-returning endpoint)
//   DELETE /secrets/:key
//
// The list endpoint returns names + status only. Values are NEVER persisted
// in this store and NEVER logged.

/// One secret's metadata as returned by `GET /secrets`. No value field — by design.
struct SecretSummary: Decodable, Identifiable, Equatable {
    let key: String
    let backend: String?
    let storage: SecretStorage
    let encryptedAtRest: Bool
    let set: Bool

    var id: String { key }

    enum CodingKeys: String, CodingKey {
        case key, backend, storage, encryptedAtRest, set
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        key = try container.decode(String.self, forKey: .key)
        backend = try container.decodeIfPresent(String.self, forKey: .backend)
        // storage may be absent or an unknown string; degrade gracefully.
        if let raw = try container.decodeIfPresent(String.self, forKey: .storage) {
            storage = SecretStorage(rawValue: raw) ?? .unknown
        } else {
            storage = .unknown
        }
        encryptedAtRest = (try container.decodeIfPresent(Bool.self, forKey: .encryptedAtRest)) ?? false
        set = (try container.decodeIfPresent(Bool.self, forKey: .set)) ?? false
    }

    /// Direct memberwise initializer for tests / previews.
    init(key: String, backend: String?, storage: SecretStorage, encryptedAtRest: Bool, set: Bool) {
        self.key = key
        self.backend = backend
        self.storage = storage
        self.encryptedAtRest = encryptedAtRest
        self.set = set
    }
}

/// Where a secret physically lives. Drives the storage badge + icon.
enum SecretStorage: String, Equatable {
    case keychain
    case plaintext
    case env
    case unknown

    var label: String {
        switch self {
        case .keychain:  return "Keychain"
        case .plaintext: return "Plaintext"
        case .env:       return "Env"
        case .unknown:   return "Unknown"
        }
    }

    /// SF Symbol — never an emoji.
    var icon: String {
        switch self {
        case .keychain:  return "key.fill"
        case .plaintext: return "doc.plaintext"
        case .env:       return "terminal"
        case .unknown:   return "questionmark.circle"
        }
    }

    /// Plaintext storage is a risk; surface it in warning tone.
    var isSensitive: Bool { self == .plaintext }
}

struct SecretsListResponse: Decodable {
    let success: Bool?
    let secrets: [SecretSummary]
}

struct SecretRevealResponse: Decodable {
    let success: Bool?
    let key: String
    let value: String
}

// MARK: - Mask Helper

enum SecretMask {
    /// The dots shown in place of a value. Fixed-width so length is never leaked.
    static let placeholder = "••••••••"

    /// Returns the masked representation for display. The real value is never
    /// returned here; callers pass `revealed` only when the operator has
    /// explicitly toggled Reveal on.
    static func display(value: String?, revealed: Bool) -> String {
        if revealed, let value, !value.isEmpty {
            return value
        }
        return placeholder
    }
}

// MARK: - Secrets Store

@MainActor
final class SecretsStore: ObservableObject {
    /// Names + status only. Never contains values.
    @Published var secrets: [SecretSummary] = []
    @Published var isLoading = false
    @Published var lastError: String?
    @Published var lastRefresh: Date?

    /// Keys whose value is currently revealed in the UI, mapped to the
    /// in-memory value. Cleared aggressively (toggle-off, timeout, blur).
    @Published private(set) var revealedValues: [String: String] = [:]

    /// Key currently held on the pasteboard by us, with the value we wrote and
    /// the deadline at which we auto-clear it. nil when nothing of ours is on
    /// the clipboard.
    @Published private(set) var clipboardHold: ClipboardHold?

    struct ClipboardHold: Equatable {
        let key: String
        let value: String
        let clearsAt: Date
        /// The NSPasteboard changeCount when we wrote, so we only clear if the
        /// pasteboard still holds OUR value (operator may have copied something else).
        let changeCount: Int
    }

    /// How long a copied secret lives on the clipboard before auto-clear.
    let clipboardTTL: TimeInterval
    /// How long a reveal stays visible before auto re-masking.
    let revealTTL: TimeInterval

    private let baseURL: String?
    private let session: URLSession
    private let pasteboard: SecretPasteboard
    private let now: () -> Date

    private nonisolated(unsafe) var clipboardTimer: Timer?
    private var revealTimers: [String: Timer] = [:]

    /// Nonisolated mirror of the active clipboard hold so `deinit` (which cannot
    /// touch MainActor state) can attempt a best-effort clear if a secret is
    /// still on the pasteboard when the store is torn down. Kept in lockstep
    /// with `clipboardHold`.
    private nonisolated(unsafe) var teardownHold: ClipboardHold?
    /// Nonisolated mirror of scheduled reveal-remask timers, so `deinit` can
    /// invalidate them without leaking. Kept in lockstep with `revealTimers`.
    private nonisolated(unsafe) var teardownRevealTimers: [Timer] = []

    init(
        autoStart: Bool = true,
        baseURL: String? = nil,
        session: URLSession = .shared,
        pasteboard: SecretPasteboard = SystemPasteboard(),
        clipboardTTL: TimeInterval = 45,
        revealTTL: TimeInterval = 30,
        now: @escaping () -> Date = Date.init
    ) {
        self.baseURL = baseURL ?? DaemonLocation.availableBaseURL()
        self.session = session
        self.pasteboard = pasteboard
        self.clipboardTTL = clipboardTTL
        self.revealTTL = revealTTL
        self.now = now

        guard autoStart else { return }
        Task { await refresh() }
    }

    deinit {
        // Invalidate every scheduled timer so nothing fires against a dead store.
        clipboardTimer?.invalidate()
        for timer in teardownRevealTimers { timer.invalidate() }

        // Best-effort: if a secret WE wrote is still on the pasteboard, clear it.
        // Only clear when both the changeCount matches and the exact value is
        // still present, so we never clobber something the operator copied
        // afterward. In-memory revealed values are class-local and released with
        // the store; the clipboard is the one place a secret can outlive us.
        if let hold = teardownHold,
           pasteboard.changeCount == hold.changeCount,
           pasteboard.currentString == hold.value {
            pasteboard.clear()
        }
    }

    // MARK: - Fetch

    func refresh() async {
        isLoading = true
        defer { isLoading = false }

        guard let baseURL, let url = URL(string: "\(baseURL)/secrets") else {
            lastError = "Invalid daemon URL"
            return
        }
        do {
            let (data, response) = try await session.data(from: url)
            guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
                lastError = "Could not load secrets"
                return
            }
            let decoded = try JSONDecoder().decode(SecretsListResponse.self, from: data)
            secrets = decoded.secrets.sorted { $0.key.localizedCaseInsensitiveCompare($1.key) == .orderedAscending }
            lastError = nil
            lastRefresh = now()
        } catch {
            // Never include a value here — there is none in the list payload,
            // but keep the message generic regardless.
            lastError = "Could not load secrets"
        }
    }

    /// Decodes a list payload (used by tests and by `refresh`). Pure, no I/O.
    static func decodeList(_ data: Data) throws -> [SecretSummary] {
        try JSONDecoder().decode(SecretsListResponse.self, from: data).secrets
    }

    // MARK: - Reveal

    /// Calls `POST /secrets/:key/reveal` and surfaces the value in-memory.
    /// Auto re-masks after `revealTTL`.
    func reveal(_ key: String) async {
        guard let url = revealURL(for: key) else {
            lastError = "Invalid secret key"
            return
        }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = "{}".data(using: .utf8)

        do {
            let (data, response) = try await session.data(for: request)
            guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
                lastError = "Reveal failed for \(key)"
                return
            }
            let decoded = try JSONDecoder().decode(SecretRevealResponse.self, from: data)
            revealedValues[decoded.key] = decoded.value
            lastError = nil
            scheduleRemask(for: decoded.key)
        } catch {
            lastError = "Reveal failed for \(key)"
        }
    }

    func isRevealed(_ key: String) -> Bool {
        revealedValues[key] != nil
    }

    /// Hide a single revealed value and cancel its re-mask timer.
    func hide(_ key: String) {
        revealedValues[key] = nil
        revealTimers[key]?.invalidate()
        revealTimers[key] = nil
        syncTeardownRevealTimers()
    }

    /// Clear every revealed value. Called on app blur / popover close.
    func hideAll() {
        for (_, timer) in revealTimers { timer.invalidate() }
        revealTimers.removeAll()
        revealedValues.removeAll()
        syncTeardownRevealTimers()
    }

    private func scheduleRemask(for key: String) {
        revealTimers[key]?.invalidate()
        let timer = Timer.scheduledTimer(withTimeInterval: revealTTL, repeats: false) { [weak self] _ in
            Task { @MainActor [weak self] in
                self?.hide(key)
            }
        }
        revealTimers[key] = timer
        syncTeardownRevealTimers()
    }

    /// Mirror the live reveal timers into the nonisolated array so `deinit` can
    /// invalidate them without touching MainActor state.
    private func syncTeardownRevealTimers() {
        teardownRevealTimers = Array(revealTimers.values)
    }

    // MARK: - Copy with auto-clear

    /// Reveals (if needed) then copies the value to the pasteboard and starts a
    /// countdown that clears it after `clipboardTTL`. The clipboard is only
    /// cleared if it still holds OUR value (changeCount match), so we never
    /// stomp something the operator copied afterward.
    func copyToClipboard(_ key: String) async {
        let value: String
        if let cached = revealedValues[key] {
            value = cached
        } else {
            await reveal(key)
            guard let fetched = revealedValues[key] else { return }
            value = fetched
        }

        let changeCount = pasteboard.write(value)
        let hold = ClipboardHold(
            key: key,
            value: value,
            clearsAt: now().addingTimeInterval(clipboardTTL),
            changeCount: changeCount
        )
        clipboardHold = hold
        teardownHold = hold
        scheduleClipboardClear()
    }

    /// Seconds remaining before the held clipboard value auto-clears, or nil.
    var clipboardSecondsRemaining: Int? {
        guard let hold = clipboardHold else { return nil }
        return max(0, Int(hold.clearsAt.timeIntervalSince(now()).rounded(.up)))
    }

    private func scheduleClipboardClear() {
        clipboardTimer?.invalidate()
        clipboardTimer = Timer.scheduledTimer(withTimeInterval: clipboardTTL, repeats: false) { [weak self] _ in
            Task { @MainActor [weak self] in
                self?.clearClipboardIfOurs()
            }
        }
    }

    /// Clears the pasteboard only if it still holds the exact value we wrote.
    /// Safe to call eagerly (blur, manual clear, timeout).
    @discardableResult
    func clearClipboardIfOurs() -> Bool {
        clipboardTimer?.invalidate()
        clipboardTimer = nil
        guard let hold = clipboardHold else { return false }
        clipboardHold = nil
        teardownHold = nil

        // Only clear if the pasteboard is unchanged since our write AND still
        // contains our exact value. Either guard alone can yield a false
        // positive (changeCount wraps; identical strings) so require both.
        let unchanged = pasteboard.changeCount == hold.changeCount
        let stillOurs = pasteboard.currentString == hold.value
        if unchanged && stillOurs {
            pasteboard.clear()
            return true
        }
        return false
    }

    // MARK: - Set / Delete

    /// `POST /secrets` with `{ key, value, backend? }`. The value is sent once
    /// and never retained. Returns true on 2xx.
    @discardableResult
    func setSecret(key: String, value: String, backend: String? = nil) async -> Bool {
        guard let baseURL, let url = URL(string: "\(baseURL)/secrets") else {
            lastError = "Invalid daemon URL"
            return false
        }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        var payload: [String: String] = ["key": key, "value": value]
        if let backend, !backend.isEmpty { payload["backend"] = backend }
        // Encode explicitly: a silent `try?` failure would POST an empty body,
        // the daemon would reject it, and the user would see no reason why.
        // A typed [String: String] payload is always JSON-serializable, but we
        // surface any encoding failure rather than swallowing it.
        do {
            request.httpBody = try JSONEncoder().encode(payload)
        } catch {
            lastError = "Could not save \(key): invalid value"
            return false
        }

        do {
            let (_, response) = try await session.data(for: request)
            guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
                lastError = "Could not save \(key)"
                return false
            }
            lastError = nil
            await refresh()
            return true
        } catch {
            lastError = "Could not save \(key)"
            return false
        }
    }

    /// `DELETE /secrets/:key`. Clears any revealed value + our clipboard hold
    /// for that key. Returns true on 2xx.
    @discardableResult
    func deleteSecret(key: String) async -> Bool {
        guard let url = secretURL(for: key) else {
            lastError = "Invalid secret key"
            return false
        }
        var request = URLRequest(url: url)
        request.httpMethod = "DELETE"

        do {
            let (_, response) = try await session.data(for: request)
            guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
                lastError = "Could not delete \(key)"
                return false
            }
            hide(key)
            if clipboardHold?.key == key { clearClipboardIfOurs() }
            lastError = nil
            await refresh()
            return true
        } catch {
            lastError = "Could not delete \(key)"
            return false
        }
    }

    // MARK: - URL helpers

    private func encodeKey(_ key: String) -> String? {
        var allowed = CharacterSet.urlPathAllowed
        allowed.remove(charactersIn: "/")
        return key.addingPercentEncoding(withAllowedCharacters: allowed)
    }

    private func secretURL(for key: String) -> URL? {
        guard let baseURL, let encoded = encodeKey(key) else { return nil }
        return URL(string: "\(baseURL)/secrets/\(encoded)")
    }

    private func revealURL(for key: String) -> URL? {
        guard let baseURL, let encoded = encodeKey(key) else { return nil }
        return URL(string: "\(baseURL)/secrets/\(encoded)/reveal")
    }
}

// MARK: - Pasteboard abstraction
//
// Wrapping NSPasteboard lets us unit-test the auto-clear logic deterministically
// without touching the real system clipboard.

protocol SecretPasteboard: Sendable {
    /// Writes the string and returns the resulting changeCount.
    func write(_ string: String) -> Int
    var changeCount: Int { get }
    var currentString: String? { get }
    func clear()
}

struct SystemPasteboard: SecretPasteboard {
    // No stored state: NSPasteboard.general is a process-global singleton, so
    // this struct is trivially Sendable. Accessing it from `deinit` is sound.
    private var board: NSPasteboard { .general }

    func write(_ string: String) -> Int {
        board.clearContents()
        board.setString(string, forType: .string)
        return board.changeCount
    }

    var changeCount: Int { board.changeCount }
    var currentString: String? { board.string(forType: .string) }

    func clear() {
        board.clearContents()
        // Overwrite with an empty string so a paste yields nothing rather than
        // surfacing stale OS clipboard history in some apps.
        board.setString("", forType: .string)
    }
}
