import CryptoKit
import Foundation
import Security

/// The exact release asset FleetBar is allowed to install.
///
/// Update URLs are version-pinned instead of using GitHub's mutable `latest`
/// redirect. The daemon version that produced the warning therefore selects
/// one immutable tag and one architecture-specific archive.
struct FleetBarReleaseArtifact: Equatable, Sendable {
    static let repository = "curiositech/port-daddy"

    let version: String
    let architecture: String

    init?(version: String, architecture: String = FleetBarReleaseArtifact.currentArchitecture) {
        guard let semantic = SemanticVersion(version) else { return nil }
        let normalized = semantic.description
        guard version == normalized || version == "v\(normalized)" else { return nil }
        // The release workflow currently publishes FleetBar only from the
        // arm64 macOS runner. Reject Intel explicitly instead of constructing
        // an authoritative-looking URL for an asset that does not exist.
        guard architecture == "arm64" else { return nil }
        self.version = normalized
        self.architecture = architecture
    }

    static var currentArchitecture: String {
        #if arch(arm64)
        return "arm64"
        #elseif arch(x86_64)
        return "x86_64"
        #else
        return "unsupported"
        #endif
    }

    var archiveName: String { "PortDaddy-FleetBar-macOS-\(architecture).zip" }

    var releaseRoot: URL {
        URL(string: "https://github.com/\(Self.repository)/releases/download/v\(version)/")!
    }

    var archiveURL: URL { releaseRoot.appendingPathComponent(archiveName) }
    var checksumURL: URL { releaseRoot.appendingPathComponent("\(archiveName).sha256") }
}

enum FleetBarUpdateError: LocalizedError, Equatable {
    case unsupportedRelease(String)
    case downloadFailed(String)
    case malformedChecksum
    case checksumFilenameMismatch
    case checksumMismatch
    case extractionFailed(String)
    case invalidBundle(String)
    case signatureRejected
    case notarizationRejected
    case installFailed(String)

    var errorDescription: String? {
        switch self {
        case let .unsupportedRelease(version):
            return "FleetBar cannot install release \(version) on this Mac."
        case let .downloadFailed(detail):
            return "The signed FleetBar release could not be downloaded: \(detail)"
        case .malformedChecksum:
            return "The release checksum file is malformed. Nothing was installed."
        case .checksumFilenameMismatch:
            return "The release checksum names a different archive. Nothing was installed."
        case .checksumMismatch:
            return "The FleetBar download did not match its published checksum. Nothing was installed."
        case let .extractionFailed(detail):
            return "FleetBar could not unpack the verified release: \(detail)"
        case let .invalidBundle(detail):
            return "The downloaded app has invalid identity: \(detail)"
        case .signatureRejected:
            return "The downloaded app is not signed by Curiositech. Nothing was installed."
        case .notarizationRejected:
            return "macOS did not accept the downloaded app as notarized. Nothing was installed."
        case let .installFailed(detail):
            return "FleetBar could not replace the old app and rolled it back: \(detail)"
        }
    }
}

enum FleetBarUpdateState: Equatable {
    case idle
    case installing(version: String)
    case relaunching(version: String)
    case failed(message: String)

    var isBusy: Bool {
        switch self {
        case .installing, .relaunching: return true
        case .idle, .failed: return false
        }
    }
}

/// Downloads, verifies, atomically swaps, and relaunches FleetBar.
///
/// The old bundle remains beside the installed app as a timestamped backup.
/// If either directory rename fails, the installer restores the old bundle
/// before returning an error. It never executes code from the archive before
/// checksum, bundle identity, Developer ID, and Gatekeeper checks all pass.
final class FleetBarReleaseInstaller: @unchecked Sendable {
    private static let bundleIdentifier = "ai.portdaddy.FleetBar"
    private static let developerTeam = "P5H9P59X2M"
    private static let launchAgentLabel = "com.portdaddy.fleetbar"

    static func expectedChecksum(from text: String, archiveName: String) throws -> String {
        let lines = text
            .split(whereSeparator: \Character.isNewline)
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
        guard lines.count == 1 else { throw FleetBarUpdateError.malformedChecksum }

        let fields = lines[0].split(whereSeparator: \Character.isWhitespace)
        guard fields.count == 2 else { throw FleetBarUpdateError.malformedChecksum }
        let digest = String(fields[0]).lowercased()
        guard digest.count == 64, digest.allSatisfy({ $0.isHexDigit }) else {
            throw FleetBarUpdateError.malformedChecksum
        }
        guard String(fields[1]) == archiveName else {
            throw FleetBarUpdateError.checksumFilenameMismatch
        }
        return digest
    }

    func install(version: String, currentBundleURL: URL = Bundle.main.bundleURL) async throws {
        guard let artifact = FleetBarReleaseArtifact(version: version) else {
            throw FleetBarUpdateError.unsupportedRelease(version)
        }

        async let archiveRequest = download(artifact.archiveURL)
        async let checksumRequest = download(artifact.checksumURL)
        let (archiveData, checksumData) = try await (archiveRequest, checksumRequest)

        guard let checksumText = String(data: checksumData, encoding: .utf8) else {
            throw FleetBarUpdateError.malformedChecksum
        }
        let expected = try Self.expectedChecksum(from: checksumText, archiveName: artifact.archiveName)
        let actual = SHA256.hash(data: archiveData).map { String(format: "%02x", $0) }.joined()
        guard actual == expected else { throw FleetBarUpdateError.checksumMismatch }

        try await Task.detached(priority: .userInitiated) {
            try self.installVerifiedArchive(
                archiveData,
                artifact: artifact,
                currentBundleURL: currentBundleURL
            )
        }.value
    }

    private func download(_ url: URL) async throws -> Data {
        do {
            var request = URLRequest(url: url)
            request.timeoutInterval = 60
            request.cachePolicy = .reloadIgnoringLocalAndRemoteCacheData
            let (data, response) = try await URLSession.shared.data(for: request)
            guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
                throw FleetBarUpdateError.downloadFailed("the release server did not return HTTP 200")
            }
            return data
        } catch let error as FleetBarUpdateError {
            throw error
        } catch {
            throw FleetBarUpdateError.downloadFailed(error.localizedDescription)
        }
    }

    private func installVerifiedArchive(
        _ archiveData: Data,
        artifact: FleetBarReleaseArtifact,
        currentBundleURL: URL
    ) throws {
        let fileManager = FileManager.default
        let installRoot = currentBundleURL.deletingLastPathComponent()
        let workRoot = installRoot.appendingPathComponent(".fleetbar-update-\(UUID().uuidString)", isDirectory: true)
        let archiveURL = workRoot.appendingPathComponent(artifact.archiveName)
        let expandedRoot = workRoot.appendingPathComponent("expanded", isDirectory: true)
        let candidate = expandedRoot.appendingPathComponent("FleetBar.app", isDirectory: true)

        do {
            try fileManager.createDirectory(at: expandedRoot, withIntermediateDirectories: true)
            try archiveData.write(to: archiveURL, options: .atomic)

            let extraction = run("/usr/bin/ditto", ["-x", "-k", archiveURL.path, expandedRoot.path])
            guard extraction.status == 0 else {
                throw FleetBarUpdateError.extractionFailed(extraction.output)
            }
            try verifyCandidate(candidate, expectedVersion: artifact.version)

            let oldVersion = Self.bundleVersion(at: currentBundleURL) ?? "unknown"
            let stamp = ISO8601DateFormatter().string(from: Date()).replacingOccurrences(of: ":", with: "")
            let backup = installRoot.appendingPathComponent("FleetBar.app.backup-\(oldVersion)-\(stamp)", isDirectory: true)

            do {
                try fileManager.moveItem(at: currentBundleURL, to: backup)
                do {
                    try fileManager.moveItem(at: candidate, to: currentBundleURL)
                } catch {
                    try? fileManager.moveItem(at: backup, to: currentBundleURL)
                    throw error
                }
            } catch let error as FleetBarUpdateError {
                throw error
            } catch {
                throw FleetBarUpdateError.installFailed(error.localizedDescription)
            }

            do {
                try stageRelaunch(in: workRoot)
            } catch {
                let failed = installRoot.appendingPathComponent("FleetBar.app.failed-\(stamp)", isDirectory: true)
                try? fileManager.moveItem(at: currentBundleURL, to: failed)
                if !fileManager.fileExists(atPath: currentBundleURL.path) {
                    try? fileManager.moveItem(at: backup, to: currentBundleURL)
                }
                throw FleetBarUpdateError.installFailed("relaunch could not be scheduled: \(error.localizedDescription)")
            }
        } catch {
            if fileManager.fileExists(atPath: workRoot.path) {
                try? fileManager.removeItem(at: workRoot)
            }
            throw error
        }
    }

    private func verifyCandidate(_ candidate: URL, expectedVersion: String) throws {
        let fileManager = FileManager.default
        var isDirectory: ObjCBool = false
        guard fileManager.fileExists(atPath: candidate.path, isDirectory: &isDirectory), isDirectory.boolValue else {
            throw FleetBarUpdateError.invalidBundle("FleetBar.app is missing")
        }
        guard candidate.resolvingSymlinksInPath().path.hasPrefix(candidate.deletingLastPathComponent().path + "/") else {
            throw FleetBarUpdateError.invalidBundle("the app escapes the verified archive")
        }
        guard Self.bundleIdentifier(at: candidate) == Self.bundleIdentifier else {
            throw FleetBarUpdateError.invalidBundle("unexpected bundle identifier")
        }
        guard Self.bundleVersion(at: candidate) == expectedVersion else {
            throw FleetBarUpdateError.invalidBundle("expected version \(expectedVersion)")
        }

        var staticCode: SecStaticCode?
        guard SecStaticCodeCreateWithPath(candidate as CFURL, SecCSFlags(), &staticCode) == errSecSuccess,
              let staticCode else {
            throw FleetBarUpdateError.signatureRejected
        }
        let requirementText =
            "anchor apple generic and identifier \"\(Self.bundleIdentifier)\" " +
            "and certificate leaf[subject.OU] = \"\(Self.developerTeam)\" " +
            "and certificate 1[field.1.2.840.113635.100.6.2.6] exists " +
            "and certificate leaf[field.1.2.840.113635.100.6.1.13] exists"
        var requirement: SecRequirement?
        guard SecRequirementCreateWithString(requirementText as CFString, SecCSFlags(), &requirement) == errSecSuccess,
              let requirement,
              SecStaticCodeCheckValidity(staticCode, SecCSFlags(), requirement) == errSecSuccess else {
            throw FleetBarUpdateError.signatureRejected
        }

        let gatekeeper = run("/usr/sbin/spctl", ["--assess", "--type", "execute", "--verbose=2", candidate.path])
        guard gatekeeper.status == 0 else { throw FleetBarUpdateError.notarizationRejected }
    }

    private func stageRelaunch(in workRoot: URL) throws {
        let script = workRoot.appendingPathComponent("relaunch.sh")
        let target = "gui/\(getuid())/\(Self.launchAgentLabel)"
        let body = """
        #!/bin/sh
        sleep 1
        /bin/launchctl kickstart -k "$1"
        status=$?
        rm -rf -- "$(dirname "$0")"
        exit $status
        """
        try body.write(to: script, atomically: true, encoding: .utf8)
        try FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: script.path)

        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/bin/sh")
        process.arguments = [script.path, target]
        process.standardOutput = FileHandle.nullDevice
        process.standardError = FileHandle.nullDevice
        try process.run()
    }

    private static func bundleIdentifier(at bundleURL: URL) -> String? {
        guard let bundle = Bundle(url: bundleURL) else { return nil }
        return bundle.bundleIdentifier
    }

    private static func bundleVersion(at bundleURL: URL) -> String? {
        guard let bundle = Bundle(url: bundleURL) else { return nil }
        return bundle.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String
    }

    private func run(_ executable: String, _ arguments: [String]) -> (status: Int32, output: String) {
        let process = Process()
        let output = Pipe()
        process.executableURL = URL(fileURLWithPath: executable)
        process.arguments = arguments
        process.standardOutput = output
        process.standardError = output
        do {
            try process.run()
            process.waitUntilExit()
            let data = output.fileHandleForReading.readDataToEndOfFile()
            return (process.terminationStatus, String(decoding: data, as: UTF8.self))
        } catch {
            return (-1, error.localizedDescription)
        }
    }
}

@MainActor
final class FleetBarUpdater: ObservableObject {
    @Published private(set) var state: FleetBarUpdateState = .idle
    private let installer: FleetBarReleaseInstaller

    init(
        installer: FleetBarReleaseInstaller = FleetBarReleaseInstaller(),
        initialState: FleetBarUpdateState = .idle
    ) {
        self.installer = installer
        self.state = initialState
    }

    func install(version: String) {
        guard !state.isBusy else { return }
        state = .installing(version: version)
        Task {
            do {
                try await installer.install(version: version)
                state = .relaunching(version: version)
            } catch {
                state = .failed(message: error.localizedDescription)
            }
        }
    }
}
