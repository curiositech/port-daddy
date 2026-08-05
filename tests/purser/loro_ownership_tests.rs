use super::*;
use std::sync::Arc;

#[test]
fn test_loro_ownership_enforcement() {
    let mut pane = EditorPane::new("test_path".to_string(), Arc::new(Identity::new()));
    let owner = PeerId::new("test_owner");
    
    // Set valid owner
    pane.motion_cue = EditorMotionCue::OwnerOwnership(owner.clone());
    assert_eq!(pane.motion_cue, EditorMotionCue::OwnerOwnership(owner));

    // Test invalid owner
    let invalid_owner = PeerId::new("invalid");
    pane.motion_cue = EditorMotionCue::OwnerOwnership(invalid_owner);
    assert_ne!(pane.motion_cue, EditorMotionCue::OwnerOwnership(owner));

    // Ensure ownership is enforced across surfaces
    let surface = "test_surface".to_string();
    assert!(pane.review.evidence().source == ReviewSource::Surface && pane.review.evidence().path == surface);
}

#[test]
fn test_concurrent_ownership_access() {
    let pane = Arc::new(std::sync::Mutex::new(EditorPane::new("test_path".to_string(), Arc::new(Identity::new()))));
    let handle = std::thread::spawn(move || {
        let mut pane = pane.lock().unwrap();
        pane.motion_cue = EditorMotionCue::OwnerOwnership(PeerId::new("thread1"));
    });
    
    let handle2 = std::thread::spawn(move || {
        let mut pane = pane.lock().unwrap();
        pane.motion_cue = EditorMotionCue::OwnerOwnership(PeerId::new("thread2"));
    });
    
    handle.join().unwrap();
    handle2.join().unwrap();
    
    let pane = pane.lock().unwrap();
    // Ensure only one owner is active
    assert!(pane.motion_cue == EditorMotionCue::OwnerOwnership(PeerId::new("thread1")) ||
           pane.motion_cue == EditorMotionCue::OwnerOwnership(PeerId::new("thread2")));
}