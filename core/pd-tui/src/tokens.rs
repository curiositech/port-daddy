// Port Daddy Design Tokens — generated 2026-05-15 by design/build.mjs.
// DO NOT EDIT. Edit design/tokens/*.json and re-run `node design/build.mjs`.
// Version: 0.1.0
//
// Usage in ratatui:
//   use ratatui::style::Color;
//   use port_daddy_tokens::{dark, light, Theme};
//   let theme: &dyn Theme = if std::env::var("PD_THEME").as_deref() == Ok("light")
//       { &light::THEME } else { &dark::THEME };
//   let bg = theme.bg_page();

#![allow(dead_code)]

use ratatui::style::Color;

pub trait Theme: Sync {
    fn bg_page(&self) -> Color;
    fn bg_surface(&self) -> Color;
    fn bg_elevated(&self) -> Color;
    fn bg_inverse(&self) -> Color;
    fn bg_brand(&self) -> Color;
    fn bg_brand_soft(&self) -> Color;
    fn bg_danger(&self) -> Color;
    fn bg_success(&self) -> Color;
    fn bg_warning(&self) -> Color;
    fn text_heading(&self) -> Color;
    fn text_body(&self) -> Color;
    fn text_body_subtle(&self) -> Color;
    fn text_on_brand(&self) -> Color;
    fn text_on_danger(&self) -> Color;
    fn text_on_inverse(&self) -> Color;
    fn text_inverse_subtle(&self) -> Color;
    fn text_link(&self) -> Color;
    fn border_default(&self) -> Color;
    fn border_muted(&self) -> Color;
    fn border_emphasis(&self) -> Color;
    fn shadow_color(&self) -> Color;
    fn state_claim_active_bg(&self) -> Color;
    fn state_claim_active_fg(&self) -> Color;
    fn state_claim_active_border(&self) -> Color;
    fn state_awaiting_human_bg(&self) -> Color;
    fn state_awaiting_human_fg(&self) -> Color;
    fn state_awaiting_human_border(&self) -> Color;
    fn state_burning_cash_bg(&self) -> Color;
    fn state_burning_cash_fg(&self) -> Color;
    fn state_burning_cash_border(&self) -> Color;
    fn state_conflict_bg(&self) -> Color;
    fn state_conflict_fg(&self) -> Color;
    fn state_conflict_border(&self) -> Color;
    fn state_blocked_bg(&self) -> Color;
    fn state_blocked_fg(&self) -> Color;
    fn state_blocked_border(&self) -> Color;
    fn state_claim_stale_bg(&self) -> Color;
    fn state_claim_stale_fg(&self) -> Color;
    fn state_claim_stale_border(&self) -> Color;
    fn state_idle_bg(&self) -> Color;
    fn state_idle_fg(&self) -> Color;
    fn state_idle_border(&self) -> Color;
    fn severity_securite_bg(&self) -> Color;
    fn severity_securite_fg(&self) -> Color;
    fn severity_pan_pan_bg(&self) -> Color;
    fn severity_pan_pan_fg(&self) -> Color;
    fn severity_mayday_bg(&self) -> Color;
    fn severity_mayday_fg(&self) -> Color;
    fn perf_request_bg(&self) -> Color;
    fn perf_inform_bg(&self) -> Color;
    fn perf_agree_bg(&self) -> Color;
    fn perf_refuse_bg(&self) -> Color;
    fn perf_failure_bg(&self) -> Color;
    fn perf_cfp_bg(&self) -> Color;
    fn perf_propose_bg(&self) -> Color;
    fn perf_accept_proposal_bg(&self) -> Color;
    fn perf_subscribe_bg(&self) -> Color;
    fn perf_query_ref_bg(&self) -> Color;
    fn term_prompt(&self) -> Color;
    fn term_cmd(&self) -> Color;
    fn term_ok(&self) -> Color;
    fn term_warn(&self) -> Color;
    fn term_err(&self) -> Color;
    fn term_dim(&self) -> Color;
    fn term_info(&self) -> Color;
    fn term_bg(&self) -> Color;
    fn term_fg(&self) -> Color;
    fn ics_flag_red(&self) -> Color;
    fn ics_flag_blue(&self) -> Color;
    fn ics_flag_yellow(&self) -> Color;
    fn ics_flag_white(&self) -> Color;
    fn ics_flag_black(&self) -> Color;
}

pub mod dark {
    use super::*;
    pub struct Tokens;
    pub const THEME: Tokens = Tokens;
    impl Theme for Tokens {
        fn bg_page(&self) -> Color { Color::Rgb(30, 27, 24) }
        fn bg_surface(&self) -> Color { Color::Rgb(43, 39, 36) }
        fn bg_elevated(&self) -> Color { Color::Rgb(16, 14, 12) }
        fn bg_inverse(&self) -> Color { Color::Rgb(245, 245, 240) }
        fn bg_brand(&self) -> Color { Color::Rgb(255, 219, 51) }
        fn bg_brand_soft(&self) -> Color { Color::Rgb(253, 230, 138) }
        fn bg_danger(&self) -> Color { Color::Rgb(204, 61, 46) }
        fn bg_success(&self) -> Color { Color::Rgb(21, 128, 61) }
        fn bg_warning(&self) -> Color { Color::Rgb(245, 158, 11) }
        fn text_heading(&self) -> Color { Color::Rgb(245, 245, 240) }
        fn text_body(&self) -> Color { Color::Rgb(245, 245, 240) }
        fn text_body_subtle(&self) -> Color { Color::Rgb(209, 209, 199) }
        fn text_on_brand(&self) -> Color { Color::Rgb(30, 27, 24) }
        fn text_on_danger(&self) -> Color { Color::Rgb(255, 255, 255) }
        fn text_on_inverse(&self) -> Color { Color::Rgb(30, 27, 24) }
        fn text_inverse_subtle(&self) -> Color { Color::Rgb(63, 61, 56) }
        fn text_link(&self) -> Color { Color::Rgb(255, 219, 51) }
        fn border_default(&self) -> Color { Color::Rgb(245, 245, 240) }
        fn border_muted(&self) -> Color { Color::Rgb(80, 75, 70) }
        fn border_emphasis(&self) -> Color { Color::Rgb(255, 219, 51) }
        fn shadow_color(&self) -> Color { Color::Rgb(16, 14, 12) }
        fn state_claim_active_bg(&self) -> Color { Color::Rgb(21, 128, 61) }
        fn state_claim_active_fg(&self) -> Color { Color::Rgb(245, 245, 240) }
        fn state_claim_active_border(&self) -> Color { Color::Rgb(109, 211, 168) }
        fn state_awaiting_human_bg(&self) -> Color { Color::Rgb(245, 158, 11) }
        fn state_awaiting_human_fg(&self) -> Color { Color::Rgb(30, 27, 24) }
        fn state_awaiting_human_border(&self) -> Color { Color::Rgb(146, 64, 14) }
        fn state_burning_cash_bg(&self) -> Color { Color::Rgb(139, 22, 34) }
        fn state_burning_cash_fg(&self) -> Color { Color::Rgb(245, 245, 240) }
        fn state_burning_cash_border(&self) -> Color { Color::Rgb(204, 61, 46) }
        fn state_conflict_bg(&self) -> Color { Color::Rgb(204, 61, 46) }
        fn state_conflict_fg(&self) -> Color { Color::Rgb(245, 245, 240) }
        fn state_conflict_border(&self) -> Color { Color::Rgb(255, 144, 129) }
        fn state_blocked_bg(&self) -> Color { Color::Rgb(43, 39, 36) }
        fn state_blocked_fg(&self) -> Color { Color::Rgb(209, 209, 199) }
        fn state_blocked_border(&self) -> Color { Color::Rgb(80, 75, 70) }
        fn state_claim_stale_bg(&self) -> Color { Color::Rgb(43, 39, 36) }
        fn state_claim_stale_fg(&self) -> Color { Color::Rgb(181, 181, 168) }
        fn state_claim_stale_border(&self) -> Color { Color::Rgb(80, 75, 70) }
        fn state_idle_bg(&self) -> Color { Color::Rgb(16, 14, 12) }
        fn state_idle_fg(&self) -> Color { Color::Rgb(181, 181, 168) }
        fn state_idle_border(&self) -> Color { Color::Rgb(80, 75, 70) }
        fn severity_securite_bg(&self) -> Color { Color::Rgb(139, 90, 26) }
        fn severity_securite_fg(&self) -> Color { Color::Rgb(253, 230, 138) }
        fn severity_pan_pan_bg(&self) -> Color { Color::Rgb(204, 61, 46) }
        fn severity_pan_pan_fg(&self) -> Color { Color::Rgb(255, 255, 255) }
        fn severity_mayday_bg(&self) -> Color { Color::Rgb(139, 22, 34) }
        fn severity_mayday_fg(&self) -> Color { Color::Rgb(255, 255, 255) }
        fn perf_request_bg(&self) -> Color { Color::Rgb(3, 105, 161) }
        fn perf_inform_bg(&self) -> Color { Color::Rgb(220, 252, 231) }
        fn perf_agree_bg(&self) -> Color { Color::Rgb(21, 128, 61) }
        fn perf_refuse_bg(&self) -> Color { Color::Rgb(139, 22, 34) }
        fn perf_failure_bg(&self) -> Color { Color::Rgb(139, 22, 34) }
        fn perf_cfp_bg(&self) -> Color { Color::Rgb(255, 219, 51) }
        fn perf_propose_bg(&self) -> Color { Color::Rgb(109, 40, 217) }
        fn perf_accept_proposal_bg(&self) -> Color { Color::Rgb(67, 56, 202) }
        fn perf_subscribe_bg(&self) -> Color { Color::Rgb(15, 118, 110) }
        fn perf_query_ref_bg(&self) -> Color { Color::Rgb(127, 196, 255) }
        fn term_prompt(&self) -> Color { Color::Rgb(255, 219, 51) }
        fn term_cmd(&self) -> Color { Color::Rgb(245, 245, 240) }
        fn term_ok(&self) -> Color { Color::Rgb(109, 211, 168) }
        fn term_warn(&self) -> Color { Color::Rgb(245, 158, 11) }
        fn term_err(&self) -> Color { Color::Rgb(255, 144, 129) }
        fn term_dim(&self) -> Color { Color::Rgb(209, 209, 199) }
        fn term_info(&self) -> Color { Color::Rgb(127, 196, 255) }
        fn term_bg(&self) -> Color { Color::Rgb(30, 27, 24) }
        fn term_fg(&self) -> Color { Color::Rgb(245, 245, 240) }
        fn ics_flag_red(&self) -> Color { Color::Rgb(204, 61, 46) }
        fn ics_flag_blue(&self) -> Color { Color::Rgb(30, 58, 138) }
        fn ics_flag_yellow(&self) -> Color { Color::Rgb(237, 197, 49) }
        fn ics_flag_white(&self) -> Color { Color::Rgb(250, 250, 245) }
        fn ics_flag_black(&self) -> Color { Color::Rgb(30, 27, 24) }
    }
}

pub mod light {
    use super::*;
    pub struct Tokens;
    pub const THEME: Tokens = Tokens;
    impl Theme for Tokens {
        fn bg_page(&self) -> Color { Color::Rgb(245, 245, 240) }
        fn bg_surface(&self) -> Color { Color::Rgb(255, 255, 255) }
        fn bg_elevated(&self) -> Color { Color::Rgb(255, 249, 224) }
        fn bg_inverse(&self) -> Color { Color::Rgb(30, 27, 24) }
        fn bg_brand(&self) -> Color { Color::Rgb(255, 219, 51) }
        fn bg_brand_soft(&self) -> Color { Color::Rgb(253, 230, 138) }
        fn bg_danger(&self) -> Color { Color::Rgb(204, 61, 46) }
        fn bg_success(&self) -> Color { Color::Rgb(220, 252, 231) }
        fn bg_warning(&self) -> Color { Color::Rgb(254, 243, 199) }
        fn text_heading(&self) -> Color { Color::Rgb(30, 27, 24) }
        fn text_body(&self) -> Color { Color::Rgb(43, 42, 38) }
        fn text_body_subtle(&self) -> Color { Color::Rgb(63, 61, 56) }
        fn text_on_brand(&self) -> Color { Color::Rgb(30, 27, 24) }
        fn text_on_danger(&self) -> Color { Color::Rgb(255, 255, 255) }
        fn text_on_inverse(&self) -> Color { Color::Rgb(245, 245, 240) }
        fn text_inverse_subtle(&self) -> Color { Color::Rgb(209, 209, 199) }
        fn text_link(&self) -> Color { Color::Rgb(139, 22, 34) }
        fn border_default(&self) -> Color { Color::Rgb(30, 27, 24) }
        fn border_muted(&self) -> Color { Color::Rgb(212, 197, 169) }
        fn border_emphasis(&self) -> Color { Color::Rgb(204, 61, 46) }
        fn shadow_color(&self) -> Color { Color::Rgb(30, 27, 24) }
        fn state_claim_active_bg(&self) -> Color { Color::Rgb(220, 252, 231) }
        fn state_claim_active_fg(&self) -> Color { Color::Rgb(21, 128, 61) }
        fn state_claim_active_border(&self) -> Color { Color::Rgb(21, 128, 61) }
        fn state_awaiting_human_bg(&self) -> Color { Color::Rgb(254, 243, 199) }
        fn state_awaiting_human_fg(&self) -> Color { Color::Rgb(146, 64, 14) }
        fn state_awaiting_human_border(&self) -> Color { Color::Rgb(245, 158, 11) }
        fn state_burning_cash_bg(&self) -> Color { Color::Rgb(254, 202, 202) }
        fn state_burning_cash_fg(&self) -> Color { Color::Rgb(204, 61, 46) }
        fn state_burning_cash_border(&self) -> Color { Color::Rgb(204, 61, 46) }
        fn state_conflict_bg(&self) -> Color { Color::Rgb(254, 202, 202) }
        fn state_conflict_fg(&self) -> Color { Color::Rgb(139, 22, 34) }
        fn state_conflict_border(&self) -> Color { Color::Rgb(204, 61, 46) }
        fn state_blocked_bg(&self) -> Color { Color::Rgb(255, 249, 224) }
        fn state_blocked_fg(&self) -> Color { Color::Rgb(63, 61, 56) }
        fn state_blocked_border(&self) -> Color { Color::Rgb(212, 197, 169) }
        fn state_claim_stale_bg(&self) -> Color { Color::Rgb(255, 249, 224) }
        fn state_claim_stale_fg(&self) -> Color { Color::Rgb(63, 61, 56) }
        fn state_claim_stale_border(&self) -> Color { Color::Rgb(212, 197, 169) }
        fn state_idle_bg(&self) -> Color { Color::Rgb(255, 255, 255) }
        fn state_idle_fg(&self) -> Color { Color::Rgb(63, 61, 56) }
        fn state_idle_border(&self) -> Color { Color::Rgb(209, 209, 199) }
        fn severity_securite_bg(&self) -> Color { Color::Rgb(139, 90, 26) }
        fn severity_securite_fg(&self) -> Color { Color::Rgb(253, 230, 138) }
        fn severity_pan_pan_bg(&self) -> Color { Color::Rgb(204, 61, 46) }
        fn severity_pan_pan_fg(&self) -> Color { Color::Rgb(255, 255, 255) }
        fn severity_mayday_bg(&self) -> Color { Color::Rgb(139, 22, 34) }
        fn severity_mayday_fg(&self) -> Color { Color::Rgb(255, 255, 255) }
        fn perf_request_bg(&self) -> Color { Color::Rgb(3, 105, 161) }
        fn perf_inform_bg(&self) -> Color { Color::Rgb(220, 252, 231) }
        fn perf_agree_bg(&self) -> Color { Color::Rgb(21, 128, 61) }
        fn perf_refuse_bg(&self) -> Color { Color::Rgb(139, 22, 34) }
        fn perf_failure_bg(&self) -> Color { Color::Rgb(139, 22, 34) }
        fn perf_cfp_bg(&self) -> Color { Color::Rgb(255, 219, 51) }
        fn perf_propose_bg(&self) -> Color { Color::Rgb(109, 40, 217) }
        fn perf_accept_proposal_bg(&self) -> Color { Color::Rgb(67, 56, 202) }
        fn perf_subscribe_bg(&self) -> Color { Color::Rgb(15, 118, 110) }
        fn perf_query_ref_bg(&self) -> Color { Color::Rgb(127, 196, 255) }
        fn term_prompt(&self) -> Color { Color::Rgb(204, 61, 46) }
        fn term_cmd(&self) -> Color { Color::Rgb(30, 27, 24) }
        fn term_ok(&self) -> Color { Color::Rgb(21, 128, 61) }
        fn term_warn(&self) -> Color { Color::Rgb(146, 64, 14) }
        fn term_err(&self) -> Color { Color::Rgb(139, 22, 34) }
        fn term_dim(&self) -> Color { Color::Rgb(63, 61, 56) }
        fn term_info(&self) -> Color { Color::Rgb(3, 105, 161) }
        fn term_bg(&self) -> Color { Color::Rgb(245, 245, 240) }
        fn term_fg(&self) -> Color { Color::Rgb(30, 27, 24) }
        fn ics_flag_red(&self) -> Color { Color::Rgb(204, 61, 46) }
        fn ics_flag_blue(&self) -> Color { Color::Rgb(30, 58, 138) }
        fn ics_flag_yellow(&self) -> Color { Color::Rgb(237, 197, 49) }
        fn ics_flag_white(&self) -> Color { Color::Rgb(250, 250, 245) }
        fn ics_flag_black(&self) -> Color { Color::Rgb(30, 27, 24) }
    }
}

pub mod primitive {
    use super::*;
    pub const PAPER: Color = Color::Rgb(245, 245, 240);
    pub const PAPER_SOFT: Color = Color::Rgb(255, 255, 255);
    pub const PAPER_CREAM: Color = Color::Rgb(255, 249, 224);
    pub const SANDSTONE: Color = Color::Rgb(212, 197, 169);
    pub const FOG: Color = Color::Rgb(209, 209, 199);
    pub const FOG_DEEP: Color = Color::Rgb(181, 181, 168);
    pub const SLATE: Color = Color::Rgb(80, 75, 70);
    pub const SLATE_DEEP: Color = Color::Rgb(63, 61, 56);
    pub const SLATE_DARKER: Color = Color::Rgb(43, 42, 38);
    pub const EBONY: Color = Color::Rgb(30, 27, 24);
    pub const EBONY_DEEP: Color = Color::Rgb(16, 14, 12);
    pub const EBONY_SOFT: Color = Color::Rgb(43, 39, 36);
    pub const CINNABAR: Color = Color::Rgb(204, 61, 46);
    pub const CINNABAR_LIT: Color = Color::Rgb(255, 144, 129);
    pub const CINNABAR_DIM: Color = Color::Rgb(139, 22, 34);
    pub const TAN: Color = Color::Rgb(139, 90, 26);
    pub const CANARY: Color = Color::Rgb(255, 219, 51);
    pub const CANARY_SOFT: Color = Color::Rgb(250, 229, 131);
    pub const CANARY_WARM: Color = Color::Rgb(253, 230, 138);
    pub const CANARY_STRONG: Color = Color::Rgb(255, 204, 0);
    pub const MUSTARD: Color = Color::Rgb(237, 197, 49);
    pub const NAVY: Color = Color::Rgb(30, 58, 138);
    pub const NAVY_SOFT: Color = Color::Rgb(29, 78, 216);
    pub const KELP: Color = Color::Rgb(109, 211, 168);
    pub const KELP_DEEP: Color = Color::Rgb(21, 128, 61);
    pub const KELP_SOFT: Color = Color::Rgb(220, 252, 231);
    pub const SKY: Color = Color::Rgb(127, 196, 255);
    pub const SKY_DEEP: Color = Color::Rgb(3, 105, 161);
    pub const PURPLE: Color = Color::Rgb(109, 40, 217);
    pub const INDIGO: Color = Color::Rgb(67, 56, 202);
    pub const TEAL: Color = Color::Rgb(15, 118, 110);
    pub const WARNING: Color = Color::Rgb(245, 158, 11);
    pub const WARNING_DEEP: Color = Color::Rgb(146, 64, 14);
    pub const WARNING_SOFT: Color = Color::Rgb(254, 243, 199);
    pub const DANGER_SOFT: Color = Color::Rgb(254, 202, 202);
    pub const ICS_WHITE: Color = Color::Rgb(250, 250, 245);
    pub const ICS_BLACK: Color = Color::Rgb(30, 27, 24);
}
