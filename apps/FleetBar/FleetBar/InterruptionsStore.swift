import SwiftUI
import Foundation
import Security
@preconcurrency import UserNotifications

// MARK: - HITL operator interruptions (docs/hitl-interruptions.md §4, surface 1)
//
// FleetBar is a mandatory HITL surface: it polls the RELAY (not the local
// daemon) for the signed-in operator's open interruptions and surfaces them
// within 60 seconds. The contract this file implements:
//
//   1. Exchange the Keychain-held operator bearer for a short-lived read-only
//      capability, then poll GET /v1/interruptions?state=open with that
//      capability at interval ≤ 30 s with FULL JITTER (never a fixed offset).
//   2. Surface within 60 s: badge count + item list (title, urgency, source
//      agent, age; red for high/critical).
//   3. While a `critical` ask is open, spawn actions are disabled with the
//      ask's title as the reason (see criticalSpawnBlockTitle).
//   4. Answer/ack deep-links to /account/interruptions in the browser —
//      NEVER in-app. Answer/ack is session-gated by design; a bearer token
//      must never be able to silence its own escalations, so this store has
//      no answer or ack method at all.
//   5. Never fabricate: before the first successful poll — and after any
//      failed poll — the status is "unknown", never "all clear".

/// Urgency of an operator ask, mirroring the relay's enum. Unknown strings
/// decode as `.normal` so a newer relay never breaks rendering.
enum InterruptionUrgency: String, Equatable, CaseIterable, Sendable {
    case low
    case normal
    case high
    case critical

    /// high/critical must be visually loud (red) per the UI contract.
    var isLoud: Bool { self == .high || self == .critical }

    /// Uppercase eyebrow tag text.
    var label: String { rawValue.uppercased() }

    var color: Color {
        switch self {
        case .critical, .high: return Fleet.Color.failure
        case .normal:          return Fleet.Color.active
        case .low:             return Fleet.Color.dormant
        }
    }
}

/// One open ask, as the relay publicShape returns it (camelCase keys,
/// createdAt in epoch SECONDS).
struct OperatorInterruption: Decodable, Identifiable, Equatable, Sendable {
    let id: String
    let title: String
    let body: String
    let urgency: InterruptionUrgency
    let state: String
    let sourceAgent: String
    let createdAt: Double

    enum CodingKeys: String, CodingKey {
        case id, title, body, urgency, state, sourceAgent, createdAt
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        title = try container.decode(String.self, forKey: .title)
        body = (try container.decodeIfPresent(String.self, forKey: .body)) ?? ""
        let rawUrgency = (try container.decodeIfPresent(String.self, forKey: .urgency)) ?? "normal"
        urgency = InterruptionUrgency(rawValue: rawUrgency) ?? .normal
        state = (try container.decodeIfPresent(String.self, forKey: .state)) ?? "open"
        sourceAgent = (try container.decodeIfPresent(String.self, forKey: .sourceAgent)) ?? "unknown agent"
        createdAt = (try container.decodeIfPresent(Double.self, forKey: .createdAt)) ?? 0
    }

    /// Direct memberwise initializer for tests / previews.
    init(id: String, title: String, body: String = "", urgency: InterruptionUrgency,
         state: String = "open", sourceAgent: String, createdAt: Double) {
        self.id = id
        self.title = title
        self.body = body
        self.urgency = urgency
        self.state = state
        self.sourceAgent = sourceAgent
        self.createdAt = createdAt
    }

    /// Compact age like 45s, 12m, 3h, 2d. createdAt is epoch seconds.
    func age(now: Date = Date()) -> String {
        let seconds = max(0, now.timeIntervalSince1970 - createdAt)
        if seconds < 60 { return "\(Int(seconds))s" }
        if seconds < 3600 { return "\(Int(seconds / 60))m" }
        if seconds < 86_400 { return "\(Int(seconds / 3600))h" }
        return "\(Int(seconds / 86_400))d"
    }
}

/// The operator credential minted by the device flow. Non-secret metadata is
/// stored in account.json; the bearer is held by the macOS Keychain.
struct OperatorAccount: Equatable {
    let token: String
    let relayUrl: String
    let login: String?
}

enum OperatorAccountFile {
    /// Same default as the CLI account command.
    static let defaultRelay = "https://relay.portdaddy.dev"
    static let keychainService = "port-daddy"
    static let keychainAccount = "relay-operator-account-bearer-v1"

    static var accountURL: URL {
        FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent(".port-daddy", isDirectory: true)
            .appendingPathComponent("account.json", isDirectory: false)
    }

    static func load(
        from url: URL = accountURL,
        environment: [String: String] = ProcessInfo.processInfo.environment,
        loadSecret: () -> String? = loadKeychainBearer
    ) -> OperatorAccount? {
        guard let data = try? Data(contentsOf: url),
              let raw = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              Set(raw.keys) == Set(["createdAt", "login", "relayUrl"]),
              let login = raw["login"] as? String,
              let storedRelay = raw["relayUrl"] as? String,
              !storedRelay.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              let createdAt = raw["createdAt"] as? NSNumber,
              createdAt.doubleValue >= 0,
              let loadedSecret = loadSecret(),
              let tokenData = Data(base64Encoded: loadedSecret),
              let decodedToken = String(data: tokenData, encoding: .utf8),
              let token = Optional(decodedToken.trimmingCharacters(in: .whitespacesAndNewlines)),
              !token.isEmpty
        else { return nil }

        // PD_ACCOUNTS_RELAY_URL overrides, exactly like the CLI.
        let envRelay = environment["PD_ACCOUNTS_RELAY_URL"]?
            .trimmingCharacters(in: .whitespacesAndNewlines)
        var relay = (envRelay?.isEmpty == false ? envRelay! : storedRelay)
        while relay.hasSuffix("/") { relay.removeLast() }
        guard !relay.isEmpty else { return nil }
        return OperatorAccount(token: token, relayUrl: relay, login: login)
    }

    /// Native Keychain read. The shared Node account store intentionally saves
    /// a base64-wrapped UTF-8 value; decoding happens in `load`, after strict
    /// account metadata validation. No plaintext-file or environment fallback.
    static func loadKeychainBearer() -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: keychainService,
            kSecAttrAccount as String: keychainAccount,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var result: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
              let data = result as? Data,
              let encoded = String(data: data, encoding: .utf8),
              !encoded.isEmpty
        else { return nil }
        return encoded
    }
}

private struct OperatorInterruptionReadGrant: Decodable {
    let macaroon: String
    let verb: String
    let userId: String
    let expiresAt: Double
}

@MainActor
protocol InterruptionCapabilityClient: AnyObject {
    func readAllCapability(for account: OperatorAccount, using session: URLSession) async throws -> String
    func invalidate()
}

@MainActor
final class SystemInterruptionCapabilityClient: InterruptionCapabilityClient {
    private struct CachedGrant {
        let macaroon: String
        let account: OperatorAccount
        let expiresAt: Double
    }

    private let now: () -> Date
    private var cached: CachedGrant?

    init(now: @escaping () -> Date = Date.init) {
        self.now = now
    }

    func invalidate() {
        cached = nil
    }

    func readAllCapability(for account: OperatorAccount, using session: URLSession) async throws -> String {
        let nowMs = now().timeIntervalSince1970 * 1_000
        if let cached,
           cached.account == account,
           cached.expiresAt > nowMs + 15_000 {
            return cached.macaroon
        }

        guard let url = URL(string: "\(account.relayUrl)/v1/interruptions/grant") else {
            throw URLError(.badURL)
        }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.timeoutInterval = InterruptionsStore.requestTimeoutSeconds
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(account.token)", forHTTPHeaderField: "Authorization")
        request.httpBody = try JSONSerialization.data(withJSONObject: [
            "verb": "operator-interruption:read-all",
            "ttlSeconds": 300,
        ])

        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse,
              http.statusCode == 200 else {
            throw URLError(.userAuthenticationRequired)
        }
        let grant = try JSONDecoder().decode(OperatorInterruptionReadGrant.self, from: data)
        guard grant.verb == "operator-interruption:read-all",
              !grant.userId.isEmpty,
              !grant.macaroon.isEmpty,
              grant.expiresAt > nowMs else {
            throw URLError(.cannotParseResponse)
        }
        cached = CachedGrant(macaroon: grant.macaroon, account: account, expiresAt: grant.expiresAt)
        return grant.macaroon
    }
}

// MARK: - Store

enum InterruptionNotificationPreferences {
    static let scheduledIDsKey = "operator-interruptions.scheduled-ids.v2"
    static let alertsEnabledKey = "operator-interruptions.system-alerts-enabled.v1"
    static let soundsEnabledKey = "operator-interruptions.loud-sounds-enabled.v1"
}

enum InterruptionNotificationAuthorization: Equatable, Sendable {
    case notDetermined
    case denied
    case authorized
    case provisional

    var canSchedule: Bool { self == .authorized || self == .provisional }
}

/// Privacy boundary between Relay content and the macOS notification center.
/// The human must open FleetBar to see the actual title, body, source, session,
/// or answer. Notification previews may appear on a locked screen, so those
/// fields never enter this value.
struct InterruptionNotificationPlan: Equatable, Sendable {
    let identifier: String
    let title: String
    let subtitle: String
    let body: String
    let playSound: Bool

    static func make(for item: OperatorInterruption, soundsEnabled: Bool) -> Self {
        Self(
            identifier: "pd-operator-interruption-\(item.id)",
            title: "Port Daddy needs your attention",
            subtitle: "\(item.urgency.label) priority",
            body: "Open FleetBar to review the operator interruption.",
            playSound: soundsEnabled && item.urgency.isLoud
        )
    }
}

@MainActor
protocol InterruptionNotificationClient: AnyObject {
    func authorizationStatus() async -> InterruptionNotificationAuthorization
    func requestAuthorization() async throws -> Bool
    func schedule(_ plan: InterruptionNotificationPlan) async throws
}

@MainActor
final class SystemInterruptionNotificationClient: InterruptionNotificationClient {
    private let center: UNUserNotificationCenter

    init(center: UNUserNotificationCenter = .current()) {
        self.center = center
    }

    func authorizationStatus() async -> InterruptionNotificationAuthorization {
        await withCheckedContinuation { continuation in
            center.getNotificationSettings { settings in
                let status: InterruptionNotificationAuthorization
                switch settings.authorizationStatus {
                case .authorized:  status = .authorized
                case .provisional: status = .provisional
                case .denied:      status = .denied
                default:           status = .notDetermined
                }
                continuation.resume(returning: status)
            }
        }
    }

    func requestAuthorization() async throws -> Bool {
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Bool, Error>) in
            center.requestAuthorization(options: [.alert, .sound]) { allowed, error in
                if let error { continuation.resume(throwing: error) }
                else { continuation.resume(returning: allowed) }
            }
        }
    }

    func schedule(_ plan: InterruptionNotificationPlan) async throws {
        let content = UNMutableNotificationContent()
        content.title = plan.title
        content.subtitle = plan.subtitle
        content.body = plan.body
        if plan.playSound { content.sound = .default }
        let request = UNNotificationRequest(
            identifier: plan.identifier,
            content: content,
            trigger: nil
        )
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            center.add(request) { error in
                if let error { continuation.resume(throwing: error) }
                else { continuation.resume(returning: ()) }
            }
        }
    }
}

@MainActor
private final class InertInterruptionNotificationClient: InterruptionNotificationClient {
    func authorizationStatus() async -> InterruptionNotificationAuthorization { .notDetermined }
    func requestAuthorization() async throws -> Bool { false }
    func schedule(_ plan: InterruptionNotificationPlan) async throws {}
}

@MainActor
final class InterruptionsStore: ObservableObject {
    /// The honest tri-state. There is deliberately no way to express
    /// "all clear" without a successful poll backing it.
    enum Phase: Equatable {
        /// No successful poll backs the current picture (startup, network
        /// failure, non-200, rejected token). NEVER rendered as all-clear.
        case unknown(String)
        /// No complete metadata + Keychain account on this machine — status is
        /// unknowable until the operator signs in.
        case signedOut
        /// A successful poll returned these open asks (possibly zero — the
        /// only state allowed to claim the queue is empty).
        case open([OperatorInterruption])
    }

    @Published private(set) var phase: Phase = .unknown("No poll has completed yet.")
    @Published private(set) var account: OperatorAccount?
    @Published private(set) var lastPollAt: Date?
    @Published private(set) var consecutiveFailures = 0
    @Published private(set) var notificationAuthorization: InterruptionNotificationAuthorization = .notDetermined
    @Published private(set) var notificationError: String?
    @Published private(set) var systemAlertsEnabled: Bool
    @Published private(set) var soundsForLoudAsks: Bool

    /// Healthy poll ceiling — the contract requires 30 s or less, full jitter.
    static let pollBaseSeconds: TimeInterval = 30
    /// Failure backoff ceiling (matches the agent contract 10-minute cap).
    static let pollCapSeconds: TimeInterval = 600
    /// A slow relay counts as a failed poll, not an excuse to hang.
    static let requestTimeoutSeconds: TimeInterval = 10
    /// Failure count at which the backoff ceiling saturates; a rejected token
    /// parks at this level immediately (a 4xx never starts succeeding on its
    /// own, so re-probing fast is pure waste).
    static let parkedFailures = 5

    private let session: URLSession
    private let loadAccount: () -> OperatorAccount?
    private let capabilityClient: InterruptionCapabilityClient
    private let now: () -> Date
    private let notificationClient: InterruptionNotificationClient
    private let preferences: UserDefaults
    private let saveNotificationHistory: ([String]) -> Void
    private var isRefreshing = false
    private var reportedOpenCount: Int?
    private nonisolated(unsafe) var pollTask: Task<Void, Never>?
    private var notifiedIDs: Set<String>
    private var inFlightNotificationIDs: Set<String> = []
    private var notificationOrder: [String]

    init(
        autoStart: Bool = true,
        session: URLSession = .shared,
        loadAccount: @escaping () -> OperatorAccount? = { OperatorAccountFile.load() },
        capabilityClient: InterruptionCapabilityClient? = nil,
        now: @escaping () -> Date = Date.init,
        notificationClient: InterruptionNotificationClient? = nil,
        preferences: UserDefaults = .standard,
        loadNotificationHistory: @escaping () -> [String] = InterruptionsStore.loadNotificationHistory,
        saveNotificationHistory: @escaping ([String]) -> Void = InterruptionsStore.persistNotificationHistory
    ) {
        self.session = session
        self.loadAccount = loadAccount
        self.capabilityClient = capabilityClient ?? SystemInterruptionCapabilityClient(now: now)
        self.now = now
        self.notificationClient = notificationClient ?? SystemInterruptionNotificationClient()
        self.preferences = preferences
        // Opt in, never assume. An existing macOS authorization may belong to
        // an older FleetBar feature or install; it is not consent for this new
        // agent-interruption channel until the operator enables it here.
        self.systemAlertsEnabled = preferences.bool(
            forKey: InterruptionNotificationPreferences.alertsEnabledKey
        )
        self.soundsForLoudAsks = preferences.bool(
            forKey: InterruptionNotificationPreferences.soundsEnabledKey
        )
        let history = loadNotificationHistory()
        self.notificationOrder = history
        self.notifiedIDs = Set(history)
        self.saveNotificationHistory = saveNotificationHistory
        guard autoStart else { return }
        start()
    }

    deinit {
        pollTask?.cancel()
    }

    // MARK: Derived state

    var openItems: [OperatorInterruption] {
        if case .open(let items) = phase { return items }
        return []
    }

    /// nil when the count is not knowable (unknown / signed out) — a badge
    /// must render a question mark or nothing then, never 0.
    var openCount: Int? {
        if case .open(let items) = phase { return reportedOpenCount ?? items.count }
        return nil
    }

    var openCritical: OperatorInterruption? {
        openItems.first { $0.urgency == .critical }
    }

    var hasLoudOpenAsk: Bool {
        openItems.contains { $0.urgency.isLoud }
    }

    /// Non-nil while a critical ask is open: the title of the ask that blocks
    /// NEW dependent work (spawn approvals, run-agent). Contract clause 3.
    var criticalSpawnBlockTitle: String? {
        openCritical?.title
    }

    /// Where answer/ack happens: the session-gated web page. Never in-app.
    var answerPageURL: URL? {
        guard let account else { return nil }
        return URL(string: "\(account.relayUrl)/account/interruptions")
    }

    // MARK: Polling

    /// Full-jitter delay before the next poll: random(0, ceiling) where the
    /// ceiling is 30 s when healthy and min(600, 30 x 2^failures) after
    /// consecutive failures. Never a fixed offset.
    static func nextPollDelay(
        consecutiveFailures: Int,
        random: (ClosedRange<Double>) -> Double = { Double.random(in: $0) }
    ) -> TimeInterval {
        let exponent = min(max(0, consecutiveFailures), parkedFailures)
        let ceiling = min(pollCapSeconds, pollBaseSeconds * pow(2, Double(exponent)))
        return random(0...ceiling)
    }

    func start() {
        stop()
        // Optional native notifications must never delay the mandatory Relay
        // queue poll. This passive lookup runs independently and cannot prompt.
        Task { @MainActor [weak self] in
            await self?.refreshNotificationAuthorization()
        }
        pollTask = Task { @MainActor [weak self] in
            while !Task.isCancelled {
                guard let store = self else { return }
                await store.refresh()
                let delay = InterruptionsStore.nextPollDelay(
                    consecutiveFailures: store.consecutiveFailures
                )
                do {
                    try await Task.sleep(nanoseconds: UInt64(delay * 1_000_000_000))
                } catch {
                    return
                }
            }
        }
    }

    nonisolated func stop() {
        pollTask?.cancel()
        pollTask = nil
    }

    func refresh() async {
        guard !isRefreshing else { return }
        isRefreshing = true
        defer { isRefreshing = false }

        guard let account = loadAccount() else {
            self.account = nil
            capabilityClient.invalidate()
            phase = .signedOut
            reportedOpenCount = nil
            // Signed-out is not a relay failure; keep the base cadence so a
            // fresh sign-in is noticed within a poll interval.
            consecutiveFailures = 0
            return
        }
        self.account = account

        guard var components = URLComponents(string: "\(account.relayUrl)/v1/interruptions") else {
            consecutiveFailures += 1
            phase = .unknown("Invalid relay URL: \(account.relayUrl)")
            return
        }
        components.queryItems = [URLQueryItem(name: "state", value: "open")]
        guard let url = components.url else {
            consecutiveFailures += 1
            phase = .unknown("Invalid relay URL: \(account.relayUrl)")
            return
        }

        do {
            let capability = try await capabilityClient.readAllCapability(for: account, using: session)
            var request = URLRequest(url: url)
            request.timeoutInterval = Self.requestTimeoutSeconds
            request.setValue("Macaroon \(capability)", forHTTPHeaderField: "Authorization")
            let (data, response) = try await session.data(for: request)
            guard let http = response as? HTTPURLResponse else {
                consecutiveFailures += 1
                phase = .unknown("Relay unreachable.")
                reportedOpenCount = nil
                return
            }
            if http.statusCode == 401 || http.statusCode == 403 {
                capabilityClient.invalidate()
                // 4xx park: a rejected token never starts working on its own.
                // Saturate the backoff instead of hammering the relay, and say
                // exactly what the operator should do.
                consecutiveFailures = Self.parkedFailures
                phase = .unknown("Relay rejected the operator capability (HTTP \(http.statusCode)). Sign in again in FleetBar.")
                reportedOpenCount = nil
                return
            }
            guard http.statusCode == 200 else {
                consecutiveFailures += 1
                phase = .unknown("Interruptions poll failed (HTTP \(http.statusCode)).")
                reportedOpenCount = nil
                return
            }

            struct Envelope: Decodable {
                let openCount: Int
                let interruptions: [OperatorInterruption]
            }
            let envelope = try JSONDecoder().decode(Envelope.self, from: data)
            // Belt-and-braces: only ever surface rows that are actually open.
            let open = envelope.interruptions.filter { $0.state == "open" }
            // Prune only when this page is the complete open set. Relay caps
            // the visible page at 100 but reports an exact openCount; treating
            // a truncated page as complete would forget still-open hidden asks
            // and play their alert again after they return to the first page.
            if envelope.openCount == open.count {
                let openIDs = Set(open.map(\.id))
                let retainedOrder = notificationOrder.filter { openIDs.contains($0) }
                if retainedOrder != notificationOrder {
                    notificationOrder = retainedOrder
                    notifiedIDs = Set(retainedOrder)
                    saveNotificationHistory(retainedOrder)
                }
            }
            phase = .open(open)
            reportedOpenCount = max(0, envelope.openCount)
            consecutiveFailures = 0
            lastPollAt = now()
            await scheduleUnseenNotifications(from: open)
        } catch {
            consecutiveFailures += 1
            phase = .unknown("Interruptions poll failed: \(error.localizedDescription)")
            reportedOpenCount = nil
        }
    }

    func refreshNotificationAuthorization() async {
        notificationAuthorization = await notificationClient.authorizationStatus()
    }

    /// The only permission-prompt path. Background polling never invokes it.
    func requestNotificationPermission() async {
        notificationError = nil
        do {
            _ = try await notificationClient.requestAuthorization()
            await refreshNotificationAuthorization()
            if notificationAuthorization.canSchedule {
                systemAlertsEnabled = true
                soundsForLoudAsks = true
                preferences.set(true, forKey: InterruptionNotificationPreferences.alertsEnabledKey)
                preferences.set(true, forKey: InterruptionNotificationPreferences.soundsEnabledKey)
                await scheduleUnseenNotifications(from: openItems)
            }
        } catch {
            await refreshNotificationAuthorization()
            notificationError = "macOS could not enable notifications: \(error.localizedDescription)"
        }
    }

    func setSystemAlertsEnabled(_ enabled: Bool) {
        systemAlertsEnabled = enabled
        preferences.set(enabled, forKey: InterruptionNotificationPreferences.alertsEnabledKey)
        if enabled && notificationAuthorization.canSchedule {
            Task { @MainActor [weak self] in
                guard let self else { return }
                await self.scheduleUnseenNotifications(from: self.openItems)
            }
        }
    }

    func setSoundsForLoudAsks(_ enabled: Bool) {
        soundsForLoudAsks = enabled
        preferences.set(enabled, forKey: InterruptionNotificationPreferences.soundsEnabledKey)
    }

    private func scheduleUnseenNotifications(from items: [OperatorInterruption]) async {
        guard systemAlertsEnabled, notificationAuthorization.canSchedule else { return }
        for item in items where !notifiedIDs.contains(item.id) && !inFlightNotificationIDs.contains(item.id) {
            inFlightNotificationIDs.insert(item.id)
            let plan = InterruptionNotificationPlan.make(
                for: item,
                soundsEnabled: soundsForLoudAsks
            )
            do {
                try await notificationClient.schedule(plan)
                // A scheduling receipt is recorded only after macOS accepts the
                // request. It is not a claim that the human saw the alert.
                notifiedIDs.insert(item.id)
                notificationOrder.append(item.id)
                saveNotificationHistory(notificationOrder)
                notificationError = nil
            } catch {
                // Retry on the next poll; a failed schedule never creates a
                // false delivery receipt and never poisons Relay queue truth.
                notificationError = "macOS did not schedule an alert; FleetBar will retry."
            }
            inFlightNotificationIDs.remove(item.id)
        }
    }

    nonisolated static func loadNotificationHistory() -> [String] {
        UserDefaults.standard.stringArray(forKey: InterruptionNotificationPreferences.scheduledIDsKey) ?? []
    }

    nonisolated static func persistNotificationHistory(_ ids: [String]) {
        UserDefaults.standard.set(ids, forKey: InterruptionNotificationPreferences.scheduledIDsKey)
    }

    // MARK: Fixtures (tests + previews)

    /// Preview/test seam: a store pinned to a phase, never polling.
    static func fixture(
        phase: Phase,
        relayUrl: String = "https://relay.example"
    ) -> InterruptionsStore {
        let account = OperatorAccount(token: "pdu_fixture", relayUrl: relayUrl, login: "operator")
        let store = InterruptionsStore(
            autoStart: false,
            loadAccount: { account },
            notificationClient: InertInterruptionNotificationClient()
        )
        store.account = account
        store.phase = phase
        if case .open(let items) = phase { store.reportedOpenCount = items.count }
        return store
    }
}
