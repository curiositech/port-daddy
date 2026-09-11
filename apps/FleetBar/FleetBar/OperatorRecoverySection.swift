import SwiftUI

struct OperatorRecoverySection: View {
    @ObservedObject var store: OperatorRecoveryStore

    var body: some View {
        if !store.visibleRecoveries.isEmpty || store.lastError != nil {
            VStack(alignment: .leading, spacing: Fleet.Space.s) {
                sectionHeader

                if let error = store.lastError {
                    Label(error, systemImage: "lock.trianglebadge.exclamationmark")
                        .font(.callout)
                        .foregroundStyle(Fleet.Color.failure)
                        .fixedSize(horizontal: false, vertical: true)
                        .accessibilityLabel("Operator recovery locked. \(error)")
                }

                if case let .unavailable(_, reason) = store.signerAvailability,
                   store.visibleRecoveries.contains(where: { $0.status == .pending || $0.status == .approved }) {
                    Label(reason, systemImage: "touchid")
                        .font(.callout)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                        .accessibilityLabel("Touch ID signing unavailable. \(reason)")
                }

                ForEach(store.visibleRecoveries) { recovery in
                    recoveryCard(recovery)
                }
            }
            .padding(.horizontal, Fleet.Space.m)
            .padding(.vertical, Fleet.Space.s)
            .background(Fleet.Color.warning.opacity(0.055))
            .accessibilityElement(children: .contain)
            Divider().opacity(0.5)
        }
    }

    private var sectionHeader: some View {
        HStack(spacing: Fleet.Space.xs) {
            Image(systemName: "person.badge.key.fill")
                .foregroundStyle(Fleet.Color.warning)
                .accessibilityHidden(true)
            Text("Operator recovery")
                .font(.callout.weight(.semibold))
            Spacer()
            Text("PROVENANCE BOUND")
                .font(.caption2.weight(.bold))
                .foregroundStyle(Fleet.Color.warning)
                .accessibilityLabel("Provenance bound")
        }
    }

    @ViewBuilder
    private func recoveryCard(_ recovery: OperatorRecoveryItem) -> some View {
        VStack(alignment: .leading, spacing: Fleet.Space.s) {
            ViewThatFits(in: .horizontal) {
                HStack(alignment: .firstTextBaseline, spacing: Fleet.Space.xs) {
                    recoveryHeading
                    Spacer(minLength: Fleet.Space.xs)
                    stateBadge(recovery.displayState)
                }
                VStack(alignment: .leading, spacing: Fleet.Space.xs) {
                    recoveryHeading
                    stateBadge(recovery.displayState)
                }
            }

            scopeDisclosure(recovery)
            claimsDisclosure(recovery.scope.claims)

            if let receipt = recovery.displayReceipt {
                receiptDisclosure(receipt)
            }

            decisionActions(recovery)
        }
        .padding(Fleet.Space.s)
        .background(
            Color.primary.opacity(0.035),
            in: RoundedRectangle(cornerRadius: Fleet.Radius.medium, style: .continuous)
        )
        .overlay {
            RoundedRectangle(cornerRadius: Fleet.Radius.medium, style: .continuous)
                .strokeBorder(stateColor(recovery.displayState).opacity(0.3), lineWidth: 1)
        }
        .accessibilityElement(children: .contain)
    }

    private var recoveryHeading: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text("Restore actor continuity")
                .font(.callout.weight(.semibold))
            Text("Review every signed boundary before authorizing a successor.")
                .font(.caption)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private func scopeDisclosure(_ recovery: OperatorRecoveryItem) -> some View {
        VStack(alignment: .leading, spacing: Fleet.Space.xs) {
            disclosureHeader("Signed recovery scope", systemImage: "signature")
            scopeField("Project", recovery.scope.project)
            scopeField("Harbor", recovery.scope.harbor)
            scopeField("Canonical worktree", recovery.scope.worktree, monospaced: true)
            scopeField("Branch", recovery.scope.branch, monospaced: true)
            scopeField("Predecessor", recovery.scope.predecessorSessionId, monospaced: true)
            scopeField("Intended agent", recovery.scope.intendedAgentId, monospaced: true)
            scopeField("Session intent", recovery.scope.sessionIntent)
            scopeField("Durable actor", recovery.scope.actorId, monospaced: true)
            scopeField("Action hash", recovery.scope.actionHash, monospaced: true)
            scopeField("Context slot", recovery.scope.contextSlot ?? "No slot bound", monospaced: true)
            scopeField(
                "Prior slot digest",
                recovery.scope.priorContextDigest ?? "None (signed empty slot)",
                monospaced: true
            )
            scopeField("Recovery nonce", recovery.scope.nonce, monospaced: true)
            scopeField("One-shot ID digest", recovery.scope.jtiDigest, monospaced: true)
            scopeField("Expires", expiryDescription(recovery.scope.expiresAt))
            scopeField("Recovered body expires", expiryDescription(recovery.scope.bodyExpiresAt))
            scopeField("Daemon generation", recovery.scope.daemonGeneration, monospaced: true)
            scopeField(
                "Operator device key",
                recovery.scope.deviceKeyId ?? "Pending native enrollment",
                monospaced: recovery.scope.deviceKeyId != nil
            )
            scopeField(
                "Enrollment receipt",
                recovery.scope.enrollmentEventId ?? "Pending native enrollment",
                monospaced: recovery.scope.enrollmentEventId != nil
            )
            scopeField(
                "Enrollment activation receipt",
                recovery.scope.enrollmentActivationEventId ?? "Pending native activation",
                monospaced: recovery.scope.enrollmentActivationEventId != nil
            )
            scopeField("Recovery ID", recovery.recoveryId, monospaced: true)
        }
        .padding(Fleet.Space.s)
        .background(Color.primary.opacity(0.025), in: RoundedRectangle(cornerRadius: Fleet.Radius.small))
        .accessibilityElement(children: .contain)
    }

    private func claimsDisclosure(_ claims: [OperatorRecoveryClaim]) -> some View {
        VStack(alignment: .leading, spacing: Fleet.Space.xs) {
            disclosureHeader("Exact claim map", systemImage: "scope")

            if claims.isEmpty {
                Text("No claims will move or be released.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            } else {
                ForEach(claims) { claim in
                    claimRow(claim)
                }
            }
        }
        .padding(Fleet.Space.s)
        .background(Color.primary.opacity(0.025), in: RoundedRectangle(cornerRadius: Fleet.Radius.small))
        .accessibilityElement(children: .contain)
    }

    private func claimRow(_ claim: OperatorRecoveryClaim) -> some View {
        VStack(alignment: .leading, spacing: Fleet.Space.xs) {
            Text(claim.disposition.rawValue.uppercased())
                .font(.caption2.weight(.bold))
                .foregroundStyle(claim.disposition == .transfer ? Fleet.Color.healthy : Fleet.Color.warning)
                .padding(.horizontal, 6)
                .padding(.vertical, 2)
                .background(
                    (claim.disposition == .transfer ? Fleet.Color.healthy : Fleet.Color.warning).opacity(0.1),
                    in: Capsule()
                )

            Text(claim.filePath)
                .font(.system(.caption, design: .monospaced))
                .foregroundStyle(.primary)
                .fixedSize(horizontal: false, vertical: true)
                .textSelection(.enabled)
            Text(claim.regionDescription ?? "Whole file")
                .font(.caption)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
            scopeField("Claim node", claim.nodeId, monospaced: true)
            scopeField("Claim row", String(claim.claimId), monospaced: true)
            scopeField("Repository", claim.repoId, monospaced: true)
            scopeField("World", "\(claim.worldKind) · \(claim.worldId)", monospaced: true)
            scopeField("Git object", claim.gitOid ?? "Working tree", monospaced: true)
            scopeField("Selector", claim.selectorKind, monospaced: true)
            scopeField("Owner session", claim.sessionId, monospaced: true)
            scopeField("Purpose", claim.purpose)
            scopeField("Agent", claim.agentId ?? "Unassigned", monospaced: claim.agentId != nil)
            scopeField("Phase and mode", "\(claim.phase) · \(claim.mode)", monospaced: true)
            scopeField("Intent", claim.intent ?? "No additional intent")
            scopeField("Claimed", timestampDescription(claim.claimedAt))
            scopeField("Released", claim.releasedAt.map(timestampDescription) ?? "Active")
            scopeField("Observed by", claim.observedBy ?? "Not recorded", monospaced: claim.observedBy != nil)
            scopeField("Confidence", String(format: "%.3f", claim.confidence), monospaced: true)
            scopeField(
                "Legacy claim row",
                claim.legacySessionFileId.map(String.init) ?? "None",
                monospaced: claim.legacySessionFileId != nil
            )
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.vertical, 3)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(claim.accessibilitySummary)
    }

    private func receiptDisclosure(_ receipt: OperatorRecoveryReceipt) -> some View {
        let color: Color = switch receipt.tone {
        case .success: Fleet.Color.healthy
        case .warning: Fleet.Color.warning
        case .failure: Fleet.Color.failure
        }
        return VStack(alignment: .leading, spacing: Fleet.Space.xs) {
            Label(receipt.title, systemImage: receiptIcon(receipt.tone))
                .font(.callout.weight(.semibold))
                .foregroundStyle(color)
            Text(receipt.detail)
                .font(.caption)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
            if let successor = receipt.successorSessionId {
                scopeField("Successor", successor, monospaced: true)
            }
            if let authorityEvent = receipt.ledgerReceipt.terminalAuthorityEventId {
                scopeField("Authority event", authorityEvent, monospaced: true)
            }
            if let latestEvent = receipt.ledgerReceipt.terminalEventId {
                scopeField("Latest ledger event", latestEvent, monospaced: true)
            }
            if !receipt.ledgerReceipt.ledgerSequences.isEmpty {
                scopeField(
                    "Ledger sequences",
                    receipt.ledgerReceipt.ledgerSequences.map(String.init).joined(separator: ", "),
                    monospaced: true
                )
            }
            if let binding = receipt.binding {
                scopeField("Bound predecessor", binding.predecessorSessionId ?? "Not returned", monospaced: true)
                scopeField("Bound successor", binding.successorSessionId, monospaced: true)
                scopeField("Bound actor", binding.actorId ?? "Not returned", monospaced: true)
                scopeField("Bound intended agent", binding.intendedAgentId ?? "Not returned", monospaced: true)
                scopeField(
                    "Transferred claims",
                    binding.transferredClaimNodeIds.isEmpty
                        ? "None"
                        : binding.transferredClaimNodeIds.joined(separator: ", "),
                    monospaced: true
                )
                scopeField(
                    "Released claims",
                    binding.releasedClaimNodeIds.isEmpty
                        ? "None"
                        : binding.releasedClaimNodeIds.joined(separator: ", "),
                    monospaced: true
                )
                if let boundAt = binding.boundAt {
                    scopeField("Bound", timestampDescription(boundAt))
                }
            }
            if let body = receipt.bodyCredential {
                scopeField("Recovered body ID", body.bodyId, monospaced: true)
                scopeField("Recovered body actor", body.actorId, monospaced: true)
                scopeField("Recovered body intended agent", body.intendedAgentId, monospaced: true)
                scopeField("Recovered body profile", body.scopeProfile, monospaced: true)
                scopeField("Recovered body harbor", body.scope.harbor, monospaced: true)
                scopeField("Recovered body session", body.scope.sessionId, monospaced: true)
                scopeField("Recovered body project", body.scope.project, monospaced: true)
                scopeField("Recovered body worktree", body.scope.canonicalWorktree, monospaced: true)
                scopeField("Recovered body branch", body.scope.branch, monospaced: true)
                scopeField("Recovered body issued", timestampDescription(body.issuedAt))
                scopeField("Recovered body expires", timestampDescription(body.expiresAt))
            }
            if let custody = receipt.custody {
                scopeField("Custody installed", custody.installed ? "Yes" : "No")
                scopeField("Custody context slot", custody.contextSlot, monospaced: true)
                scopeField("Custody worktree", custody.canonicalWorktree, monospaced: true)
                scopeField("Custody file mode", String(format: "%04o", custody.mode), monospaced: true)
            }
        }
        .padding(Fleet.Space.s)
        .background(color.opacity(0.07), in: RoundedRectangle(cornerRadius: Fleet.Radius.small))
        .accessibilityElement(children: .combine)
    }

    @ViewBuilder
    private func decisionActions(_ recovery: OperatorRecoveryItem) -> some View {
        if recovery.status == .pending {
            if recovery.signing == nil {
                Label(
                    "FleetBar is finishing the provenance-bound key activation. No decision can be signed until its append-only activation receipt is verified.",
                    systemImage: "key.horizontal.fill"
                )
                .font(.caption)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityLabel("Operator recovery decision locked while enrollment activation is verified")
            } else {
                ViewThatFits(in: .horizontal) {
                    HStack(spacing: Fleet.Space.xs) {
                        approveButton(recovery)
                        denyButton(recovery)
                    }
                    VStack(alignment: .leading, spacing: Fleet.Space.xs) {
                        approveButton(recovery)
                        denyButton(recovery)
                    }
                }
            }
        } else if recovery.status == .approved {
            decisionButton(
                recovery,
                decision: .revoke,
                title: "Revoke approved recovery",
                systemImage: "lock.rotation",
                tint: Fleet.Color.failure,
                prominent: false,
                hint: "Revokes the unconsumed one-shot grant for this exact recovery scope"
            )
        }
    }

    private func approveButton(_ recovery: OperatorRecoveryItem) -> some View {
        decisionButton(
            recovery,
            decision: .approve,
            title: "Approve with Touch ID",
            systemImage: "touchid",
            tint: Fleet.Color.healthy,
            prominent: true,
            hint: "Signs and settles only the daemon-provided bytes for this exact recovery scope"
        )
    }

    private func denyButton(_ recovery: OperatorRecoveryItem) -> some View {
        decisionButton(
            recovery,
            decision: .deny,
            title: "Deny",
            systemImage: "xmark",
            tint: Fleet.Color.failure,
            prominent: false,
            hint: "Signs a denial for this exact recovery scope"
        )
    }

    @ViewBuilder
    private func decisionButton(
        _ recovery: OperatorRecoveryItem,
        decision: OperatorRecoveryDecision,
        title: String,
        systemImage: String,
        tint: Color,
        prominent: Bool,
        hint: String
    ) -> some View {
        let button = Button {
            Task { await store.decide(recovery, decision: decision) }
        } label: {
            Label(title, systemImage: systemImage)
                .font(.callout.weight(.semibold))
                .frame(maxWidth: prominent ? .infinity : nil)
        }
        .tint(tint)
        .disabled(!store.canDecide(recovery, decision: decision) || store.decidingIds.contains(recovery.id))
        .accessibilityHint(hint)

        if prominent {
            button.buttonStyle(.borderedProminent)
        } else {
            button.buttonStyle(.bordered)
        }
    }

    private func disclosureHeader(_ title: String, systemImage: String) -> some View {
        Label(title, systemImage: systemImage)
            .font(.caption.weight(.semibold))
            .foregroundStyle(.secondary)
    }

    private func scopeField(_ label: String, _ value: String, monospaced: Bool = false) -> some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(label.uppercased())
                .font(.caption2.weight(.semibold))
                .foregroundStyle(.tertiary)
            Text(value)
                .font(monospaced ? .system(.caption, design: .monospaced) : .callout)
                .foregroundStyle(.primary)
                .fixedSize(horizontal: false, vertical: true)
                .textSelection(.enabled)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(label), \(value)")
    }

    private func stateBadge(_ state: OperatorRecoveryDisplayState) -> some View {
        Text(state.rawValue.replacingOccurrences(of: "-", with: " ").uppercased())
            .font(.caption2.weight(.bold))
            .foregroundStyle(stateColor(state))
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(stateColor(state).opacity(0.1), in: Capsule())
            .accessibilityLabel("Recovery state \(state.rawValue.replacingOccurrences(of: "-", with: " "))")
    }

    private func stateColor(_ state: OperatorRecoveryDisplayState) -> Color {
        switch state {
        case .approved, .consumed: return Fleet.Color.healthy
        case .pending, .custodyPending: return Fleet.Color.warning
        case .denied, .expired, .revoked, .driftRefused, .replayRefused: return Fleet.Color.failure
        }
    }

    private func expiryDescription(_ milliseconds: Int64) -> String {
        let date = Date(timeIntervalSince1970: TimeInterval(milliseconds) / 1_000)
        let exact = date.formatted(date: .abbreviated, time: .standard)
        guard date > Date() else { return "\(exact) (expired)" }
        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .full
        return "\(exact) (\(formatter.localizedString(for: date, relativeTo: Date())))"
    }

    private func timestampDescription(_ milliseconds: Int64) -> String {
        Date(timeIntervalSince1970: TimeInterval(milliseconds) / 1_000)
            .formatted(date: .abbreviated, time: .standard)
    }

    private func receiptIcon(_ tone: OperatorRecoveryReceiptTone) -> String {
        switch tone {
        case .success: return "checkmark.seal.fill"
        case .warning: return "clock.badge.exclamationmark.fill"
        case .failure: return "xmark.shield.fill"
        }
    }
}
