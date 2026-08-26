import Foundation

// MARK: - Relay client
//
// Every path in this file was read out of apps/relay/src/index.ts on this
// branch. None were guessed, and none were "obvious" — the relay routes with a
// hand-rolled if/else chain on url.pathname, so there is no router table to
// read and no convention to extrapolate from. If a path is not below, the
// relay does not serve it.
//
// AUTH: `Authorization: Bearer pdu_...`. resolveUserFromRequest (device-flow.ts)
// takes a `pdu_` bearer first and falls back to the session cookie; a native
// client has no cookie, so the bearer is the only credential here. The token
// is minted by the device flow: POST /auth/device/start, then poll
// POST /auth/device/token.
//
// ── WHAT THE SERVER DOES NOT HAVE YET ────────────────────────────────────────
//
// Three pieces of ADR-0125 v1 have no endpoint behind them. They are named
// here as unbuilt rather than coded against a fiction, because a plausible-
// looking client method for a route that does not exist is how a scaffold
// starts lying about how finished it is:
//
//   1. ROADMAP PROJECTION — no /v1/roadmap, no /account/roadmap. The
//      projection exists as lib/roadmap-projection.ts with no route
//      registered. `fetchRoadmapProjection` throws `.serverSideUnbuilt`.
//
//   2. REACHABILITY VERDICT — apps/relay/src/harbors.ts defers the
//      possible|degraded|impossible|unknown verdict to v2+ in its own header.
//      There is no JSON endpoint. The client fetches presence, which is real,
//      and Reachability.derive computes the verdict on-device; the UI labels
//      it as locally derived.
//
//   3. ANSWER / ACK — POST /v1/interruptions/:id/answer and .../ack exist, but
//      closeInterruption requires resolveSession (a signed-in cookie) AND a
//      same-origin check. A bearer token cannot close an ask. This client
//      deliberately has no answer method; see Interruptions.swift's header.
//      InterruptionHandoff builds the web destination instead.
//
// APNs device registration (POST /v1/push/apns/devices) is real but ships in
// the relay's push module, which is not on this branch yet. The method is
// present and annotated, because the app cannot register for pushes it cannot
// deliver, and a 404 from it means the relay half has not deployed.

public struct RelayCredential: Equatable, Sendable {
    /// A `pdu_`-prefixed bearer token from the device flow.
    public let token: String

    public init(token: String) {
        self.token = token
    }

    public var looksWellFormed: Bool { token.hasPrefix("pdu_") && token.count > 8 }
}

/// Where the bearer token lives.
///
/// Deliberately a protocol with an in-memory default and nothing else. A
/// device token is control authority over an operator's fleet; it belongs in
/// the Keychain with a real accessibility class, and writing a UserDefaults
/// implementation here would leave a convincing insecure default for someone
/// to ship. The Keychain-backed store lands with pairing (ADR-0125 §3), which
/// mints the device membership record this token would attach to.
public protocol RelayTokenStore: AnyObject {
    var credential: RelayCredential? { get set }
}

public final class InMemoryRelayTokenStore: RelayTokenStore {
    public var credential: RelayCredential?

    public init(credential: RelayCredential? = nil) {
        self.credential = credential
    }
}

public enum RelayError: Error, Equatable, CustomStringConvertible {
    /// No token, or the relay rejected it. 401 body:
    /// `{code:'UNAUTHENTICATED', error:'a pdu_ bearer token or session is required'}`.
    case unauthenticated(String)
    /// 403 `{code:'CROSS_ORIGIN'}` — a route that refuses non-same-origin
    /// callers. A native client hitting this has found a route it is not
    /// meant to call directly.
    case crossOriginRefused(String)
    /// The relay answered, unhappily.
    case http(status: Int, code: String, message: String)
    /// Transport failure — offline, DNS, TLS. Surfaces as "unknown", never as
    /// an empty result.
    case transport(String)
    case decoding(String)
    /// The route this method would call does not exist on the relay yet.
    /// Thrown, never silently returned as empty data.
    case serverSideUnbuilt(String)

    public var description: String {
        switch self {
        case .unauthenticated(let m):   return "not signed in: \(m)"
        case .crossOriginRefused(let m): return "refused: \(m)"
        case .http(let status, let code, let message): return "relay \(status) \(code): \(message)"
        case .transport(let m):         return "could not reach the relay: \(m)"
        case .decoding(let m):          return "could not read the relay's answer: \(m)"
        case .serverSideUnbuilt(let m): return "not built yet: \(m)"
        }
    }
}

/// Envelope every relay JSON route wraps its payload in.
private struct RelayEnvelope: Decodable {
    let code: String?
    let error: String?
}

/// The real routes, as string constants, so the tests can pin them and a
/// typo cannot hide inside string interpolation at a call site.
public enum RelayRoute {
    // Device-flow login — the path a native client uses (CLI, FleetBar and
    // pd-console use the same two).
    public static let deviceStart = "/auth/device/start"
    public static let deviceToken = "/auth/device/token"
    public static let whoami = "/auth/whoami"

    public static let harbors = "/v1/harbors"
    public static func harbor(namespace: String, name: String) -> String {
        "/v1/harbors/\(encode(namespace))/\(encode(name))"
    }
    public static func harborPresence(namespace: String, name: String) -> String {
        "\(harbor(namespace: namespace, name: name))/presence"
    }

    public static let interruptions = "/v1/interruptions"

    /// Session-gated HTML surface the app deep-links to for answer/ack.
    public static let accountInterruptions = "/account/interruptions"

    /// Ships with the relay's push module.
    public static let apnsDevices = "/v1/push/apns/devices"

    /// The RFC 3986 path grammar is `path = *( pchar / "/" )`, so `/` is a MEMBER
    /// of `.urlPathAllowed` — encoding a path COMPONENT with that set leaves a
    /// slash in the name untouched and silently splits it into another segment.
    /// A harbor named `fleet/presence` would otherwise address the presence
    /// route rather than a harbor. Subtracting `/` is the whole point of this
    /// function: it encodes one component, not a path.
    static let componentAllowed: CharacterSet = .urlPathAllowed.subtracting(CharacterSet(charactersIn: "/"))

    static func encode(_ component: String) -> String {
        component.addingPercentEncoding(withAllowedCharacters: componentAllowed) ?? component
    }
}

/// URLSession client for the Port Daddy relay.
///
/// Not declared Sendable: it holds a URLSession, and the store is a reference
/// type. Hold one per view model on the main actor rather than sharing one
/// across isolation domains.
public struct RelayClient {
    public let baseURL: URL
    public let tokenStore: RelayTokenStore
    private let session: URLSession
    private let decoder: JSONDecoder

    public init(baseURL: URL, tokenStore: RelayTokenStore, session: URLSession = .shared) {
        self.baseURL = baseURL
        self.tokenStore = tokenStore
        self.session = session
        self.decoder = JSONDecoder()
    }

    // MARK: - Response envelopes

    private struct HarborListResponse: Decodable {
        let harbors: [Harbor]
    }

    private struct HarborDetailResponse: Decodable {
        let harbor: Harbor
        let members: [HarborMember]
    }

    // MARK: - Requests

    // Named makeRequest, not request: `let request = try request(...)` at a
    // call site would shadow the method with the variable being declared.
    func makeRequest(path: String, query: [URLQueryItem] = [], method: String = "GET") throws -> URLRequest {
        guard var components = URLComponents(url: baseURL, resolvingAgainstBaseURL: false) else {
            throw RelayError.transport("malformed relay base URL")
        }
        // percentEncodedPath, NOT path: the `path` setter takes a DECODED value and
        // re-encodes it, which turns the `%2F` that `RelayRoute.encode` just wrote
        // back into a `/` and undoes the split-segment fix above. The routes are
        // built by RelayRoute, so what arrives here is already encoded.
        components.percentEncodedPath = path
        // Setting `.queryItems` (the decoded [URLQueryItem] form, not
        // `.percentEncodedQueryItems`) makes URLComponents percent-encode each
        // item's name and value itself when `.url` is read below — this file
        // never hand-encodes a query value.
        components.queryItems = query.isEmpty ? nil : query
        guard let url = components.url else {
            throw RelayError.transport("could not build a URL for \(path)")
        }
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        guard let credential = tokenStore.credential else {
            throw RelayError.unauthenticated("no device token — pair this phone first")
        }
        request.setValue("Bearer \(credential.token)", forHTTPHeaderField: "Authorization")
        // No Origin header is set on purpose. isSameOrigin() treats a request
        // with neither Origin nor Referer as same-origin; adding one that is
        // not the relay's own origin turns 200s into 403s on any route that
        // checks. If a future proxy starts attaching one, that is where a
        // CROSS_ORIGIN failure will be coming from.
        return request
    }

    func send<T: Decodable>(_ request: URLRequest, as type: T.Type) async throws -> T {
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch {
            throw RelayError.transport(error.localizedDescription)
        }
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        if status < 200 || status >= 300 {
            let envelope = try? decoder.decode(RelayEnvelope.self, from: data)
            let code = envelope?.code ?? "HTTP_\(status)"
            let message = envelope?.error ?? "the relay returned \(status)"
            if status == 401 { throw RelayError.unauthenticated(message) }
            if code == "CROSS_ORIGIN" { throw RelayError.crossOriginRefused(message) }
            throw RelayError.http(status: status, code: code, message: message)
        }
        do {
            return try decoder.decode(T.self, from: data)
        } catch {
            throw RelayError.decoding(String(describing: error))
        }
    }

    // MARK: - Interruptions (read only — see the file header)

    /// GET /v1/interruptions?state=open
    ///
    /// `state` is validated server-side against
    /// ['open','acked','answered','expired']; anything else is a 400, so this
    /// takes the enum rather than a string.
    public func fetchInterruptions(state: InterruptionState? = .open) async throws -> InterruptionListResponse {
        let query = state.map { [URLQueryItem(name: "state", value: $0.rawValue)] } ?? []
        let request = try makeRequest(path: RelayRoute.interruptions, query: query)
        return try await send(request, as: InterruptionListResponse.self)
    }

    /// Where to send the operator to answer or ack. Not a request — the relay
    /// requires a signed-in session for both, which a bearer token is not.
    public func answerHandoff(for interruption: OperatorInterruption) -> InterruptionHandoff {
        InterruptionHandoff.webAnswerSurface(relayBaseURL: baseURL, interruptionID: interruption.id)
    }

    // MARK: - Harbors

    /// GET /v1/harbors — the harbors this account belongs to.
    public func fetchHarbors() async throws -> [Harbor] {
        let request = try makeRequest(path: RelayRoute.harbors)
        return try await send(request, as: HarborListResponse.self).harbors
    }

    /// GET /v1/harbors/:namespace/:name — detail plus members.
    ///
    /// A non-member and a nonexistent harbor both return the same
    /// `404 {code:'NOT_FOUND', error:'no such harbor'}`. That is deliberate on
    /// the relay's side — no existence oracle — so this client must not
    /// distinguish them either, and the UI says "no such harbor" for both.
    public func fetchHarbor(namespace: String, name: String) async throws -> (harbor: Harbor, members: [HarborMember]) {
        let request = try makeRequest(path: RelayRoute.harbor(namespace: namespace, name: name))
        let response = try await send(request, as: HarborDetailResponse.self)
        return (response.harbor, response.members)
    }

    /// GET /v1/harbors/:namespace/:name/presence — who is online, plus the
    /// relay's own TTL. The reachability verdict is derived from this on
    /// device (see Harbors.swift) because the relay does not serve one.
    public func fetchPresence(namespace: String, name: String) async throws -> PresenceSnapshot {
        let request = try makeRequest(path: RelayRoute.harborPresence(namespace: namespace, name: name))
        return try await send(request, as: PresenceSnapshot.self)
    }

    // MARK: - Roadmap (unbuilt server-side)

    /// There is no route. `lib/roadmap-projection.ts` is a read model with no
    /// HTTP registration in apps/relay/src/index.ts — not on this branch and
    /// not on the branch the projection itself lives on. This throws rather
    /// than returning a fixture dressed as live data.
    public func fetchRoadmapProjection() async throws -> RoadmapProjection {
        throw RelayError.serverSideUnbuilt(
            "the relay serves no roadmap projection route yet — lib/roadmap-projection.ts has no HTTP registration"
        )
    }

    // MARK: - Push registration

    /// POST /v1/push/apns/devices — registers this device's APNs token.
    ///
    /// The route is real but ships in the relay's push module, which is not on
    /// this branch. Until it deploys, this returns a 404 through
    /// `RelayError.http`, which is the honest answer: the app cannot register
    /// for a delivery channel that is not listening.
    public func registerPushDevice(deviceToken: String, deviceID: String) async throws {
        var request = try makeRequest(path: RelayRoute.apnsDevices, method: "POST")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        let body: [String: String] = [
            "device_token": deviceToken.lowercased(),
            "device_id": deviceID,
            "platform": "ios",
        ]
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        _ = try await send(request, as: RelayEnvelope.self)
    }
}

/// A harbor member as `memberJson` returns it. `member` is a login for users
/// and a fingerprint for daemons.
public struct HarborMember: Codable, Hashable, Sendable {
    public let kind: String
    public let member: String
    public let role: String
    public let addedAt: Double

    public var isDaemon: Bool { kind == "daemon" }

    public init(kind: String, member: String, role: String, addedAt: Double) {
        self.kind = kind
        self.member = member
        self.role = role
        self.addedAt = addedAt
    }
}
