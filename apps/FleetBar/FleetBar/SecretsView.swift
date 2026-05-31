import SwiftUI

// MARK: - Secrets Pane
//
// A credentials manager reachable from the FleetBar popover footer and from a
// standalone Settings window. Values are masked by default; Reveal is an
// explicit, on-demand, auto-expiring action; Copy auto-clears the pasteboard.
//
// Accessibility is a hard requirement here:
//  - All type uses Dynamic Type (.body/.callout/.caption). The only fixed
//    sizes are uppercase, semibold, wide-tracked eyebrow labels per the
//    project font policy.
//  - Every control carries a VoiceOver label that announces its state.
//  - Icons are SF Symbols, never emoji.

struct SecretsView: View {
    @ObservedObject var store: SecretsStore

    @State private var editorTarget: SecretEditorTarget?
    @State private var deleteTarget: SecretSummary?
    @ScaledMetric(relativeTo: .body) private var rowIconWidth: CGFloat = 22

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            header
            Divider().opacity(0.5)

            if store.secrets.isEmpty {
                emptyState
            } else {
                ScrollView {
                    LazyVStack(spacing: Fleet.Space.s) {
                        ForEach(store.secrets) { secret in
                            SecretRow(
                                secret: secret,
                                isRevealed: store.isRevealed(secret.key),
                                revealedValue: store.revealedValue(secret.key),
                                clipboardSecondsRemaining: store.clipboardHold?.key == secret.key
                                    ? store.clipboardSecondsRemaining
                                    : nil,
                                onToggleReveal: { toggleReveal(secret) },
                                onCopy: { Task { await store.copyToClipboard(secret.key) } },
                                onEdit: { editorTarget = .edit(secret) },
                                onDelete: { deleteTarget = secret },
                                iconWidth: rowIconWidth
                            )
                        }
                    }
                    .padding(Fleet.Space.l)
                }
            }

            if let error = store.lastError {
                errorBanner(error)
            }
        }
        .background(Fleet.Chrome.popoverBackground)
        .task { await store.refresh() }
        .onDisappear {
            // Security: drop revealed values and any clipboard hold when the
            // pane goes away.
            store.hideAll()
            store.clearClipboardIfOurs()
        }
        .sheet(item: $editorTarget) { target in
            SecretEditorSheet(store: store, target: target)
        }
        .confirmationDialog(
            "Delete secret?",
            isPresented: deleteBinding,
            presenting: deleteTarget
        ) { secret in
            Button("Delete \(secret.key)", role: .destructive) {
                Task { await store.deleteSecret(key: secret.key) }
                deleteTarget = nil
            }
            Button("Cancel", role: .cancel) { deleteTarget = nil }
        } message: { secret in
            Text("This removes \(secret.key) from \(secret.storage.label) storage. It cannot be undone.")
        }
    }

    private var deleteBinding: Binding<Bool> {
        Binding(
            get: { deleteTarget != nil },
            set: { if !$0 { deleteTarget = nil } }
        )
    }

    // MARK: - Header

    private var header: some View {
        HStack(alignment: .firstTextBaseline, spacing: Fleet.Space.s) {
            VStack(alignment: .leading, spacing: 2) {
                Text("Secrets")
                    .font(.headline)
                Text("Credentials the daemon holds for fleet agents. Values stay masked until you reveal them.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }

            Spacer(minLength: Fleet.Space.s)

            Button {
                Task { await store.refresh() }
            } label: {
                Image(systemName: "arrow.clockwise")
                    .fontWeight(.medium)
            }
            .buttonStyle(.borderless)
            .help("Reload secrets")
            .accessibilityLabel("Reload secrets")
            .disabled(store.isLoading)

            Button {
                editorTarget = .add
            } label: {
                Label("Add", systemImage: "plus")
                    .font(.callout.weight(.semibold))
            }
            .buttonStyle(.borderless)
            .foregroundStyle(Fleet.Color.healthy)
            .help("Add a new secret")
            .accessibilityLabel("Add a new secret")
        }
        .padding(.horizontal, Fleet.Space.l)
        .padding(.vertical, Fleet.Space.m)
    }

    private var emptyState: some View {
        VStack(spacing: Fleet.Space.m) {
            Image(systemName: "key.slash")
                .font(.system(size: 34, weight: .light))
                .foregroundStyle(.quaternary)
            Text(store.isLoading ? "Loading secrets…" : "No secrets stored")
                .font(.body.weight(.medium))
                .foregroundStyle(.secondary)
            if !store.isLoading {
                Text("Add an API key or token and the daemon will hand it to fleet agents on demand.")
                    .font(.caption)
                    .foregroundStyle(.tertiary)
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: 320)
                Button {
                    editorTarget = .add
                } label: {
                    Label("Add secret", systemImage: "plus")
                        .font(.callout.weight(.semibold))
                }
                .buttonStyle(.borderless)
                .foregroundStyle(Fleet.Color.healthy)
                .accessibilityLabel("Add a new secret")
            }
        }
        .frame(maxWidth: .infinity, minHeight: 220)
        .padding(Fleet.Space.xl)
    }

    private func errorBanner(_ message: String) -> some View {
        HStack(spacing: Fleet.Space.s) {
            Image(systemName: "exclamationmark.triangle.fill")
                .foregroundStyle(Fleet.Color.warning)
            Text(message)
                .font(.caption)
                .foregroundStyle(.secondary)
            Spacer()
        }
        .padding(.horizontal, Fleet.Space.l)
        .padding(.vertical, Fleet.Space.s)
        .background(Fleet.Color.warning.opacity(0.08))
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Error: \(message)")
    }

    private func toggleReveal(_ secret: SecretSummary) {
        if store.isRevealed(secret.key) {
            store.hide(secret.key)
        } else {
            Task { await store.reveal(secret.key) }
        }
    }
}

// MARK: - Secret Row

private struct SecretRow: View {
    let secret: SecretSummary
    let isRevealed: Bool
    let revealedValue: String?
    let clipboardSecondsRemaining: Int?
    let onToggleReveal: () -> Void
    let onCopy: () -> Void
    let onEdit: () -> Void
    let onDelete: () -> Void
    let iconWidth: CGFloat

    var body: some View {
        VStack(alignment: .leading, spacing: Fleet.Space.s) {
            HStack(spacing: Fleet.Space.s) {
                Image(systemName: secret.storage.icon)
                    .font(.body)
                    .foregroundStyle(secret.storage.isSensitive ? Fleet.Color.warning : Fleet.Color.active)
                    .frame(width: iconWidth)
                    .accessibilityHidden(true)

                VStack(alignment: .leading, spacing: 3) {
                    Text(secret.key)
                        .font(.callout.weight(.semibold))
                        .foregroundStyle(.primary)
                        .lineLimit(1)
                        .truncationMode(.middle)

                    badges
                }

                Spacer(minLength: Fleet.Space.s)

                Menu {
                    Button { onEdit() } label: { Label("Edit value", systemImage: "pencil") }
                    Button(role: .destructive) { onDelete() } label: {
                        Label("Delete", systemImage: "trash")
                    }
                } label: {
                    Image(systemName: "ellipsis.circle")
                        .font(.body)
                }
                .menuStyle(.borderlessButton)
                .fixedSize()
                .help("More actions for \(secret.key)")
                .accessibilityLabel("More actions for \(secret.key)")
            }

            // Masked / revealed value line + actions.
            HStack(spacing: Fleet.Space.s) {
                Text(SecretMask.display(value: revealedValue, revealed: isRevealed))
                    .font(.system(.callout, design: .monospaced))
                    .foregroundStyle(isRevealed ? .primary : .secondary)
                    .lineLimit(1)
                    .truncationMode(.middle)
                    .textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, Fleet.Space.s)
                    .padding(.vertical, 6)
                    .background(
                        Color.primary.opacity(0.05),
                        in: RoundedRectangle(cornerRadius: Fleet.Radius.small, style: .continuous)
                    )
                    .accessibilityLabel(valueAccessibilityLabel)

                revealButton
                copyButton
            }

            if let seconds = clipboardSecondsRemaining {
                Label {
                    Text("Copied — clears in \(seconds)s")
                        .font(.caption.weight(.medium))
                } icon: {
                    Image(systemName: "clock.badge.checkmark")
                        .font(.caption)
                }
                .foregroundStyle(Fleet.Color.healthy)
                .accessibilityLabel("Copied to clipboard. Clears automatically in \(seconds) seconds.")
            }
        }
        .padding(Fleet.Space.m)
        .background(
            Fleet.Chrome.card,
            in: RoundedRectangle(cornerRadius: Fleet.Radius.medium, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: Fleet.Radius.medium, style: .continuous)
                .stroke(Fleet.Chrome.border, lineWidth: 1)
        )
    }

    private var badges: some View {
        HStack(spacing: Fleet.Space.xs) {
            StatusBadge(
                text: secret.set ? "Set" : "Not set",
                color: secret.set ? Fleet.Color.healthy : Fleet.Color.dormant,
                icon: secret.set ? "checkmark.circle.fill" : "circle.dashed"
            )
            StatusBadge(
                text: secret.storage.label,
                color: secret.storage.isSensitive ? Fleet.Color.warning : Fleet.Color.active,
                icon: secret.storage.icon
            )
            if secret.encryptedAtRest {
                StatusBadge(
                    text: "Encrypted",
                    color: Fleet.Color.healthy,
                    icon: "lock.fill"
                )
            } else if secret.storage.isSensitive {
                StatusBadge(
                    text: "Cleartext",
                    color: Fleet.Color.warning,
                    icon: "lock.open"
                )
            }
            if let backend = secret.backend, !backend.isEmpty {
                StatusBadge(text: backend, color: Fleet.Color.dormant, icon: "cpu")
            }
        }
    }

    private var revealButton: some View {
        Button(action: onToggleReveal) {
            Image(systemName: isRevealed ? "eye.slash" : "eye")
                .font(.body)
                .frame(width: 24)
        }
        .buttonStyle(.borderless)
        .foregroundStyle(isRevealed ? Fleet.Color.warning : Fleet.Color.active)
        .disabled(!secret.set)
        .help(isRevealed ? "Hide value" : "Reveal value")
        // VoiceOver announces the action and the current state.
        .accessibilityLabel(isRevealed ? "Hide value for \(secret.key)" : "Reveal value for \(secret.key)")
        .accessibilityValue(isRevealed ? "Revealed" : "Hidden")
        .accessibilityAddTraits(isRevealed ? [.isSelected, .isButton] : [.isButton])
    }

    private var copyButton: some View {
        Button(action: onCopy) {
            Image(systemName: clipboardSecondsRemaining == nil ? "doc.on.doc" : "checkmark")
                .font(.body)
                .frame(width: 24)
        }
        .buttonStyle(.borderless)
        .foregroundStyle(clipboardSecondsRemaining == nil ? Fleet.Color.active : Fleet.Color.healthy)
        .disabled(!secret.set)
        .help("Copy value to clipboard (auto-clears in 45s)")
        .accessibilityLabel("Copy value for \(secret.key) to clipboard")
        .accessibilityHint("Clears from the clipboard automatically after 45 seconds")
        .accessibilityValue(clipboardSecondsRemaining == nil ? "" : "Copied")
    }

    private var valueAccessibilityLabel: String {
        if isRevealed, let revealedValue, !revealedValue.isEmpty {
            return "Value for \(secret.key), revealed"
        }
        return "Value for \(secret.key), hidden"
    }
}

// MARK: - Status Badge

private struct StatusBadge: View {
    let text: String
    let color: Color
    let icon: String

    var body: some View {
        HStack(spacing: 3) {
            Image(systemName: icon)
                .font(.system(size: 9, weight: .semibold))
                .accessibilityHidden(true)
            // Eyebrow style: uppercase + semibold + wide tracking is the only
            // place the project font policy permits sub-13pt apparent size.
            Text(text.uppercased())
                .font(.system(size: 10, weight: .semibold))
                .tracking(0.4)
        }
        .foregroundStyle(color)
        .padding(.horizontal, Fleet.Space.xs + 1)
        .padding(.vertical, 2)
        .background(
            color.opacity(0.1),
            in: RoundedRectangle(cornerRadius: Fleet.Radius.small, style: .continuous)
        )
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(text)
    }
}

// MARK: - Editor

enum SecretEditorTarget: Identifiable {
    case add
    case edit(SecretSummary)

    var id: String {
        switch self {
        case .add: return "__add__"
        case .edit(let secret): return secret.key
        }
    }

    var existing: SecretSummary? {
        if case .edit(let secret) = self { return secret }
        return nil
    }
}

private struct SecretEditorSheet: View {
    @ObservedObject var store: SecretsStore
    let target: SecretEditorTarget
    @Environment(\.dismiss) private var dismiss

    @State private var key: String = ""
    @State private var value: String = ""
    @State private var backend: String = ""
    @State private var isSaving = false
    @State private var saveError: String?

    private var isEditing: Bool { target.existing != nil }

    var body: some View {
        VStack(alignment: .leading, spacing: Fleet.Space.l) {
            VStack(alignment: .leading, spacing: 4) {
                Text(isEditing ? "Edit secret value" : "Add a secret")
                    .font(.title3.weight(.semibold))
                Text(isEditing
                     ? "Set a new value for \(target.existing?.key ?? ""). The value is sent once and never echoed back."
                     : "The daemon stores this and hands it to fleet agents on demand. It is never returned in the secrets list.")
                    .font(.callout)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }

            VStack(alignment: .leading, spacing: Fleet.Space.s) {
                FieldLabel("Key")
                TextField("OPENAI_API_KEY", text: $key)
                    .textFieldStyle(.roundedBorder)
                    .font(.body)
                    .disabled(isEditing)
                    .accessibilityLabel("Secret key")
                    .autocorrectionDisabled(true)
            }

            VStack(alignment: .leading, spacing: Fleet.Space.s) {
                FieldLabel("Value")
                // SecureField masks input as the operator types.
                SecureField("Paste the secret value", text: $value)
                    .textFieldStyle(.roundedBorder)
                    .font(.body)
                    .accessibilityLabel("Secret value")
                Text("Hidden as you type. Not logged or echoed.")
                    .font(.caption)
                    .foregroundStyle(.tertiary)
            }

            VStack(alignment: .leading, spacing: Fleet.Space.s) {
                FieldLabel("Backend (optional)")
                TextField("e.g. openai, anthropic", text: $backend)
                    .textFieldStyle(.roundedBorder)
                    .font(.body)
                    .accessibilityLabel("Backend, optional")
                    .autocorrectionDisabled(true)
            }

            if let saveError {
                Label(saveError, systemImage: "exclamationmark.triangle.fill")
                    .font(.caption)
                    .foregroundStyle(Fleet.Color.failure)
            }

            HStack(spacing: Fleet.Space.m) {
                Spacer()
                Button("Cancel") { dismiss() }
                    .buttonStyle(.bordered)
                    .accessibilityLabel("Cancel")
                Button {
                    Task { await save() }
                } label: {
                    if isSaving {
                        ProgressView().controlSize(.small)
                    } else {
                        Text(isEditing ? "Update" : "Save")
                            .font(.body.weight(.semibold))
                    }
                }
                .buttonStyle(.borderedProminent)
                .disabled(!canSave)
                .accessibilityLabel(isEditing ? "Update secret" : "Save secret")
            }
        }
        .padding(Fleet.Space.xxl)
        .frame(minWidth: 460)
        .background(Fleet.Chrome.popoverBackground)
        .onAppear {
            if let existing = target.existing {
                key = existing.key
                backend = existing.backend ?? ""
            }
        }
    }

    private var canSave: Bool {
        !isSaving
            && !value.isEmpty
            && !key.trimmingCharacters(in: .whitespaces).isEmpty
    }

    private func save() async {
        isSaving = true
        saveError = nil
        let ok = await store.setSecret(
            key: key.trimmingCharacters(in: .whitespaces),
            value: value,
            backend: backend.trimmingCharacters(in: .whitespaces)
        )
        // Drop the value from local state immediately after the call.
        value = ""
        isSaving = false
        if ok {
            dismiss()
        } else {
            saveError = store.lastError ?? "Could not save secret"
        }
    }
}

private struct FieldLabel: View {
    let text: String
    init(_ text: String) { self.text = text }

    var body: some View {
        Text(text.uppercased())
            .font(.system(size: 11, weight: .semibold))
            .tracking(0.5)
            .foregroundStyle(.secondary)
            .accessibilityHidden(true)
    }
}

// MARK: - Convenience accessor

extension SecretsStore {
    func revealedValue(_ key: String) -> String? {
        revealedValues[key]
    }
}

// MARK: - Preview

#Preview("Secrets") {
    let store = SecretsStore(autoStart: false)
    store.secrets = [
        SecretSummary(key: "OPENAI_API_KEY", backend: "openai", storage: .keychain, encryptedAtRest: true, set: true),
        SecretSummary(key: "ANTHROPIC_API_KEY", backend: "anthropic", storage: .keychain, encryptedAtRest: true, set: true),
        SecretSummary(key: "LEGACY_TOKEN", backend: nil, storage: .plaintext, encryptedAtRest: false, set: true),
        SecretSummary(key: "GEMINI_API_KEY", backend: "gemini", storage: .keychain, encryptedAtRest: true, set: false),
    ]
    return SecretsView(store: store)
        .frame(width: 440, height: 600)
}
