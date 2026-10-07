import CryptoKit
import Foundation

/// Porthole evidence classes are not Drydock witness or Epistemology warrant classes.
/// The authoritative producer must enforce non-promotion from source provenance;
/// decoding this vocabulary alone does not establish the truth of a class label.
public enum PortholeEvidenceClass: String, Codable, CaseIterable, Sendable {
    case witnessed, reported, derived, inferred, unavailable
}

/// All offsets are seconds on the source's monotonic timeline, not wall-clock dates.
public struct PortholeMomentInterval: Codable, Equatable, Sendable {
    public let start: Double
    public let end: Double

    public init(start: Double, end: Double) { self.start = start; self.end = end }
    public var isValid: Bool { start.isFinite && end.isFinite && start >= 0 && end > start }
    public func contains(_ other: Self) -> Bool {
        isValid && other.isValid && start <= other.start && other.end <= end
    }
}

/// An exact source identity, not a path whose contents can change underneath a hit.
public struct PortholeRecallSource: Codable, Equatable, Sendable {
    public let id: String
    public let revision: String
    public let lineage: String
    public let scope: String
    public let policyRevision: String

    public init(id: String, revision: String, lineage: String, scope: String, policyRevision: String) {
        self.id = id; self.revision = revision; self.lineage = lineage
        self.scope = scope; self.policyRevision = policyRevision
    }
    fileprivate var isValid: Bool {
        [id, revision, lineage, scope, policyRevision].allSatisfy {
            !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && $0.utf8.count <= 1024
        }
    }
}

/// Versioned, content-free handoff for an existing search owner. The source and
/// derivative retain distinct revisions. Gaps remain explicit even on matching hits.
public struct PortholeMomentReference: Codable, Equatable, Sendable {
    public let schemaVersion: Int
    public let id: String
    public let revision: String
    public let source: PortholeRecallSource
    public let interval: PortholeMomentInterval
    public let gaps: [PortholeMomentInterval]
    public let transformations: [String]
    public let evidenceClass: PortholeEvidenceClass

    public init(schemaVersion: Int = 1, id: String, revision: String, source: PortholeRecallSource,
                interval: PortholeMomentInterval, gaps: [PortholeMomentInterval] = [],
                transformations: [String] = [], evidenceClass: PortholeEvidenceClass) {
        self.schemaVersion = schemaVersion; self.id = id; self.revision = revision; self.source = source
        self.interval = interval; self.gaps = gaps; self.transformations = transformations
        self.evidenceClass = evidenceClass
    }

    public var isValid: Bool {
        guard schemaVersion == 1, source.isValid, interval.isValid,
              !id.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, id.utf8.count <= 1024,
              !revision.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, revision.utf8.count <= 1024,
              gaps.count <= 256, transformations.count <= 32,
              transformations.allSatisfy({ !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && $0.utf8.count <= 1024 }),
              gaps.allSatisfy({ interval.contains($0) }) else { return false }
        // Ordered, non-overlapping gaps make downstream playback unambiguous.
        return zip(gaps, gaps.dropFirst()).allSatisfy { $0.0.end <= $0.1.start }
    }
}

public enum PortholeRecallOperation: String, Codable, CaseIterable, Sendable {
    case indexing, localAgentRecall, disclosure
}

/// Supplied by the authoritative consent store, never extracted from screen text.
/// A recording permission alone is deliberately not representable here.
public struct PortholeRecallGrant: Equatable, Sendable {
    public let source: PortholeRecallSource
    public let operation: PortholeRecallOperation
    public let principal: String
    public let purpose: String
    public let interval: PortholeMomentInterval
    public let issuedAt: Double
    public let expiresAt: Double

    public init(source: PortholeRecallSource, operation: PortholeRecallOperation, principal: String,
                purpose: String, interval: PortholeMomentInterval, issuedAt: Double, expiresAt: Double) {
        self.source = source; self.operation = operation; self.principal = principal; self.purpose = purpose
        self.interval = interval; self.issuedAt = issuedAt; self.expiresAt = expiresAt
    }
}

/// A synchronous authority snapshot; the eventual IO boundary must obtain this
/// and perform its effect under the same revocation/retention lock. This value
/// alone proves neither authentic consent nor process/network containment.
public struct PortholeRecallState: Equatable, Sendable {
    public let source: PortholeRecallSource
    public let retainedInterval: PortholeMomentInterval
    public let retainedUntil: Double
    public let revoked: Bool
    public let checkedAt: Double

    public init(source: PortholeRecallSource, retainedInterval: PortholeMomentInterval,
                retainedUntil: Double, revoked: Bool, checkedAt: Double) {
        self.source = source; self.retainedInterval = retainedInterval; self.retainedUntil = retainedUntil
        self.revoked = revoked; self.checkedAt = checkedAt
    }
}

/// Exact excerpt consent is separate from general disclosure permission. This
/// unsigned value must be loaded from the trusted user-approval store, not a model.
public struct PortholeExcerptApproval: Equatable, Sendable {
    public let moment: PortholeMomentReference
    public let digest: String
    public let destination: String
    public let principal: String
    public let purpose: String
    public let issuedAt: Double
    public let expiresAt: Double

    public init(moment: PortholeMomentReference, excerpt: Data, destination: String,
                principal: String, purpose: String, issuedAt: Double, expiresAt: Double) {
        self.moment = moment; self.digest = PortholeRecallPolicy.digest(excerpt)
        self.destination = destination; self.principal = principal; self.purpose = purpose
        self.issuedAt = issuedAt; self.expiresAt = expiresAt
    }
}

/// Pure admission predicates only: no capture, search, indexing, transport, or
/// automatic fallback. Callers must never treat a past true value as a lease.
public enum PortholeRecallPolicy {
    public static let maximumExcerptBytes = 1024 * 1024

    public static func digest(_ bytes: Data) -> String {
        SHA256.hash(data: bytes).map { String(format: "%02x", $0) }.joined()
    }

    public static func permits(_ operation: PortholeRecallOperation, moment: PortholeMomentReference,
                               principal: String, purpose: String, grant: PortholeRecallGrant,
                               state: PortholeRecallState, now: Double) -> Bool {
        // Disclosure never has a generic admission path: exact excerpt approval
        // is mandatory even when a general disclosure grant exists.
        operation != .disclosure && permitsGrant(operation, moment: moment, principal: principal,
            purpose: purpose, grant: grant, state: state, now: now)
    }

    private static func permitsGrant(_ operation: PortholeRecallOperation, moment: PortholeMomentReference,
                                     principal: String, purpose: String, grant: PortholeRecallGrant,
                                     state: PortholeRecallState, now: Double) -> Bool {
        guard moment.isValid, now.isFinite, now >= 0, state.checkedAt == now,
              !state.revoked, state.retainedUntil.isFinite, now < state.retainedUntil,
              state.source == moment.source, state.retainedInterval.contains(moment.interval),
              grant.source == moment.source, grant.operation == operation,
              !principal.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              !purpose.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              principal.utf8.count <= 1024, purpose.utf8.count <= 1024,
              grant.principal == principal, grant.purpose == purpose,
              grant.interval.contains(moment.interval),
              live(issuedAt: grant.issuedAt, expiresAt: grant.expiresAt, now: now) else { return false }
        return true
    }

    public static func permitsCloudExcerpt(_ excerpt: Data, destination: String,
                                           moment: PortholeMomentReference, principal: String,
                                           purpose: String, grant: PortholeRecallGrant,
                                           approval: PortholeExcerptApproval?, state: PortholeRecallState,
                                           now: Double) -> Bool {
        guard !excerpt.isEmpty, excerpt.count <= maximumExcerptBytes,
              !destination.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              destination.utf8.count <= 1024,
              permitsGrant(.disclosure, moment: moment, principal: principal, purpose: purpose,
                      grant: grant, state: state, now: now),
              let approval, approval.moment == moment, approval.principal == principal,
              approval.purpose == purpose, approval.destination == destination,
              live(issuedAt: approval.issuedAt, expiresAt: approval.expiresAt, now: now),
              approval.digest == digest(excerpt) else { return false }
        return true
    }

    private static func live(issuedAt: Double, expiresAt: Double, now: Double) -> Bool {
        issuedAt.isFinite && expiresAt.isFinite && issuedAt >= 0 && issuedAt <= now && now < expiresAt
    }
}
