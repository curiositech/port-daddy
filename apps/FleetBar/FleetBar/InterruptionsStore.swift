import SwiftUI
import Foundation

// MARK: - HITL operator interruptions (docs/hitl-interruptions.md §4, surface 1)
//
// FleetBar is a mandatory HITL surface: it polls the RELAY (not the local
// daemon) for the signed-in operator's open interruptions and surfaces them
// within 60 seconds. The contract this file implements:
//
//   1. Poll GET /v1/interruptions?state=open with the operator's pdu_ token,
//      interval ≤ 30 s with FULL JITTER (never a fixed offset).
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
enum InterruptionUrgency: String, Equatable, CaseIterable {
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
struct OperatorInterruption: Decodable, Identifiable, Equatable {
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

/// The operator credential minted by the device flow and stored locally by
/// the CLI (see cli/commands/account.ts). FleetBar reads it; it never mints
/// or refreshes tokens itself.
struct OperatorAccount: Equatable {
    let token: String
    let relayUrl: String
    let login: String?
}

enum OperatorAccountFile {
    /// Same default as the CLI account command.
    static let defaultRelay = "https://port-daddy-relay.erich-owens.workers.dev"

    static var accountURL: URL {
        FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent(".port-daddy", isDirectory: true)
            .appendingPathComponent("account.json", isDirectory: false)
    }

    static func load(
        from url: URL = accountURL,
        environment: [String: String] = ProcessInfo.processInfo.environment
    ) -> OperatorAccount? {
        struct Stored: Decodable {
            let token: String?
            let login: String?
            let relayUrl: String?
        }
        guard let data = try? Data(contentsOf: url),
              let stored = try? JSONDecoder().decode(Stored.self, from: data),
              let token = stored.token?.trimmingCharacters(in: .whitespacesAndNewlines),
              !token.isEmpty
        else { return nil }

        // PD_ACCOUNTS_RELAY_URL overrides, exactly like the CLI.
        let envRelay = environment["PD_ACCOUNTS_RELAY_URL"]?
            .trimmingCharacters(in: .whitespacesAndNewlines)
        var relay = (envRelay?.isEmpty == false ? envRelay! : (stored.relayUrl ?? defaultRelay))
        while relay.hasSuffix("/") { relay.removeLast() }
        return OperatorAccount(token: token, relayUrl: relay, login: stored.login)
    }
}

// MARK: - Store

@MainActor
final class InterruptionsStore: ObservableObject {
    /// The honest tri-state. There is deliberately no way to express
    /// "all clear" without a successful poll backing it.
    enum Phase: Equatable {
        /// No successful poll backs the current picture (startup, network
        /// failure, non-200, rejected token). NEVER rendered as all-clear.
        case unknown(String)
        /// No pdu_ token on this machine — status is unknowable until the
        /// operator signs in with the CLI.
        case signedOut
        /// A successful poll returned these open asks (possibly zero — the
        /// only state allowed to claim the queue is empty).
        case open([OperatorInterruption])
    }

    @Published private(set) var phase: Phase = .unknown("No poll has completed yet.")
    @Published private(set) var account: OperatorAccount?
    @Published private(set) var lastPollAt: Date?
    @Published private(set) var consecutiveFailures = 0

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
    private let now: () -> Date
    private var isRefreshing = false
    private nonisolated(unsafe) var pollTask: Task<Void, Never>?

    init(
        autoStart: Bool = true,
        session: URLSession = .shared,
        loadAccount: @escaping () -> OperatorAccount? = { OperatorAccountFile.load() },
        now: @escaping () -> Date = Date.init
    ) {
        self.session = session
        self.loadAccount = loadAccount
        self.now = now
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
        if case .open(let items) = phase { return items.count }
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
            phase = .signedOut
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

        var request = URLRequest(url: url)
        request.timeoutInterval = Self.requestTimeoutSeconds
        request.setValue("Bearer \(account.token)", forHTTPHeaderField: "Authorization")

        do {
            let (data, response) = try await session.data(for: request)
            guard let http = response as? HTTPURLResponse else {
                consecutiveFailures += 1
                phase = .unknown("Relay unreachable.")
                return
            }
            if http.statusCode == 401 || http.statusCode == 403 {
                // 4xx park: a rejected token never starts working on its own.
                // Saturate the backoff instead of hammering the relay, and say
                // exactly what the operator should do.
                consecutiveFailures = Self.parkedFailures
                phase = .unknown("Relay rejected the stored token (HTTP \(http.statusCode)). Sign in again with the pd CLI.")
                return
            }
            guard http.statusCode == 200 else {
                consecutiveFailures += 1
                phase = .unknown("Interruptions poll failed (HTTP \(http.statusCode)).")
                return
            }

            struct Envelope: Decodable {
                let interruptions: [OperatorInterruption]
            }
            let envelope = try JSONDecoder().decode(Envelope.self, from: data)
            // Belt-and-braces: only ever surface rows that are actually open.
            phase = .open(envelope.interruptions.filter { $0.state == "open" })
            consecutiveFailures = 0
            lastPollAt = now()
        } catch {
            consecutiveFailures += 1
            phase = .unknown("Interruptions poll failed: \(error.localizedDescription)")
        }
    }

    // MARK: Fixtures (tests + previews)

    /// Preview/test seam: a store pinned to a phase, never polling.
    static func fixture(
        phase: Phase,
        relayUrl: String = "https://relay.example"
    ) -> InterruptionsStore {
        let account = OperatorAccount(token: "pdu_fixture", relayUrl: relayUrl, login: "operator")
        let store = InterruptionsStore(autoStart: false, loadAccount: { account })
        store.account = account
        store.phase = phase
        return store
    }
}
