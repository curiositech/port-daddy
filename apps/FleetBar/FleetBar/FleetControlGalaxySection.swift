import Foundation
import SwiftUI

// MARK: - FleetControlGalaxySection
//
// Native Fleet Control Center surface for /galaxy/map + /parley.
// `fleet-config-ui` is legacy; new operator views belong here.

struct FleetControlGalaxySection: View {
    let daemonURL: String
    let project: String?

    @StateObject private var store = FleetControlGalaxyStore()
    @State private var selectedPointId: String?

    private var requestKey: String {
        "\(daemonURL)|\(project ?? "all")"
    }

    private var selectedPoint: GalaxyPoint? {
        guard let selectedPointId else { return store.points.first }
        return store.points.first(where: { $0.id == selectedPointId }) ?? store.points.first
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Fleet.Space.l) {
                header
                summaryRow
                contentGrid

                if let error = store.errorMessage {
                    errorBanner(error)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.bottom, Fleet.Space.l)
        }
        .background(Fleet.Chrome.popoverBackground)
        .task(id: requestKey) {
            await store.refresh(daemonURL: daemonURL, project: project)
        }
    }

    private var header: some View {
        HStack(alignment: .center, spacing: Fleet.Space.m) {
            Image(systemName: "circle.hexagongrid")
                .foregroundStyle(Fleet.Color.active)
            VStack(alignment: .leading, spacing: 2) {
                Text("Session Galaxy")
                    .font(.system(size: 18, weight: .semibold))
                Text(projectLabel)
                    .font(.system(size: 14))
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
            Spacer()
            Button {
                Task { await store.refresh(daemonURL: daemonURL, project: project) }
            } label: {
                Label(store.isLoading ? "Refreshing" : "Refresh", systemImage: "arrow.clockwise")
                    .font(.system(size: 14, weight: .semibold))
            }
            .buttonStyle(.bordered)
            .disabled(store.isLoading)
        }
    }

    private var projectLabel: String {
        if let project, !project.isEmpty {
            return "Recent transcript embeddings and parleys for \(project)."
        }
        return "Recent transcript embeddings and parleys across all projects."
    }

    private var summaryRow: some View {
        HStack(spacing: Fleet.Space.s) {
            metricChip(title: "Points", value: "\(store.points.count)", tint: store.points.isEmpty ? Fleet.Color.dormant : Fleet.Color.active)
            metricChip(title: "Clusters", value: "\(store.clusters.count)", tint: store.clusters.isEmpty ? Fleet.Color.dormant : Fleet.Color.healthy)
            metricChip(title: "Cache hits", value: "\(store.map?.stats?.embeddingCacheHits ?? 0)", tint: Fleet.Color.healthy)
            metricChip(title: "Parleys", value: "\(store.parleys.count)", tint: store.parleys.isEmpty ? Fleet.Color.dormant : Fleet.Color.warning)
            metricChip(title: "Last refresh", value: store.lastRefresh.map(Self.relativeTime(from:)) ?? "-", tint: Fleet.Color.dormant)
        }
    }

    private var contentGrid: some View {
        HStack(alignment: .top, spacing: Fleet.Space.l) {
            mapCard
                .frame(minWidth: 560, maxWidth: .infinity)

            VStack(alignment: .leading, spacing: Fleet.Space.m) {
                detailCard
                parleyCard
                clusterCard
            }
            .frame(width: 360)
        }
    }

    private var mapCard: some View {
        VStack(alignment: .leading, spacing: Fleet.Space.m) {
            sectionHeader(
                icon: "point.3.connected.trianglepath.dotted",
                title: "Embedding Map",
                subtitle: "Each dot is a recent agent transcript tail projected into Galaxy space."
            )

            ZStack {
                RoundedRectangle(cornerRadius: Fleet.Radius.medium, style: .continuous)
                    .fill(Color.primary.opacity(0.035))
                GeometryReader { proxy in
                    let size = proxy.size
                    gridLines(size: size)
                    ForEach(store.clusters) { cluster in
                        clusterHalo(cluster, in: size)
                    }
                    ForEach(store.points) { point in
                        pointButton(point, in: size)
                    }
                }
                .padding(Fleet.Space.s)

                if store.isLoading && store.points.isEmpty {
                    ProgressView("Loading galaxy...")
                        .controlSize(.regular)
                } else if store.points.isEmpty {
                    emptyState(icon: "sparkle.magnifyingglass", text: "No transcript points match this project and window.")
                }
            }
            .frame(height: 420)
            .overlay(
                RoundedRectangle(cornerRadius: Fleet.Radius.medium, style: .continuous)
                    .stroke(Fleet.Chrome.border, lineWidth: 1)
            )
        }
        .padding(Fleet.Space.l)
        .background(Fleet.Chrome.card, in: RoundedRectangle(cornerRadius: Fleet.Radius.medium, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: Fleet.Radius.medium, style: .continuous)
                .stroke(Fleet.Chrome.border, lineWidth: 1)
        )
    }

    @ViewBuilder
    private func gridLines(size: CGSize) -> some View {
        Path { path in
            let cols = 6
            let rows = 4
            for index in 0...cols {
                let x = size.width * CGFloat(index) / CGFloat(cols)
                path.move(to: CGPoint(x: x, y: 0))
                path.addLine(to: CGPoint(x: x, y: size.height))
            }
            for index in 0...rows {
                let y = size.height * CGFloat(index) / CGFloat(rows)
                path.move(to: CGPoint(x: 0, y: y))
                path.addLine(to: CGPoint(x: size.width, y: y))
            }
        }
        .stroke(Color.primary.opacity(0.045), lineWidth: 1)
    }

    @ViewBuilder
    private func clusterHalo(_ cluster: GalaxyCluster, in size: CGSize) -> some View {
        if cluster.centroid.count >= 2 {
            Circle()
                .fill(clusterColor(cluster.id).opacity(0.11))
                .frame(width: haloSize(for: cluster), height: haloSize(for: cluster))
                .position(projected(x: cluster.centroid[0], y: cluster.centroid[1], in: size))
                .accessibilityHidden(true)
        }
    }

    private func pointButton(_ point: GalaxyPoint, in size: CGSize) -> some View {
        let selected = point.id == selectedPoint?.id
        let parleyParty = store.parleyParties.contains(point.agentId)
        return Button {
            selectedPointId = point.id
        } label: {
            ZStack {
                Circle()
                    .fill(clusterColor(point.clusterId))
                    .frame(width: parleyParty ? 16 : 13, height: parleyParty ? 16 : 13)
                if selected || parleyParty {
                    Circle()
                        .stroke(selected ? Color.primary : Fleet.Color.warning, lineWidth: selected ? 2 : 1.5)
                        .frame(width: selected ? 24 : 20, height: selected ? 24 : 20)
                }
            }
        }
        .buttonStyle(.plain)
        .position(projected(x: point.x, y: point.y, in: size))
        .help("\(point.agentId) · cluster \(point.clusterId)")
    }

    private var detailCard: some View {
        VStack(alignment: .leading, spacing: Fleet.Space.m) {
            sectionHeader(icon: "scope", title: "Selected Point", subtitle: "Transcript tail and routing metadata.")

            if let point = selectedPoint {
                VStack(alignment: .leading, spacing: Fleet.Space.s) {
                    HStack(spacing: Fleet.Space.s) {
                        statusPill(point.status, tint: statusColor(point.status))
                        statusPill("cluster \(point.clusterId)", tint: clusterColor(point.clusterId))
                    }
                    Text(point.agentId)
                        .font(.system(size: 15, weight: .semibold, design: .monospaced))
                        .lineLimit(2)
                    if let identity = point.identity {
                        Text(identity)
                            .font(.system(size: 12, design: .monospaced))
                            .foregroundStyle(.secondary)
                            .lineLimit(2)
                    }
                    Text(point.snippet)
                        .font(.system(size: 14))
                        .foregroundStyle(.secondary)
                        .lineLimit(6)
                    Divider()
                    HStack {
                        metadata(label: "tokens", value: "\(point.tailTokens)")
                        metadata(label: "PR", value: point.prNumber.map { "#\($0)" } ?? "-")
                        metadata(label: "ship", value: point.ship ?? "-")
                    }
                }
            } else {
                emptyState(icon: "dot.scope", text: "Select a Galaxy point for transcript detail.")
            }
        }
        .padding(Fleet.Space.l)
        .background(Fleet.Chrome.card, in: RoundedRectangle(cornerRadius: Fleet.Radius.medium, style: .continuous))
        .overlay(cardBorder)
    }

    private var parleyCard: some View {
        VStack(alignment: .leading, spacing: Fleet.Space.m) {
            sectionHeader(icon: "person.2.wave.2", title: "Recent Parleys", subtitle: "Coordination triggered by overlapping or converging agents.")

            if store.parleys.isEmpty {
                emptyState(icon: "checkmark.seal", text: "No recent parleys on this daemon.")
            } else {
                VStack(alignment: .leading, spacing: Fleet.Space.s) {
                    ForEach(store.parleys.prefix(4)) { summary in
                        parleyRow(summary)
                    }
                }
            }
        }
        .padding(Fleet.Space.l)
        .background(Fleet.Chrome.card, in: RoundedRectangle(cornerRadius: Fleet.Radius.medium, style: .continuous))
        .overlay(cardBorder)
    }

    private var clusterCard: some View {
        VStack(alignment: .leading, spacing: Fleet.Space.m) {
            sectionHeader(icon: "circle.grid.cross", title: "Clusters", subtitle: "Daemon labels from transcript terms.")
            if store.clusters.isEmpty {
                emptyState(icon: "square.3.layers.3d", text: "No clusters computed.")
            } else {
                VStack(alignment: .leading, spacing: Fleet.Space.s) {
                    ForEach(store.clusters.prefix(6)) { cluster in
                        HStack(spacing: Fleet.Space.s) {
                            Circle()
                                .fill(clusterColor(cluster.id))
                                .frame(width: 9, height: 9)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(cluster.label)
                                    .font(.system(size: 13, weight: .semibold))
                                    .lineLimit(1)
                                Text("\(cluster.size) transcript\(cluster.size == 1 ? "" : "s")")
                                    .font(.system(size: 12))
                                    .foregroundStyle(.secondary)
                            }
                            Spacer()
                        }
                    }
                }
            }
        }
        .padding(Fleet.Space.l)
        .background(Fleet.Chrome.card, in: RoundedRectangle(cornerRadius: Fleet.Radius.medium, style: .continuous))
        .overlay(cardBorder)
    }

    private func parleyRow(_ summary: GalaxyParleySummary) -> some View {
        VStack(alignment: .leading, spacing: Fleet.Space.xs) {
            HStack(spacing: Fleet.Space.s) {
                statusPill(summary.status, tint: parleyColor(summary.status))
                Text(summary.parley.parleyId)
                    .font(.system(size: 12, design: .monospaced))
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                Spacer()
            }
            Text(summary.parley.reason)
                .font(.system(size: 13))
                .lineLimit(3)
            Text(summary.parley.parties.joined(separator: " + "))
                .font(.system(size: 12, design: .monospaced))
                .foregroundStyle(.secondary)
                .lineLimit(2)
            if let firstTurn = summary.turns.first {
                Text("\(firstTurn.party): \(firstTurn.performative)")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(Fleet.Color.healthy)
                    .lineLimit(1)
            }
        }
        .padding(Fleet.Space.s)
        .background(Color.primary.opacity(0.035), in: RoundedRectangle(cornerRadius: Fleet.Radius.small, style: .continuous))
    }

    private func sectionHeader(icon: String, title: String, subtitle: String) -> some View {
        HStack(alignment: .top, spacing: Fleet.Space.s) {
            Image(systemName: icon)
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(Fleet.Color.active)
                .frame(width: 20)
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.system(size: 14, weight: .semibold))
                Text(subtitle)
                    .font(.system(size: 13))
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
            }
        }
    }

    private func metricChip(title: String, value: String, tint: Color) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title.uppercased())
                .font(.system(size: 10, weight: .semibold))
                .foregroundStyle(.secondary)
            Text(value)
                .font(.system(size: 14, weight: .semibold, design: .monospaced))
                .foregroundStyle(tint)
        }
        .padding(.horizontal, Fleet.Space.m)
        .padding(.vertical, Fleet.Space.s)
        .frame(minWidth: 104, alignment: .leading)
        .background(Fleet.Chrome.card, in: RoundedRectangle(cornerRadius: Fleet.Radius.medium, style: .continuous))
        .overlay(cardBorder)
    }

    private func metadata(label: String, value: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label.uppercased())
                .font(.system(size: 10, weight: .semibold))
                .foregroundStyle(.secondary)
            Text(value)
                .font(.system(size: 12, weight: .semibold, design: .monospaced))
                .lineLimit(1)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func statusPill(_ text: String, tint: Color) -> some View {
        Text(text.lowercased())
            .font(.system(size: 11, weight: .semibold))
            .foregroundStyle(tint)
            .padding(.horizontal, Fleet.Space.s)
            .padding(.vertical, 4)
            .background(tint.opacity(0.12), in: Capsule())
    }

    private func emptyState(icon: String, text: String) -> some View {
        VStack(spacing: Fleet.Space.s) {
            Image(systemName: icon)
                .font(.system(size: 20, weight: .semibold))
                .foregroundStyle(.secondary)
            Text(text)
                .font(.system(size: 14))
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity, minHeight: 96)
    }

    private func errorBanner(_ text: String) -> some View {
        HStack(spacing: Fleet.Space.s) {
            Image(systemName: "exclamationmark.triangle.fill")
                .foregroundStyle(Fleet.Color.failure)
            Text(text)
                .font(.system(size: 14))
                .foregroundStyle(.primary)
            Spacer()
        }
        .padding(Fleet.Space.m)
        .background(Fleet.Color.failure.opacity(0.10), in: RoundedRectangle(cornerRadius: Fleet.Radius.medium, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: Fleet.Radius.medium, style: .continuous)
                .stroke(Fleet.Color.failure.opacity(0.3), lineWidth: 1)
        )
    }

    private var cardBorder: some View {
        RoundedRectangle(cornerRadius: Fleet.Radius.medium, style: .continuous)
            .stroke(Fleet.Chrome.border, lineWidth: 1)
    }

    private func projected(x: Double, y: Double, in size: CGSize) -> CGPoint {
        let clampedX = min(max(x, 0), 1)
        let clampedY = min(max(y, 0), 1)
        let padding: CGFloat = 18
        return CGPoint(
            x: padding + CGFloat(clampedX) * max(1, size.width - padding * 2),
            y: padding + CGFloat(1 - clampedY) * max(1, size.height - padding * 2)
        )
    }

    private func haloSize(for cluster: GalaxyCluster) -> CGFloat {
        min(180, max(72, CGFloat(cluster.size) * 38))
    }

    private func clusterColor(_ id: Int) -> Color {
        let palette = [
            Fleet.Color.active,
            Fleet.Color.warning,
            Fleet.Color.healthy,
            Color(red: 0.76, green: 0.45, blue: 0.72),
            Color(red: 0.48, green: 0.66, blue: 0.92),
            Color(red: 0.86, green: 0.42, blue: 0.36),
        ]
        return palette[abs(id) % palette.count]
    }

    private func statusColor(_ status: String) -> Color {
        switch status.lowercased() {
        case "completed", "done", "success": return Fleet.Color.healthy
        case "running", "active": return Fleet.Color.active
        case "failed", "error": return Fleet.Color.failure
        default: return Fleet.Color.dormant
        }
    }

    private func parleyColor(_ status: String) -> Color {
        switch status.uppercased() {
        case "CONVENED": return Fleet.Color.warning
        case "COLLAPSED": return Fleet.Color.healthy
        case "ESCALATED": return Fleet.Color.failure
        case "VOIDED": return Fleet.Color.dormant
        default: return Fleet.Color.active
        }
    }

    private static func relativeTime(from date: Date) -> String {
        let elapsed = Date().timeIntervalSince(date)
        if elapsed < 60 { return "now" }
        if elapsed < 3600 { return "\(Int(elapsed / 60))m ago" }
        if elapsed < 86400 { return "\(Int(elapsed / 3600))h ago" }
        return "\(Int(elapsed / 86400))d ago"
    }
}

@MainActor
final class FleetControlGalaxyStore: ObservableObject {
    @Published var map: GalaxyMapResponse?
    @Published var parleys: [GalaxyParleySummary] = []
    @Published var isLoading = false
    @Published var errorMessage: String?
    @Published var lastRefresh: Date?

    var points: [GalaxyPoint] { map?.points ?? [] }
    var clusters: [GalaxyCluster] { map?.clusters ?? [] }

    var parleyParties: Set<String> {
        Set(parleys.flatMap { $0.parley.parties })
    }

    func refresh(daemonURL: String, project: String?) async {
        isLoading = true
        errorMessage = nil
        defer { isLoading = false }

        do {
            let galaxyURL = try mapURL(daemonURL: daemonURL, project: project)
            let parleysURL = try parleyURL(daemonURL: daemonURL)
            async let mapResponse: GalaxyMapResponse = fetch(
                GalaxyMapResponse.self,
                from: galaxyURL
            )
            async let parleyResponse: GalaxyParleyListResponse = fetch(
                GalaxyParleyListResponse.self,
                from: parleysURL
            )

            let (nextMap, nextParleys) = try await (mapResponse, parleyResponse)
            if nextMap.success == false {
                throw GalaxyControlError.message(nextMap.error ?? "Galaxy map request failed")
            }
            if nextParleys.success == false {
                throw GalaxyControlError.message(nextParleys.error ?? "Parley request failed")
            }
            map = nextMap
            parleys = nextParleys.parleys ?? []
            lastRefresh = Date()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func mapURL(daemonURL: String, project: String?) throws -> URL {
        guard var components = URLComponents(string: "\(daemonURL)/galaxy/map") else {
            throw GalaxyControlError.message("Invalid daemon URL: \(daemonURL)")
        }
        var items = [
            URLQueryItem(name: "windowHours", value: "24"),
            URLQueryItem(name: "tailTokens", value: "1200"),
            URLQueryItem(name: "minTokens", value: "64"),
            URLQueryItem(name: "limit", value: "50"),
        ]
        if let project, !project.isEmpty, project != "All projects" {
            items.append(URLQueryItem(name: "project", value: project))
        }
        components.queryItems = items
        guard let url = components.url else {
            throw GalaxyControlError.message("Invalid Galaxy map URL")
        }
        return url
    }

    private func parleyURL(daemonURL: String) throws -> URL {
        guard var components = URLComponents(string: "\(daemonURL)/parley") else {
            throw GalaxyControlError.message("Invalid daemon URL: \(daemonURL)")
        }
        components.queryItems = [URLQueryItem(name: "limit", value: "12")]
        guard let url = components.url else {
            throw GalaxyControlError.message("Invalid parley URL")
        }
        return url
    }

    private func fetch<T: Decodable>(_ type: T.Type, from url: URL) async throws -> T {
        let (data, response) = try await URLSession.shared.data(from: url)
        if let http = response as? HTTPURLResponse, http.statusCode >= 400 {
            throw GalaxyControlError.message("HTTP \(http.statusCode) from \(url.path)")
        }
        return try JSONDecoder().decode(type, from: data)
    }
}

private enum GalaxyControlError: LocalizedError {
    case message(String)

    var errorDescription: String? {
        switch self {
        case .message(let message): return message
        }
    }
}

struct GalaxyMapResponse: Decodable {
    let success: Bool
    let computedAt: Double?
    let params: GalaxyMapParams?
    let points: [GalaxyPoint]?
    let clusters: [GalaxyCluster]?
    let stats: GalaxyStats?
    let error: String?
}

struct GalaxyMapParams: Decodable {
    let windowHours: Int?
    let tailTokens: Int?
    let minTokens: Int?
    let limit: Int?
    let project: String?
    let cluster: Bool?
}

struct GalaxyPoint: Identifiable, Decodable {
    let id: String
    let sessionId: String?
    let agentId: String
    let ship: String?
    let project: String?
    let identity: String?
    let purpose: String?
    let status: String
    let startedAt: Double?
    let endedAt: Double?
    let tailTokens: Int
    let x: Double
    let y: Double
    let clusterId: Int
    let snippet: String
    let prNumber: Int?
}

struct GalaxyCluster: Identifiable, Decodable {
    let id: Int
    let label: String
    let terms: [GalaxyClusterTerm]?
    let size: Int
    let centroid: [Double]
}

struct GalaxyClusterTerm: Decodable {
    let term: String
    let mi: Double
}

struct GalaxyStats: Decodable {
    let sessionCount: Int?
    let embeddedNow: Int?
    let cacheHits: Int?
    let embeddingCacheHits: Int?
    let responseCacheHits: Int?
    let elapsedMs: Int?
}

struct GalaxyParleyListResponse: Decodable {
    let success: Bool
    let parleys: [GalaxyParleySummary]?
    let count: Int?
    let error: String?
}

struct GalaxyParleySummary: Identifiable, Decodable {
    let parley: GalaxyParleyRecord
    let status: String
    let turns: [GalaxyParleyTurn]
    let outcome: GalaxyParleyOutcome?
    let respondedParties: [String]?
    let missingParties: [String]?
    let receipts: [GalaxyParleyReceipt]?
    let expired: Bool?
    let risks: [String]?

    var id: String { parley.parleyId }
}

struct GalaxyParleyRecord: Decodable {
    let parleyId: String
    let surface: String
    let reason: String
    let parties: [String]
    let calledBy: String
    let trigger: String?
    let channel: String
    let status: String
    let harbor: String?
    let responseDueAt: Double?
    let roundLimit: Int?
    let createdAt: Double?
}

struct GalaxyParleyTurn: Decodable {
    let parleyId: String
    let party: String
    let performative: String
    let content: String
    let proposalId: String?
    let evidenceRefs: [String]?
    let at: Double?
}

struct GalaxyParleyOutcome: Decodable {
    let parleyId: String
    let status: String
    let decision: String?
    let reason: String?
    let resolvedBy: String
    let dissenters: [String]?
    let at: Double?
}

struct GalaxyParleyReceipt: Decodable {
    let party: String
    let lastSeenAt: Double?
    let unseenTurns: Int
}

#Preview("Fleet Control Galaxy") {
    FleetControlGalaxySection(
        daemonURL: DaemonLocation.availableBaseURL() ?? "http://preview.local",
        project: "port-daddy"
    )
    .frame(width: 1120, height: 720)
}
