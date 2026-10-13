import SwiftUI

struct ContentView: View {
    @State private var fixture: ObservabilityFixture?
    @State private var loadingError: String?
    @State private var graphID = "square"
    @State private var labelID = "edge-0:+1"

    var body: some View {
        Group {
            if let fixture {
                explorer(fixture)
            } else if let loadingError {
                ContentUnavailableView("Fixture unavailable", systemImage: "doc.questionmark",
                                       description: Text(loadingError))
            } else {
                ProgressView("Loading exact fixture")
            }
        }
        .task {
            guard fixture == nil else { return }
            do { fixture = try ObservabilityFixture.load() }
            catch { loadingError = error.localizedDescription }
        }
    }

    private func explorer(_ fixture: ObservabilityFixture) -> some View {
        let graph = fixture.graphs.first { $0.id == graphID } ?? fixture.graphs[0]
        let label = graph.labels.first { $0.id == labelID } ?? graph.labels[0]
        return NavigationSplitView {
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    Text("OBSERVATION MODEL").font(.body.weight(.bold)).foregroundStyle(.secondary)
                    VStack(alignment: .leading, spacing: 8) {
                        ForEach(fixture.graphs) { candidate in
                            Button { graphID = candidate.id } label: {
                                HStack {
                                    VStack(alignment: .leading, spacing: 4) {
                                        Text(candidate.title).font(.headline)
                                        Text("\(candidate.classCount) classes · \(candidate.labelCount) labels")
                                            .font(.body).foregroundStyle(.secondary)
                                    }
                                    Spacer()
                                    if graphID == candidate.id { Image(systemName: "checkmark.circle.fill") }
                                }
                                .padding(12)
                                .frame(minHeight: 56)
                                .background(graphID == candidate.id ? Color.accentColor.opacity(0.12) : Color.clear,
                                            in: RoundedRectangle(cornerRadius: 8))
                            }
                            .buttonStyle(.plain)
                            .accessibilityLabel("\(candidate.title), \(candidate.classCount) signature classes")
                        }
                    }
                    Divider()
                    Text("REPORT MUTATION").font(.body.weight(.bold)).foregroundStyle(.secondary)
                    Text("Select one predeclared signed target-side change.")
                        .font(.body).foregroundStyle(.secondary)
                    VStack(spacing: 4) {
                        ForEach(graph.labels) { candidate in
                            Button { labelID = candidate.id } label: {
                                HStack {
                                    Text(candidate.title).font(.body)
                                    Spacer()
                                    if labelID == candidate.id { Image(systemName: "checkmark") }
                                }
                                .padding(.horizontal, 12)
                                .frame(minHeight: 44)
                                .contentShape(Rectangle())
                                .background(labelID == candidate.id ? Color.accentColor.opacity(0.12) : Color.clear,
                                            in: RoundedRectangle(cornerRadius: 8))
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
                .padding(20)
            }
            .navigationTitle("Observability")
            .frame(minWidth: 270)
        } detail: {
            ScrollView {
                VStack(alignment: .leading, spacing: 28) {
                    header()
                    metadata(fixture)
                    graphComparison(graph)
                    signature(label)
                    probes(fixture)
                    baseline(fixture)
                    limits(fixture)
                }
                .frame(maxWidth: 920, alignment: .leading)
                .padding(32)
                .frame(maxWidth: .infinity)
            }
            .background(Color(nsColor: .windowBackgroundColor))
            .navigationTitle("Exact fixture explorer")
        }
        .frame(minWidth: 850, minHeight: 680)
    }

    private func header() -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("PAPER 8 / OFFLINE STUDY").font(.body.weight(.bold)).foregroundStyle(.secondary)
            Text("What one more observation separates")
                .font(.largeTitle.weight(.bold)).fixedSize(horizontal: false, vertical: true)
            Text("Synthetic integer differences from one feature and one watermark. This explorer shows exact report-mutation signatures; it makes no claim about a semantic culprit.")
                .font(.body).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            Label("SYNTHETIC FIXTURE · NO PROVENANCE OR SIGNATURE VERIFICATION · NO LIVE UTILITY OR TRUTH CLAIM",
                  systemImage: "exclamationmark.shield")
                .font(.body.weight(.semibold))
                .padding(16)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Color.orange.opacity(0.15), in: RoundedRectangle(cornerRadius: 8))
        }
    }

    private func metadata(_ fixture: ObservabilityFixture) -> some View {
        GroupBox("Fixed observation contract") {
            VStack(alignment: .leading, spacing: 8) {
                metadataRow("Feature", fixture.feature)
                metadataRow("Work item", fixture.workItem)
                metadataRow("Schema / watermark", "v\(fixture.schemaVersion) / \(fixture.watermark)")
                metadataRow("Source root", fixture.sourceRoot)
            }
            .frame(maxWidth: .infinity, alignment: .leading).padding(8)
        }
    }

    private func metadataRow(_ title: String, _ value: String) -> some View {
        HStack(alignment: .firstTextBaseline) {
            Text(title).foregroundStyle(.secondary).frame(width: 170, alignment: .leading)
            Text(value).textSelection(.enabled)
        }
        .font(.body)
    }

    private func graphComparison(_ graph: ObservationGraph) -> some View {
        GroupBox("\(graph.title) · graph topology") {
            VStack(alignment: .leading, spacing: 12) {
                ObservationGraphView(graph: graph)
                Text("Edge order: " + graph.edges.enumerated().map { "e\($0.offset) \($0.element[0])→\($0.element[1])" }.joined(separator: " · "))
                    .font(.body.monospaced())
                    .fixedSize(horizontal: false, vertical: true)
                Text("\(graph.labelCount) predeclared labels → \(graph.classCount) exact projected signature classes")
                    .font(.headline)
                Text("Minimum cut \(graph.edgeConnectivity). Every one-edge report error is identifiable only when the cut exceeds 2; every two-edge error would require a cut above 4.")
                    .font(.body)
                    .fixedSize(horizontal: false, vertical: true)
                HStack(spacing: 24) {
                    metric("Minimum label distance²", graph.minimumMarginSquared)
                    metric("Distinct class distance²", graph.distinctMarginSquared)
                    metric("Unique-class radius²", graph.robustRadiusSquared)
                }
                if graph.aliasPairs.isEmpty {
                    Text("Every label has its own projected vector under this finite library.").font(.body)
                } else {
                    Text("\(graph.aliasPairs.count) alias pairs: \(graph.aliasPairs.map { $0.joined(separator: " = ") }.joined(separator: "; ")).")
                        .font(.body).fixedSize(horizontal: false, vertical: true)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading).padding(8)
        }
    }

    private func metric(_ title: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title).font(.body).foregroundStyle(.secondary)
            Text(value).font(.title2.monospacedDigit().weight(.semibold))
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func signature(_ label: MutationLabel) -> some View {
        GroupBox("Selected projected signature") {
            VStack(alignment: .leading, spacing: 12) {
                Text(label.title).font(.title2.weight(.semibold))
                Text("Q(report difference) = (\(label.vector.joined(separator: ", ")))")
                    .font(.body.monospaced()).textSelection(.enabled)
                    .fixedSize(horizontal: false, vertical: true)
                Text("Vector coordinates follow the graph's displayed edge order; fractions are exact.")
                    .font(.body).foregroundStyle(.secondary)
                if label.classLabels.count > 1 {
                    Label("Same vector as \(label.classLabels.filter { $0 != label.id }.joined(separator: ", ")). This label is not identifiable here.", systemImage: "equal.circle")
                        .font(.body.weight(.semibold))
                } else {
                    Label("Unique vector among the 11 declared report-mutation labels.", systemImage: "checkmark.circle")
                        .font(.body.weight(.semibold))
                }
                Divider()
                Text("Scalar only: ‖Q(error)‖² = \(label.normSquared). A norm discards vector direction. In K₄, every signed single-edge label has ‖Q(error)‖² = 1/2, while their full vectors differ.")
                    .font(.body).fixedSize(horizontal: false, vertical: true)
                Text("This classifies a specified report mutation, not an agent, cause, or truth.")
                    .font(.body).foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, alignment: .leading).padding(8)
        }
    }

    private func probes(_ fixture: ObservabilityFixture) -> some View {
        GroupBox("One-packet audit probes · equal cost") {
            VStack(alignment: .leading, spacing: 12) {
                Text("Each candidate adds one independent observation of the same feature at the same watermark. The added packet is fault-free in this calculation; the original 11 labels stay fixed.")
                    .font(.body)
                ForEach(fixture.probes) { probe in
                    HStack(alignment: .firstTextBaseline, spacing: 16) {
                        Text("\(probe.title) \(probe.endpoints)")
                            .font(.body.weight(probe.id.hasPrefix("new-cross") ? .semibold : .regular))
                            .frame(maxWidth: .infinity, alignment: .leading)
                        Text("\(probe.classCount)/11 classes").font(.body.monospacedDigit())
                        Text("min d² \(probe.minimumMarginSquared)").font(.body.monospacedDigit())
                    }
                    .padding(12)
                    .background(probe.id.hasPrefix("new-cross") ? Color.accentColor.opacity(0.12) : Color.clear,
                                in: RoundedRectangle(cornerRadius: 8))
                    .accessibilityElement(children: .combine)
                }
                Text("Edge 1→3 is the unique maximin choice here: all 11 labels separate with minimum distance² 1/2.")
                    .font(.body.weight(.semibold))
            }
            .frame(maxWidth: .infinity, alignment: .leading).padding(8)
        }
    }

    private func baseline(_ fixture: ObservabilityFixture) -> some View {
        GroupBox("Synthetic ledger comparison") {
            VStack(alignment: .leading, spacing: 12) {
                Text("Of \(fixture.perturbations) enumerated perturbations, \(fixture.ledgerDisagreements) disagree with the independent synthetic ledger.")
                    .font(.body)
                HStack(spacing: 24) {
                    metric("Duplicate-claim check", "\(fixture.duplicateDetections)/\(fixture.ledgerDisagreements)")
                    metric("Cycle check", "\(fixture.cycleDetections)/\(fixture.ledgerDisagreements)")
                }
                Text("The cheaper duplicate check catches more ledger disagreements here. This fixture supports no incremental utility claim for cycle projection.")
                    .font(.body)
            }
            .frame(maxWidth: .infinity, alignment: .leading).padding(8)
        }
    }

    private func limits(_ fixture: ObservabilityFixture) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Evidence boundary").font(.headline)
            Text("Exact, offline arithmetic over a finite synthetic library. Zero projection only means these edge differences admit a global potential. It does not establish honest claims, authorized evidence, or a safe release.")
                .font(.body)
            Text("Source: \(fixture.source)").font(.body).foregroundStyle(.secondary).textSelection(.enabled)
        }
    }
}
