import AppKit
import Darwin
import Foundation
import SwiftUI

struct OperatorAccount: Equatable {
    let token: String
    let relayUrl: String
    let login: String?
}

enum OperatorAccountFile {
    static let defaultRelay = "https://relay.portdaddy.dev"

    static var accountURL: URL {
        FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent(".port-daddy", isDirectory: true)
            .appendingPathComponent("account.json", isDirectory: false)
    }

    static func load(from url: URL = accountURL) -> OperatorAccount? {
        guard let data = try? Data(contentsOf: url),
              let stored = try? JSONDecoder().decode(StoredAccount.self, from: data),
              isValidToken(stored.token)
        else { return nil }

        let relay = normalizedRelay(stored.relayUrl)
        guard isValidRelay(relay) else { return nil }
        return OperatorAccount(token: stored.token, relayUrl: relay, login: stored.login)
    }

    /// Writes a credential without exposing a partially written or broadly
    /// readable file. The existing account remains untouched until the new
    /// bytes have been written, synced, decoded, and verified byte-for-byte.
    static func saveAtomically(
        _ account: OperatorAccount,
        to url: URL = accountURL,
        createdAt: Date = Date()
    ) throws {
        guard isValidToken(account.token) else { throw AccountFileError.invalidToken }
        let relay = normalizedRelay(account.relayUrl)
        guard isValidRelay(relay) else { throw AccountFileError.invalidRelay }

        let stored = StoredAccount(
            token: account.token,
            login: account.login,
            relayUrl: relay,
            createdAt: Int(createdAt.timeIntervalSince1970)
        )
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
        var data = try encoder.encode(stored)
        data.append(0x0A)

        let directory = url.deletingLastPathComponent()
        if !FileManager.default.fileExists(atPath: directory.path) {
            try FileManager.default.createDirectory(
                at: directory,
                withIntermediateDirectories: true,
                attributes: [.posixPermissions: 0o700]
            )
        }

        let temporary = directory.appendingPathComponent(".account.\(UUID().uuidString).tmp")
        let descriptor = Darwin.open(temporary.path, O_WRONLY | O_CREAT | O_EXCL, S_IRUSR | S_IWUSR)
        guard descriptor >= 0 else { throw AccountFileError.cannotCreate }

        var committed = false
        defer {
            Darwin.close(descriptor)
            if !committed { try? FileManager.default.removeItem(at: temporary) }
        }

        try data.withUnsafeBytes { rawBuffer in
            guard let base = rawBuffer.baseAddress else { return }
            var offset = 0
            while offset < rawBuffer.count {
                let count = Darwin.write(descriptor, base.advanced(by: offset), rawBuffer.count - offset)
                guard count > 0 else { throw AccountFileError.cannotWrite }
                offset += count
            }
        }
        guard Darwin.fsync(descriptor) == 0 else { throw AccountFileError.cannotWrite }

        guard let readback = try? Data(contentsOf: temporary), readback == data,
              let decoded = try? JSONDecoder().decode(StoredAccount.self, from: readback),
              decoded == stored
        else { throw AccountFileError.readbackFailed }

        guard Darwin.rename(temporary.path, url.path) == 0 else {
            throw AccountFileError.cannotReplace
        }
        committed = true
    }

    static func remove(from url: URL = accountURL) throws {
        guard FileManager.default.fileExists(atPath: url.path) else { return }
        try FileManager.default.removeItem(at: url)
    }

    static func isValidToken(_ token: String) -> Bool {
        guard token.count == 68, token.hasPrefix("pdu_") else { return false }
        return token.dropFirst(4).allSatisfy { $0.isHexDigit }
    }

    /// Production credentials must travel over HTTPS. Plain HTTP remains
    /// available only for a relay bound to this Mac, which keeps local
    /// development possible without accepting credentials over the network.
    static func isValidRelay(_ relay: String) -> Bool {
        guard let components = URLComponents(string: relay),
              let scheme = components.scheme?.lowercased(),
              let host = components.host?.lowercased(),
              !host.isEmpty,
              components.user == nil,
              components.password == nil,
              components.query == nil,
              components.fragment == nil
        else { return false }
        if scheme == "https" { return true }
        guard scheme == "http" else { return false }
        return host == "localhost" || host == "127.0.0.1" || host == "::1" || host == "[::1]"
    }

    private static func normalizedRelay(_ raw: String?) -> String {
        var relay = raw?.trimmingCharacters(in: .whitespacesAndNewlines) ?? defaultRelay
        if relay.isEmpty { relay = defaultRelay }
        while relay.hasSuffix("/") { relay.removeLast() }
        return relay
    }

    private struct StoredAccount: Codable, Equatable {
        let token: String
        let login: String?
        let relayUrl: String
        let createdAt: Int?
    }

    enum AccountFileError: LocalizedError {
        case invalidToken, invalidRelay, cannotCreate, cannotWrite, readbackFailed, cannotReplace

        var errorDescription: String? {
            switch self {
            case .invalidToken: return "The relay returned an invalid account credential."
            case .invalidRelay: return "The relay address must use HTTPS or a local development address."
            case .cannotCreate: return "FleetBar could not create a protected account file."
            case .cannotWrite: return "FleetBar could not finish writing the protected account file."
            case .readbackFailed: return "FleetBar could not verify the protected account file."
            case .cannotReplace: return "FleetBar could not replace the protected account file."
            }
        }
    }
}

@MainActor
final class OperatorAccountStore: ObservableObject {
    struct Identity: Equatable {
        let login: String
        let relayUrl: String
        let lastVerified: Date?
    }

    struct DeviceAuthorization: Equatable {
        let userCode: String
        let verificationURL: URL
        let expiresAt: Date
    }

    enum Phase: Equatable {
        case checking
        case signedOut
        case connecting(DeviceAuthorization)
        case connected(Identity)
        case failed(String)
    }

    enum PollResult: Equatable {
        case pending
        case cancelled
        case connected(Identity)
        case failed(String)
    }

    @Published private(set) var phase: Phase = .checking

    private let session: URLSession
    private let accountURL: URL
    private let relayUrl: String
    private let now: () -> Date
    private let openBrowser: (URL) -> Void
    private var deviceCode: String?
    private var deviceRelayUrl: String?
    private var pollInterval: TimeInterval = 5
    private var operationGeneration = UUID()
    private nonisolated(unsafe) var connectionTask: Task<Void, Never>?

    init(
        autoRefresh: Bool = true,
        session: URLSession = .shared,
        accountURL: URL = OperatorAccountFile.accountURL,
        relayUrl: String = OperatorAccountFile.defaultRelay,
        now: @escaping () -> Date = Date.init,
        openBrowser: @escaping (URL) -> Void = { NSWorkspace.shared.open($0) }
    ) {
        self.session = session
        self.accountURL = accountURL
        self.relayUrl = relayUrl
        self.now = now
        self.openBrowser = openBrowser
        if autoRefresh {
            Task { await refresh() }
        }
    }

    deinit { connectionTask?.cancel() }

    var connectedIdentity: Identity? {
        if case .connected(let identity) = phase { return identity }
        return nil
    }

    func refresh() async {
        connectionTask?.cancel()
        connectionTask = nil
        deviceCode = nil
        deviceRelayUrl = nil
        let generation = beginOperation()
        guard let account = OperatorAccountFile.load(from: accountURL) else {
            if operationGeneration == generation { phase = .signedOut }
            return
        }
        phase = .checking
        let result = await verify(account)
        guard operationGeneration == generation, !Task.isCancelled else { return }
        switch result {
        case .success(let identity): phase = .connected(identity)
        case .failure(let message): phase = .failed(message)
        }
    }

    func connect() {
        cancelConnection(resetPhase: false)
        connectionTask = Task { @MainActor [weak self] in
            guard let self, await self.beginConnection(openAuthorizationPage: true) != nil else { return }
            while !Task.isCancelled {
                do {
                    try await Task.sleep(nanoseconds: UInt64(self.pollInterval * 1_000_000_000))
                } catch { return }
                let result = await self.pollConnectionOnce()
                if result != .pending { return }
            }
        }
    }

    @discardableResult
    func beginConnection(openAuthorizationPage: Bool = false) async -> DeviceAuthorization? {
        let generation = beginOperation()
        let connectionRelay = OperatorAccountFile.load(from: accountURL)?.relayUrl ?? relayUrl
        guard OperatorAccountFile.isValidRelay(connectionRelay),
              let url = URL(string: "\(connectionRelay)/auth/device/start")
        else {
            phase = .failed("The account service address is invalid.")
            return nil
        }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.timeoutInterval = 15
        do {
            let (data, response) = try await session.data(for: request)
            guard operationGeneration == generation, !Task.isCancelled else { return nil }
            guard let http = response as? HTTPURLResponse, http.statusCode == 200,
                  let envelope = try? JSONDecoder().decode(DeviceStartEnvelope.self, from: data),
                  let verificationURL = URL(string: envelope.verificationUri),
                  isTrustedAuthorizationPage(verificationURL)
            else {
                phase = .failed("FleetBar could not start account connection. Try again in a moment.")
                return nil
            }
            let authorization = DeviceAuthorization(
                userCode: envelope.userCode,
                verificationURL: verificationURL,
                expiresAt: now().addingTimeInterval(TimeInterval(envelope.expiresIn))
            )
            deviceCode = envelope.deviceCode
            deviceRelayUrl = connectionRelay
            pollInterval = TimeInterval(max(2, envelope.interval))
            phase = .connecting(authorization)
            if openAuthorizationPage { openBrowser(verificationURL) }
            return authorization
        } catch {
            guard operationGeneration == generation, !Task.isCancelled else { return nil }
            phase = .failed("FleetBar could not reach the account service.")
            return nil
        }
    }

    func pollConnectionOnce() async -> PollResult {
        guard case .connecting(let authorization) = phase,
              let deviceCode,
              let deviceRelayUrl
        else {
            return .failed("No account connection is in progress.")
        }
        let generation = operationGeneration
        guard authorization.expiresAt > now() else {
            self.deviceCode = nil
            let message = "The connection code expired. Start again for a fresh code."
            phase = .failed(message)
            return .failed(message)
        }
        guard let url = URL(string: "\(deviceRelayUrl)/auth/device/token") else {
            return failConnection("The account service address is invalid.")
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.timeoutInterval = 15
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try? JSONEncoder().encode(DeviceTokenRequest(
            deviceCode: deviceCode,
            label: "FleetBar on this Mac"
        ))

        do {
            let (data, response) = try await session.data(for: request)
            guard isCurrentConnection(generation: generation, deviceCode: deviceCode),
                  !Task.isCancelled
            else { return .cancelled }
            guard let http = response as? HTTPURLResponse else {
                return failConnection("FleetBar could not reach the account service.")
            }
            let envelope = try? JSONDecoder().decode(DeviceTokenEnvelope.self, from: data)
            if http.statusCode == 200, envelope?.pending == true {
                if envelope?.error == "slow_down" { pollInterval += 5 }
                return .pending
            }
            guard http.statusCode == 200,
                  let token = envelope?.token,
                  OperatorAccountFile.isValidToken(token)
            else {
                let message = envelope?.error == "access_denied"
                    ? "Account connection was declined."
                    : envelope?.error == "expired_token"
                        ? "The connection code expired. Start again for a fresh code."
                        : "Account connection failed. Start again when you are ready."
                return failConnection(message)
            }

            let candidate = OperatorAccount(token: token, relayUrl: deviceRelayUrl, login: envelope?.login)
            let verification = await verify(candidate)
            guard isCurrentConnection(generation: generation, deviceCode: deviceCode),
                  !Task.isCancelled
            else { return .cancelled }
            switch verification {
            case .failure:
                return failConnection("The new account credential could not be verified. Your previous connection is unchanged.")
            case .success(let identity):
                do {
                    try OperatorAccountFile.saveAtomically(candidate, to: accountURL, createdAt: now())
                    self.deviceCode = nil
                    phase = .connected(identity)
                    return .connected(identity)
                } catch {
                    return failConnection("FleetBar could not save the verified connection. Your previous connection is unchanged.")
                }
            }
        } catch {
            guard isCurrentConnection(generation: generation, deviceCode: deviceCode),
                  !Task.isCancelled
            else { return .cancelled }
            return failConnection("FleetBar could not reach the account service.")
        }
    }

    func cancelConnection(resetPhase: Bool = true) {
        connectionTask?.cancel()
        connectionTask = nil
        deviceCode = nil
        deviceRelayUrl = nil
        operationGeneration = UUID()
        guard resetPhase else { return }
        if let account = OperatorAccountFile.load(from: accountURL) {
            phase = .connected(Identity(
                login: account.login?.isEmpty == false ? account.login! : "Connected account",
                relayUrl: account.relayUrl,
                lastVerified: nil
            ))
        } else {
            phase = .signedOut
        }
    }

    func signOut() {
        cancelConnection(resetPhase: false)
        do {
            try OperatorAccountFile.remove(from: accountURL)
            phase = .signedOut
        } catch {
            phase = .failed("FleetBar could not sign out without risking the saved connection.")
        }
    }

    static func fixture(phase: Phase) -> OperatorAccountStore {
        let store = OperatorAccountStore(autoRefresh: false)
        store.phase = phase
        return store
    }

    private func failConnection(_ message: String) -> PollResult {
        deviceCode = nil
        deviceRelayUrl = nil
        phase = .failed(message)
        return .failed(message)
    }

    private func beginOperation() -> UUID {
        let generation = UUID()
        operationGeneration = generation
        return generation
    }

    private func isCurrentConnection(generation: UUID, deviceCode: String) -> Bool {
        guard operationGeneration == generation, self.deviceCode == deviceCode else { return false }
        if case .connecting = phase { return true }
        return false
    }

    private func isTrustedAuthorizationPage(_ url: URL) -> Bool {
        url.scheme?.lowercased() == "https"
            && url.host?.lowercased() == "github.com"
            && url.path == "/login/device"
            && url.user == nil
            && url.password == nil
    }

    private enum VerificationResult {
        case success(Identity)
        case failure(String)
    }

    private func verify(_ account: OperatorAccount) async -> VerificationResult {
        guard let url = URL(string: "\(account.relayUrl)/auth/whoami") else {
            return .failure("The saved relay address is invalid.")
        }
        var request = URLRequest(url: url)
        request.timeoutInterval = 15
        request.setValue("Bearer \(account.token)", forHTTPHeaderField: "Authorization")
        do {
            let (data, response) = try await session.data(for: request)
            guard let http = response as? HTTPURLResponse else {
                return .failure("FleetBar could not reach the account service.")
            }
            guard http.statusCode == 200,
                  let envelope = try? JSONDecoder().decode(WhoamiEnvelope.self, from: data)
            else {
                return .failure(http.statusCode == 401 || http.statusCode == 403
                    ? "The saved connection is no longer accepted. Reconnect your account."
                    : "The account service did not confirm this connection.")
            }
            return .success(Identity(
                login: envelope.user.login,
                relayUrl: account.relayUrl,
                lastVerified: now()
            ))
        } catch {
            return .failure("FleetBar could not reach the account service.")
        }
    }

    private struct DeviceStartEnvelope: Decodable {
        let deviceCode: String
        let userCode: String
        let verificationUri: String
        let expiresIn: Int
        let interval: Int

        enum CodingKeys: String, CodingKey {
            case deviceCode = "device_code"
            case userCode = "user_code"
            case verificationUri = "verification_uri"
            case expiresIn = "expires_in"
            case interval
        }
    }

    private struct DeviceTokenRequest: Encodable {
        let deviceCode: String
        let label: String
        enum CodingKeys: String, CodingKey { case deviceCode = "device_code", label }
    }

    private struct DeviceTokenEnvelope: Decodable {
        let token: String?
        let login: String?
        let pending: Bool?
        let error: String?
    }

    private struct WhoamiEnvelope: Decodable {
        struct User: Decodable { let login: String }
        let user: User
    }
}
