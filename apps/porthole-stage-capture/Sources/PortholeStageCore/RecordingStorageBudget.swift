import Foundation

/// In-process accounting only: this does not reserve filesystem blocks, persist a
/// journal, recover a crashed writer, or establish a fresh free-disk observation.
/// A writer must reserve before creating any bytes, including derivatives and
/// temporary exports, and keep the reservation until writing has stopped.
public actor RecordingStorageBudget {
    public struct Limits: Sendable, Equatable {
        public let totalBytes: Int64
        public let freeDiskReserveBytes: Int64
        public let maximumReservations: Int

        public init(totalBytes: Int64 = 20 * 1_024 * 1_024 * 1_024,
                    freeDiskReserveBytes: Int64 = 10 * 1_024 * 1_024 * 1_024,
                    maximumReservations: Int = 4_096) {
            self.totalBytes = totalBytes
            self.freeDiskReserveBytes = freeDiskReserveBytes
            self.maximumReservations = maximumReservations
        }
    }

    public enum Purpose: String, Sendable, CaseIterable {
        case media, ocr, embedding, thumbnail, cachedResult, quarantine, temporaryExport
    }

    public enum Failure: Error, Equatable {
        case invalidValue, quotaExceeded, diskReserveExceeded, tooManyReservations
        case unknownReservation, exceedsReservation
    }

    /// Tokens are minted by one budget and cannot be constructed by callers.
    public struct Reservation: Sendable, Hashable {
        fileprivate let id: UUID
        public let bytes: Int64
        public let purpose: Purpose
    }

    public struct Snapshot: Sendable, Equatable {
        public let committedBytes: Int64
        public let reservedBytes: Int64
        public let pinnedBytes: Int64
        public let estimatedFreeDiskBytes: Int64
        public let reservationCount: Int
    }

    private let limits: Limits
    private var committedBytes: Int64
    private var pinnedBytes: Int64
    private var freeDiskBytes: Int64
    private var reservedBytes: Int64 = 0
    private var reservations: [UUID: Reservation] = [:]

    /// Existing usage includes all archive-owned bytes, including pinned content.
    /// Free disk is a caller-supplied baseline, not a measurement made here. The
    /// baseline must describe disk after existing usage; it is never credited
    /// back automatically. Concurrent external disk usage needs a writer gate.
    public init(limits: Limits = Limits(), existingBytes: Int64 = 0,
                existingPinnedBytes: Int64 = 0, availableDiskBytes: Int64) throws {
        guard limits.totalBytes > 0, limits.freeDiskReserveBytes >= 0,
              limits.maximumReservations > 0, existingBytes >= 0,
              existingBytes <= limits.totalBytes, existingPinnedBytes >= 0,
              existingPinnedBytes <= existingBytes, availableDiskBytes >= 0 else {
            throw Failure.invalidValue
        }
        self.limits = limits
        committedBytes = existingBytes
        pinnedBytes = existingPinnedBytes
        freeDiskBytes = availableDiskBytes
    }

    /// Reserve the worst-case output size, including container/encryption overhead.
    /// Actor isolation makes admission and accounting one indivisible operation.
    public func reserve(bytes: Int64, purpose: Purpose) throws -> Reservation {
        guard bytes > 0 else { throw Failure.invalidValue }
        guard reservations.count < limits.maximumReservations else {
            throw Failure.tooManyReservations
        }
        guard bytes <= limits.totalBytes - committedBytes - reservedBytes else {
            throw Failure.quotaExceeded
        }
        guard freeDiskBytes >= limits.freeDiskReserveBytes,
              reservedBytes <= freeDiskBytes - limits.freeDiskReserveBytes,
              bytes <= freeDiskBytes - limits.freeDiskReserveBytes - reservedBytes else {
            throw Failure.diskReserveExceeded
        }
        let token = Reservation(id: UUID(), bytes: bytes, purpose: purpose)
        reservations[token.id] = token
        reservedBytes += bytes
        return token
    }

    /// Convert a stopped writer's reservation into retained usage. A failed
    /// commit preserves its reservation: the caller cannot accidentally free
    /// capacity while an oversize/invalid output still exists. Pins cost quota.
    public func commit(_ token: Reservation, actualBytes: Int64, pinned: Bool = false) throws {
        guard reservations[token.id] == token else { throw Failure.unknownReservation }
        guard actualBytes >= 0 else { throw Failure.invalidValue }
        guard actualBytes <= token.bytes else { throw Failure.exceedsReservation }
        reservations.removeValue(forKey: token.id)
        reservedBytes -= token.bytes
        committedBytes += actualBytes
        freeDiskBytes -= actualBytes
        if pinned { pinnedBytes += actualBytes }
    }

    /// Cancel only after the writer is stopped and all its partial bytes have
    /// been removed. This accounting operation performs no deletion itself.
    public func release(_ token: Reservation) throws {
        guard reservations[token.id] == token else { throw Failure.unknownReservation }
        reservations.removeValue(forKey: token.id)
        reservedBytes -= token.bytes
    }

    public func snapshot() -> Snapshot {
        Snapshot(committedBytes: committedBytes, reservedBytes: reservedBytes,
                 pinnedBytes: pinnedBytes, estimatedFreeDiskBytes: freeDiskBytes,
                 reservationCount: reservations.count)
    }
}
