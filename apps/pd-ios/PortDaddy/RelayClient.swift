import Foundation

// MARK: - Relay client
//
// Every path in this file was read out of apps/relay/src/index.ts on this
// branch. None were guessed, and none were "obvious" — the relay routes with a
// hand-rolled if/else chain on url.pathname, so there is no router table to
// read and no convention to extrapolate from. If a path is not below, the
// relay does not serve it.
//
// AUTH: The existing Relay read routes accept a pdu_ personal access token
// or a browser session. The device flow issues unscoped account authority,
// not the read-only phone credential this beta would need. This transport
// remains fixture-tested but is not constructed by the beta's app entry.
// There is no enrollment, cookie import, or token persistence in the beta.
//
// ── WHAT THIS CLIENT DOES NOT DO YET ─────────────────────────────────────────
//
// Two of these are genuinely server-side gaps; the third (roadmap) no longer
// is, and is named here as a client-side gap instead, for the same reason the
// other two are named as what they are: a plausible-looking client method
// that doesn't do what it appears to is how a scaffold starts lying about how
// finished it is.
//
//   1. ROADMAP PROJECTION — `GET /roadmap/projection` is real and live
//      (routes/roadmap.ts, landed with #9223); the gap is entirely on this
//      side. D1 ships with no live network wiring for ANY tab — RootView
//      never calls this client for roadmap, harbors, or interruptions, all of
//      which render from fixtures the same way. That is not an oversight
//      specific to roadmap; it is D1's actual scope boundary, the same one
//      this file's own AUTH section names for pairing. `fetchRoadmapProjection`
//      still throws `.serverSideUnbuilt` (kept for now — it is the one call
//      site and the message says why), but the reason is "this client isn't
//      wired to call it yet", not "the relay has no route".
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
public struct RelayCredential: Equatable, Sendable, CustomStringConvertible, CustomDebugStringConvertible {
    /// A pdu_ account bearer, not proof of a read-only device grant.
    public let token: String

    public init(token: String) {
        self.token = token
    }

    public var description: String { "RelayCredential(redacted)" }
    public var debugDescription: String { description }

    public var looksWellFormed: Bool {
        // Match readBearer in apps/relay/src/device-flow.ts, including its
        // case-insensitive prefix. Never allow whitespace or header injection.
        let bytes = Array(token.utf8)
        return bytes.count == 68 && token.prefix(4).lowercased() == "pdu_"
            && bytes.dropFirst(4).allSatisfy {
                (48...57).contains($0) || (65...70).contains($0) || (97...102).contains($0)
            }
    }
}

/// Where the bearer token lives.
///
/// In-memory fixtures only in this beta. Keychain custody protects a token at
/// rest; it cannot narrow the authority Relay grants to that token.
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

/// The server's free-form error text is not a display or logging contract.
/// Recognize named codes for these reads and discard the rest of the body.
private enum RelayFailureCode: String, Decodable {
    case badRequest = "BAD_REQUEST"
    case crossOrigin = "CROSS_ORIGIN"
    case forbidden = "FORBIDDEN"
    case notFound = "NOT_FOUND"
}

private struct RelayFailureEnvelope: Decodable {
    let code: RelayFailureCode
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
    public static let accountHarbors = "/account/harbors"

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
/// Refuse ALL redirects, including same-origin redirects: a changed endpoint
/// must be configured explicitly, never learned from a credentialed response.
/// A per-task delegate also applies when callers inject a URLSession.
final class RelayRedirectRefusal: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask,
                    willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest,
                    completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}

protocol RelayTransport {
    func data(for request: URLRequest, delegate: (any URLSessionTaskDelegate)?) async throws -> (Data, URLResponse)
}

extension URLSession: RelayTransport {}

public struct RelayClient {
    public let baseURL: URL
    public let tokenStore: RelayTokenStore
    private let session: any RelayTransport
    private let decoder: JSONDecoder

    public init(baseURL: URL, tokenStore: RelayTokenStore) {
        self.init(baseURL: baseURL, tokenStore: tokenStore,
                  session: URLSession(configuration: Self.privateConfiguration()))
    }

    /// Test-only transport injection. Production callers cannot supply a
    /// session with persistent cookie, credential, or cache stores.
    init(baseURL: URL, tokenStore: RelayTokenStore, session: any RelayTransport) {
        self.baseURL = baseURL
        self.tokenStore = tokenStore
        self.session = session
        self.decoder = JSONDecoder()
    }

    static func privateConfiguration() -> URLSessionConfiguration {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.httpShouldSetCookies = false
        configuration.httpCookieStorage = nil
        configuration.urlCredentialStorage = nil
        configuration.urlCache = nil
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        configuration.timeoutIntervalForRequest = 15
        configuration.timeoutIntervalForResource = 30
        return configuration
    }

    /// baseURL is an explicit trust decision made by configuration, not an
    /// arbitrary URL obtained from a message or response. Self-hosted HTTPS
    /// origins are allowed. Reject ambiguity before touching the token store.
    private func trustedOrigin() throws -> URLComponents {
        guard baseURL.baseURL == nil,
              let components = URLComponents(url: baseURL, resolvingAgainstBaseURL: false),
              components.scheme?.lowercased() == "https",
              let host = components.host, !host.isEmpty,
              !host.contains(where: { $0.isWhitespace }),
              components.user == nil, components.password == nil,
              components.query == nil, components.fragment == nil,
              components.path.isEmpty || components.path == "/",
              components.port.map({ (1...65535).contains($0) }) ?? true else {
            throw RelayError.transport("relay endpoint must be an absolute HTTPS origin without user information, path, query, or fragment")
        }
        return components
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
    func makeRequest(path: String, query: [URLQueryItem] = []) throws -> URLRequest {
        var components = try trustedOrigin()
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
        request.httpShouldHandleCookies = false
        request.cachePolicy = .reloadIgnoringLocalCacheData
        request.httpMethod = "GET"
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        guard let credential = tokenStore.credential, credential.looksWellFormed else {
            throw RelayError.unauthenticated("no valid Relay credential is available")
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
        guard request.httpMethod == "GET", request.httpBody == nil, request.httpBodyStream == nil else {
            throw RelayError.transport("only bodyless Relay reads are supported")
        }
        let origin = try trustedOrigin()
        guard let url = request.url,
              let destination = URLComponents(url: url, resolvingAgainstBaseURL: false),
              destination.scheme?.lowercased() == "https",
              destination.host?.lowercased() == origin.host?.lowercased(),
              (destination.port ?? 443) == (origin.port ?? 443),
              destination.user == nil, destination.password == nil,
              destination.fragment == nil else {
            throw RelayError.transport("request is outside the configured relay origin")
        }
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request, delegate: RelayRedirectRefusal())
        } catch is CancellationError {
            throw CancellationError()
        } catch let error as URLError where error.code == .cancelled {
            throw CancellationError()
        } catch {
            throw RelayError.transport("the request did not complete")
        }
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        if status < 200 || status >= 300 {
            if status == 401 {
                throw RelayError.unauthenticated("the relay did not accept this credential")
            }
            let code = (try? decoder.decode(RelayFailureEnvelope.self, from: data))?.code
            if code == .crossOrigin {
                throw RelayError.crossOriginRefused("the relay refused the request origin")
            }
            throw RelayError.http(
                status: status, code: code?.rawValue ?? "HTTP_\(status)", message: "the relay returned \(status)"
            )
        }
        do {
            return try decoder.decode(T.self, from: data)
        } catch {
            throw RelayError.decoding("the response did not match the requested Relay data")
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

    // MARK: - Roadmap (client-side wiring not built yet — see the header note)

    /// `GET /roadmap/projection` is a real, live route (routes/roadmap.ts,
    /// landed with #9223) — this client simply doesn't call it yet. D1 has no
    /// live network wiring for any tab (see the header note), so this throws
    /// rather than returning a fixture dressed as live data, same as every
    /// other screen's fixture path being labelled a fixture.
    public func fetchRoadmapProjection() async throws -> RoadmapProjection {
        throw RelayError.serverSideUnbuilt(
            "GET /roadmap/projection is live server-side, but this client build has no roadmap live-fetch wiring yet"
        )
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
