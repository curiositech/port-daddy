import Foundation

struct CloudFleetRun: Decodable, Identifiable, Equatable {
    let id: String
    let deliveryId: String?
    let repo: String
    let prNumber: Int
    let prUrl: String?
    let headSha: String
    let conclusion: String?
    let ships: [String]
    let neurons: Int
    let elapsedMs: Double
    let createdAt: Double
    let state: String
    let generation: Int
    let attemptCount: Int
    let queuedAt: Double?
    let startedAt: Double?
    let lastProgressAt: Double?
    let finishedAt: Double?
    let expectedStartAt: Double?
    let expectedFinishAt: Double?
    let queueAheadEstimate: Int?
    let hasTranscript: Bool
    let supersededBy: String?
    let lastError: String?

    private enum CodingKeys: String, CodingKey {
        case id, deliveryId, repo, prNumber, prUrl, headSha, conclusion, ships, neurons
        case elapsedMs, createdAt, state, generation, attemptCount, queuedAt, startedAt
        case lastProgressAt, finishedAt, expectedStartAt, expectedFinishAt
        case queueAheadEstimate, hasTranscript, supersededBy, lastError
    }

    init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        id = try values.decode(String.self, forKey: .id)
        deliveryId = try values.decodeIfPresent(String.self, forKey: .deliveryId)
        repo = (try values.decodeIfPresent(String.self, forKey: .repo)) ?? "unknown repo"
        prNumber = (try values.decodeIfPresent(Int.self, forKey: .prNumber)) ?? 0
        prUrl = try values.decodeIfPresent(String.self, forKey: .prUrl)
        headSha = (try values.decodeIfPresent(String.self, forKey: .headSha)) ?? ""
        conclusion = try values.decodeIfPresent(String.self, forKey: .conclusion)
        ships = (try values.decodeIfPresent([String].self, forKey: .ships)) ?? []
        neurons = (try values.decodeIfPresent(Int.self, forKey: .neurons)) ?? 0
        elapsedMs = (try values.decodeIfPresent(Double.self, forKey: .elapsedMs)) ?? 0
        createdAt = (try values.decodeIfPresent(Double.self, forKey: .createdAt)) ?? 0
        state = (try values.decodeIfPresent(String.self, forKey: .state)) ?? "unknown"
        generation = max((try values.decodeIfPresent(Int.self, forKey: .generation)) ?? 1, 1)
        attemptCount = max((try values.decodeIfPresent(Int.self, forKey: .attemptCount)) ?? 0, 0)
        queuedAt = try values.decodeIfPresent(Double.self, forKey: .queuedAt)
        startedAt = try values.decodeIfPresent(Double.self, forKey: .startedAt)
        lastProgressAt = try values.decodeIfPresent(Double.self, forKey: .lastProgressAt)
        finishedAt = try values.decodeIfPresent(Double.self, forKey: .finishedAt)
        expectedStartAt = try values.decodeIfPresent(Double.self, forKey: .expectedStartAt)
        expectedFinishAt = try values.decodeIfPresent(Double.self, forKey: .expectedFinishAt)
        queueAheadEstimate = try values.decodeIfPresent(Int.self, forKey: .queueAheadEstimate)
            .flatMap { $0 >= 0 ? $0 : nil }
        hasTranscript = (try values.decodeIfPresent(Bool.self, forKey: .hasTranscript)) ?? false
        supersededBy = try values.decodeIfPresent(String.self, forKey: .supersededBy)
        lastError = try values.decodeIfPresent(String.self, forKey: .lastError)
    }

    var isActive: Bool {
        state == "admitting" || state == "queued" || state == "running" || state == "retrying"
    }

    var isFailure: Bool {
        state == "enqueue_failed" || state == "failed_admission" || conclusion == "failure"
    }

    var shortSha: String {
        String(headSha.prefix(7))
    }

    var attemptLabel: String {
        let attempts = attemptCount == 1 ? "1 delivery" : "\(attemptCount) deliveries"
        return "generation \(generation) · \(attempts)"
    }

    func progress(at now: Date = Date()) -> Double? {
        guard state == "running",
              let startedAt,
              let expectedFinishAt,
              expectedFinishAt > startedAt
        else { return nil }
        let fraction = (now.timeIntervalSince1970 - startedAt) / (expectedFinishAt - startedAt)
        return min(max(fraction, 0.03), 0.98)
    }
}

struct CloudFleetHealth: Decodable, Equatable {
    let paused: Bool
    let lastRunAgeSec: Double?
    let queueDepthEstimate: Int?
    let running: Int
    let retrying: Int
    let superseded: Int
    let failedAdmission: Int
    let oldestQueuedAgeSec: Double?
    let knownIntents: Int

    private enum CodingKeys: String, CodingKey {
        case paused, lastRunAgeSec, queueDepthEstimate, running, retrying
        case superseded, failedAdmission, oldestQueuedAgeSec, knownIntents
    }

    init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        paused = (try values.decodeIfPresent(Bool.self, forKey: .paused)) ?? false
        lastRunAgeSec = try values.decodeIfPresent(Double.self, forKey: .lastRunAgeSec)
        queueDepthEstimate = try values.decodeIfPresent(Int.self, forKey: .queueDepthEstimate)
        running = (try values.decodeIfPresent(Int.self, forKey: .running)) ?? 0
        retrying = (try values.decodeIfPresent(Int.self, forKey: .retrying)) ?? 0
        superseded = (try values.decodeIfPresent(Int.self, forKey: .superseded)) ?? 0
        failedAdmission = (try values.decodeIfPresent(Int.self, forKey: .failedAdmission)) ?? 0
        oldestQueuedAgeSec = try values.decodeIfPresent(Double.self, forKey: .oldestQueuedAgeSec)
        knownIntents = (try values.decodeIfPresent(Int.self, forKey: .knownIntents)) ?? 0
    }
}

struct CloudFleetStep: Decodable, Identifiable, Equatable {
    let seq: Int
    let kind: String
    let ship: String?
    let title: String
    let createdAt: Double
    /// Forward-compatible seam. The relay does not claim step-level ETAs yet;
    /// if it eventually can, native clients render them without a schema break.
    let expectedAt: Double?

    var id: Int { seq }

    private enum CodingKeys: String, CodingKey {
        case seq, kind, ship, title, createdAt, expectedAt
    }

    init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        seq = (try values.decodeIfPresent(Int.self, forKey: .seq)) ?? 0
        kind = (try values.decodeIfPresent(String.self, forKey: .kind)) ?? "event"
        ship = try values.decodeIfPresent(String.self, forKey: .ship)
        title = (try values.decodeIfPresent(String.self, forKey: .title)) ?? "Fleet progress recorded"
        createdAt = (try values.decodeIfPresent(Double.self, forKey: .createdAt)) ?? 0
        expectedAt = try values.decodeIfPresent(Double.self, forKey: .expectedAt)
    }

    var explanation: String {
        switch kind {
        case "delivery-attempt":
            return "Cloudflare delivered this job to the executor. The attempt number distinguishes a retry from new work."
        case "checkpoint-reused":
            return "The executor reused durable completed work instead of paying for or publishing it again."
        case "checkpoint-written":
            return "A durable checkpoint was saved so a later retry can resume from this boundary."
        case "map-chunk":
            return "One bounded section of the change is being inspected by the named ship."
        case "reduce":
            return "The ship is consolidating its chunk-level observations into one review verdict."
        case "ship-verdict":
            return "A ship completed its assigned review and persisted the resulting verdict."
        case "check-completed":
            return "GitHub read-back confirmed the required Fleet check reached its intended terminal state."
        case "check-completion-retry":
            return "GitHub did not confirm the terminal check yet; the retry is rate-limited and durably scheduled."
        case "superseded":
            return "A newer head generation replaced this intent before it could publish stale work."
        default:
            if let ship, !ship.isEmpty {
                return "The \(ship) ship recorded this \(kind.replacingOccurrences(of: "-", with: " ")) step in the durable run transcript."
            }
            return "The executor recorded this \(kind.replacingOccurrences(of: "-", with: " ")) step in the durable run transcript."
        }
    }
}

private struct CloudFleetActivityEnvelope: Decodable {
    let runs: [CloudFleetRun]
}

private struct CloudFleetDetailEnvelope: Decodable {
    let run: CloudFleetRun
    let steps: [CloudFleetStep]
}

private enum CloudFleetTransportError: LocalizedError {
    case invalidRelay
    case rejected(Int)
    case status(Int)
    case notHTTP

    var errorDescription: String? {
        switch self {
        case .invalidRelay: return "The saved relay address is invalid."
        case .rejected: return "Your Cloud Fleet session needs to be renewed in FleetBar Credentials."
        case .status(let status): return "Cloud Fleet returned HTTP \(status)."
        case .notHTTP: return "Cloud Fleet returned an unreadable response."
        }
    }
}

@MainActor
final class CloudFleetStore: ObservableObject {
    @Published private(set) var runs: [CloudFleetRun] = []
    @Published private(set) var health: CloudFleetHealth?
    @Published private(set) var account: OperatorAccount?
    @Published private(set) var selectedRun: CloudFleetRun?
    @Published private(set) var steps: [CloudFleetStep] = []
    @Published private(set) var lastRefresh: Date?
    @Published private(set) var lastError: String?
    @Published private(set) var detailError: String?
    @Published private(set) var isRefreshing = false
    @Published private(set) var isLoadingDetail = false
    @Published private(set) var isSignedOut = false
    @Published private(set) var needsReauthentication = false
    @Published private(set) var consecutiveFailures = 0

    static let activePollSeconds: TimeInterval = 5
    static let idlePollSeconds: TimeInterval = 20
    static let failurePollCapSeconds: TimeInterval = 300
    static let requestTimeoutSeconds: TimeInterval = 10

    private let session: URLSession
    private let loadAccount: () -> OperatorAccount?
    private let now: () -> Date
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

    var activeRuns: [CloudFleetRun] {
        runs.filter(\.isActive)
    }

    var hasCloudActivity: Bool {
        !runs.isEmpty
    }

    var accountLabel: String {
        if needsReauthentication { return "session expired" }
        guard let account else { return "signed out" }
        if let login = account.login, !login.isEmpty { return "@\(login)" }
        return "signed in"
    }

    var resolvedRelayURL: String? {
        account?.relayUrl
    }

    static func nextPollDelay(
        hasActiveRuns: Bool,
        consecutiveFailures: Int,
        random: (ClosedRange<Double>) -> Double = { Double.random(in: $0) }
    ) -> TimeInterval {
        let base = hasActiveRuns ? activePollSeconds : idlePollSeconds
        let exponent = min(max(0, consecutiveFailures), 4)
        let ceiling = min(failurePollCapSeconds, base * pow(2, Double(exponent)))
        return consecutiveFailures == 0 ? base : random(0...ceiling)
    }

    func start() {
        stop()
        pollTask = Task { @MainActor [weak self] in
            while !Task.isCancelled {
                guard let store = self else { return }
                await store.refresh()
                let delay = Self.nextPollDelay(
                    hasActiveRuns: !store.activeRuns.isEmpty,
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

        guard let nextAccount = loadAccount() else {
            account = nil
            health = nil
            runs = []
            selectedRun = nil
            steps = []
            lastError = nil
            detailError = nil
            isSignedOut = true
            needsReauthentication = false
            consecutiveFailures = 0
            return
        }

        account = nextAccount
        isSignedOut = false

        do {
            let healthData = try await request(path: "/v1/fleet/health", account: nextAccount)
            let nextHealth = try JSONDecoder().decode(CloudFleetHealth.self, from: healthData)
            let activityData = try await request(path: "/v1/fleet/activity?limit=40", account: nextAccount)
            let activity = try JSONDecoder().decode(CloudFleetActivityEnvelope.self, from: activityData)

            health = nextHealth
            runs = activity.runs
            lastRefresh = now()
            lastError = nil
            needsReauthentication = false
            consecutiveFailures = 0

            let previousSelectionID = selectedRun?.id
            let previousState = selectedRun?.state
            let previousAttemptCount = selectedRun?.attemptCount
            let chosen = selectedRun.flatMap { selected in
                activity.runs.first { $0.id == selected.id }
            } ?? activity.runs.first(where: \.isActive) ?? activity.runs.first

            guard let chosen else {
                selectedRun = nil
                steps = []
                detailError = nil
                return
            }
            // Activity is authoritative for run selection. A malformed or
            // temporarily unavailable transcript must not erase the run row;
            // loadDetail owns only the detail panel and may fail independently.
            selectedRun = chosen
            if chosen.isActive
                || chosen.id != previousSelectionID
                || chosen.state != previousState
                || chosen.attemptCount != previousAttemptCount
                || steps.isEmpty {
                await loadDetail(chosen, account: nextAccount)
            }
        } catch let error as CloudFleetTransportError {
            record(error)
        } catch {
            consecutiveFailures += 1
            lastError = "Cloud Fleet could not refresh: \(error.localizedDescription)"
        }
    }

    func select(_ run: CloudFleetRun) async {
        selectedRun = run
        steps = []
        detailError = nil
        guard let account = loadAccount() else {
            isSignedOut = true
            return
        }
        self.account = account
        await loadDetail(run, account: account)
    }

    private func loadDetail(_ run: CloudFleetRun, account: OperatorAccount) async {
        guard !isLoadingDetail else { return }
        isLoadingDetail = true
        defer { isLoadingDetail = false }

        let allowed = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "._-"))
        guard let encodedID = run.id.addingPercentEncoding(withAllowedCharacters: allowed) else {
            detailError = "This run identifier cannot be opened."
            return
        }

        do {
            let data = try await request(path: "/v1/fleet/runs/\(encodedID)", account: account)
            let detail = try JSONDecoder().decode(CloudFleetDetailEnvelope.self, from: data)
            guard selectedRun?.id == run.id || selectedRun == nil else { return }
            selectedRun = detail.run
            steps = detail.steps.sorted { $0.seq < $1.seq }
            detailError = nil
        } catch let error as CloudFleetTransportError {
            if case .rejected = error {
                needsReauthentication = true
            }
            detailError = error.localizedDescription
        } catch {
            detailError = "The run transcript could not be decoded: \(error.localizedDescription)"
        }
    }

    private func request(path: String, account: OperatorAccount) async throws -> Data {
        guard let url = URL(string: "\(account.relayUrl)\(path)") else {
            throw CloudFleetTransportError.invalidRelay
        }
        var request = URLRequest(url: url)
        request.timeoutInterval = Self.requestTimeoutSeconds
        request.setValue("Bearer \(account.token)", forHTTPHeaderField: "Authorization")
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw CloudFleetTransportError.notHTTP
        }
        if http.statusCode == 401 || http.statusCode == 403 {
            throw CloudFleetTransportError.rejected(http.statusCode)
        }
        guard http.statusCode == 200 else {
            throw CloudFleetTransportError.status(http.statusCode)
        }
        return data
    }

    private func record(_ error: CloudFleetTransportError) {
        consecutiveFailures += 1
        if case .rejected = error {
            needsReauthentication = true
            consecutiveFailures = 4
        }
        lastError = error.localizedDescription
    }
}
