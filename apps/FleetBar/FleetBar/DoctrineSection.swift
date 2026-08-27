import SwiftUI

/// Native FleetBar view for the CASE-13 doctrine loop. It shows the whole
/// evidence wake instead of reducing a learned advisory to a green/red badge:
/// episode → experiment → provisional order → retrieval → response → outcome.
struct FleetDoctrineSection: View {
    @ObservedObject var store: FleetDoctrineStore
    let projectDir: String?

    @State private var contestReason = ""
    @State private var decisionID = ""
    @State private var decisionClass = ""
    @State private var applicationDrafts: [String: FleetDoctrineApplicationDraft] = [:]
    @State private var outcomeDrafts: [String: FleetDoctrineOutcomeDraft] = [:]

    var body: some View {
        HStack(spacing: 0) {
            candidateList
                .frame(minWidth: 300, idealWidth: 340, maxWidth: 390)
            Divider()
            detailPane
        }
        .background(Fleet.Chrome.popoverBackground)
        .task(id: projectDir) { await store.refresh(projectDir: projectDir) }
    }

    private var candidateList: some View {
        VStack(alignment: .leading, spacing: Fleet.Space.m) {
            header
            ScrollView {
                if store.candidates.isEmpty {
                    VStack(alignment: .leading, spacing: Fleet.Space.s) {
                        Image(systemName: "scroll")
                            .font(.system(size: 24))
                            .foregroundStyle(Fleet.Color.dormant)
                        Text(store.routeMissing ? "Doctrine routes unavailable" : "No doctrine evidence yet")
                            .font(.system(size: 15, weight: .semibold))
                        Text(store.routeMissing
                            ? "This daemon has not exposed the doctrine evidence ledger."
                            : "Silence is not a lesson: FleetBar will not fabricate a candidate until an evidence event exists.")
                            .font(.system(size: 14))
                            .foregroundStyle(.secondary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(Fleet.Space.m)
                    .background(
                        Fleet.Chrome.card,
                        in: RoundedRectangle(cornerRadius: Fleet.Radius.medium, style: .continuous)
                    )
                } else {
                    LazyVStack(spacing: Fleet.Space.s) {
                        ForEach(store.candidates) { candidate in
                            candidateRow(candidate)
                        }
                    }
                }
            }
        }
        .padding(Fleet.Space.l)
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: Fleet.Space.s) {
            HStack(alignment: .top, spacing: Fleet.Space.s) {
                Image(systemName: "scroll.fill")
                    .foregroundStyle(Fleet.Color.active)
                VStack(alignment: .leading, spacing: 2) {
                    Text("Earned Doctrine")
                        .font(.system(size: 18, weight: .semibold))
                    Text("Advisory orders with an evidence wake.")
                        .font(.system(size: 14))
                        .foregroundStyle(.secondary)
                }
                Spacer()
                Button {
                    Task { await store.refresh(projectDir: projectDir) }
                } label: {
                    Label(store.isRefreshing ? "Refreshing" : "Refresh", systemImage: "arrow.clockwise")
                        .font(.system(size: 13, weight: .semibold))
                }
                .buttonStyle(.bordered)
                .disabled(store.isRefreshing)
            }

            HStack(spacing: Fleet.Space.xs) {
                metricChip(title: "Episodes", value: "\(store.status?.counts.episodes ?? 0)", tint: Fleet.Color.dormant)
                metricChip(title: "Provisional", value: "\(store.status?.counts.provisional ?? 0)", tint: Fleet.Color.warning)
                metricChip(title: "Contested", value: "\(store.status?.counts.contested ?? 0)", tint: (store.status?.counts.contested ?? 0) > 0 ? Fleet.Color.failure : Fleet.Color.dormant)
            }

            Text("Advisory only: a doctrine can inform a decision, never authorize a merge, spend, deployment, or other irreversible action.")
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(Fleet.Color.warning)
                .fixedSize(horizontal: false, vertical: true)
                .padding(Fleet.Space.s)
                .background(
                    Fleet.Color.warning.opacity(0.09),
                    in: RoundedRectangle(cornerRadius: Fleet.Radius.standard, style: .continuous)
                )
        }
    }

    private func candidateRow(_ candidate: FleetDoctrineCandidateSnapshot) -> some View {
        let selected = store.selectedCandidate?.id == candidate.id
        return Button {
            Task { await store.select(doctrineID: candidate.doctrineId) }
        } label: {
            VStack(alignment: .leading, spacing: Fleet.Space.s) {
                HStack(alignment: .top, spacing: Fleet.Space.s) {
                    VStack(alignment: .leading, spacing: 3) {
                        Text(candidate.title)
                            .font(.system(size: 15, weight: .semibold))
                            .foregroundStyle(.primary)
                            .multilineTextAlignment(.leading)
                            .fixedSize(horizontal: false, vertical: true)
                        Text(candidate.decisionClass)
                            .font(.system(size: 12, design: .monospaced))
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                    }
                    Spacer(minLength: 0)
                    doctrineBadge(candidate.status)
                }
                HStack(spacing: Fleet.Space.xs) {
                    Text(relativeTime(candidate.occurredAt))
                    Spacer()
                    Image(systemName: "chevron.right")
                        .font(.system(size: 11, weight: .semibold))
                }
                .font(.system(size: 12))
                .foregroundStyle(.secondary)
            }
            .padding(Fleet.Space.m)
            .background(
                selected ? Fleet.Color.active.opacity(0.11) : Fleet.Chrome.card,
                in: RoundedRectangle(cornerRadius: Fleet.Radius.medium, style: .continuous)
            )
            .overlay(
                RoundedRectangle(cornerRadius: Fleet.Radius.medium, style: .continuous)
                    .stroke(selected ? Fleet.Color.active.opacity(0.5) : candidate.status.color.opacity(0.18), lineWidth: 1)
            )
        }
        .buttonStyle(.plain)
    }

    @ViewBuilder
    private var detailPane: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Fleet.Space.l) {
                if let error = store.lastError {
                    noticeBanner(error, color: Fleet.Color.failure, icon: "exclamationmark.triangle.fill")
                }
                if let notice = store.lastNotice {
                    noticeBanner(notice, color: Fleet.Color.healthy, icon: "checkmark.seal.fill")
                }

                if store.isLoadingDetail {
                    ProgressView("Loading evidence ledger…")
                        .frame(maxWidth: .infinity, minHeight: 360)
                } else if let candidate = store.selectedCandidate, let detail = store.detail {
                    doctrineDetail(candidate: candidate, detail: detail)
                } else {
                    emptyDetail
                }
            }
            .padding(Fleet.Space.xl)
        }
    }

    private var emptyDetail: some View {
        VStack(spacing: Fleet.Space.m) {
            Image(systemName: "scroll")
                .font(.system(size: 34))
                .foregroundStyle(Fleet.Color.dormant)
            Text("Choose an evidence trail")
                .font(.system(size: 18, weight: .semibold))
            Text("Inspect what was observed, preregistered, retrieved, and verified before treating an advisory as useful.")
                .font(.system(size: 14))
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .frame(maxWidth: 450)
        }
        .frame(maxWidth: .infinity, minHeight: 420)
    }

    @ViewBuilder
    private func doctrineDetail(candidate: FleetDoctrineCandidateSnapshot, detail: FleetDoctrineDetailSnapshot) -> some View {
        VStack(alignment: .leading, spacing: Fleet.Space.l) {
            HStack(alignment: .top, spacing: Fleet.Space.m) {
                VStack(alignment: .leading, spacing: 4) {
                    HStack(spacing: Fleet.Space.s) {
                        Text(candidate.title)
                            .font(.system(size: 20, weight: .semibold))
                        doctrineBadge(candidate.status)
                    }
                    Text(candidate.doctrineId ?? candidate.id)
                        .font(.system(size: 12, design: .monospaced))
                        .foregroundStyle(.secondary)
                }
                Spacer()
                if let school = candidate.school, !school.isEmpty {
                    Label(school, systemImage: "graduationcap")
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(.secondary)
                }
            }

            doctrineCard(title: "Advisory", icon: "compass.drawing") {
                Grid(horizontalSpacing: Fleet.Space.l, verticalSpacing: Fleet.Space.m) {
                    GridRow {
                        evidenceCell("When", candidate.when)
                        evidenceCell("Prefer", candidate.prefer)
                    }
                    GridRow {
                        evidenceCell("Over", candidate.over)
                        evidenceCell("Because", candidate.because)
                    }
                    GridRow {
                        evidenceCell("Unless", candidate.unless.isEmpty ? "No exception recorded" : candidate.unless.joined(separator: " · "))
                        evidenceCell("Skills", candidate.skillRefs.isEmpty ? "No skill projection recorded" : candidate.skillRefs.joined(separator: " · "))
                    }
                }
            }

            observedEpisodeCard(detail.episode)
            experimentCard(detail.experiment)

            if candidate.status == .candidate {
                admissionCard(candidate: candidate, detail: detail)
            } else {
                contestCard(candidate: candidate, detail: detail)
            }

            if candidate.status == .provisional || candidate.status == .established {
                retrievalCard(candidate: candidate, detail: detail)
            }

            if let packet = store.packet {
                packetCard(packet)
            }

            historyCard(candidate: candidate, detail: detail)

            Text("\(candidate.evidenceCitations.count) immutable receipt\(candidate.evidenceCitations.count == 1 ? "" : "s") attached. Canonical store: Agent Harbor’s append-only doctrine-evidence stream.")
                .font(.system(size: 12))
                .foregroundStyle(.secondary)
                .padding(Fleet.Space.s)
                .frame(maxWidth: .infinity, alignment: .leading)
                .overlay(
                    RoundedRectangle(cornerRadius: Fleet.Radius.standard, style: .continuous)
                        .stroke(Fleet.Color.dormant.opacity(0.25), lineWidth: 1)
                )
        }
    }

    private func observedEpisodeCard(_ episode: FleetDoctrineEpisodeSnapshot?) -> some View {
        doctrineCard(title: "Observed episode", icon: "clock.arrow.circlepath") {
            if let episode {
                Text(episode.summary)
                    .font(.system(size: 14))
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                HStack(spacing: Fleet.Space.s) {
                    evidenceTag("Historical action: \(episode.historicalAction)")
                    evidenceTag("Transcript fidelity: \(episode.fidelity)")
                    if let model = episode.provenance.model { evidenceTag("Model: \(model)") }
                }
            } else {
                Text("Episode evidence is unavailable in this projection.")
                    .font(.system(size: 14))
                    .foregroundStyle(.secondary)
            }
        }
    }

    private func experimentCard(_ experiment: FleetDoctrineExperimentSnapshot?) -> some View {
        let readiness = fleetDoctrineAdmissionReadiness(experiment)
        return doctrineCard(title: "Preregistered experiment and fidelity", icon: "flask") {
            HStack(alignment: .top, spacing: Fleet.Space.s) {
                VStack(alignment: .leading, spacing: Fleet.Space.s) {
                    Text(readiness.label)
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(readiness.isReady ? Fleet.Color.healthy : Fleet.Color.warning)
                    Text(readiness.detail)
                        .font(.system(size: 13))
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer()
            }
            if let experiment {
                Text(experiment.hypothesis)
                    .font(.system(size: 14))
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                Grid(horizontalSpacing: Fleet.Space.l, verticalSpacing: Fleet.Space.m) {
                    GridRow {
                        evidenceCell("Primary outcome", experiment.primaryOutcome)
                        evidenceCell("Sham", experiment.sham ?? "No sham arm preregistered")
                    }
                    GridRow {
                        evidenceCell("Control", experiment.control)
                        evidenceCell("Treatment", experiment.treatment)
                    }
                }
                HStack(spacing: Fleet.Space.s) {
                    ForEach(["control", "treatment", "sham"], id: \.self) { arm in
                        let run = experiment.runs.first(where: { $0.arm == arm })
                        VStack(alignment: .leading, spacing: 3) {
                            Text(arm.capitalized)
                                .font(.system(size: 12, weight: .semibold))
                            Text(run.map { "\($0.fidelity.rawValue) fidelity" } ?? "not recorded")
                                .font(.system(size: 12))
                                .foregroundStyle(run?.fidelity == .matched ? Fleet.Color.healthy : Fleet.Color.warning)
                            if let run {
                                Text(run.outcome)
                                    .font(.system(size: 11))
                                    .foregroundStyle(.secondary)
                                    .lineLimit(2)
                            }
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(Fleet.Space.s)
                        .background(
                            Fleet.Chrome.card,
                            in: RoundedRectangle(cornerRadius: Fleet.Radius.standard, style: .continuous)
                        )
                    }
                }
            } else {
                Text("No preregistered experiment is attached to this candidate.")
                    .font(.system(size: 14))
                    .foregroundStyle(.secondary)
            }
        }
    }

    private func admissionCard(candidate: FleetDoctrineCandidateSnapshot, detail: FleetDoctrineDetailSnapshot) -> some View {
        let readiness = fleetDoctrineAdmissionReadiness(detail.experiment)
        return doctrineCard(title: "Provisional admission", icon: "checkmark.seal") {
            Text("Admission only publishes an advisory packet. It is not an operational authorization.")
                .font(.system(size: 14))
                .foregroundStyle(.secondary)
            HStack {
                Text(readiness.isReady ? "The factual-control gate is met." : "Disabled: \(readiness.detail)")
                    .font(.system(size: 13))
                    .foregroundStyle(readiness.isReady ? Fleet.Color.healthy : Fleet.Color.warning)
                    .fixedSize(horizontal: false, vertical: true)
                Spacer()
                Button {
                    Task { await store.admit(candidate: candidate, detail: detail) }
                } label: {
                    Label(store.activeAction == "admit" ? "Admitting" : "Admit provisionally", systemImage: "checkmark.circle.fill")
                        .font(.system(size: 14, weight: .semibold))
                }
                .buttonStyle(.borderedProminent)
                .tint(Fleet.Color.healthy)
                .disabled(!readiness.isReady || store.activeAction != nil)
                .help(readiness.isReady ? "Admit as a provisional advisory" : readiness.detail)
            }
        }
    }

    private func contestCard(candidate: FleetDoctrineCandidateSnapshot, detail: FleetDoctrineDetailSnapshot) -> some View {
        doctrineCard(title: "Challenge this advisory", icon: "exclamationmark.bubble") {
            Text("A contradiction is a first-class observation, not a hidden deletion. Record why this doctrine should be contested.")
                .font(.system(size: 14))
                .foregroundStyle(.secondary)
            if let current = candidate.contestedReason, !current.isEmpty {
                Text("Current contest: \(current)")
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(Fleet.Color.failure)
                    .padding(Fleet.Space.s)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Fleet.Color.failure.opacity(0.08), in: RoundedRectangle(cornerRadius: Fleet.Radius.standard, style: .continuous))
            }
            HStack(alignment: .bottom, spacing: Fleet.Space.s) {
                TextField("Contradictory evidence or boundary condition", text: $contestReason, axis: .vertical)
                    .font(.system(size: 14))
                    .lineLimit(2...4)
                    .textFieldStyle(.roundedBorder)
                Button {
                    Task { await store.contest(candidate: candidate, detail: detail, reason: contestReason) }
                } label: {
                    Text(store.activeAction == "contest" ? "Recording" : "Record contradiction")
                        .font(.system(size: 14, weight: .semibold))
                }
                .buttonStyle(.bordered)
                .tint(Fleet.Color.failure)
                .disabled(contestReason.trimmingCharacters(in: .whitespacesAndNewlines).count < 3 || store.activeAction != nil)
            }
        }
    }

    private func retrievalCard(candidate: FleetDoctrineCandidateSnapshot, detail: FleetDoctrineDetailSnapshot) -> some View {
        doctrineCard(title: "Decision-time advisory retrieval", icon: "paperplane") {
            Text("Create a receipt only when a real decision is in view. The receipt captures what was actually shown, including an empty packet.")
                .font(.system(size: 14))
                .foregroundStyle(.secondary)
            HStack(spacing: Fleet.Space.s) {
                TextField("Decision identifier", text: $decisionID)
                    .textFieldStyle(.roundedBorder)
                TextField("Decision class", text: $decisionClass)
                    .textFieldStyle(.roundedBorder)
                    .onAppear {
                        if decisionClass.isEmpty { decisionClass = candidate.decisionClass }
                    }
            }
            Button {
                Task { await store.retrieve(candidate: candidate, detail: detail, decisionID: decisionID, decisionClass: decisionClass) }
            } label: {
                Label(store.activeAction == "retrieve" ? "Recording receipt" : "Retrieve advisory order", systemImage: "paperplane.fill")
                    .font(.system(size: 14, weight: .semibold))
            }
            .buttonStyle(.borderedProminent)
            .tint(Fleet.Color.active)
            .disabled(decisionID.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || decisionClass.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || store.activeAction != nil)
        }
    }

    private func packetCard(_ packet: FleetDoctrinePacketSnapshot) -> some View {
        doctrineCard(title: "Retrieval receipt", icon: "doc.text.magnifyingglass") {
            HStack {
                Text(packet.receipt.id)
                    .font(.system(size: 12, design: .monospaced))
                    .foregroundStyle(.secondary)
                Spacer()
                Text(packet.retrievalPolicy)
                    .font(.system(size: 11, weight: .medium))
                    .foregroundStyle(Fleet.Color.healthy)
            }
            if packet.doctrines.isEmpty {
                Text("No admitted doctrine matched this decision class. That absence is now part of the evidence trail.")
                    .font(.system(size: 14))
                    .foregroundStyle(.secondary)
            } else {
                ForEach(packet.doctrines) { doctrine in
                    packetDoctrineCard(packet: packet, doctrine: doctrine)
                }
            }
        }
    }

    private func packetDoctrineCard(packet: FleetDoctrinePacketSnapshot, doctrine: FleetDoctrineCandidateSnapshot) -> some View {
        let key = doctrine.doctrineId ?? doctrine.id
        let draft = applicationDrafts[key] ?? FleetDoctrineApplicationDraft()
        return VStack(alignment: .leading, spacing: Fleet.Space.s) {
            HStack {
                Text(doctrine.title)
                    .font(.system(size: 14, weight: .semibold))
                Spacer()
                doctrineBadge(doctrine.status)
            }
            Text("\(doctrine.when) Prefer \(doctrine.prefer) over \(doctrine.over).")
                .font(.system(size: 13))
                .foregroundStyle(.secondary)
            HStack(spacing: Fleet.Space.s) {
                Picker("Response", selection: binding(forApplication: key, keyPath: \.response)) {
                    ForEach(FleetDoctrineApplicationResponse.allCases) { response in
                        Text(response.displayLabel).tag(response)
                    }
                }
                .labelsHidden()
                .pickerStyle(.menu)
                TextField("Actual decision taken", text: binding(forApplication: key, keyPath: \.decision))
                    .textFieldStyle(.roundedBorder)
            }
            TextField("Optional boundary or adaptation note", text: binding(forApplication: key, keyPath: \.note))
                .textFieldStyle(.roundedBorder)
            Button {
                Task {
                    await store.recordApplication(
                        packet: packet,
                        doctrine: doctrine,
                        response: draft.response,
                        decision: draft.decision,
                        note: draft.note
                    )
                }
            } label: {
                Text(store.activeAction == "application:\(doctrine.doctrineId ?? "")" ? "Recording" : "Record agent response")
                    .font(.system(size: 13, weight: .semibold))
            }
            .buttonStyle(.bordered)
            .tint(Fleet.Color.healthy)
            .disabled(draft.decision.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || store.activeAction != nil)
        }
        .padding(Fleet.Space.s)
        .background(Fleet.Chrome.card, in: RoundedRectangle(cornerRadius: Fleet.Radius.standard, style: .continuous))
    }

    private func historyCard(candidate: FleetDoctrineCandidateSnapshot, detail: FleetDoctrineDetailSnapshot) -> some View {
        let outcomesByApplication = Dictionary(uniqueKeysWithValues: detail.outcomes.map { ($0.applicationId, $0) })
        return doctrineCard(title: "Application and outcome history", icon: "clock.badge.checkmark") {
            if detail.retrievals.isEmpty {
                Text("No decision-time retrieval receipt has been recorded for this advisory yet.")
                    .font(.system(size: 14))
                    .foregroundStyle(.secondary)
            } else {
                ForEach(detail.retrievals) { retrieval in
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Retrieved for \(retrieval.decisionId)")
                                .font(.system(size: 14, weight: .medium))
                            Text(retrieval.decisionClass)
                                .font(.system(size: 12, design: .monospaced))
                                .foregroundStyle(.secondary)
                        }
                        Spacer()
                        Text(relativeTime(retrieval.occurredAt))
                            .font(.system(size: 12))
                            .foregroundStyle(.secondary)
                    }
                    .padding(Fleet.Space.s)
                    .background(Fleet.Chrome.card, in: RoundedRectangle(cornerRadius: Fleet.Radius.standard, style: .continuous))
                }
            }
            ForEach(detail.applications) { application in
                let outcome = outcomesByApplication[application.id]
                applicationHistoryCard(application: application, outcome: outcome, candidate: candidate, detail: detail)
            }
        }
    }

    private func applicationHistoryCard(application: FleetDoctrineApplicationSnapshot, outcome: FleetDoctrineOutcomeSnapshot?, candidate: FleetDoctrineCandidateSnapshot, detail: FleetDoctrineDetailSnapshot) -> some View {
        let draft = outcomeDrafts[application.id] ?? FleetDoctrineOutcomeDraft()
        return VStack(alignment: .leading, spacing: Fleet.Space.s) {
            HStack {
                Text("Agent response: \(application.response.displayLabel)")
                    .font(.system(size: 14, weight: .semibold))
                Spacer()
                Text(relativeTime(application.occurredAt))
                    .font(.system(size: 12))
                    .foregroundStyle(.secondary)
            }
            Text(application.decision)
                .font(.system(size: 14))
                .foregroundStyle(.secondary)
            if let note = application.note, !note.isEmpty {
                Text("Note: \(note)")
                    .font(.system(size: 12))
                    .foregroundStyle(.secondary)
            }
            if let outcome {
                VStack(alignment: .leading, spacing: 3) {
                    Text("Verified outcome: \(outcome.verdict.displayLabel)")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(outcome.verdict == .harmed ? Fleet.Color.failure : Fleet.Color.healthy)
                    Text(outcome.summary)
                        .font(.system(size: 13))
                        .foregroundStyle(.secondary)
                    Text("Verified by \(outcome.verifiedBy)")
                        .font(.system(size: 11))
                        .foregroundStyle(.secondary)
                }
                .padding(Fleet.Space.s)
                .background(Fleet.Chrome.card, in: RoundedRectangle(cornerRadius: Fleet.Radius.standard, style: .continuous))
            } else {
                VStack(alignment: .leading, spacing: Fleet.Space.s) {
                    Text("Verification pending")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(Fleet.Color.warning)
                    HStack(spacing: Fleet.Space.s) {
                        Picker("Verdict", selection: binding(forOutcome: application.id, keyPath: \.verdict)) {
                            ForEach(FleetDoctrineOutcomeVerdict.allCases) { verdict in
                                Text(verdict.displayLabel).tag(verdict)
                            }
                        }
                        .labelsHidden()
                        .pickerStyle(.menu)
                        TextField("Verified by", text: binding(forOutcome: application.id, keyPath: \.verifiedBy))
                            .textFieldStyle(.roundedBorder)
                    }
                    TextField("Observed result and evidence boundary", text: binding(forOutcome: application.id, keyPath: \.summary), axis: .vertical)
                        .lineLimit(2...4)
                        .textFieldStyle(.roundedBorder)
                    Button {
                        Task {
                            await store.recordOutcome(
                                application: application,
                                candidate: candidate,
                                detail: detail,
                                verdict: draft.verdict,
                                summary: draft.summary,
                                verifiedBy: draft.verifiedBy
                            )
                        }
                    } label: {
                        Text(store.activeAction == "outcome:\(application.id)" ? "Recording" : "Record verified outcome")
                            .font(.system(size: 13, weight: .semibold))
                    }
                    .buttonStyle(.bordered)
                    .tint(Fleet.Color.warning)
                    .disabled(draft.summary.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || draft.verifiedBy.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || store.activeAction != nil)
                }
                .padding(Fleet.Space.s)
                .background(Fleet.Color.warning.opacity(0.07), in: RoundedRectangle(cornerRadius: Fleet.Radius.standard, style: .continuous))
            }
        }
        .padding(Fleet.Space.s)
        .background(Fleet.Chrome.card, in: RoundedRectangle(cornerRadius: Fleet.Radius.standard, style: .continuous))
    }

    private func doctrineCard<Content: View>(title: String, icon: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: Fleet.Space.m) {
            Label(title, systemImage: icon)
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(.primary)
            content()
        }
        .padding(Fleet.Space.m)
        .background(Fleet.Chrome.card.opacity(0.7), in: RoundedRectangle(cornerRadius: Fleet.Radius.medium, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: Fleet.Radius.medium, style: .continuous)
                .stroke(Fleet.Color.dormant.opacity(0.2), lineWidth: 1)
        )
    }

    private func evidenceCell(_ label: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(label.uppercased())
                .font(.system(size: 10, weight: .semibold))
                .foregroundStyle(.secondary)
            Text(value)
                .font(.system(size: 14))
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func evidenceTag(_ value: String) -> some View {
        Text(value)
            .font(.system(size: 12))
            .foregroundStyle(.secondary)
            .padding(.horizontal, Fleet.Space.s)
            .padding(.vertical, 4)
            .background(Fleet.Chrome.card, in: Capsule())
    }

    private func metricChip(title: String, value: String, tint: Color) -> some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(title.uppercased())
                .font(.system(size: 9, weight: .semibold))
                .foregroundStyle(.secondary)
            Text(value)
                .font(.system(size: 14, weight: .semibold, design: .monospaced))
                .foregroundStyle(tint)
        }
        .padding(.horizontal, Fleet.Space.s)
        .padding(.vertical, 5)
        .background(Fleet.Chrome.card, in: RoundedRectangle(cornerRadius: Fleet.Radius.small, style: .continuous))
    }

    private func doctrineBadge(_ status: FleetDoctrineStatus) -> some View {
        Text(status.displayLabel.uppercased())
            .font(.system(size: 10, weight: .semibold))
            .foregroundStyle(status.color)
            .padding(.horizontal, Fleet.Space.s)
            .padding(.vertical, 4)
            .background(status.color.opacity(0.12), in: Capsule())
    }

    private func noticeBanner(_ value: String, color: Color, icon: String) -> some View {
        Label(value, systemImage: icon)
            .font(.system(size: 14, weight: .medium))
            .foregroundStyle(color)
            .padding(Fleet.Space.m)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(color.opacity(0.08), in: RoundedRectangle(cornerRadius: Fleet.Radius.medium, style: .continuous))
    }

    private func relativeTime(_ iso8601: String) -> String {
        guard let date = ISO8601DateFormatter().date(from: iso8601) else { return iso8601 }
        let seconds = max(0, Date().timeIntervalSince(date))
        if seconds < 60 { return "just now" }
        if seconds < 3_600 { return "\(Int(seconds / 60))m ago" }
        if seconds < 86_400 { return "\(Int(seconds / 3_600))h ago" }
        return "\(Int(seconds / 86_400))d ago"
    }

    private func binding<Value>(forApplication id: String, keyPath: WritableKeyPath<FleetDoctrineApplicationDraft, Value>) -> Binding<Value> {
        Binding(
            get: { applicationDrafts[id, default: FleetDoctrineApplicationDraft()][keyPath: keyPath] },
            set: { value in
                var draft = applicationDrafts[id, default: FleetDoctrineApplicationDraft()]
                draft[keyPath: keyPath] = value
                applicationDrafts[id] = draft
            }
        )
    }

    private func binding<Value>(forOutcome id: String, keyPath: WritableKeyPath<FleetDoctrineOutcomeDraft, Value>) -> Binding<Value> {
        Binding(
            get: { outcomeDrafts[id, default: FleetDoctrineOutcomeDraft()][keyPath: keyPath] },
            set: { value in
                var draft = outcomeDrafts[id, default: FleetDoctrineOutcomeDraft()]
                draft[keyPath: keyPath] = value
                outcomeDrafts[id] = draft
            }
        )
    }
}

private struct FleetDoctrineApplicationDraft {
    var response: FleetDoctrineApplicationResponse = .follow
    var decision = ""
    var note = ""
}

private struct FleetDoctrineOutcomeDraft {
    var verdict: FleetDoctrineOutcomeVerdict = .inconclusive
    var summary = ""
    var verifiedBy = "fleetbar-operator"
}

private extension FleetDoctrineStatus {
    var color: Color {
        switch self {
        case .candidate: return Fleet.Color.dormant
        case .provisional: return Fleet.Color.warning
        case .established: return Fleet.Color.healthy
        case .contested, .deprecated: return Fleet.Color.failure
        }
    }
}
