import Foundation

// Exact rational strings are generated from scripts/sheaf_observability_study.py.
struct ObservabilityFixture: Decodable {
    let source: String
    let scope: String
    let feature: String
    let workItem: String
    let schemaVersion: Int
    let watermark: Int
    let sourceRoot: String
    let graphs: [ObservationGraph]
    let probes: [AuditProbe]
    let ledgerDisagreements: Int
    let duplicateDetections: Int
    let cycleDetections: Int
    let perturbations: Int

    static func load() throws -> Self {
        guard let url = Bundle.module.url(forResource: "observability_fixture", withExtension: "json") else {
            throw CocoaError(.fileNoSuchFile)
        }
        return try JSONDecoder().decode(Self.self, from: Data(contentsOf: url))
    }
}

struct ObservationGraph: Decodable, Identifiable {
    let id: String
    let title: String
    let edges: [[Int]]
    let labelCount: Int
    let classCount: Int
    let edgeConnectivity: Int
    let minimumMarginSquared: String
    let distinctMarginSquared: String
    let robustRadiusSquared: String
    let labels: [MutationLabel]

    var aliasPairs: [[String]] {
        labels.compactMap { label in
            label.classLabels.count > 1 && label.id == label.classLabels.first ? label.classLabels : nil
        }
    }
}

struct MutationLabel: Decodable, Identifiable {
    let id: String
    let vector: [String]
    let classLabels: [String]
    let normSquared: String

    var title: String {
        guard id != "none" else { return "No report mutation" }
        let parts = id.replacingOccurrences(of: "edge-", with: "Edge ").split(separator: ":")
        guard parts.count == 2 else { return id }
        return "\(parts[0]) · \(parts[1]) target report"
    }
}

struct AuditProbe: Decodable, Identifiable {
    let id: String
    let edge: [Int]
    let classCount: Int
    let minimumMarginSquared: String
    var title: String { id.hasPrefix("new-cross") ? "Add cross-edge" : "Repeat edge" }
    var endpoints: String { "\(edge[0]) → \(edge[1])" }
}
