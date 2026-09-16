//! Daemon-independent local admission. This cooperative stop is not a sandbox.
//! No method removes a marker or grants resume authority. The process latches
//! denial: repairing/deleting a marker cannot silently reactivate this console.

use std::fs::{self, File, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};

static DENIED: AtomicBool = AtomicBool::new(false);

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum State {
    Available,
    Off(String),
    Unknown(String),
}

impl State {
    pub fn allows_effects(&self) -> bool {
        matches!(self, Self::Available)
    }

    pub fn detail(&self) -> &str {
        match self {
            Self::Available => "Local automation is available; hosting controls are separate.",
            Self::Off(reason) | Self::Unknown(reason) => reason,
        }
    }
}

#[derive(Clone, Debug)]
pub struct ControlPaths {
    pub canonical: PathBuf,
    pub selected: Option<PathBuf>,
    pub extra_halt: Option<PathBuf>,
}

impl ControlPaths {
    pub fn from_environment() -> io::Result<Self> {
        let home = std::env::var_os("HOME")
            .map(PathBuf::from)
            .filter(|path| path.is_absolute())
            .ok_or_else(|| {
                io::Error::other("The account home is unavailable; local automation is blocked.")
            })?;
        Ok(Self {
            canonical: home.join(".port-daddy"),
            selected: std::env::var_os("PD_HOME").map(PathBuf::from),
            extra_halt: std::env::var_os("PD_HALT_FILE").map(PathBuf::from),
        })
    }

    pub fn state(&self) -> State {
        for root in std::iter::once(&self.canonical).chain(self.selected.iter()) {
            if let Err(error) = observable_directory(root, true) {
                return State::Unknown(format!(
                    "Cannot verify {}: {error}. Local automation is blocked.",
                    root.display()
                ));
            }
            for name in ["HALT", "hooks.disabled"] {
                match marker_state(&root.join(name)) {
                    Ok(true) => {
                        return State::Off(format!(
                            "Local Off is set at {}.",
                            root.join(name).display()
                        ))
                    }
                    Ok(false) => {}
                    Err(error) => {
                        return State::Unknown(format!(
                            "Cannot read local stop control: {error}. Automation is blocked."
                        ))
                    }
                }
            }
        }
        if let Some(path) = &self.extra_halt {
            if !path.is_absolute() || path.parent().is_none() {
                return State::Unknown(
                    "The additional halt path is invalid; automation is blocked.".into(),
                );
            }
            if let Err(error) = observable_directory(path.parent().unwrap(), false) {
                return State::Unknown(format!(
                    "Cannot verify the additional halt directory: {error}. Automation is blocked."
                ));
            }
            match marker_state(path) {
                Ok(true) => return State::Off(format!("Local Off is set at {}.", path.display())),
                Ok(false) => {}
                Err(error) => {
                    return State::Unknown(format!(
                    "Cannot verify the additional halt control: {error}. Automation is blocked."
                ))
                }
            }
        }
        State::Available
    }

    /// Create both canonical stop markers, never truncate existing incident
    /// evidence. sync_all(file) and sync_all(directory) precede success. A
    /// partial failure retains whichever stop marker was already preserved.
    pub fn persist_off(&self) -> io::Result<()> {
        observable_directory(&self.canonical, true)?;
        if !self.canonical.exists() {
            fs::create_dir(&self.canonical)?;
            File::open(
                self.canonical
                    .parent()
                    .ok_or_else(|| io::Error::other("missing account directory"))?,
            )?
            .sync_all()?;
        }
        observable_directory(&self.canonical, false)?;
        for name in ["HALT", "hooks.disabled"] {
            let path = self.canonical.join(name);
            match OpenOptions::new().write(true).create_new(true).open(&path) {
                Ok(mut file) => {
                    file.write_all(b"Operator requested local Off from pd-console. Explicit authorized recovery is required.\n")?;
                    file.sync_all()?;
                }
                Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {
                    // An existing marker (even a symlink) denies admission, but
                    // don't follow it and claim a durable successful write.
                    let meta = fs::symlink_metadata(&path)?;
                    if !meta.is_file() || meta.file_type().is_symlink() {
                        return Err(io::Error::other(format!(
                            "{} is not a regular stop marker; it was left untouched",
                            path.display()
                        )));
                    }
                    // Existing contents belong to the incident record. No
                    // reopening for writing and no replacement of that record.
                }
                Err(error) => return Err(error),
            }
        }
        File::open(&self.canonical)?.sync_all()
    }
}

fn marker_state(path: &Path) -> io::Result<bool> {
    match fs::symlink_metadata(path) {
        Ok(_) => Ok(true), // Broken symlinks are stop markers too.
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(error),
    }
}

fn observable_directory(path: &Path, allow_absent: bool) -> io::Result<()> {
    if !path.is_absolute()
        || path
            .components()
            .any(|part| matches!(part, std::path::Component::ParentDir))
    {
        return Err(io::Error::other(
            "control directories must be absolute and normalized",
        ));
    }
    // A symlinked ancestor is an override too, not just a symlinked final
    // directory. Reject it rather than traversing into another control root.
    for ancestor in path.ancestors().skip(1) {
        let meta = fs::symlink_metadata(ancestor)?;
        if !meta.is_dir() || meta.file_type().is_symlink() {
            return Err(io::Error::other(
                "control directory has a non-directory or symlinked ancestor",
            ));
        }
    }
    match fs::symlink_metadata(path) {
        Ok(meta) if meta.is_dir() && !meta.file_type().is_symlink() => {
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                if meta.permissions().mode() & 0o111 == 0 {
                    return Err(io::Error::other("control directory is not searchable"));
                }
            }
            // Traversal plus read access must be observable, not assumed from
            // exists() returning false on a permissions error.
            fs::read_dir(path)?;
            Ok(())
        }
        Err(error) if error.kind() == io::ErrorKind::NotFound && allow_absent => {
            observable_directory(
                path.parent()
                    .ok_or_else(|| io::Error::other("missing parent"))?,
                false,
            )
        }
        Err(error) => Err(error),
        _ => Err(io::Error::other(
            "control directory is not a real directory",
        )),
    }
}

pub fn current_state() -> State {
    let state = match ControlPaths::from_environment() {
        Ok(paths) => paths.state(),
        Err(error) => State::Unknown(error.to_string()),
    };
    if !state.allows_effects() {
        DENIED.store(true, Ordering::SeqCst);
        state
    } else if DENIED.load(Ordering::SeqCst) {
        State::Off("This console remains Off. Marker removal is not resume authority; restart only after authorized recovery.".into())
    } else {
        state
    }
}

pub fn ensure_allowed() -> io::Result<()> {
    let state = current_state();
    if state.allows_effects() {
        Ok(())
    } else {
        Err(io::Error::other(state.detail()))
    }
}

pub fn turn_off() -> io::Result<()> {
    // Immediate process latch precedes disk work, including failing disk work.
    DENIED.store(true, Ordering::SeqCst);
    ControlPaths::from_environment()?.persist_off()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::AtomicU64;
    static NEXT: AtomicU64 = AtomicU64::new(0);

    struct Fixture(PathBuf);
    impl Fixture {
        fn new() -> Self {
            // Explicit test scratch, never HOME or the real control directory.
            let root = std::env::var_os("PD_CONSOLE_TEST_ROOT")
                .map(PathBuf::from)
                .unwrap_or_else(|| {
                    PathBuf::from(std::env::var_os("HOME").expect("test account home"))
                        .join("coding/tmp/console-off-unit")
                });
            let path = PathBuf::from(root).join(format!(
                "console-off-{}-{}",
                std::process::id(),
                NEXT.fetch_add(1, Ordering::Relaxed)
            ));
            fs::create_dir_all(&path).unwrap();
            Self(path)
        }
        fn paths(&self) -> ControlPaths {
            ControlPaths {
                canonical: self.0.join("canonical"),
                selected: None,
                extra_halt: None,
            }
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            fs::remove_dir_all(&self.0).unwrap();
        }
    }

    #[test]
    fn absent_controls_are_observed_without_creating_them() {
        let f = Fixture::new();
        let p = f.paths();
        assert_eq!(p.state(), State::Available);
        assert!(!p.canonical.exists());
    }
    #[test]
    fn off_persists_both_markers_and_survives_reconstruction() {
        let f = Fixture::new();
        let p = f.paths();
        p.persist_off().unwrap();
        assert!(p.canonical.join("HALT").is_file());
        assert!(p.canonical.join("hooks.disabled").is_file());
        assert!(matches!(f.paths().state(), State::Off(_)));
    }
    #[test]
    fn existing_halt_evidence_is_never_replaced() {
        let f = Fixture::new();
        let p = f.paths();
        fs::create_dir(&p.canonical).unwrap();
        fs::write(p.canonical.join("HALT"), "original signed incident").unwrap();
        p.persist_off().unwrap();
        p.persist_off().unwrap();
        assert_eq!(
            fs::read_to_string(p.canonical.join("HALT")).unwrap(),
            "original signed incident"
        );
    }
    #[test]
    fn selected_root_cannot_override_canonical_off() {
        let f = Fixture::new();
        let mut p = f.paths();
        p.persist_off().unwrap();
        p.selected = Some(f.0.join("other"));
        p.extra_halt = Some(f.0.join("absent"));
        assert!(!p.state().allows_effects());
    }
    #[test]
    fn selected_root_adds_a_denial() {
        let f = Fixture::new();
        let mut p = f.paths();
        p.selected = Some(f.0.join("other"));
        fs::create_dir(p.selected.as_ref().unwrap()).unwrap();
        fs::write(p.selected.as_ref().unwrap().join("hooks.disabled"), "off").unwrap();
        assert!(!p.state().allows_effects());
    }
    #[test]
    fn missing_extra_halt_parent_is_unknown_not_enabled() {
        let f = Fixture::new();
        let mut p = f.paths();
        p.extra_halt = Some(f.0.join("missing/HALT"));
        assert!(matches!(p.state(), State::Unknown(_)));
    }
    #[test]
    fn relative_or_non_directory_roots_deny() {
        let f = Fixture::new();
        let mut p = f.paths();
        p.selected = Some(PathBuf::from("relative"));
        assert!(matches!(p.state(), State::Unknown(_)));
        fs::write(&p.canonical, "not a directory").unwrap();
        p.selected = None;
        assert!(matches!(p.state(), State::Unknown(_)));
        assert!(p.persist_off().is_err());
    }
    #[cfg(unix)]
    #[test]
    fn symlink_roots_and_broken_stop_links_deny_without_following() {
        use std::os::unix::fs::symlink;
        let f = Fixture::new();
        let p = f.paths();
        symlink(f.0.join("missing"), &p.canonical).unwrap();
        assert!(matches!(p.state(), State::Unknown(_)));
        assert!(p.persist_off().is_err());
        fs::remove_file(&p.canonical).unwrap();
        fs::create_dir(&p.canonical).unwrap();
        symlink(f.0.join("missing"), p.canonical.join("HALT")).unwrap();
        assert!(matches!(p.state(), State::Off(_)));
        assert!(p.persist_off().is_err());
        assert!(!f.0.join("missing").exists());
    }
    #[cfg(unix)]
    #[test]
    fn symlinked_ancestor_is_not_control_authority() {
        let f = Fixture::new();
        let mut p = f.paths();
        std::os::unix::fs::symlink(&f.0, f.0.join("alias")).unwrap();
        p.canonical = f.0.join("alias/canonical");
        assert!(matches!(p.state(), State::Unknown(_)));
        assert!(p.persist_off().is_err());
    }
    #[cfg(unix)]
    #[test]
    fn non_searchable_directory_is_unknown() {
        use std::os::unix::fs::PermissionsExt;
        let f = Fixture::new();
        let p = f.paths();
        fs::create_dir(&p.canonical).unwrap();
        fs::set_permissions(&p.canonical, fs::Permissions::from_mode(0o400)).unwrap();
        let state = p.state();
        fs::set_permissions(&p.canonical, fs::Permissions::from_mode(0o700)).unwrap();
        assert!(matches!(state, State::Unknown(_)));
    }
}
