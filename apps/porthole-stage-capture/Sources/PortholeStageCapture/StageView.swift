import AppKit
import PortholeStageCore
import SwiftUI

/// Presentation is separate from capture authority. The render-only model never
/// constructs a capture controller, system picker, source filter, or Keychain.
@MainActor
protocol StagePresentationModel: ObservableObject {
    var approvedSources: [SourceApproval] { get }
    var selectedApprovalID: String? { get }
    var pendingApprovalReview: ApprovalReview? { get }
    var lifecycle: CaptureLifecycle { get }
    var persistenceGate: PersistenceGate { get }
    var activeCaptureLease: CaptureLeaseIdentity? { get }
    var latestImage: NSImage? { get }
    var latestMetadata: FrameMetadata? { get }
    var frameRingCount: Int { get }
    var cursors: [CursorEvent] { get }
    var proofReceipt: PortholeProofReceipt? { get }
    var proofConfiguration: ProofConfiguration? { get }
    var statusMessage: String { get }
    var selectedApprovalCanEnterStage: Bool { get }
    var canPauseCapture: Bool { get }
    func isApprovalReady(_ approvalID: String) -> Bool
    func cancelPendingApproval()
    func approvePending(scope: SourceApprovalScopeKind, capabilities: SourceCapabilities)
    func selectApproval(_ approvalID: String) async
    func revokeApproval(_ approvalID: String) async
    func presentSystemPicker(for sourceKind: ApprovedSourceKind) async
    func startCapture() async
    func pauseCapture() async
    func stopCapture() async
}

extension StageCaptureController: StagePresentationModel {}

struct StageView<Model: StagePresentationModel>: View {
    @ObservedObject var controller: Model
    @Environment(\.colorScheme) private var colorScheme

    private var ink: Color { colorScheme == .dark
        ? Color(red: 0.035, green: 0.043, blue: 0.055) : Color(red: 0.97, green: 0.97, blue: 0.95) }
    private var panel: Color { colorScheme == .dark
        ? Color(red: 0.065, green: 0.078, blue: 0.098) : Color(red: 0.93, green: 0.94, blue: 0.91) }
    private var line: Color { Color.primary.opacity(colorScheme == .dark ? 0.11 : 0.17) }
    private var mint: Color { colorScheme == .dark
        ? Color(red: 0.42, green: 0.94, blue: 0.72) : Color(red: 0.04, green: 0.39, blue: 0.29) }

    var body: some View {
        HStack(spacing: 0) {
            sourceRail.frame(width: 320)
            Divider().overlay(line)
            VStack(spacing: 0) {
                stageHeader
                Divider().overlay(line)
                preview
                Divider().overlay(line)
                transportBar
            }
        }
        .background(ink)
        .foregroundStyle(.primary)
        .sheet(item: pendingReviewBinding) { review in
            ApprovalReviewSheet(
                review: review,
                onCancel: controller.cancelPendingApproval,
                onApprove: controller.approvePending(scope:capabilities:)
            )
        }
    }

    private var pendingReviewBinding: Binding<ApprovalReview?> {
        Binding(
            get: { controller.pendingApprovalReview },
            set: { value in
                if value == nil, controller.pendingApprovalReview != nil {
                    controller.cancelPendingApproval()
                }
            }
        )
    }

    private var sourceRail: some View {
        VStack(alignment: .leading, spacing: 0) {
            VStack(alignment: .leading, spacing: 7) {
                Text("PORTHOLE")
                    .font(.system(size: 12, weight: .black, design: .rounded))
                    .tracking(2.4)
                    .foregroundStyle(mint)
                Text("Window Stage")
                    .font(.system(size: 24, weight: .semibold, design: .rounded))
                Text("One approved source. Local presence. Memory-only by default.")
                    .font(.system(size: 14))
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(22)

            HStack {
                Text("APPROVED SOURCES")
                    .font(.system(size: 11, weight: .bold, design: .rounded))
                    .tracking(1.2)
                    .foregroundStyle(.secondary)
                Spacer()
                Text("\(controller.approvedSources.count)")
                    .font(.system(size: 11, weight: .bold, design: .monospaced))
                    .foregroundStyle(controller.approvedSources.isEmpty ? .secondary : mint)
            }
            .padding(.horizontal, 20)
            .padding(.bottom, 10)

            if controller.lifecycle == .permissionDenied {
                permissionCard.padding(.horizontal, 16)
            } else if controller.approvedSources.isEmpty {
                emptyApprovalCard.padding(.horizontal, 16)
            } else {
                ScrollView {
                    VStack(spacing: 10) {
                        ForEach(controller.approvedSources) { approval in
                            ApprovalCard(
                                approval: approval,
                                selected: controller.selectedApprovalID == approval.approvalID,
                                ready: controller.isApprovalReady(approval.approvalID),
                                live: controller.activeCaptureLease?.approvalID == approval.approvalID,
                                persistenceGate: controller.activeCaptureLease?.approvalID == approval.approvalID
                                    ? controller.persistenceGate : nil,
                                onSelect: {
                                    Task { await controller.selectApproval(approval.approvalID) }
                                },
                                onRevoke: {
                                    Task { await controller.revokeApproval(approval.approvalID) }
                                }
                            )
                        }
                    }
                    .padding(.horizontal, 14)
                    .padding(.bottom, 10)
                }
                .accessibilityLabel("Approved source policies")
            }

            pickerButtons
                .padding(.horizontal, 16)
                .padding(.top, 12)
            Spacer(minLength: 12)
            privacyCard.padding(16)
        }
        .background(panel)
    }

    private var emptyApprovalCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            Image(systemName: "checkmark.shield")
                .font(.system(size: 24, weight: .medium))
                .foregroundStyle(.secondary)
            Text("Nothing is approved")
                .font(.system(size: 16, weight: .semibold))
            Text("The window catalog stays inside the macOS picker. Porthole receives only the source you choose for review.")
                .font(.system(size: 13))
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
            Label("Approval never starts capture", systemImage: "pause.circle")
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(.secondary)
        }
        .padding(16)
        .background(Color.primary.opacity(0.035), in: RoundedRectangle(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).stroke(line))
        .accessibilityElement(children: .combine)
    }

    private var pickerButtons: some View {
        VStack(spacing: 9) {
            Button {
                Task { await controller.presentSystemPicker(for: .window) }
            } label: {
                Label("Choose exact window…", systemImage: "macwindow")
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .buttonStyle(.borderedProminent)
            .tint(.blue)
            .accessibilityHint("Opens the private macOS window picker; it does not begin capture")

            Button {
                Task { await controller.presentSystemPicker(for: .application) }
            } label: {
                Label("Choose app…", systemImage: "app.dashed")
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .buttonStyle(.bordered)
            .accessibilityHint("Opens the private macOS application picker; it does not begin capture")
        }
    }

    private var permissionCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            Image(systemName: "rectangle.on.rectangle.slash")
                .font(.system(size: 26))
                .foregroundStyle(.orange)
            Text("The macOS picker could not open")
                .font(.system(size: 16, weight: .semibold))
            Text("Nothing was captured. Try the private exact-window picker again; Porthole does not request global Screen Recording here.")
                .font(.system(size: 14))
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
            Button("Choose exact window…") {
                Task { await controller.presentSystemPicker(for: .window) }
            }
            .buttonStyle(.borderedProminent)
            .accessibilityHint("Retries Apple's private source picker without requesting global screen access")
        }
        .padding(16)
        .background(.orange.opacity(0.08), in: RoundedRectangle(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).stroke(.orange.opacity(0.35)))
    }

    private var privacyCard: some View {
        VStack(alignment: .leading, spacing: 9) {
            HStack(spacing: 8) {
                Image(systemName: privacyIcon).foregroundStyle(privacyColor)
                Text(privacyLabel).font(.system(size: 14, weight: .semibold))
            }
            Text(controller.persistenceGate.reason)
                .font(.system(size: 12))
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
            HStack(spacing: 10) {
                Label("Mic off", systemImage: "mic.slash")
                Label("Audio off", systemImage: "speaker.slash")
            }
            .font(.system(size: 11, weight: .medium))
            .foregroundStyle(.secondary)
            Label("Evidence access is separate", systemImage: "person.2.slash")
                .font(.system(size: 11, weight: .medium))
                .foregroundStyle(.secondary)
        }
        .padding(14)
        .background(Color.primary.opacity(0.035), in: RoundedRectangle(cornerRadius: 13))
        .overlay(RoundedRectangle(cornerRadius: 13).stroke(line))
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Persistence and audio privacy status")
    }

    private var privacyLabel: String {
        if controller.lifecycle == .live, controller.persistenceGate.allowed { return "Recording approved" }
        if controller.lifecycle == .live { return "Live · memory-only" }
        return controller.approvedSources.isEmpty ? "Not approved" : "Approved · not live"
    }

    private var privacyIcon: String {
        controller.lifecycle == .live && controller.persistenceGate.allowed
            ? "record.circle.fill"
            : controller.approvedSources.isEmpty ? "lock.shield" : "checkmark.shield.fill"
    }

    private var privacyColor: Color {
        controller.lifecycle == .live && controller.persistenceGate.allowed
            ? .red
            : controller.approvedSources.isEmpty ? .secondary : mint
    }

    private var stageHeader: some View {
        HStack(spacing: 14) {
            VStack(alignment: .leading, spacing: 3) {
                Text("ACTIVE CAPTURE LEASE")
                    .font(.system(size: 11, weight: .bold, design: .rounded))
                    .tracking(1.3)
                    .foregroundStyle(.secondary)
                Text(controller.activeCaptureLease?.displayTitle ?? "No active source")
                    .font(.system(size: 18, weight: .semibold))
                    .lineLimit(1)
            }
            Spacer()
            if let metadata = controller.latestMetadata {
                MetadataPill(label: "FRAME", value: "#\(metadata.sequence)")
                MetadataPill(label: "RING", value: "\(controller.frameRingCount)/\(StageCaptureController.frameRingCapacity)")
                MetadataPill(label: "SOURCE", value: metadata.sourceWindowID == 0 ? "APP" : "W\(metadata.sourceWindowID)")
            }
            StatePill(
                lifecycle: controller.lifecycle,
                recording: controller.lifecycle == .live && controller.persistenceGate.allowed
            )
        }
        .padding(.horizontal, 22)
        .padding(.vertical, 15)
        .background(ink)
    }

    private var preview: some View {
        GeometryReader { geometry in
            ZStack {
                ink
                CanvasGrid().opacity(controller.latestImage == nil ? 1 : 0.18)
                if let image = controller.latestImage,
                   let lease = controller.activeCaptureLease,
                   let metadata = controller.latestMetadata,
                   lease.matches(metadata)
                {
                    let fitted = aspectFitRect(imageSize: image.size, in: geometry.size)
                    Image(nsImage: image)
                        .resizable()
                        .interpolation(.high)
                        .frame(width: fitted.width, height: fitted.height)
                        .position(x: fitted.midX, y: fitted.midY)
                        .accessibilityLabel("Live preview of \(lease.displayTitle)")
                    ForEach(controller.cursors) { cursor in
                        GhostCursor(event: cursor)
                            .position(
                                x: fitted.minX + fitted.width * cursor.normalizedX,
                                y: fitted.minY + fitted.height * cursor.normalizedY
                            )
                    }
                } else {
                    VStack(spacing: 14) {
                        Image(systemName: controller.approvedSources.isEmpty ? "lock.rectangle" : "rectangle.dashed")
                            .font(.system(size: 42, weight: .light))
                            .foregroundStyle(.secondary)
                        Text(previewEmptyTitle).font(.system(size: 16, weight: .medium))
                        Text(previewEmptyDetail)
                            .font(.system(size: 14))
                            .foregroundStyle(.secondary)
                    }
                    .accessibilityElement(children: .combine)
                }
            }
            .clipped()
        }
        .background(ink)
    }

    private var previewEmptyTitle: String {
        if controller.approvedSources.isEmpty { return "Nothing is approved" }
        if controller.selectedApprovalID != nil { return "Approved, not capturing" }
        return "Select an approved source"
    }

    private var previewEmptyDetail: String {
        if controller.approvedSources.isEmpty { return "Use the macOS picker; its catalog is never shown here." }
        if let id = controller.selectedApprovalID, !controller.isApprovalReady(id) {
            return "Choose this signed app in the macOS picker to attach a current filter."
        }
        return "Enter Stage starts the separately approved memory-only preview."
    }

    private var transportBar: some View {
        HStack(spacing: 14) {
            RoundedRectangle(cornerRadius: 2)
                .fill(stateColor)
                .frame(width: 10, height: 10)
                .shadow(color: stateColor.opacity(0.6), radius: 5)
            VStack(alignment: .leading, spacing: 2) {
                Text(controller.statusMessage)
                    .font(.system(size: 14, weight: .medium))
                    .lineLimit(1)
                Text("Physical cursor: exact-window pixels · named cursors: lease-scoped JSONL")
                    .font(.system(size: 11))
                    .foregroundStyle(.secondary)
            }
            Spacer()
            if let receipt = controller.proofReceipt {
                Label(String(receipt.sourceMediaSHA256.prefix(10)), systemImage: "checkmark.seal.fill")
                    .font(.system(size: 12, weight: .medium, design: .monospaced))
                    .foregroundStyle(mint)
                    .help("Approved exact-source SHA-256; Stage composite is deferred to an in-process renderer")
            }
            Button {
                Task { await controller.startCapture() }
            } label: {
                Label("Enter Stage", systemImage: "play.rectangle.fill")
            }
            .buttonStyle(.borderedProminent)
            .tint(.blue)
            .disabled(!controller.selectedApprovalCanEnterStage)
            .keyboardShortcut("r", modifiers: [.command])
            .accessibilityHint("Starts the approved preview; it does not add persistence permission")

            if controller.proofConfiguration == nil {
                Button {
                    Task { await controller.pauseCapture() }
                } label: {
                    Label("Pause", systemImage: "pause.fill")
                }
                .buttonStyle(.bordered)
                .disabled(!controller.canPauseCapture)
                .keyboardShortcut("p", modifiers: [.command])
            } else {
                Label("Single-segment proof", systemImage: "lock.fill")
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(.secondary)
                    .help("Proof cannot pause or resume in this slice. Stop & Clear finalizes its one immutable media segment.")
                    .accessibilityLabel("Proof recording is one immutable segment; pause is unavailable")
            }

            Button {
                Task { await controller.stopCapture() }
            } label: {
                Label("Stop & Clear", systemImage: "stop.fill")
            }
            .buttonStyle(.bordered)
            .disabled(![.live, .paused].contains(controller.lifecycle))
            .keyboardShortcut(".", modifiers: [.command])
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 14)
        .background(panel)
    }

    private var stateColor: Color {
        if controller.lifecycle == .live, controller.persistenceGate.allowed { return .red }
        switch controller.lifecycle {
        case .live: return mint
        case .paused: return .yellow
        case .failed, .permissionDenied: return .red
        default: return .secondary
        }
    }

    private func aspectFitRect(imageSize: CGSize, in container: CGSize) -> CGRect {
        guard imageSize.width > 0, imageSize.height > 0 else { return CGRect(origin: .zero, size: container) }
        let scale = min(container.width / imageSize.width, container.height / imageSize.height)
        let size = CGSize(width: imageSize.width * scale, height: imageSize.height * scale)
        return CGRect(
            x: (container.width - size.width) / 2,
            y: (container.height - size.height) / 2,
            width: size.width,
            height: size.height
        )
    }
}

private struct ApprovalCard: View {
    @Environment(\.colorScheme) private var colorScheme
    let approval: SourceApproval
    let selected: Bool
    let ready: Bool
    let live: Bool
    let persistenceGate: PersistenceGate?
    let onSelect: () -> Void
    let onRevoke: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Button(action: onSelect) {
                HStack(alignment: .top, spacing: 10) {
                    Image(systemName: approval.sourceKind == .window ? "macwindow" : "app")
                        .font(.system(size: 17, weight: .medium))
                        .foregroundStyle(statusColor)
                        .frame(width: 30, height: 30)
                        .background(statusColor.opacity(0.12), in: RoundedRectangle(cornerRadius: 8))
                    VStack(alignment: .leading, spacing: 3) {
                        Text(approval.displayTitle)
                            .font(.system(size: 14, weight: .semibold))
                            .lineLimit(2)
                            .multilineTextAlignment(.leading)
                        Label(statusLabel, systemImage: statusIcon)
                            .font(.system(size: 11, weight: .medium))
                            .foregroundStyle(statusColor)
                    }
                    Spacer()
                    if selected {
                        Image(systemName: "checkmark.circle.fill")
                            .foregroundStyle(.blue)
                            .accessibilityLabel("Selected")
                    }
                }
            }
            .buttonStyle(.plain)

            HStack(spacing: 6) {
                CapabilityBadge(label: "Preview", granted: approval.capabilities.preview)
                CapabilityBadge(label: "Share", granted: approval.capabilities.liveShare)
                Label(persistence.label, systemImage: persistence.allowed ? "checkmark.shield.fill" : "lock.shield")
                    .font(.system(size: 11, weight: .medium))
                    .foregroundStyle(persistence.allowed ? Color.green : Color.secondary)
                    .help(persistence.reason)
                    .accessibilityLabel(persistence.label + ". " + persistence.reason)
            }

            HStack {
                Text(expiryLabel)
                    .font(.system(size: 10, weight: .medium))
                    .foregroundStyle(.secondary)
                Spacer()
                Button("Revoke", role: .destructive, action: onRevoke)
                    .buttonStyle(.link)
                    .font(.system(size: 11, weight: .semibold))
            }
        }
        .padding(13)
        .background(selected ? Color.blue.opacity(0.10) : Color.primary.opacity(0.035), in: RoundedRectangle(cornerRadius: 13))
        .overlay(
            RoundedRectangle(cornerRadius: 13)
                .stroke(selected ? Color.blue.opacity(0.7) : Color.primary.opacity(0.14), lineWidth: selected ? 1.5 : 1)
        )
        .accessibilityElement(children: .contain)
    }

    private var statusLabel: String {
        if live { return persistence.allowed ? "Live · persistence eligible" : "Live · memory-only" }
        if ready { return "Approved · ready" }
        return "Approved · choose again to activate"
    }

    private var persistence: PersistenceCapabilityPresentation {
        .evaluate(approval: approval, activeGate: persistenceGate)
    }

    private var statusIcon: String {
        if live { return "play.rectangle.fill" }
        if ready { return "checkmark.shield.fill" }
        return "lock.rotation"
    }

    private var statusColor: Color {
        if live { return StagePalette.positive(colorScheme) }
        if ready { return .blue }
        return .secondary
    }

    private var expiryLabel: String {
        switch approval.scope {
        case .signedProgram: return "Signed app · Keychain · until revoked"
        case .runningInstance: return "This launch · expires on exit"
        case .exactWindow: return "This window · expires on close"
        }
    }
}

private struct CapabilityBadge: View {
    @Environment(\.colorScheme) private var colorScheme
    let label: String
    let granted: Bool

    private var color: Color { granted ? StagePalette.positive(colorScheme) : .secondary }

    var body: some View {
        Label(label, systemImage: granted ? "checkmark" : "minus")
            .font(.system(size: 9, weight: .bold, design: .rounded))
            .foregroundStyle(color)
            .padding(.horizontal, 6)
            .padding(.vertical, 4)
            .background(color.opacity(0.09), in: Capsule())
            .overlay(Capsule().stroke(color.opacity(0.2)))
            .accessibilityLabel("\(label) \(granted ? "approved" : "not approved")")
    }
}

private struct ApprovalReviewSheet: View {
    let review: ApprovalReview
    let onCancel: () -> Void
    let onApprove: (SourceApprovalScopeKind, SourceCapabilities) -> Void

    @State private var scope: SourceApprovalScopeKind
    @State private var preview = true
    @State private var liveShare = false
    @State private var persist = false

    init(
        review: ApprovalReview,
        onCancel: @escaping () -> Void,
        onApprove: @escaping (SourceApprovalScopeKind, SourceCapabilities) -> Void
    ) {
        self.review = review
        self.onCancel = onCancel
        self.onApprove = onApprove
        _scope = State(initialValue: review.supportedScopes.first ?? .runningInstance)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            VStack(alignment: .leading, spacing: 5) {
                Text("Review source approval")
                    .font(.system(size: 22, weight: .semibold, design: .rounded))
                Text(review.displayTitle).font(.system(size: 15, weight: .medium))
                Text("Nothing has started capturing. Choose the identity boundary and each capability explicitly.")
                    .font(.system(size: 13))
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }

            VStack(alignment: .leading, spacing: 9) {
                Text("APPROVAL SCOPE")
                    .font(.system(size: 10, weight: .bold, design: .rounded))
                    .tracking(1)
                    .foregroundStyle(.secondary)
                Picker("Approval scope", selection: $scope) {
                    ForEach(review.supportedScopes, id: \.self) { option in
                        Text(scopeLabel(option)).tag(option)
                    }
                }
                .pickerStyle(.radioGroup)
                .onChange(of: scope) { _, newScope in
                    if newScope != .exactWindow { persist = false }
                }
                Text(scopeDetail(scope))
                    .font(.system(size: 12))
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }

            VStack(alignment: .leading, spacing: 9) {
                Text("CAPABILITIES")
                    .font(.system(size: 10, weight: .bold, design: .rounded))
                    .tracking(1)
                    .foregroundStyle(.secondary)
                Toggle("Preview in Porthole", isOn: $preview)
                Toggle("Share live Stage output", isOn: $liveShare)
                Toggle("Allow recording persistence", isOn: $persist)
                    .disabled(scope != .exactWindow)
                if scope != .exactWindow {
                    Text("Recording persistence requires This exact window.")
                        .font(.system(size: 14))
                        .foregroundStyle(.secondary)
                }
                if persist {
                    Label(
                        "Persistence still fails closed on protected-field uncertainty and needs an explicit destination.",
                        systemImage: "exclamationmark.shield"
                    )
                    .font(.system(size: 12))
                    .foregroundStyle(.orange)
                    .fixedSize(horizontal: false, vertical: true)
                }
            }

            Divider()
            HStack {
                Label("Approval does not enter Stage", systemImage: "pause.circle")
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(.secondary)
                Spacer()
                Button("Cancel", action: onCancel).keyboardShortcut(.cancelAction)
                Button("Approve Source") {
                    onApprove(
                        scope,
                        SourceCapabilities(
                            preview: preview,
                            liveShare: liveShare,
                            persistRecording: persist
                        )
                    )
                }
                .buttonStyle(.borderedProminent)
                .disabled(!SourceApprovalPolicy.supports(scope: scope, capabilities: SourceCapabilities(
                    preview: preview, liveShare: liveShare, persistRecording: persist)))
                .keyboardShortcut(.defaultAction)
            }
        }
        .padding(24)
        .frame(width: 520)
        .accessibilityElement(children: .contain)
    }

    private func scopeLabel(_ scope: SourceApprovalScopeKind) -> String {
        switch scope {
        case .exactWindow: return "This exact window"
        case .runningInstance: return "This running app instance"
        case .signedProgram: return "This signed app"
        }
    }

    private func scopeDetail(_ scope: SourceApprovalScopeKind) -> String {
        switch scope {
        case .exactWindow:
            return "Bound to signed launch + PID + window ID. Expires when the window closes."
        case .runningInstance:
            return "Bound to signature + executable + launch identity, not PID alone. Expires when the app exits."
        case .signedProgram:
            return "Bound to bundle ID + designated code requirement. Stored in Keychain until revoked; window titles are never stored."
        }
    }
}

private struct StatePill: View {
    @Environment(\.colorScheme) private var colorScheme
    let lifecycle: CaptureLifecycle
    let recording: Bool

    var body: some View {
        Label(label, systemImage: icon)
            .font(.system(size: 11, weight: .black, design: .rounded))
            .tracking(0.6)
            .padding(.horizontal, 11)
            .padding(.vertical, 7)
            .foregroundStyle(color)
            .background(color.opacity(0.12), in: Capsule())
            .overlay(Capsule().stroke(color.opacity(0.35)))
            .accessibilityLabel("Capture state \(label)")
    }

    private var label: String { recording ? "RECORDING" : lifecycle.rawValue.uppercased() }

    private var icon: String {
        if recording { return "record.circle.fill" }
        switch lifecycle {
        case .live: return "play.fill"
        case .paused: return "pause.fill"
        case .failed, .permissionDenied: return "exclamationmark.triangle.fill"
        default: return "stop.fill"
        }
    }

    private var color: Color {
        if recording { return .red }
        switch lifecycle {
        case .live: return StagePalette.positive(colorScheme)
        case .paused: return .yellow
        case .failed, .permissionDenied: return .red
        default: return .secondary
        }
    }
}

private enum StagePalette {
    static func positive(_ scheme: ColorScheme) -> Color {
        scheme == .dark ? .green : Color(red: 0.04, green: 0.39, blue: 0.29)
    }
}

private struct MetadataPill: View {
    let label: String
    let value: String

    var body: some View {
        VStack(spacing: 1) {
            Text(label).font(.system(size: 8, weight: .bold, design: .rounded)).foregroundStyle(.secondary)
            Text(value).font(.system(size: 11, weight: .semibold, design: .monospaced))
        }
        .padding(.horizontal, 9)
        .padding(.vertical, 5)
        .background(Color.primary.opacity(0.055), in: RoundedRectangle(cornerRadius: 7))
    }
}

private struct GhostCursor: View {
    let event: CursorEvent

    var body: some View {
        HStack(alignment: .top, spacing: 3) {
            Image(systemName: event.kind == .human ? "cursorarrow" : "cursorarrow.rays")
                .font(.system(size: 24, weight: .black))
                .foregroundStyle(color)
                .shadow(color: .black.opacity(0.8), radius: 2, x: 0, y: 1)
            Text(event.displayName)
                .font(.system(size: 11, weight: .bold, design: .rounded))
                .padding(.horizontal, 7)
                .padding(.vertical, 4)
                .foregroundStyle(.black)
                .background(color, in: Capsule())
                .shadow(color: .black.opacity(0.55), radius: 3, y: 1)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(event.kind.rawValue) cursor for \(event.displayName)")
    }

    private var color: Color { Color(nsColor: NSColor(hex: event.colorHex) ?? .cyan) }
}

private struct CanvasGrid: View {
    var body: some View {
        Canvas { context, size in
            var path = Path()
            stride(from: 0.0, through: size.width, by: 36).forEach { x in
                path.move(to: CGPoint(x: x, y: 0))
                path.addLine(to: CGPoint(x: x, y: size.height))
            }
            stride(from: 0.0, through: size.height, by: 36).forEach { y in
                path.move(to: CGPoint(x: 0, y: y))
                path.addLine(to: CGPoint(x: size.width, y: y))
            }
            context.stroke(path, with: .color(.primary.opacity(0.045)), lineWidth: 1)
        }
    }
}

private extension NSColor {
    convenience init?(hex: String) {
        guard hex.count == 7, hex.first == "#", let value = UInt64(hex.dropFirst(), radix: 16) else { return nil }
        self.init(
            red: CGFloat((value >> 16) & 0xFF) / 255,
            green: CGFloat((value >> 8) & 0xFF) / 255,
            blue: CGFloat(value & 0xFF) / 255,
            alpha: 1
        )
    }
}
