import CryptoKit
import Foundation
import LocalAuthentication
import Security

enum OperatorRecoveryStatus: String, Codable, Equatable {
    case pending
    case approved
    case custodyPending = "custody-pending"
    case denied
    case expired
    case revoked
    case consumed
}

enum OperatorRecoveryDisplayState: String, Equatable {
    case pending
    case approved
    case custodyPending = "custody-pending"
    case denied
    case expired
    case revoked
    case consumed
    case driftRefused = "drift-refused"
    case replayRefused = "replay-refused"
}

enum OperatorRecoveryDecision: String, Codable, Equatable {
    case approve
    case deny
    case revoke
}

enum OperatorRecoveryClaimDisposition: String, Codable, Equatable {
    case transfer
    case release
}

struct OperatorRecoveryClaim: Identifiable, Codable, Equatable {
    let claimId: Int
    let nodeId: String
    let disposition: OperatorRecoveryClaimDisposition
    let repoId: String
    let worldKind: String
    let worldId: String
    let gitOid: String?
    let selectorKind: String
    let filePath: String
    let startLine: Int?
    let endLine: Int?
    let symbol: String?
    let symbolPath: String?
    let sessionId: String
    let purpose: String
    let agentId: String?
    let phase: String
    let mode: String
    let intent: String?
    let claimedAt: Int64
    let releasedAt: Int64?
    let observedBy: String?
    let confidence: Double
    let legacySessionFileId: Int?

    var id: String { nodeId }

    enum CodingKeys: String, CodingKey {
        case claimId = "id"
        case nodeId
        case disposition
        case repoId
        case worldKind
        case worldId
        case gitOid
        case selectorKind
        case filePath
        case startLine
        case endLine
        case symbol
        case symbolPath
        case sessionId
        case purpose
        case agentId
        case phase
        case mode
        case intent
        case claimedAt
        case releasedAt
        case observedBy
        case confidence
        case legacySessionFileId
    }

    var regionDescription: String? {
        var descriptors: [String] = []
        if let symbolPath, !symbolPath.isEmpty {
            descriptors.append("Symbol path \(symbolPath)")
        }
        if let symbol, !symbol.isEmpty {
            descriptors.append("Symbol \(symbol)")
        }
        switch (startLine, endLine) {
        case let (start?, end?) where start == end:
            descriptors.append("Line \(start)")
        case let (start?, end?):
            descriptors.append("Lines \(start)\u{2013}\(end)")
        case let (start?, nil):
            descriptors.append("From line \(start)")
        case let (nil, end?):
            descriptors.append("Through line \(end)")
        case (nil, nil):
            break
        }
        return descriptors.isEmpty ? nil : descriptors.joined(separator: " \u{00b7} ")
    }

    var accessibilitySummary: String {
        let action = disposition == .transfer ? "transfer" : "release"
        let region = regionDescription.map { ", \($0)" } ?? ", whole file"
        return "\(action) \(filePath)\(region), claim \(nodeId), selector \(selectorKind), owner session \(sessionId), mode \(mode)"
    }
}

struct OperatorRecoveryScope: Codable, Equatable {
    let actionHash: String
    let harbor: String
    let project: String
    let worktree: String
    let branch: String
    let predecessorSessionId: String
    let sessionIntent: String
    let actorId: String
    let intendedAgentId: String
    let daemonGeneration: String
    let nonce: String
    let expiresAt: Int64
    let bodyExpiresAt: Int64
    let jtiDigest: String
    let contextSlot: String?
    let priorContextDigest: String?
    let deviceKeyId: String?
    let enrollmentEventId: String?
    let enrollmentActivationEventId: String?
    let claims: [OperatorRecoveryClaim]
}

struct OperatorRecoverySigningPrompt: Codable, Equatable {
    let challengeBytesBase64: String
    let challengeDigest: String
}

struct OperatorRecoverySigningPrompts: Codable, Equatable {
    let approve: OperatorRecoverySigningPrompt?
    let deny: OperatorRecoverySigningPrompt?
    let revoke: OperatorRecoverySigningPrompt?
}

struct OperatorRecoveryEvent: Codable, Equatable {
    let eventId: String
    let kind: String
    let ledgerSeq: Int
}

struct OperatorRecoveryLedgerReceipt: Codable, Equatable {
    let ledgerSequences: [Int]
    let eventIds: [String]
    let terminalAuthorityEventId: String?
    let terminalEventId: String?
}

struct OperatorRecoveryBindingReceipt: Codable, Equatable {
    let predecessorSessionId: String?
    let successorSessionId: String
    let actorId: String?
    let intendedAgentId: String?
    let transferredClaimNodeIds: [String]
    let releasedClaimNodeIds: [String]
    let boundAt: Int64?
}

struct OperatorRecoveryCustodyReceipt: Codable, Equatable {
    let installed: Bool
    let contextSlot: String
    let canonicalWorktree: String
    let mode: Int
}

struct OperatorRecoveryBodyScopeReceipt: Codable, Equatable {
    let harbor: String
    let sessionId: String
    let project: String
    let canonicalWorktree: String
    let branch: String
}

struct OperatorRecoveryBodyCredentialReceipt: Codable, Equatable {
    let bodyId: String
    let actorId: String
    let intendedAgentId: String
    let scopeProfile: String
    let scope: OperatorRecoveryBodyScopeReceipt
    let issuedAt: Int64
    let expiresAt: Int64
}

struct OperatorRecoveryItem: Identifiable, Codable, Equatable {
    let recoveryId: String
    let status: OperatorRecoveryStatus
    let scope: OperatorRecoveryScope
    let signing: OperatorRecoverySigningPrompts?
    let successorSessionId: String?
    let ledgerReceipt: OperatorRecoveryLedgerReceipt
    let events: [OperatorRecoveryEvent]
    var binding: OperatorRecoveryBindingReceipt?
    var bodyCredential: OperatorRecoveryBodyCredentialReceipt?
    var custody: OperatorRecoveryCustodyReceipt?

    var id: String { recoveryId }

    enum CodingKeys: String, CodingKey {
        case recoveryId
        case status
        case scope
        case signing
        case successorSessionId
        case ledgerReceipt = "receipt"
        case events
        case binding
        case bodyCredential
        case custody
    }

    var displayState: OperatorRecoveryDisplayState {
        // The daemon's canonical authority projection wins once it is
        // terminal. Replay/drift events appended afterward are audit evidence,
        // not a rewrite of a consumed, denied, expired, or revoked outcome.
        switch status {
        case .consumed, .denied, .expired, .revoked:
            return OperatorRecoveryDisplayState(rawValue: status.rawValue) ?? .pending
        case .pending, .approved, .custodyPending:
            break
        }
        switch events.last?.kind {
        case "drift-refused": return .driftRefused
        case "replay-refused": return .replayRefused
        default:
            return OperatorRecoveryDisplayState(rawValue: status.rawValue) ?? .pending
        }
    }

    func prompt(for decision: OperatorRecoveryDecision) -> OperatorRecoverySigningPrompt? {
        switch decision {
        case .approve: return signing?.approve
        case .deny: return signing?.deny
        case .revoke: return signing?.revoke
        }
    }

    var displayReceipt: OperatorRecoveryReceipt? {
        switch displayState {
        case .pending:
            return nil
        case .approved:
            return OperatorRecoveryReceipt(
                tone: .success,
                title: "Recovery approved",
                detail: "The one-shot grant is ready for the exact successor session shown above.",
                ledgerReceipt: ledgerReceipt,
                successorSessionId: successorSessionId,
                binding: binding,
                bodyCredential: bodyCredential,
                custody: custody
            )
        case .custodyPending:
            return OperatorRecoveryReceipt(
                tone: .warning,
                title: "Successor bound; custody pending",
                detail: "The daemon committed the successor and is retrying owner-only installation into the exact signed context slot.",
                ledgerReceipt: ledgerReceipt,
                successorSessionId: binding?.successorSessionId ?? successorSessionId,
                binding: binding,
                bodyCredential: bodyCredential,
                custody: custody
            )
        case .denied:
            return OperatorRecoveryReceipt(
                tone: .failure,
                title: "Recovery denied",
                detail: "No recovery authority was granted and the predecessor remains unchanged.",
                ledgerReceipt: ledgerReceipt,
                successorSessionId: nil,
                binding: binding,
                bodyCredential: bodyCredential,
                custody: custody
            )
        case .expired:
            let successorWasBound = binding != nil || successorSessionId != nil
            return OperatorRecoveryReceipt(
                tone: .failure,
                title: "Recovery expired",
                detail: successorWasBound
                    ? "The successor and claim changes were committed, but owner-only credential custody expired before installation."
                    : "The bounded approval window closed without restoring authority.",
                ledgerReceipt: ledgerReceipt,
                successorSessionId: binding?.successorSessionId ?? successorSessionId,
                binding: binding,
                bodyCredential: bodyCredential,
                custody: custody
            )
        case .revoked:
            return OperatorRecoveryReceipt(
                tone: .failure,
                title: "Recovery revoked",
                detail: "The approved one-shot grant can no longer be consumed.",
                ledgerReceipt: ledgerReceipt,
                successorSessionId: nil,
                binding: binding,
                bodyCredential: bodyCredential,
                custody: custody
            )
        case .consumed:
            return OperatorRecoveryReceipt(
                tone: .success,
                title: "Continuity restored",
                detail: "A successor session was bound to the same durable actor.",
                ledgerReceipt: ledgerReceipt,
                successorSessionId: binding?.successorSessionId ?? successorSessionId,
                binding: binding,
                bodyCredential: bodyCredential,
                custody: custody
            )
        case .driftRefused:
            return OperatorRecoveryReceipt(
                tone: .failure,
                title: "Recovery refused after drift",
                detail: "Live project, worktree, branch, actor, session, or claim state no longer matched the signed scope.",
                ledgerReceipt: ledgerReceipt,
                successorSessionId: nil,
                binding: binding,
                bodyCredential: bodyCredential,
                custody: custody
            )
        case .replayRefused:
            return OperatorRecoveryReceipt(
                tone: .failure,
                title: "Replay refused",
                detail: "This one-shot authority was already consumed or otherwise made terminal.",
                ledgerReceipt: ledgerReceipt,
                successorSessionId: binding?.successorSessionId ?? successorSessionId,
                binding: binding,
                bodyCredential: bodyCredential,
                custody: custody
            )
        }
    }
}

enum OperatorRecoveryReceiptTone: Equatable {
    case success
    case warning
    case failure
}

struct OperatorRecoveryReceipt: Equatable {
    let tone: OperatorRecoveryReceiptTone
    let title: String
    let detail: String
    let ledgerReceipt: OperatorRecoveryLedgerReceipt
    let successorSessionId: String?
    let binding: OperatorRecoveryBindingReceipt?
    let bodyCredential: OperatorRecoveryBodyCredentialReceipt?
    let custody: OperatorRecoveryCustodyReceipt?
}

enum OperatorPresenceSignerAvailability: Equatable {
    case available(deviceKeyId: String)
    case unavailable(code: String, reason: String)

    var unavailableReason: String? {
        if case let .unavailable(_, reason) = self { return reason }
        return nil
    }
}

struct OperatorPresenceSignature: Equatable {
    let deviceKeyId: String
    let publicKeyX963: Data
    let signatureDer: Data
}

@MainActor
protocol OperatorPresenceSigning: AnyObject {
    var availability: OperatorPresenceSignerAvailability { get }
    func sign(challenge: Data, reason: String) async throws -> OperatorPresenceSignature
}

enum OperatorPresenceSigningError: LocalizedError {
    case untrustedBuild
    case secureEnclaveUnavailable
    case enrollmentRequired
    case biometricUnavailable(String)
    case keyReferenceInvalid
    case accessControlUnavailable

    var errorDescription: String? {
        switch self {
        case .untrustedBuild:
            return "Operator recovery is available only in the exact signed production FleetBar."
        case .secureEnclaveUnavailable:
            return "Secure Enclave is unavailable on this Mac; operator recovery remains locked."
        case .enrollmentRequired:
            return "No provenance-pinned operator key is enrolled. Enrollment requires the signed native bootstrap."
        case let .biometricUnavailable(reason):
            return "Touch ID is unavailable: \(reason)"
        case .keyReferenceInvalid:
            return "The enrolled Secure Enclave key reference is invalid; recovery remains locked."
        case .accessControlUnavailable:
            return "Biometric private-key access control could not be created."
        }
    }
}

enum OperatorKeyActivationState: String, Codable, Equatable {
    case pending
    case active
}

struct EnrolledOperatorKeyReference: Codable, Equatable {
    let deviceKeyId: String
    let publicKeyX963: Data
    /// Keychain application tag, not key material. The private key is a
    /// permanent Secure Enclave SecKey and is never serialized.
    let applicationTag: String
    let state: OperatorKeyActivationState
    /// Exact helper response and activation-command digests acknowledged by
    /// the daemon. Empty while pending; neither is authorization material.
    let activationResponseDigest: String?
    let activationCommandDigest: String?
}

enum OperatorKeyReferenceStore {
    static let service = "ai.portdaddy.FleetBar.operator-presence"
    static let account = "p256-secure-enclave-v1"

    static func load() throws -> EnrolledOperatorKeyReference? {
        let query: [CFString: Any] = [
            kSecClass: kSecClassGenericPassword,
            kSecAttrService: service,
            kSecAttrAccount: account,
            kSecReturnData: true,
            kSecMatchLimit: kSecMatchLimitOne,
        ]
        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = item as? Data else {
            throw NSError(domain: NSOSStatusErrorDomain, code: Int(status))
        }
        return try JSONDecoder().decode(EnrolledOperatorKeyReference.self, from: data)
    }

    static func save(_ reference: EnrolledOperatorKeyReference) throws {
        let data = try JSONEncoder().encode(reference)
        let identity: [CFString: Any] = [
            kSecClass: kSecClassGenericPassword,
            kSecAttrService: service,
            kSecAttrAccount: account,
        ]
        let updateStatus = SecItemUpdate(
            identity as CFDictionary,
            [kSecValueData: data] as CFDictionary
        )
        if updateStatus == errSecSuccess { return }
        guard updateStatus == errSecItemNotFound else {
            throw NSError(domain: NSOSStatusErrorDomain, code: Int(updateStatus))
        }
        var insert = identity
        insert[kSecValueData] = data
        let insertStatus = SecItemAdd(insert as CFDictionary, nil)
        guard insertStatus == errSecSuccess else {
            throw NSError(domain: NSOSStatusErrorDomain, code: Int(insertStatus))
        }
    }
}

struct OperatorPresenceEnrollmentMaterial {
    let deviceKeyId: String
    let publicKeyX963: Data
    let applicationTag: String
    let state: OperatorKeyActivationState
}

enum OperatorSecureEnclaveKeyStore {
    static let applicationTag = "ai.portdaddy.FleetBar.operator-presence.se-p256.v1"

    private static var applicationTagData: Data { Data(applicationTag.utf8) }

    static func loadPrivateKey(authenticationContext: LAContext? = nil) throws -> SecKey? {
        var query: [CFString: Any] = [
            kSecClass: kSecClassKey,
            kSecAttrApplicationTag: applicationTagData,
            kSecAttrKeyType: kSecAttrKeyTypeECSECPrimeRandom,
            kSecReturnRef: true,
            kSecMatchLimit: kSecMatchLimitOne,
        ]
        if let authenticationContext {
            query[kSecUseAuthenticationContext] = authenticationContext
        } else {
            let nonInteractiveContext = LAContext()
            nonInteractiveContext.interactionNotAllowed = true
            query[kSecUseAuthenticationContext] = nonInteractiveContext
        }
        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let key = item else {
            throw NSError(domain: NSOSStatusErrorDomain, code: Int(status))
        }
        return (key as! SecKey)
    }

    static func publicKeyX963(for privateKey: SecKey) throws -> Data {
        guard let publicKey = SecKeyCopyPublicKey(privateKey) else {
            throw OperatorPresenceSigningError.keyReferenceInvalid
        }
        var error: Unmanaged<CFError>?
        guard let bytes = SecKeyCopyExternalRepresentation(publicKey, &error) as Data? else {
            _ = error?.takeRetainedValue()
            throw OperatorPresenceSigningError.keyReferenceInvalid
        }
        guard bytes.count == 65, bytes.first == 0x04 else {
            throw OperatorPresenceSigningError.keyReferenceInvalid
        }
        return bytes
    }

    static func ensureEnrollmentMaterial() throws -> OperatorPresenceEnrollmentMaterial {
        if let key = try loadPrivateKey() {
            let publicKey = try publicKeyX963(for: key)
            return try material(for: publicKey)
        }

        var accessError: Unmanaged<CFError>?
        guard let access = SecAccessControlCreateWithFlags(
            nil,
            kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
            [.privateKeyUsage, .biometryCurrentSet],
            &accessError
        ) else {
            _ = accessError?.takeRetainedValue()
            throw OperatorPresenceSigningError.accessControlUnavailable
        }
        let attributes: [CFString: Any] = [
            kSecAttrKeyType: kSecAttrKeyTypeECSECPrimeRandom,
            kSecAttrKeySizeInBits: 256,
            kSecAttrTokenID: kSecAttrTokenIDSecureEnclave,
            kSecPrivateKeyAttrs: [
                kSecAttrIsPermanent: true,
                kSecAttrApplicationTag: applicationTagData,
                kSecAttrAccessControl: access,
            ] as [CFString: Any],
        ]
        var creationError: Unmanaged<CFError>?
        guard let key = SecKeyCreateRandomKey(attributes as CFDictionary, &creationError) else {
            _ = creationError?.takeRetainedValue()
            throw OperatorPresenceSigningError.secureEnclaveUnavailable
        }
        return try material(for: publicKeyX963(for: key))
    }

    private static func material(for publicKey: Data) throws -> OperatorPresenceEnrollmentMaterial {
        let digest = sha256Digest(publicKey)
        let deviceKeyId = "se-p256:\(digest.dropFirst("sha256:".count))"
        if let metadata = try OperatorKeyReferenceStore.load() {
            guard metadata.applicationTag == applicationTag,
                  metadata.deviceKeyId == deviceKeyId,
                  metadata.publicKeyX963 == publicKey else {
                throw OperatorPresenceSigningError.keyReferenceInvalid
            }
            return OperatorPresenceEnrollmentMaterial(
                deviceKeyId: deviceKeyId,
                publicKeyX963: publicKey,
                applicationTag: applicationTag,
                state: metadata.state
            )
        }
        let pending = EnrolledOperatorKeyReference(
            deviceKeyId: deviceKeyId,
            publicKeyX963: publicKey,
            applicationTag: applicationTag,
            state: .pending,
            activationResponseDigest: nil,
            activationCommandDigest: nil
        )
        try OperatorKeyReferenceStore.save(pending)
        return OperatorPresenceEnrollmentMaterial(
            deviceKeyId: deviceKeyId,
            publicKeyX963: publicKey,
            applicationTag: applicationTag,
            state: .pending
        )
    }

    static func activate(
        material: OperatorPresenceEnrollmentMaterial,
        responseDigest: String,
        activationCommandDigest: String
    ) throws -> OperatorPresenceEnrollmentMaterial {
        guard responseDigest.hasPrefix("sha256:"), responseDigest.count == 71,
              activationCommandDigest.hasPrefix("sha256:"), activationCommandDigest.count == 71 else {
            throw OperatorPresenceSigningError.keyReferenceInvalid
        }
        guard let existing = try OperatorKeyReferenceStore.load(),
              existing.deviceKeyId == material.deviceKeyId,
              existing.publicKeyX963 == material.publicKeyX963,
              existing.applicationTag == applicationTag else {
            throw OperatorPresenceSigningError.keyReferenceInvalid
        }
        try OperatorKeyReferenceStore.save(EnrolledOperatorKeyReference(
            deviceKeyId: existing.deviceKeyId,
            publicKeyX963: existing.publicKeyX963,
            applicationTag: existing.applicationTag,
            state: .active,
            activationResponseDigest: responseDigest,
            activationCommandDigest: activationCommandDigest
        ))
        guard let activated = try OperatorKeyReferenceStore.load(),
              activated.deviceKeyId == material.deviceKeyId,
              activated.publicKeyX963 == material.publicKeyX963,
              activated.applicationTag == applicationTag,
              activated.state == .active,
              activated.activationResponseDigest == responseDigest,
              activated.activationCommandDigest == activationCommandDigest else {
            throw OperatorPresenceSigningError.keyReferenceInvalid
        }
        return OperatorPresenceEnrollmentMaterial(
            deviceKeyId: activated.deviceKeyId,
            publicKeyX963: activated.publicKeyX963,
            applicationTag: activated.applicationTag,
            state: activated.state
        )
    }

    static func signature(
        challenge: Data,
        authenticationContext: LAContext
    ) throws -> Data {
        guard let privateKey = try loadPrivateKey(authenticationContext: authenticationContext) else {
            throw OperatorPresenceSigningError.keyReferenceInvalid
        }
        var error: Unmanaged<CFError>?
        guard let signature = SecKeyCreateSignature(
            privateKey,
            .ecdsaSignatureMessageX962SHA256,
            challenge as CFData,
            &error
        ) as Data? else {
            _ = error?.takeRetainedValue()
            throw OperatorPresenceSigningError.keyReferenceInvalid
        }
        return signature
    }
}

func sha256Digest(_ data: Data) -> String {
    "sha256:" + SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
}

/// Real signer for a key previously pinned by the signed native bootstrap.
/// This type deliberately has no HTTP enrollment method.
@MainActor
final class SecureEnclaveOperatorPresenceSigner: OperatorPresenceSigning {
    private let exactProductionBuild: () -> Bool

    init(exactProductionBuild: @escaping () -> Bool = { FleetVersion.isExactProductionBuild }) {
        self.exactProductionBuild = exactProductionBuild
    }

    var availability: OperatorPresenceSignerAvailability {
        guard exactProductionBuild() else {
            return .unavailable(code: "UNTRUSTED_BUILD", reason: OperatorPresenceSigningError.untrustedBuild.localizedDescription)
        }
        guard SecureEnclave.isAvailable else {
            return .unavailable(code: "SECURE_ENCLAVE_UNAVAILABLE", reason: OperatorPresenceSigningError.secureEnclaveUnavailable.localizedDescription)
        }
        do {
            guard let enrolled = try OperatorKeyReferenceStore.load(),
                  enrolled.state == .active else {
                return .unavailable(code: "ENROLLMENT_REQUIRED", reason: OperatorPresenceSigningError.enrollmentRequired.localizedDescription)
            }
            guard (try OperatorSecureEnclaveKeyStore.loadPrivateKey()) != nil else {
                return .unavailable(code: "KEY_REFERENCE_INVALID", reason: OperatorPresenceSigningError.keyReferenceInvalid.localizedDescription)
            }
            return .available(deviceKeyId: enrolled.deviceKeyId)
        } catch {
            return .unavailable(code: "KEY_REFERENCE_INVALID", reason: OperatorPresenceSigningError.keyReferenceInvalid.localizedDescription)
        }
    }

    func sign(challenge: Data, reason: String) async throws -> OperatorPresenceSignature {
        guard exactProductionBuild() else { throw OperatorPresenceSigningError.untrustedBuild }
        guard SecureEnclave.isAvailable else { throw OperatorPresenceSigningError.secureEnclaveUnavailable }
        guard let enrolled = try OperatorKeyReferenceStore.load(),
              enrolled.state == .active else {
            throw OperatorPresenceSigningError.enrollmentRequired
        }

        let context = LAContext()
        context.localizedCancelTitle = "Keep locked"
        context.touchIDAuthenticationAllowableReuseDuration = 0
        var authenticationError: NSError?
        guard context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &authenticationError) else {
            throw OperatorPresenceSigningError.biometricUnavailable(
                authenticationError?.localizedDescription ?? "Touch ID is not configured"
            )
        }
        try await context.evaluatePolicy(
            .deviceOwnerAuthenticationWithBiometrics,
            localizedReason: reason
        )

        guard let privateKey = try OperatorSecureEnclaveKeyStore.loadPrivateKey(authenticationContext: context),
              try OperatorSecureEnclaveKeyStore.publicKeyX963(for: privateKey) == enrolled.publicKeyX963 else {
            throw OperatorPresenceSigningError.keyReferenceInvalid
        }
        let signature = try OperatorSecureEnclaveKeyStore.signature(
            challenge: challenge,
            authenticationContext: context
        )
        return OperatorPresenceSignature(
            deviceKeyId: enrolled.deviceKeyId,
            publicKeyX963: enrolled.publicKeyX963,
            signatureDer: signature
        )
    }

    /// Native-helper primitive only. The key is created permanently in Secure
    /// Enclave and only public metadata is returned. It remains pending until
    /// the daemon ACKs the exact helper response.
    static func createEnrollmentMaterialForNativeBootstrap() throws -> OperatorPresenceEnrollmentMaterial {
        guard FleetVersion.isExactProductionBuild else { throw OperatorPresenceSigningError.untrustedBuild }
        guard SecureEnclave.isAvailable else { throw OperatorPresenceSigningError.secureEnclaveUnavailable }
        return try OperatorSecureEnclaveKeyStore.ensureEnrollmentMaterial()
    }
}

// MARK: - Native enrollment helper

struct OperatorEnrollmentHelperRequest: Codable, Equatable {
    let protocolVersion: Int
    let operation: String
    let requestId: String
    let nonce: String
    let daemonGeneration: String
    let bootstrapId: String
    let expiresAtMs: Int64
    let challengeBytesBase64: String
    let challengeDigest: String
}

struct OperatorEnrollmentHelperResponse: Codable, Equatable {
    let protocolVersion: Int
    let operation: String
    let requestId: String
    let nonce: String
    let daemonGeneration: String
    let bootstrapId: String
    let expiresAtMs: Int64
    let challengeDigest: String
    let deviceKeyId: String
    let keyDigest: String
    let publicKeyX963Base64: String
    let signatureDerBase64: String
    let keyState: OperatorKeyActivationState
}

struct OperatorEnrollmentActivationCommand: Codable, Equatable {
    let protocolVersion: Int
    let operation: String
    let requestId: String
    let nonce: String
    let daemonGeneration: String
    let bootstrapId: String
    let expiresAtMs: Int64
    let challengeDigest: String
    let deviceKeyId: String
    let keyDigest: String
    let responseDigest: String
    let enrollmentEventId: String
    let activationEventId: String
    let activationNonce: String
}

struct OperatorEnrollmentActivationReceipt: Codable, Equatable {
    let protocolVersion: Int
    let operation: String
    let requestId: String
    let nonce: String
    let daemonGeneration: String
    let bootstrapId: String
    let expiresAtMs: Int64
    let challengeDigest: String
    let deviceKeyId: String
    let keyDigest: String
    let responseDigest: String
    let enrollmentEventId: String
    let activationEventId: String
    let activationNonce: String
    let activationCommandDigest: String
    let keyState: OperatorKeyActivationState
}

protocol OperatorEnrollmentKeyHandling {
    func prepare(challenge: Data, reason: String) throws
        -> (OperatorPresenceEnrollmentMaterial, Data)
    func activate(
        material: OperatorPresenceEnrollmentMaterial,
        responseDigest: String,
        activationCommandDigest: String
    ) throws -> OperatorPresenceEnrollmentMaterial
}

private final class SynchronousAuthenticationResult: @unchecked Sendable {
    private let lock = NSLock()
    private var value: Result<Void, Error>?

    func set(_ result: Result<Void, Error>) {
        lock.lock()
        value = result
        lock.unlock()
    }

    func get() -> Result<Void, Error>? {
        lock.lock()
        defer { lock.unlock() }
        return value
    }
}

struct SecureEnclaveOperatorEnrollmentKeyHandler: OperatorEnrollmentKeyHandling {
    func prepare(challenge: Data, reason: String) throws
        -> (OperatorPresenceEnrollmentMaterial, Data) {
        guard FleetVersion.isExactProductionBuild else {
            throw OperatorPresenceSigningError.untrustedBuild
        }
        guard SecureEnclave.isAvailable else {
            throw OperatorPresenceSigningError.secureEnclaveUnavailable
        }
        let material = try OperatorSecureEnclaveKeyStore.ensureEnrollmentMaterial()
        let context = LAContext()
        context.localizedCancelTitle = "Keep locked"
        context.touchIDAuthenticationAllowableReuseDuration = 0
        var authenticationError: NSError?
        guard context.canEvaluatePolicy(
            .deviceOwnerAuthenticationWithBiometrics,
            error: &authenticationError
        ) else {
            throw OperatorPresenceSigningError.biometricUnavailable(
                authenticationError?.localizedDescription ?? "Touch ID is not configured"
            )
        }
        let semaphore = DispatchSemaphore(value: 0)
        let result = SynchronousAuthenticationResult()
        context.evaluatePolicy(
            .deviceOwnerAuthenticationWithBiometrics,
            localizedReason: reason
        ) { success, error in
            if success {
                result.set(.success(()))
            } else {
                result.set(.failure(error ?? OperatorPresenceSigningError.biometricUnavailable("authentication was refused")))
            }
            semaphore.signal()
        }
        semaphore.wait()
        try result.get()?.get()
        let signature = try OperatorSecureEnclaveKeyStore.signature(
            challenge: challenge,
            authenticationContext: context
        )
        return (material, signature)
    }

    func activate(
        material: OperatorPresenceEnrollmentMaterial,
        responseDigest: String,
        activationCommandDigest: String
    ) throws -> OperatorPresenceEnrollmentMaterial {
        try OperatorSecureEnclaveKeyStore.activate(
            material: material,
            responseDigest: responseDigest,
            activationCommandDigest: activationCommandDigest
        )
    }
}

enum OperatorEnrollmentHelperError: LocalizedError {
    case malformedFrame
    case oversizedFrame
    case truncatedFrame
    case invalidRequest(String)
    case invalidAck
    case extraInput

    var errorDescription: String? {
        switch self {
        case .malformedFrame: return "operator enrollment helper received a malformed frame"
        case .oversizedFrame: return "operator enrollment helper frame exceeds the 96 KiB limit"
        case .truncatedFrame: return "operator enrollment helper frame was truncated"
        case let .invalidRequest(reason): return "operator enrollment helper request was refused: \(reason)"
        case .invalidAck: return "operator enrollment helper activation ACK did not match the response"
        case .extraInput: return "operator enrollment helper received an unexpected extra frame"
        }
    }
}

enum OperatorEnrollmentHelper {
    static let argument = "--operator-enrollment-helper"
    static let protocolVersion = 2
    static let maxFrameBytes = 96 * 1024
    static let maxChallengeBytes = 64 * 1024
    static let maxLifetimeMs: Int64 = 2 * 60 * 1000

    private struct PreparedResponse {
        let response: OperatorEnrollmentHelperResponse
        let material: OperatorPresenceEnrollmentMaterial
        let payload: Data
        let digest: String
    }

    static func run(
        input: FileHandle = .standardInput,
        output: FileHandle = .standardOutput,
        activationOutput: FileHandle = FileHandle(fileDescriptor: 3, closeOnDealloc: false),
        errorOutput: FileHandle = .standardError,
        keyHandler: OperatorEnrollmentKeyHandling = SecureEnclaveOperatorEnrollmentKeyHandler(),
        nowMs: () -> Int64 = { Int64(Date().timeIntervalSince1970 * 1000) }
    ) -> Int32 {
        do {
            let requestPayload = try readFrame(from: input)
            let request = try JSONDecoder().decode(
                OperatorEnrollmentHelperRequest.self,
                from: requestPayload
            )
            let prepared = try prepare(
                request: request,
                keyHandler: keyHandler,
                nowMs: nowMs()
            )
            try writeFrame(prepared.payload, to: output)
            // Half-close the response channel after exactly one frame. The
            // daemon requires EOF before it durably pins the key, while this
            // process remains alive on stdin awaiting the activation ACK.
            try output.close()

            let activationCommandPayload = try readFrame(from: input)
            let activationCommand = try JSONDecoder().decode(
                OperatorEnrollmentActivationCommand.self,
                from: activationCommandPayload
            )
            guard activationCommandMatches(
                activationCommand,
                request: request,
                prepared: prepared
            ) else {
                throw OperatorEnrollmentHelperError.invalidAck
            }
            let activationCommandDigest = sha256Digest(activationCommandPayload)
            let activated = try keyHandler.activate(
                material: prepared.material,
                responseDigest: prepared.digest,
                activationCommandDigest: activationCommandDigest
            )
            guard activated.deviceKeyId == prepared.response.deviceKeyId,
                  activated.publicKeyX963 == prepared.material.publicKeyX963,
                  activated.applicationTag == prepared.material.applicationTag,
                  activated.state == .active else {
                throw OperatorPresenceSigningError.keyReferenceInvalid
            }
            let activationReceipt = OperatorEnrollmentActivationReceipt(
                protocolVersion: protocolVersion,
                operation: "enrollment-activated",
                requestId: request.requestId,
                nonce: request.nonce,
                daemonGeneration: request.daemonGeneration,
                bootstrapId: request.bootstrapId,
                expiresAtMs: request.expiresAtMs,
                challengeDigest: request.challengeDigest,
                deviceKeyId: prepared.response.deviceKeyId,
                keyDigest: prepared.response.keyDigest,
                responseDigest: prepared.digest,
                enrollmentEventId: activationCommand.enrollmentEventId,
                activationEventId: activationCommand.activationEventId,
                activationNonce: activationCommand.activationNonce,
                activationCommandDigest: activationCommandDigest,
                keyState: .active
            )
            let encoder = JSONEncoder()
            encoder.outputFormatting = [.sortedKeys]
            try writeFrame(try encoder.encode(activationReceipt), to: activationOutput)
            try activationOutput.close()
            // The helper remains alive until the daemon validates and records
            // the activation receipt, then closes the command pipe. Any
            // trailing byte is a protocol-smuggling attempt.
            if let trailing = try input.read(upToCount: 1), !trailing.isEmpty {
                throw OperatorEnrollmentHelperError.extraInput
            }
            return 0
        } catch {
            let message = "operator enrollment helper refused: \(error.localizedDescription)\n"
            if let data = message.data(using: .utf8) {
                try? errorOutput.write(contentsOf: data.prefix(2_048))
            }
            return 64
        }
    }

    static func prepareForTesting(
        request: OperatorEnrollmentHelperRequest,
        keyHandler: OperatorEnrollmentKeyHandling,
        nowMs: Int64
    ) throws -> OperatorEnrollmentHelperResponse {
        try prepare(request: request, keyHandler: keyHandler, nowMs: nowMs).response
    }

    private static func prepare(
        request: OperatorEnrollmentHelperRequest,
        keyHandler: OperatorEnrollmentKeyHandling,
        nowMs: Int64
    ) throws -> PreparedResponse {
        guard request.protocolVersion == protocolVersion,
              request.operation == "enroll",
              boundedIdentifier(request.requestId),
              boundedIdentifier(request.nonce),
              boundedIdentifier(request.daemonGeneration),
              boundedIdentifier(request.bootstrapId) else {
            throw OperatorEnrollmentHelperError.invalidRequest("protocol or binding fields are invalid")
        }
        guard request.expiresAtMs > nowMs,
              request.expiresAtMs - nowMs <= maxLifetimeMs else {
            throw OperatorEnrollmentHelperError.invalidRequest("request is expired or exceeds the two-minute lifetime")
        }
        guard let challenge = Data(base64Encoded: request.challengeBytesBase64),
              challenge.base64EncodedString() == request.challengeBytesBase64,
              !challenge.isEmpty,
              challenge.count <= maxChallengeBytes,
              sha256Digest(challenge) == request.challengeDigest else {
            throw OperatorEnrollmentHelperError.invalidRequest("challenge bytes or digest are invalid")
        }
        let (material, signature) = try keyHandler.prepare(
            challenge: challenge,
            reason: "Enroll this exact Port Daddy operator key with Touch ID"
        )
        guard material.publicKeyX963.count == 65,
              material.publicKeyX963.first == 0x04 else {
            throw OperatorPresenceSigningError.keyReferenceInvalid
        }
        let keyDigest = sha256Digest(material.publicKeyX963)
        guard material.deviceKeyId == "se-p256:\(keyDigest.dropFirst("sha256:".count))" else {
            throw OperatorPresenceSigningError.keyReferenceInvalid
        }
        let response = OperatorEnrollmentHelperResponse(
            protocolVersion: protocolVersion,
            operation: "enrollment-response",
            requestId: request.requestId,
            nonce: request.nonce,
            daemonGeneration: request.daemonGeneration,
            bootstrapId: request.bootstrapId,
            expiresAtMs: request.expiresAtMs,
            challengeDigest: request.challengeDigest,
            deviceKeyId: material.deviceKeyId,
            keyDigest: keyDigest,
            publicKeyX963Base64: material.publicKeyX963.base64EncodedString(),
            signatureDerBase64: signature.base64EncodedString(),
            keyState: material.state
        )
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        let payload = try encoder.encode(response)
        return PreparedResponse(
            response: response,
            material: material,
            payload: payload,
            digest: sha256Digest(payload)
        )
    }

    private static func activationCommandMatches(
        _ command: OperatorEnrollmentActivationCommand,
        request: OperatorEnrollmentHelperRequest,
        prepared: PreparedResponse
    ) -> Bool {
        command.protocolVersion == protocolVersion &&
            command.operation == "activate-enrollment" &&
            command.requestId == request.requestId &&
            command.nonce == request.nonce &&
            command.daemonGeneration == request.daemonGeneration &&
            command.bootstrapId == request.bootstrapId &&
            command.expiresAtMs == request.expiresAtMs &&
            command.challengeDigest == request.challengeDigest &&
            command.deviceKeyId == prepared.response.deviceKeyId &&
            command.keyDigest == prepared.response.keyDigest &&
            command.responseDigest == prepared.digest &&
            boundedIdentifier(command.enrollmentEventId) &&
            boundedIdentifier(command.activationEventId) &&
            boundedIdentifier(command.activationNonce)
    }

    private static func boundedIdentifier(_ value: String) -> Bool {
        !value.isEmpty && value.utf8.count <= 128 && !value.utf8.contains(0)
    }

    static func frame(_ payload: Data) throws -> Data {
        guard !payload.isEmpty else { throw OperatorEnrollmentHelperError.malformedFrame }
        guard payload.count <= maxFrameBytes else { throw OperatorEnrollmentHelperError.oversizedFrame }
        var length = UInt32(payload.count).bigEndian
        var framed = Data(bytes: &length, count: MemoryLayout<UInt32>.size)
        framed.append(payload)
        return framed
    }

    static func readFrame(from handle: FileHandle) throws -> Data {
        let prefix = try readExactly(4, from: handle)
        let length = prefix.withUnsafeBytes { raw -> UInt32 in
            raw.loadUnaligned(as: UInt32.self).bigEndian
        }
        guard length > 0 else { throw OperatorEnrollmentHelperError.malformedFrame }
        guard length <= maxFrameBytes else { throw OperatorEnrollmentHelperError.oversizedFrame }
        return try readExactly(Int(length), from: handle)
    }

    static func writeFrame(_ payload: Data, to handle: FileHandle) throws {
        try handle.write(contentsOf: frame(payload))
    }

    private static func readExactly(_ count: Int, from handle: FileHandle) throws -> Data {
        var data = Data()
        while data.count < count {
            guard let chunk = try handle.read(upToCount: count - data.count), !chunk.isEmpty else {
                throw OperatorEnrollmentHelperError.truncatedFrame
            }
            data.append(chunk)
        }
        return data
    }
}

private struct OperatorRecoverySignedDecisionEnvelope: Decodable {
    let schema: String
    let decision: OperatorRecoveryDecision
    let actionHash: String
    let recoveryId: String
    let harbor: String
    let intendedAgentId: String
    let project: String
    let worktree: String
    let branch: String
    let predecessorSessionId: String
    let sessionIntent: String
    let actorId: String
    let daemonGeneration: String
    let nonce: String
    let expiresAt: Int64
    let bodyExpiresAt: Int64
    let jtiDigest: String
    let contextSlot: String
    let priorContextDigest: String?
    let deviceKeyId: String
    let enrollmentEventId: String
    let enrollmentActivationEventId: String
    let claims: [OperatorRecoveryClaim]
}

private enum OperatorRecoveryContractValidator {
    static let decisionSchema = "pd.operator-recovery-decision.v0"
    static let maxSigningBytes = 64 * 1_024
    static let topLevelKeys: Set<String> = [
        "schema", "decision", "actionHash", "recoveryId", "harbor",
        "intendedAgentId", "project", "worktree", "branch",
        "predecessorSessionId", "sessionIntent", "actorId", "daemonGeneration",
        "nonce", "expiresAt", "bodyExpiresAt", "jtiDigest", "contextSlot",
        "priorContextDigest", "deviceKeyId", "enrollmentEventId",
        "enrollmentActivationEventId", "claims",
    ]
    static let claimKeys: Set<String> = [
        "id", "nodeId", "disposition", "repoId", "worldKind", "worldId",
        "gitOid", "selectorKind", "filePath", "startLine", "endLine", "symbol",
        "symbolPath", "sessionId", "purpose", "agentId", "phase", "mode",
        "intent", "claimedAt", "releasedAt", "observedBy", "confidence",
        "legacySessionFileId",
    ]

    static func validatePublicJSON(_ data: Data) throws {
        let forbidden = Set([
            "credential",
            "grant",
            "jti",
            "macaroonidentifier",
            "publickeyx963base64",
            "rootkey",
            "signature",
            "signaturederbase64",
        ])
        let root: Any
        do {
            root = try JSONSerialization.jsonObject(with: data)
        } catch {
            throw OperatorRecoveryClientError.contractViolation
        }
        func inspect(_ value: Any) throws {
            if let array = value as? [Any] {
                for entry in array { try inspect(entry) }
                return
            }
            guard let object = value as? [String: Any] else { return }
            for (key, nested) in object {
                guard !forbidden.contains(key.lowercased()) else {
                    throw OperatorRecoveryClientError.contractViolation
                }
                try inspect(nested)
            }
        }
        try inspect(root)
    }

    static func validatedSigningBytes(
        for item: OperatorRecoveryItem,
        decision: OperatorRecoveryDecision
    ) throws -> Data {
        guard let prompt = item.prompt(for: decision),
              let bytes = Data(base64Encoded: prompt.challengeBytesBase64),
              !bytes.isEmpty,
              bytes.count <= maxSigningBytes,
              bytes.base64EncodedString() == prompt.challengeBytesBase64,
              sha256Digest(bytes) == prompt.challengeDigest else {
            throw OperatorRecoveryClientError.contractViolation
        }
        guard let object = try JSONSerialization.jsonObject(with: bytes) as? [String: Any],
              Set(object.keys) == topLevelKeys,
              let rawClaims = object["claims"] as? [[String: Any]],
              rawClaims.allSatisfy({ Set($0.keys) == claimKeys }) else {
            throw OperatorRecoveryClientError.contractViolation
        }
        let envelope: OperatorRecoverySignedDecisionEnvelope
        do {
            envelope = try JSONDecoder().decode(OperatorRecoverySignedDecisionEnvelope.self, from: bytes)
        } catch {
            throw OperatorRecoveryClientError.contractViolation
        }
        let scope = item.scope
        guard envelope.schema == decisionSchema,
              envelope.decision == decision,
              envelope.recoveryId == item.recoveryId,
              envelope.actionHash == scope.actionHash,
              envelope.harbor == scope.harbor,
              envelope.intendedAgentId == scope.intendedAgentId,
              envelope.project == scope.project,
              envelope.worktree == scope.worktree,
              envelope.branch == scope.branch,
              envelope.predecessorSessionId == scope.predecessorSessionId,
              envelope.sessionIntent == scope.sessionIntent,
              envelope.actorId == scope.actorId,
              envelope.daemonGeneration == scope.daemonGeneration,
              envelope.nonce == scope.nonce,
              envelope.expiresAt == scope.expiresAt,
              envelope.bodyExpiresAt == scope.bodyExpiresAt,
              envelope.jtiDigest == scope.jtiDigest,
              envelope.contextSlot == scope.contextSlot,
              envelope.priorContextDigest == scope.priorContextDigest,
              envelope.deviceKeyId == scope.deviceKeyId,
              envelope.enrollmentEventId == scope.enrollmentEventId,
              envelope.enrollmentActivationEventId == scope.enrollmentActivationEventId,
              envelope.claims == scope.claims else {
            throw OperatorRecoveryClientError.contractViolation
        }
        return bytes
    }

    static func validateAdvance(
        from prior: OperatorRecoveryItem,
        to next: OperatorRecoveryItem
    ) throws {
        guard prior.recoveryId == next.recoveryId,
              prior.scope == next.scope,
              next.ledgerReceipt.ledgerSequences.starts(with: prior.ledgerReceipt.ledgerSequences),
              next.ledgerReceipt.eventIds.starts(with: prior.ledgerReceipt.eventIds),
              next.events.starts(with: prior.events) else {
            throw OperatorRecoveryClientError.contractViolation
        }
    }

    static func validateActionablePrompts(_ item: OperatorRecoveryItem) throws {
        switch item.status {
        case .pending:
            guard item.signing?.approve != nil,
                  item.signing?.deny != nil,
                  item.signing?.revoke == nil else {
                throw OperatorRecoveryClientError.contractViolation
            }
            _ = try validatedSigningBytes(for: item, decision: .approve)
            _ = try validatedSigningBytes(for: item, decision: .deny)
        case .approved:
            guard item.signing?.approve == nil,
                  item.signing?.deny == nil,
                  item.signing?.revoke != nil else {
                throw OperatorRecoveryClientError.contractViolation
            }
            _ = try validatedSigningBytes(for: item, decision: .revoke)
        case .custodyPending, .denied, .expired, .revoked, .consumed:
            guard item.signing == nil else {
                throw OperatorRecoveryClientError.contractViolation
            }
        }
    }

    static func validateReceipts(
        _ item: OperatorRecoveryItem,
        currentDaemonGeneration: String
    ) throws {
        let receipt = item.ledgerReceipt
        guard !item.events.isEmpty,
              receipt.ledgerSequences == item.events.map(\.ledgerSeq),
              receipt.eventIds == item.events.map(\.eventId),
              Set(receipt.eventIds).count == receipt.eventIds.count,
              zip(receipt.ledgerSequences, receipt.ledgerSequences.dropFirst())
                .allSatisfy({ $0 < $1 }),
              receipt.terminalEventId == item.events.last?.eventId else {
            throw OperatorRecoveryClientError.contractViolation
        }

        let isActionable = item.status == .pending || item.status == .approved
        guard !isActionable || item.scope.daemonGeneration == currentDaemonGeneration else {
            throw OperatorRecoveryClientError.contractViolation
        }

        let terminalKind: String?
        switch item.status {
        case .denied: terminalKind = "denied"
        case .expired: terminalKind = "expired"
        case .revoked: terminalKind = "grant-revoked"
        case .consumed: terminalKind = "context-custody-installed"
        case .pending, .approved, .custodyPending: terminalKind = nil
        }
        if let terminalKind {
            guard let authorityId = receipt.terminalAuthorityEventId,
                  item.events.contains(where: {
                      $0.eventId == authorityId && $0.kind == terminalKind
                  }) else {
                throw OperatorRecoveryClientError.contractViolation
            }
        } else if receipt.terminalAuthorityEventId != nil {
            throw OperatorRecoveryClientError.contractViolation
        }

        let hasBoundSuccessor = item.successorSessionId != nil
            || item.binding != nil
            || item.bodyCredential != nil
        switch item.status {
        case .custodyPending, .consumed:
            guard hasBoundSuccessor else {
                throw OperatorRecoveryClientError.contractViolation
            }
        case .expired:
            break // Expiry can happen before binding or while sealed custody is pending.
        case .pending, .approved, .denied, .revoked:
            guard !hasBoundSuccessor, item.custody == nil else {
                throw OperatorRecoveryClientError.contractViolation
            }
        }

        if hasBoundSuccessor {
            guard let successor = item.successorSessionId,
                  let binding = item.binding,
                  let body = item.bodyCredential,
                  binding.predecessorSessionId == item.scope.predecessorSessionId,
                  binding.successorSessionId == successor,
                  binding.actorId == item.scope.actorId,
                  binding.intendedAgentId == item.scope.intendedAgentId,
                  binding.boundAt != nil,
                  binding.transferredClaimNodeIds.sorted() == item.scope.claims
                    .filter({ $0.disposition == .transfer }).map(\.nodeId).sorted(),
                  binding.releasedClaimNodeIds.sorted() == item.scope.claims
                    .filter({ $0.disposition == .release }).map(\.nodeId).sorted(),
                  body.actorId == item.scope.actorId,
                  body.intendedAgentId == item.scope.intendedAgentId,
                  body.scopeProfile == "session-body-v1",
                  body.scope.harbor == item.scope.harbor,
                  body.scope.sessionId == successor,
                  body.scope.project == item.scope.project,
                  body.scope.canonicalWorktree == item.scope.worktree,
                  body.scope.branch == item.scope.branch,
                  body.issuedAt < body.expiresAt,
                  body.expiresAt == item.scope.bodyExpiresAt else {
                throw OperatorRecoveryClientError.contractViolation
            }
        }

        if item.status == .consumed {
            guard let custody = item.custody,
                  custody.installed,
                  custody.contextSlot == item.scope.contextSlot,
                  custody.canonicalWorktree == item.scope.worktree,
                  custody.mode == 0o600 else {
                throw OperatorRecoveryClientError.contractViolation
            }
        } else if item.custody != nil {
            throw OperatorRecoveryClientError.contractViolation
        }
    }
}

private struct OperatorRecoveryListEnvelope: Codable {
    let success: Bool
    let count: Int
    let daemonGeneration: String
    let recoveries: [OperatorRecoveryItem]
}

private struct OperatorRecoveryErrorEnvelope: Codable {
    let code: String?
}

private enum OperatorRecoveryClientError: LocalizedError {
    case unreadableList
    case unreadableDecision
    case mismatchedRecovery
    case approvalDidNotSettle(OperatorRecoveryStatus)
    case missingBindingReceipt
    case missingCustodyReceipt
    case contractViolation

    var errorDescription: String? {
        switch self {
        case .unreadableList:
            return "The daemon returned an unreadable recovery list. Recovery remains locked."
        case .unreadableDecision:
            return "The daemon returned an unreadable signed-decision receipt. Recovery remains locked."
        case .mismatchedRecovery:
            return "The signed-decision receipt named a different recovery. Recovery remains locked."
        case let .approvalDidNotSettle(status):
            return "Approval did not reach a usable terminal state (\(status.rawValue)). Review the daemon receipt."
        case .missingBindingReceipt:
            return "The approved recovery omitted its successor binding receipt. Recovery remains locked."
        case .missingCustodyReceipt:
            return "The consumed recovery omitted its exact-slot custody receipt. Recovery remains locked."
        case .contractViolation:
            return "The daemon recovery contract did not match the exact scope shown here. Recovery remains locked."
        }
    }
}

private func safeOperatorRecoveryError(code: String?, fallback: String) -> String {
    switch code {
    case "OPERATOR_RECOVERY_CHALLENGE_DRIFTED",
         "OPERATOR_RECOVERY_DEVICE_DRIFTED",
         "OPERATOR_RECOVERY_DRIFTED",
         "OPERATOR_RECOVERY_GENERATION_DRIFTED",
         "OPERATOR_RECOVERY_GRANT_DRIFTED":
        return "The live recovery boundary no longer matches the signed scope. Review a fresh request."
    case "OPERATOR_RECOVERY_DECISION_REPLAYED",
         "OPERATOR_RECOVERY_ENROLLMENT_REPLAYED",
         "OPERATOR_RECOVERY_GRANT_REPLAYED":
        return "This one-shot recovery action was already used or made terminal."
    case "OPERATOR_RECOVERY_ENROLLMENT_EXPIRED",
         "OPERATOR_RECOVERY_GRANT_EXPIRED",
         "OPERATOR_RECOVERY_BODY_EXPIRED":
        return "This recovery request expired. Review a newly bounded request."
    case "OPERATOR_RECOVERY_GRANT_REVOKED":
        return "This recovery grant was revoked and can no longer be used."
    case "OPERATOR_RECOVERY_SIGNATURE_INVALID":
        return "Touch ID signed bytes that did not match the daemon's canonical recovery challenge."
    case "OPERATOR_RECOVERY_ENROLLMENT_REQUIRED",
         "OPERATOR_RECOVERY_PROVENANCE_UNPINNED":
        return "No provenance-pinned operator key is active; recovery remains locked."
    case "OPERATOR_RECOVERY_SIGNATURE_VERIFIER_UNAVAILABLE",
         "OPERATOR_RECOVERY_ENROLLMENT_HELPER_UNAVAILABLE":
        return "Native operator-presence verification is unavailable; recovery remains locked."
    case "OPERATOR_RECOVERY_CONTEXT_CUSTODY_UNAVAILABLE":
        return "Owner-only context custody is unavailable. The approved recovery remains unconsumed."
    case "OPERATOR_RECOVERY_CONTEXT_CUSTODY_FAILED":
        return "The successor is bound in sealed custody, but exact-slot installation must be retried."
    case "OPERATOR_RECOVERY_CUSTODY_DRIFTED",
         "OPERATOR_RECOVERY_BODY_ENVELOPE_DRIFTED",
         "OPERATOR_RECOVERY_BODY_ENVELOPE_UNAVAILABLE":
        return "The sealed successor custody no longer matches its signed receipt. Recovery remains locked."
    case "OPERATOR_RECOVERY_BINDING_READBACK_FAILED",
         "OPERATOR_RECOVERY_PREDECESSOR_NOT_FOUND",
         "OPERATOR_RECOVERY_PREDECESSOR_TERMINAL":
        return "The exact predecessor-to-successor binding could not be verified. Recovery remains locked."
    default:
        // Daemon error prose is intentionally never rendered. Authority-path
        // failures can contain echoed inputs; the UI uses curated structured
        // codes so credentials, signatures, and JTIs cannot leak into chrome.
        return fallback
    }
}

@MainActor
final class OperatorRecoveryStore: ObservableObject {
    @Published private(set) var recoveries: [OperatorRecoveryItem] = []
    @Published private(set) var decidingIds: Set<String> = []
    @Published var lastError: String?

    let signer: OperatorPresenceSigning
    private let baseURL: String?
    private let session: URLSession
    private nonisolated(unsafe) var refreshTimer: Timer?
    private var isRefreshing = false
    private var lastSuccessfulRefreshAt: Date?

    init(
        baseURL: String? = nil,
        session: URLSession = .shared,
        signer: OperatorPresenceSigning? = nil
    ) {
        self.baseURL = baseURL ?? DaemonLocation.availableBaseURL()
        self.session = session
        self.signer = signer ?? SecureEnclaveOperatorPresenceSigner()
    }

    var signerAvailability: OperatorPresenceSignerAvailability { signer.availability }

    var visibleRecoveries: [OperatorRecoveryItem] {
        Array(recoveries.prefix(5))
    }

    func start() {
        Task { await refresh() }
        refreshTimer?.invalidate()
        refreshTimer = Timer.scheduledTimer(withTimeInterval: 15, repeats: true) { [weak self] _ in
            Task { @MainActor [weak self] in await self?.refresh() }
        }
    }

    nonisolated func stop() {
        refreshTimer?.invalidate()
        refreshTimer = nil
    }

    func refresh() async {
        guard !isRefreshing else { return }
        isRefreshing = true
        defer { isRefreshing = false }
        guard let baseURL, let url = URL(string: "\(baseURL)/operator-recovery?limit=20") else { return }

        do {
            let (data, response) = try await session.data(from: url)
            guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode) else {
                let body = try? JSONDecoder().decode(OperatorRecoveryErrorEnvelope.self, from: data)
                lastError = safeOperatorRecoveryError(
                    code: body?.code,
                    fallback: "Operator recovery is unavailable."
                )
                return
            }
            let envelope: OperatorRecoveryListEnvelope
            do {
                try OperatorRecoveryContractValidator.validatePublicJSON(data)
                envelope = try JSONDecoder().decode(OperatorRecoveryListEnvelope.self, from: data)
            } catch let error as OperatorRecoveryClientError {
                throw error
            } catch {
                throw OperatorRecoveryClientError.unreadableList
            }
            guard envelope.success,
                  envelope.count == envelope.recoveries.count,
                  Set(envelope.recoveries.map(\.id)).count == envelope.recoveries.count else {
                throw OperatorRecoveryClientError.contractViolation
            }
            let existing = Dictionary(uniqueKeysWithValues: recoveries.map { ($0.id, $0) })
            for remote in envelope.recoveries {
                try OperatorRecoveryContractValidator.validateActionablePrompts(remote)
                try OperatorRecoveryContractValidator.validateReceipts(
                    remote,
                    currentDaemonGeneration: envelope.daemonGeneration
                )
                if let prior = existing[remote.id] {
                    try OperatorRecoveryContractValidator.validateAdvance(from: prior, to: remote)
                }
            }
            recoveries = envelope.recoveries
            lastSuccessfulRefreshAt = Date()
            lastError = nil
        } catch {
            lastError = error.localizedDescription
        }
    }

    func canDecide(_ recovery: OperatorRecoveryItem, decision: OperatorRecoveryDecision) -> Bool {
        let validState: Bool
        switch decision {
        case .approve, .deny:
            validState = recovery.status == .pending
        case .revoke:
            validState = recovery.status == .approved
        }
        guard validState,
              !isRefreshing,
              lastError == nil,
              lastSuccessfulRefreshAt != nil,
              !decidingIds.contains(recovery.id),
              recovery.scope.expiresAt > Int64(Date().timeIntervalSince1970 * 1_000),
              recoveries.first(where: { $0.id == recovery.id }) == recovery,
              (try? OperatorRecoveryContractValidator.validatedSigningBytes(
                  for: recovery,
                  decision: decision
              )) != nil else { return false }
        guard case let .available(deviceKeyId) = signer.availability else { return false }
        return recovery.scope.deviceKeyId == deviceKeyId
    }

    func canDecide(_ recovery: OperatorRecoveryItem) -> Bool {
        canDecide(recovery, decision: .approve)
    }

    private func reconcileAmbiguousDecision(
        recovery: OperatorRecoveryItem,
        decision: OperatorRecoveryDecision
    ) async -> Bool {
        guard let baseURL,
              let escapedId = recovery.id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed),
              let url = URL(string: "\(baseURL)/operator-recovery/\(escapedId)") else {
            return false
        }
        do {
            let (data, response) = try await session.data(from: url)
            guard let http = response as? HTTPURLResponse,
                  (200...299).contains(http.statusCode) else {
                return false
            }
            try OperatorRecoveryContractValidator.validatePublicJSON(data)
            guard let exact = try? JSONDecoder().decode(OperatorRecoveryItem.self, from: data),
                  exact.recoveryId == recovery.recoveryId,
                  exact.scope == recovery.scope else {
                return false
            }
            try OperatorRecoveryContractValidator.validateActionablePrompts(exact)
            try OperatorRecoveryContractValidator.validateAdvance(from: recovery, to: exact)
            try OperatorRecoveryContractValidator.validateReceipts(
                exact,
                currentDaemonGeneration: recovery.scope.daemonGeneration
            )
            let settled: Bool
            switch decision {
            case .approve:
                settled = exact.status == .consumed || exact.status == .custodyPending
            case .deny:
                settled = exact.status == .denied
            case .revoke:
                settled = exact.status == .revoked
            }
            guard settled else { return false }
            if let index = recoveries.firstIndex(where: { $0.id == exact.id }) {
                recoveries[index] = exact
            } else {
                recoveries.insert(exact, at: 0)
            }
            lastError = nil
            return true
        } catch {
            return false
        }
    }

    func decide(_ recovery: OperatorRecoveryItem, decision: OperatorRecoveryDecision) async {
        guard !decidingIds.contains(recovery.id) else { return }
        let challenge: Data
        do {
            challenge = try OperatorRecoveryContractValidator.validatedSigningBytes(
                for: recovery,
                decision: decision
            )
        } catch {
            lastError = error.localizedDescription
            return
        }
        guard canDecide(recovery, decision: decision) else {
            lastError = signer.availability.unavailableReason
                ?? "The enrolled operator key does not match this recovery challenge."
            return
        }
        guard let baseURL,
              let escapedId = recovery.id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed),
              let url = URL(string: "\(baseURL)/operator-recovery/\(escapedId)/decision") else { return }

        decidingIds.insert(recovery.id)
        defer { decidingIds.remove(recovery.id) }
        var decisionRequestWasSent = false
        do {
            let authenticationReason: String
            switch decision {
            case .approve:
                authenticationReason = "Approve this exact Port Daddy recovery with Touch ID"
            case .deny:
                authenticationReason = "Deny this exact Port Daddy recovery with Touch ID"
            case .revoke:
                authenticationReason = "Revoke this exact Port Daddy recovery with Touch ID"
            }
            let signature = try await signer.sign(
                challenge: challenge,
                reason: authenticationReason
            )
            // Touch ID is asynchronous. Re-read the current item after the
            // operator gesture so a refresh, expiry, or scope replacement
            // cannot submit a signature for pixels that are no longer current.
            guard lastError == nil,
                  recovery.scope.expiresAt > Int64(Date().timeIntervalSince1970 * 1_000),
                  recoveries.first(where: { $0.id == recovery.id }) == recovery,
                  try OperatorRecoveryContractValidator.validatedSigningBytes(
                      for: recovery,
                      decision: decision
                  ) == challenge,
                  signature.deviceKeyId == recovery.scope.deviceKeyId else {
                throw OperatorPresenceSigningError.keyReferenceInvalid
            }
            struct DecisionBody: Codable {
                let decision: OperatorRecoveryDecision
                let deviceKeyId: String
                let publicKeyX963Base64: String
                let signatureDerBase64: String
                let challengeDigest: String
            }
            var request = URLRequest(url: url)
            request.httpMethod = "POST"
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONEncoder().encode(DecisionBody(
                decision: decision,
                deviceKeyId: signature.deviceKeyId,
                publicKeyX963Base64: signature.publicKeyX963.base64EncodedString(),
                signatureDerBase64: signature.signatureDer.base64EncodedString(),
                challengeDigest: sha256Digest(challenge)
            ))
            decisionRequestWasSent = true
            let (data, response) = try await session.data(for: request)
            guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode) else {
                let body = try? JSONDecoder().decode(OperatorRecoveryErrorEnvelope.self, from: data)
                lastError = safeOperatorRecoveryError(
                    code: body?.code,
                    fallback: "Operator recovery decision was refused."
                )
                return
            }
            let decided: OperatorRecoveryItem
            do {
                try OperatorRecoveryContractValidator.validatePublicJSON(data)
                decided = try JSONDecoder().decode(OperatorRecoveryItem.self, from: data)
            } catch let error as OperatorRecoveryClientError {
                throw error
            } catch {
                throw OperatorRecoveryClientError.unreadableDecision
            }
            guard decided.recoveryId == recovery.recoveryId else {
                throw OperatorRecoveryClientError.mismatchedRecovery
            }
            try OperatorRecoveryContractValidator.validateActionablePrompts(decided)
            try OperatorRecoveryContractValidator.validateAdvance(from: recovery, to: decided)
            switch decision {
            case .approve:
                guard decided.status == .consumed || decided.status == .custodyPending else {
                    throw OperatorRecoveryClientError.approvalDidNotSettle(decided.status)
                }
                guard decided.binding != nil else {
                    throw OperatorRecoveryClientError.missingBindingReceipt
                }
                if decided.status == .consumed {
                    guard decided.custody?.installed == true else {
                        throw OperatorRecoveryClientError.missingCustodyReceipt
                    }
                }
            case .deny:
                guard decided.status == .denied else {
                    throw OperatorRecoveryClientError.unreadableDecision
                }
            case .revoke:
                guard decided.status == .revoked else {
                    throw OperatorRecoveryClientError.unreadableDecision
                }
            }
            try OperatorRecoveryContractValidator.validateReceipts(
                decided,
                currentDaemonGeneration: recovery.scope.daemonGeneration
            )
            if let index = recoveries.firstIndex(where: { $0.id == decided.id }) {
                recoveries[index] = decided
            } else {
                recoveries.insert(decided, at: 0)
            }
            lastError = nil
        } catch {
            if decisionRequestWasSent,
               await reconcileAmbiguousDecision(recovery: recovery, decision: decision) {
                return
            }
            lastError = error.localizedDescription
        }
    }
}
