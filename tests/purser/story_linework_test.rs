use super::*;
use crate::story_linework::{motion_orientation_cue, motion_state_stripe};

#[test]
fn test_motion_orientation_cue() {
    let cue = motion_orientation_cue("test_surface");
    assert!(cue.contains("test_surface"), "Cue should include surface name");
    assert!(cue.contains("reduced-motion"), "Cue should indicate reduced motion");
}

#[test]
fn test_motion_state_stripe() {
    let stripe = motion_state_stripe("test_id", "test_surface", rgb(255, 255, 255), 4.0, 20.0, true);
    assert!(stripe.to_string().contains("test_id"), "Stripe should have correct ID");
    assert!(stripe.to_string().contains("reduced-motion"), "Stripe should indicate reduced motion");
}
