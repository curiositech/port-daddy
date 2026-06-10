//! ICS maritime flag rendering for GPUI.
//!
//! Each flag is a small colored rectangle with a centered letter.
//! Hover tooltip shows the full International Code of Signals meaning.
//! Colors are pre-computed from OKLCH (no runtime conversion needed in GPUI).

use gpui::prelude::*;
use gpui::*;

/// One ICS single-letter flag with its Port Daddy semantic mapping.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Flag {
    Alpha,    // A — diver down / spawning
    Bravo,    // B — dangerous cargo / burning-cash
    Charlie,  // C — affirmative / approved
    Delta,    // D — maneuvering difficulty / blocked
    Echo,     // E — altering course starboard / pivoting
    Foxtrot,  // F — disabled, communicate / awaiting-human (HITL trigger)
    Golf,     // G — requires pilot / needs-orchestrator
    Hotel,    // H — pilot on board / claim-active
    India,    // I — altering course port
    Juliett,  // J — on fire with dangerous cargo / mayday
    Kilo,     // K — wish to communicate / request
    Lima,     // L — stop vessel instantly / guard-block
    Mike,     // M — stopped, no way / idle
    November, // N — negative / error
    Oscar,    // O — man overboard / agent-crashed (reserved)
    Papa,     // P — Blue Peter / fleet-healthy
    Quebec,   // Q — healthy, request pratique / newcomer
    Romeo,    // R — way is off / completed
    Sierra,   // S — operating astern / rolling-back
    Tango,    // T — pair trawling / coordinated
    Uniform,  // U — running into danger / conflict-warning
    Victor,   // V — require assistance / needs-help
    Whiskey,  // W — require medical / severe-failure
    Xray,     // X — stop intentions / guard-intercept
    Yankee,   // Y — dragging anchor / claim-stale
    Zulu,     // Z — require tug / needs-reboot
}

impl Flag {
    pub fn letter(self) -> char {
        match self {
            Flag::Alpha => 'A', Flag::Bravo => 'B', Flag::Charlie => 'C',
            Flag::Delta => 'D', Flag::Echo => 'E', Flag::Foxtrot => 'F',
            Flag::Golf => 'G', Flag::Hotel => 'H', Flag::India => 'I',
            Flag::Juliett => 'J', Flag::Kilo => 'K', Flag::Lima => 'L',
            Flag::Mike => 'M', Flag::November => 'N', Flag::Oscar => 'O',
            Flag::Papa => 'P', Flag::Quebec => 'Q', Flag::Romeo => 'R',
            Flag::Sierra => 'S', Flag::Tango => 'T', Flag::Uniform => 'U',
            Flag::Victor => 'V', Flag::Whiskey => 'W', Flag::Xray => 'X',
            Flag::Yankee => 'Y', Flag::Zulu => 'Z',
        }
    }

    /// Full ICS single-sentence meaning — shown in hover tooltip.
    pub fn ics_meaning(self) -> &'static str {
        match self {
            Flag::Alpha   => "I have a diver down; keep well clear at slow speed",
            Flag::Bravo   => "I am taking in, discharging, or carrying dangerous cargo",
            Flag::Charlie => "Affirmative / Yes",
            Flag::Delta   => "Keep clear of me; I am maneuvering with difficulty",
            Flag::Echo    => "I am altering my course to starboard",
            Flag::Foxtrot => "I am disabled; communicate with me",
            Flag::Golf    => "I require a pilot",
            Flag::Hotel   => "I have a pilot on board",
            Flag::India   => "I am altering my course to port",
            Flag::Juliett => "I am on fire and have dangerous cargo on board; keep well clear",
            Flag::Kilo    => "I wish to communicate with you",
            Flag::Lima    => "You should stop your vessel instantly",
            Flag::Mike    => "My vessel is stopped and making no way through the water",
            Flag::November=> "Negative / No",
            Flag::Oscar   => "Man overboard",
            Flag::Papa    => "Blue Peter — all persons report on board; about to put to sea",
            Flag::Quebec  => "My vessel is healthy and I request free pratique",
            Flag::Romeo   => "The way is off my ship; you may feel your way past me",
            Flag::Sierra  => "I am operating astern propulsion",
            Flag::Tango   => "Keep clear of me; I am engaged in pair trawling",
            Flag::Uniform => "You are running into danger",
            Flag::Victor  => "I require assistance",
            Flag::Whiskey => "I require medical assistance",
            Flag::Xray    => "Stop carrying out your intentions and watch for my signals",
            Flag::Yankee  => "I am dragging my anchor",
            Flag::Zulu    => "I require a tug",
        }
    }

    /// PD console meaning shown in tooltip below the ICS meaning.
    pub fn pd_meaning(self) -> &'static str {
        match self {
            Flag::Alpha   => "Agent spawning — keep clear",
            Flag::Bravo   => "Agent burning budget at elevated rate",
            Flag::Charlie => "Approved / confirmed",
            Flag::Delta   => "Agent blocked / waiting on dependency",
            Flag::Echo    => "Agent pivoting mid-task",
            Flag::Foxtrot => "HITL gate active — agent needs operator input",
            Flag::Golf    => "Agent requesting orchestrator guidance",
            Flag::Hotel   => "Agent has active file claims — engaged",
            Flag::India   => "Agent re-routing",
            Flag::Juliett => "Agent in crisis — runaway / on fire",
            Flag::Kilo    => "Agent has a message for you",
            Flag::Lima    => "Coordination Guard blocked this commit",
            Flag::Mike    => "Agent idle / no progress",
            Flag::November=> "Error / refused / negative",
            Flag::Oscar   => "Agent crashed — man overboard",
            Flag::Papa    => "Fleet healthy — ready to sail",
            Flag::Quebec  => "New agent — no completed sortie history yet",
            Flag::Romeo   => "Agent completed — way is off",
            Flag::Sierra  => "Agent rolling back",
            Flag::Tango   => "Coordinated multi-agent operation",
            Flag::Uniform => "Conflict warning — running into danger",
            Flag::Victor  => "Agent needs operator assistance",
            Flag::Whiskey => "Agent health degraded",
            Flag::Xray    => "Guard override pending",
            Flag::Yankee  => "Agent has stale claims — dragging anchor",
            Flag::Zulu    => "Agent needs a larger operation to assist",
        }
    }

    /// Background color (sRGB u32, no alpha — opaque).
    pub fn bg_rgb(self) -> u32 {
        match self {
            // Green — affirmative / active / healthy
            Flag::Charlie | Flag::Hotel | Flag::Papa | Flag::Quebec => 0x2d6a4f,
            // Amber — request / idle / warning
            Flag::Kilo | Flag::Mike | Flag::Uniform | Flag::Yankee => 0x92400e,
            // Red — blocked / disabled / negative / emergency
            Flag::Delta | Flag::Foxtrot | Flag::November | Flag::Oscar
            | Flag::Victor | Flag::Whiskey | Flag::Xray | Flag::Juliett => 0x7f1d1d,
            // Blue — course changes / inform / astern
            Flag::Echo | Flag::India | Flag::Romeo | Flag::Sierra => 0x1e3a5f,
            // Magenta — needs pilot / on fire (Juliett handled above)
            Flag::Golf => 0x4a1942,
            // Gray — everything else
            _ => 0x374151,
        }
    }
}

/// Map a canonical agent state string to the ICS flag.
pub fn flag_for_state(state: &str) -> Flag {
    match state {
        "spawning" | "starting"              => Flag::Alpha,
        "burning-cash" | "over-budget"       => Flag::Bravo,
        "approved" | "affirmative"           => Flag::Charlie,
        "blocked" | "waiting"                => Flag::Delta,
        "pivoting"                           => Flag::Echo,
        "awaiting-human" | "hitl" | "gated"  => Flag::Foxtrot,
        "needs-orchestrator"                 => Flag::Golf,
        "claim-active" | "engaged"           => Flag::Hotel,
        "mayday" | "crisis" | "runaway"      => Flag::Juliett,
        "messaging" | "request"              => Flag::Kilo,
        "guard-blocked" | "commit-blocked"   => Flag::Lima,
        "idle" | "resting"                   => Flag::Mike,
        "error" | "failed" | "refused"       => Flag::November,
        "crashed" | "dead"                   => Flag::Oscar,
        "healthy" | "fleet-healthy"          => Flag::Papa,
        "new" | "newcomer"                   => Flag::Quebec,
        "completed" | "landed" | "done"      => Flag::Romeo,
        "rolling-back"                       => Flag::Sierra,
        "coordinated" | "pair"               => Flag::Tango,
        "conflict-warning"                   => Flag::Uniform,
        "needs-help"                         => Flag::Victor,
        "degraded"                           => Flag::Whiskey,
        "guard-intercept"                    => Flag::Xray,
        "claim-stale" | "stale"              => Flag::Yankee,
        _                                    => Flag::Mike,
    }
}

/// Rendered ICS flag badge — 32×20px colored block with letter, tooltip on hover.
#[derive(IntoElement)]
pub struct FlagBadge {
    flag: Flag,
}

impl FlagBadge {
    pub fn new(flag: Flag) -> Self {
        Self { flag }
    }

    pub fn for_state(state: &str) -> Self {
        Self::new(flag_for_state(state))
    }
}

impl RenderOnce for FlagBadge {
    fn render(self, _window: &mut Window, _cx: &mut App) -> impl IntoElement {
        let flag = self.flag;
        let bg = rgb(flag.bg_rgb());
        let letter = flag.letter().to_string();
        div()
            .w(px(32.0))
            .h(px(20.0))
            .rounded(px(3.0))
            .bg(bg)
            .flex()
            .items_center()
            .justify_center()
            .cursor_default()
            .child(
                div()
                    .text_color(rgb(0xf9fafb))
                    .text_size(px(12.0))
                    .font_weight(FontWeight::BOLD)
                    .child(letter)
            )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn all_states_map_to_flags() {
        let states = [
            "spawning", "blocked", "awaiting-human", "claim-active",
            "idle", "error", "crashed", "completed", "claim-stale", "mayday",
        ];
        for state in &states {
            let f = flag_for_state(state);
            assert_ne!(f.letter(), '\0');
            assert!(!f.ics_meaning().is_empty());
            assert!(!f.pd_meaning().is_empty());
        }
    }

    #[test]
    fn hitl_flag_is_foxtrot() {
        assert_eq!(flag_for_state("awaiting-human"), Flag::Foxtrot);
        assert_eq!(flag_for_state("hitl"), Flag::Foxtrot);
        assert_eq!(Flag::Foxtrot.letter(), 'F');
        assert!(Flag::Foxtrot.ics_meaning().contains("disabled"));
    }

    #[test]
    fn mayday_is_juliett() {
        assert_eq!(flag_for_state("mayday"), Flag::Juliett);
        assert!(Flag::Juliett.ics_meaning().contains("on fire"));
    }
}
