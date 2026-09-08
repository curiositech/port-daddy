import Foundation

public enum ProofConfigurationError: Error, Equatable, LocalizedError {
    case missingValue(String)
    case duplicateFlag(String)
    case invalidDuration
    case durationOutOfRange

    public var errorDescription: String? {
        switch self {
        case let .missingValue(flag): return "Proof mode requires a nonempty value for \(flag)."
        case let .duplicateFlag(flag): return "Proof mode accepts \(flag) only once."
        case .invalidDuration: return "Proof duration must be a finite number."
        case .durationOutOfRange: return "Proof duration must be between 2 and 30 seconds."
        }
    }
}

public enum ProofDurationPolicy {
    /// Invalid input is not a request for the default or for silent clamping.
    public static func parse(_ rawValue: String?) throws -> Double {
        guard let rawValue else { return 8 }
        guard let value = Double(rawValue.trimmingCharacters(in: .whitespacesAndNewlines)),
              value.isFinite else { throw ProofConfigurationError.invalidDuration }
        guard (2 ... 30).contains(value) else { throw ProofConfigurationError.durationOutOfRange }
        return value
    }
}

public enum ProofConfigurationParser {
    /// A partial proof invocation fails closed instead of becoming an ordinary
    /// interactive launch with different authority and persistence semantics.
    public static func parse(arguments: [String], currentDirectory: URL) throws -> ProofConfiguration? {
        let flags = ["--proof-window-title", "--proof-output", "--proof-duration"]
        guard arguments.contains(where: { flags.contains($0) || $0 == "--approve-safe-fixture-persistence" })
        else { return nil }
        var values: [String: String] = [:]
        for flag in flags {
            let indices = arguments.indices.filter { arguments[$0] == flag }
            guard indices.count <= 1 else { throw ProofConfigurationError.duplicateFlag(flag) }
            guard let index = indices.first else { continue }
            guard arguments.indices.contains(index + 1),
                  !arguments[index + 1].hasPrefix("--"),
                  !arguments[index + 1].trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            else { throw ProofConfigurationError.missingValue(flag) }
            values[flag] = arguments[index + 1]
        }
        guard let title = values["--proof-window-title"] else {
            throw ProofConfigurationError.missingValue("--proof-window-title")
        }
        guard let output = values["--proof-output"] else {
            throw ProofConfigurationError.missingValue("--proof-output")
        }
        return ProofConfiguration(
            targetWindowTitle: title,
            outputDirectory: URL(fileURLWithPath: output, relativeTo:
                URL(fileURLWithPath: currentDirectory.path, isDirectory: true)).standardizedFileURL,
            explicitSafeFixtureApproval: arguments.contains("--approve-safe-fixture-persistence"),
            durationSeconds: try ProofDurationPolicy.parse(values["--proof-duration"])
        )
    }
}

/// The package seals this manifest into Porthole.app after signing the fixture.
/// Its digest binds the companion build without imposing a runtime folder layout.
public struct SafeFixtureIdentityManifest: Codable, Equatable, Sendable {
    public static let schemaName = "pd.porthole.safe-fixture-identity.v1"
    public let schema: String
    public let bundleIdentifier: String
    public let executableFilename: String
    public let executableSHA256: String

    public init(schema: String = Self.schemaName, bundleIdentifier: String,
                executableFilename: String, executableSHA256: String) {
        self.schema = schema
        self.bundleIdentifier = bundleIdentifier
        self.executableFilename = executableFilename
        self.executableSHA256 = executableSHA256
    }
}

public enum SafeFixtureIdentityPolicy {
    public static func accepts(_ manifest: SafeFixtureIdentityManifest,
                               observed: SignedProgramIdentity, executableFilename: String) -> Bool {
        manifest.schema == SafeFixtureIdentityManifest.schemaName
            && manifest.bundleIdentifier == "dev.portdaddy.porthole.safe-fixture"
            && manifest.executableFilename == "PortholeFixture"
            && manifest.executableSHA256.count == 64
            && manifest.executableSHA256.allSatisfy { "0123456789abcdef".contains($0) }
            && observed.bundleIdentifier == manifest.bundleIdentifier
            && observed.executableSHA256 == manifest.executableSHA256
            && !observed.designatedRequirement.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && executableFilename == manifest.executableFilename
    }
}

private struct NativeFrameEvent: Encodable {
    let schema = "pd.porthole.native-frame-metadata.v1"
    let frame: FrameMetadata
}

/// Inject the output boundary so encoding and closed/broken sinks are testable.
/// A failed write propagates; successful encoding is not evidence of delivery.
public struct FrameMetadataLineWriter {
    private let sink: (Data) throws -> Void

    public init(sink: @escaping (Data) throws -> Void) { self.sink = sink }

    public func write(_ frame: FrameMetadata) throws {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        var data = try encoder.encode(NativeFrameEvent(frame: frame))
        data.append(0x0A)
        try sink(data)
    }
}
