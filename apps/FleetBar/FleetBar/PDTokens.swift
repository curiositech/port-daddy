// Port Daddy Design Tokens — generated 2026-05-15 by design/build.mjs.
// DO NOT EDIT. Edit design/tokens/*.json and re-run `node design/build.mjs`.
// Version: 0.1.0

import SwiftUI

public enum PDTheme: String {
    case dark, light
    public static var current: PDTheme {
        // Honor an explicit override; otherwise follow appearance.
        if let v = ProcessInfo.processInfo.environment["PD_THEME"],
           let theme = PDTheme(rawValue: v) { return theme }
        return .dark
    }
}
public extension Color {
    static func pd(_ id: PDSemantic, theme: PDTheme = .current) -> Color {
        switch theme {
        case .dark:  return PDDark.color(for: id)
        case .light: return PDLight.color(for: id)
        }
    }
}

public enum PDSemantic: String, CaseIterable {
    case bg_page = "bg-page"
    case bg_surface = "bg-surface"
    case bg_elevated = "bg-elevated"
    case bg_inverse = "bg-inverse"
    case bg_brand = "bg-brand"
    case bg_brand_soft = "bg-brand-soft"
    case bg_danger = "bg-danger"
    case bg_success = "bg-success"
    case bg_warning = "bg-warning"
    case text_heading = "text-heading"
    case text_body = "text-body"
    case text_body_subtle = "text-body-subtle"
    case text_on_brand = "text-on-brand"
    case text_on_danger = "text-on-danger"
    case text_on_inverse = "text-on-inverse"
    case text_inverse_subtle = "text-inverse-subtle"
    case text_link = "text-link"
    case border_default = "border-default"
    case border_muted = "border-muted"
    case border_emphasis = "border-emphasis"
    case shadow_color = "shadow-color"
    case state_claim_active_bg = "state-claim-active-bg"
    case state_claim_active_fg = "state-claim-active-fg"
    case state_claim_active_border = "state-claim-active-border"
    case state_awaiting_human_bg = "state-awaiting-human-bg"
    case state_awaiting_human_fg = "state-awaiting-human-fg"
    case state_awaiting_human_border = "state-awaiting-human-border"
    case state_burning_cash_bg = "state-burning-cash-bg"
    case state_burning_cash_fg = "state-burning-cash-fg"
    case state_burning_cash_border = "state-burning-cash-border"
    case state_conflict_bg = "state-conflict-bg"
    case state_conflict_fg = "state-conflict-fg"
    case state_conflict_border = "state-conflict-border"
    case state_blocked_bg = "state-blocked-bg"
    case state_blocked_fg = "state-blocked-fg"
    case state_blocked_border = "state-blocked-border"
    case state_claim_stale_bg = "state-claim-stale-bg"
    case state_claim_stale_fg = "state-claim-stale-fg"
    case state_claim_stale_border = "state-claim-stale-border"
    case state_idle_bg = "state-idle-bg"
    case state_idle_fg = "state-idle-fg"
    case state_idle_border = "state-idle-border"
    case severity_securite_bg = "severity-securite-bg"
    case severity_securite_fg = "severity-securite-fg"
    case severity_pan_pan_bg = "severity-pan-pan-bg"
    case severity_pan_pan_fg = "severity-pan-pan-fg"
    case severity_mayday_bg = "severity-mayday-bg"
    case severity_mayday_fg = "severity-mayday-fg"
    case perf_request_bg = "perf-request-bg"
    case perf_inform_bg = "perf-inform-bg"
    case perf_agree_bg = "perf-agree-bg"
    case perf_refuse_bg = "perf-refuse-bg"
    case perf_failure_bg = "perf-failure-bg"
    case perf_cfp_bg = "perf-cfp-bg"
    case perf_propose_bg = "perf-propose-bg"
    case perf_accept_proposal_bg = "perf-accept-proposal-bg"
    case perf_subscribe_bg = "perf-subscribe-bg"
    case perf_query_ref_bg = "perf-query-ref-bg"
    case term_prompt = "term-prompt"
    case term_cmd = "term-cmd"
    case term_ok = "term-ok"
    case term_warn = "term-warn"
    case term_err = "term-err"
    case term_dim = "term-dim"
    case term_info = "term-info"
    case term_bg = "term-bg"
    case term_fg = "term-fg"
    case ics_flag_red = "ics-flag-red"
    case ics_flag_blue = "ics-flag-blue"
    case ics_flag_yellow = "ics-flag-yellow"
    case ics_flag_white = "ics-flag-white"
    case ics_flag_black = "ics-flag-black"
}

enum PDDark {
    static func color(for id: PDSemantic) -> Color {
        switch id {
        case .bg_page: return Color(red: 0.118, green: 0.106, blue: 0.094)
        case .bg_surface: return Color(red: 0.169, green: 0.153, blue: 0.141)
        case .bg_elevated: return Color(red: 0.063, green: 0.055, blue: 0.047)
        case .bg_inverse: return Color(red: 0.961, green: 0.961, blue: 0.941)
        case .bg_brand: return Color(red: 1.000, green: 0.859, blue: 0.200)
        case .bg_brand_soft: return Color(red: 0.992, green: 0.902, blue: 0.541)
        case .bg_danger: return Color(red: 0.800, green: 0.239, blue: 0.180)
        case .bg_success: return Color(red: 0.082, green: 0.502, blue: 0.239)
        case .bg_warning: return Color(red: 0.961, green: 0.620, blue: 0.043)
        case .text_heading: return Color(red: 0.961, green: 0.961, blue: 0.941)
        case .text_body: return Color(red: 0.961, green: 0.961, blue: 0.941)
        case .text_body_subtle: return Color(red: 0.820, green: 0.820, blue: 0.780)
        case .text_on_brand: return Color(red: 0.118, green: 0.106, blue: 0.094)
        case .text_on_danger: return Color(red: 1.000, green: 1.000, blue: 1.000)
        case .text_on_inverse: return Color(red: 0.118, green: 0.106, blue: 0.094)
        case .text_inverse_subtle: return Color(red: 0.247, green: 0.239, blue: 0.220)
        case .text_link: return Color(red: 1.000, green: 0.859, blue: 0.200)
        case .border_default: return Color(red: 0.961, green: 0.961, blue: 0.941)
        case .border_muted: return Color(red: 0.314, green: 0.294, blue: 0.275)
        case .border_emphasis: return Color(red: 1.000, green: 0.859, blue: 0.200)
        case .shadow_color: return Color(red: 0.063, green: 0.055, blue: 0.047)
        case .state_claim_active_bg: return Color(red: 0.082, green: 0.502, blue: 0.239)
        case .state_claim_active_fg: return Color(red: 0.961, green: 0.961, blue: 0.941)
        case .state_claim_active_border: return Color(red: 0.427, green: 0.827, blue: 0.659)
        case .state_awaiting_human_bg: return Color(red: 0.961, green: 0.620, blue: 0.043)
        case .state_awaiting_human_fg: return Color(red: 0.118, green: 0.106, blue: 0.094)
        case .state_awaiting_human_border: return Color(red: 0.573, green: 0.251, blue: 0.055)
        case .state_burning_cash_bg: return Color(red: 0.545, green: 0.086, blue: 0.133)
        case .state_burning_cash_fg: return Color(red: 0.961, green: 0.961, blue: 0.941)
        case .state_burning_cash_border: return Color(red: 0.800, green: 0.239, blue: 0.180)
        case .state_conflict_bg: return Color(red: 0.800, green: 0.239, blue: 0.180)
        case .state_conflict_fg: return Color(red: 0.961, green: 0.961, blue: 0.941)
        case .state_conflict_border: return Color(red: 1.000, green: 0.565, blue: 0.506)
        case .state_blocked_bg: return Color(red: 0.169, green: 0.153, blue: 0.141)
        case .state_blocked_fg: return Color(red: 0.820, green: 0.820, blue: 0.780)
        case .state_blocked_border: return Color(red: 0.314, green: 0.294, blue: 0.275)
        case .state_claim_stale_bg: return Color(red: 0.169, green: 0.153, blue: 0.141)
        case .state_claim_stale_fg: return Color(red: 0.710, green: 0.710, blue: 0.659)
        case .state_claim_stale_border: return Color(red: 0.314, green: 0.294, blue: 0.275)
        case .state_idle_bg: return Color(red: 0.063, green: 0.055, blue: 0.047)
        case .state_idle_fg: return Color(red: 0.710, green: 0.710, blue: 0.659)
        case .state_idle_border: return Color(red: 0.314, green: 0.294, blue: 0.275)
        case .severity_securite_bg: return Color(red: 0.545, green: 0.353, blue: 0.102)
        case .severity_securite_fg: return Color(red: 0.992, green: 0.902, blue: 0.541)
        case .severity_pan_pan_bg: return Color(red: 0.800, green: 0.239, blue: 0.180)
        case .severity_pan_pan_fg: return Color(red: 1.000, green: 1.000, blue: 1.000)
        case .severity_mayday_bg: return Color(red: 0.545, green: 0.086, blue: 0.133)
        case .severity_mayday_fg: return Color(red: 1.000, green: 1.000, blue: 1.000)
        case .perf_request_bg: return Color(red: 0.012, green: 0.412, blue: 0.631)
        case .perf_inform_bg: return Color(red: 0.863, green: 0.988, blue: 0.906)
        case .perf_agree_bg: return Color(red: 0.082, green: 0.502, blue: 0.239)
        case .perf_refuse_bg: return Color(red: 0.545, green: 0.086, blue: 0.133)
        case .perf_failure_bg: return Color(red: 0.545, green: 0.086, blue: 0.133)
        case .perf_cfp_bg: return Color(red: 1.000, green: 0.859, blue: 0.200)
        case .perf_propose_bg: return Color(red: 0.427, green: 0.157, blue: 0.851)
        case .perf_accept_proposal_bg: return Color(red: 0.263, green: 0.220, blue: 0.792)
        case .perf_subscribe_bg: return Color(red: 0.059, green: 0.463, blue: 0.431)
        case .perf_query_ref_bg: return Color(red: 0.498, green: 0.769, blue: 1.000)
        case .term_prompt: return Color(red: 1.000, green: 0.859, blue: 0.200)
        case .term_cmd: return Color(red: 0.961, green: 0.961, blue: 0.941)
        case .term_ok: return Color(red: 0.427, green: 0.827, blue: 0.659)
        case .term_warn: return Color(red: 0.961, green: 0.620, blue: 0.043)
        case .term_err: return Color(red: 1.000, green: 0.565, blue: 0.506)
        case .term_dim: return Color(red: 0.820, green: 0.820, blue: 0.780)
        case .term_info: return Color(red: 0.498, green: 0.769, blue: 1.000)
        case .term_bg: return Color(red: 0.118, green: 0.106, blue: 0.094)
        case .term_fg: return Color(red: 0.961, green: 0.961, blue: 0.941)
        case .ics_flag_red: return Color(red: 0.800, green: 0.239, blue: 0.180)
        case .ics_flag_blue: return Color(red: 0.118, green: 0.227, blue: 0.541)
        case .ics_flag_yellow: return Color(red: 0.929, green: 0.773, blue: 0.192)
        case .ics_flag_white: return Color(red: 0.980, green: 0.980, blue: 0.961)
        case .ics_flag_black: return Color(red: 0.118, green: 0.106, blue: 0.094)
        }
    }
}

enum PDLight {
    static func color(for id: PDSemantic) -> Color {
        switch id {
        case .bg_page: return Color(red: 0.961, green: 0.961, blue: 0.941)
        case .bg_surface: return Color(red: 1.000, green: 1.000, blue: 1.000)
        case .bg_elevated: return Color(red: 1.000, green: 0.976, blue: 0.878)
        case .bg_inverse: return Color(red: 0.118, green: 0.106, blue: 0.094)
        case .bg_brand: return Color(red: 1.000, green: 0.859, blue: 0.200)
        case .bg_brand_soft: return Color(red: 0.992, green: 0.902, blue: 0.541)
        case .bg_danger: return Color(red: 0.800, green: 0.239, blue: 0.180)
        case .bg_success: return Color(red: 0.863, green: 0.988, blue: 0.906)
        case .bg_warning: return Color(red: 0.996, green: 0.953, blue: 0.780)
        case .text_heading: return Color(red: 0.118, green: 0.106, blue: 0.094)
        case .text_body: return Color(red: 0.169, green: 0.165, blue: 0.149)
        case .text_body_subtle: return Color(red: 0.247, green: 0.239, blue: 0.220)
        case .text_on_brand: return Color(red: 0.118, green: 0.106, blue: 0.094)
        case .text_on_danger: return Color(red: 1.000, green: 1.000, blue: 1.000)
        case .text_on_inverse: return Color(red: 0.961, green: 0.961, blue: 0.941)
        case .text_inverse_subtle: return Color(red: 0.820, green: 0.820, blue: 0.780)
        case .text_link: return Color(red: 0.545, green: 0.086, blue: 0.133)
        case .border_default: return Color(red: 0.118, green: 0.106, blue: 0.094)
        case .border_muted: return Color(red: 0.831, green: 0.773, blue: 0.663)
        case .border_emphasis: return Color(red: 0.800, green: 0.239, blue: 0.180)
        case .shadow_color: return Color(red: 0.118, green: 0.106, blue: 0.094)
        case .state_claim_active_bg: return Color(red: 0.863, green: 0.988, blue: 0.906)
        case .state_claim_active_fg: return Color(red: 0.082, green: 0.502, blue: 0.239)
        case .state_claim_active_border: return Color(red: 0.082, green: 0.502, blue: 0.239)
        case .state_awaiting_human_bg: return Color(red: 0.996, green: 0.953, blue: 0.780)
        case .state_awaiting_human_fg: return Color(red: 0.573, green: 0.251, blue: 0.055)
        case .state_awaiting_human_border: return Color(red: 0.961, green: 0.620, blue: 0.043)
        case .state_burning_cash_bg: return Color(red: 0.996, green: 0.792, blue: 0.792)
        case .state_burning_cash_fg: return Color(red: 0.800, green: 0.239, blue: 0.180)
        case .state_burning_cash_border: return Color(red: 0.800, green: 0.239, blue: 0.180)
        case .state_conflict_bg: return Color(red: 0.996, green: 0.792, blue: 0.792)
        case .state_conflict_fg: return Color(red: 0.545, green: 0.086, blue: 0.133)
        case .state_conflict_border: return Color(red: 0.800, green: 0.239, blue: 0.180)
        case .state_blocked_bg: return Color(red: 1.000, green: 0.976, blue: 0.878)
        case .state_blocked_fg: return Color(red: 0.247, green: 0.239, blue: 0.220)
        case .state_blocked_border: return Color(red: 0.831, green: 0.773, blue: 0.663)
        case .state_claim_stale_bg: return Color(red: 1.000, green: 0.976, blue: 0.878)
        case .state_claim_stale_fg: return Color(red: 0.247, green: 0.239, blue: 0.220)
        case .state_claim_stale_border: return Color(red: 0.831, green: 0.773, blue: 0.663)
        case .state_idle_bg: return Color(red: 1.000, green: 1.000, blue: 1.000)
        case .state_idle_fg: return Color(red: 0.247, green: 0.239, blue: 0.220)
        case .state_idle_border: return Color(red: 0.820, green: 0.820, blue: 0.780)
        case .severity_securite_bg: return Color(red: 0.545, green: 0.353, blue: 0.102)
        case .severity_securite_fg: return Color(red: 0.992, green: 0.902, blue: 0.541)
        case .severity_pan_pan_bg: return Color(red: 0.800, green: 0.239, blue: 0.180)
        case .severity_pan_pan_fg: return Color(red: 1.000, green: 1.000, blue: 1.000)
        case .severity_mayday_bg: return Color(red: 0.545, green: 0.086, blue: 0.133)
        case .severity_mayday_fg: return Color(red: 1.000, green: 1.000, blue: 1.000)
        case .perf_request_bg: return Color(red: 0.012, green: 0.412, blue: 0.631)
        case .perf_inform_bg: return Color(red: 0.863, green: 0.988, blue: 0.906)
        case .perf_agree_bg: return Color(red: 0.082, green: 0.502, blue: 0.239)
        case .perf_refuse_bg: return Color(red: 0.545, green: 0.086, blue: 0.133)
        case .perf_failure_bg: return Color(red: 0.545, green: 0.086, blue: 0.133)
        case .perf_cfp_bg: return Color(red: 1.000, green: 0.859, blue: 0.200)
        case .perf_propose_bg: return Color(red: 0.427, green: 0.157, blue: 0.851)
        case .perf_accept_proposal_bg: return Color(red: 0.263, green: 0.220, blue: 0.792)
        case .perf_subscribe_bg: return Color(red: 0.059, green: 0.463, blue: 0.431)
        case .perf_query_ref_bg: return Color(red: 0.498, green: 0.769, blue: 1.000)
        case .term_prompt: return Color(red: 0.800, green: 0.239, blue: 0.180)
        case .term_cmd: return Color(red: 0.118, green: 0.106, blue: 0.094)
        case .term_ok: return Color(red: 0.082, green: 0.502, blue: 0.239)
        case .term_warn: return Color(red: 0.573, green: 0.251, blue: 0.055)
        case .term_err: return Color(red: 0.545, green: 0.086, blue: 0.133)
        case .term_dim: return Color(red: 0.247, green: 0.239, blue: 0.220)
        case .term_info: return Color(red: 0.012, green: 0.412, blue: 0.631)
        case .term_bg: return Color(red: 0.961, green: 0.961, blue: 0.941)
        case .term_fg: return Color(red: 0.118, green: 0.106, blue: 0.094)
        case .ics_flag_red: return Color(red: 0.800, green: 0.239, blue: 0.180)
        case .ics_flag_blue: return Color(red: 0.118, green: 0.227, blue: 0.541)
        case .ics_flag_yellow: return Color(red: 0.929, green: 0.773, blue: 0.192)
        case .ics_flag_white: return Color(red: 0.980, green: 0.980, blue: 0.961)
        case .ics_flag_black: return Color(red: 0.118, green: 0.106, blue: 0.094)
        }
    }
}
