//! Device-local text saving, not a Harbor admission or recovery receipt.
//!
//! Optimistic conflict detection checks file identity, metadata and exact bytes
//! before replacement. This is NOT an OS compare-and-swap against arbitrary
//! external writers: another process can race the last check and rename. Shared
//! filesystem authority and crash-safe CRDT history remain separate work.

use sha2::{Digest, Sha256};
use std::fs::{self, File, Metadata, OpenOptions};
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};
use std::time::SystemTime;

// A deliberately small, process-local writer domain. Even distinct region
// panes / differently spelled paths cannot concurrently pass the old baseline
// check. This mutex never lives on the render thread and confers no OS lease.
static LOCAL_WRITER: std::sync::Mutex<()> = std::sync::Mutex::new(());

#[derive(Clone, Debug, PartialEq, Eq)]
struct FileVersion {
    len: u64,
    modified: SystemTime,
    readonly: bool,
    #[cfg(unix)]
    identity: (u64, u64, u32, u32, u32, i64, i64),
}

impl FileVersion {
    fn read(meta: &Metadata) -> io::Result<Self> {
        if !meta.is_file() {
            return Err(io::Error::other("Save requires a regular file"));
        }
        #[cfg(unix)]
        if std::os::unix::fs::MetadataExt::nlink(meta) != 1 {
            return Err(io::Error::other(
                "Saving multiply-linked files is not supported",
            ));
        }
        Ok(Self {
            len: meta.len(),
            modified: meta.modified()?,
            readonly: meta.permissions().readonly(),
            #[cfg(unix)]
            identity: {
                use std::os::unix::fs::MetadataExt;
                (
                    meta.dev(),
                    meta.ino(),
                    meta.mode(),
                    meta.uid(),
                    meta.gid(),
                    meta.ctime(),
                    meta.ctime_nsec(),
                )
            },
        })
    }
}

#[derive(Clone, Debug)]
pub struct LocalFileBaseline {
    path: PathBuf,
    version: FileVersion,
    digest: [u8; 32],
}

fn conflict() -> io::Error {
    io::Error::other("File changed outside this editor; save refused. Your buffer was kept")
}

/// Reject symlink components instead of silently writing somewhere other than
/// the selected path. Relative paths are resolved once, at open, not at save.
fn checked_path(path: &Path) -> io::Result<PathBuf> {
    let path = if path.is_absolute() {
        path.to_owned()
    } else {
        std::env::current_dir()?.join(path)
    };
    let mut prefix = PathBuf::new();
    for part in path.components() {
        prefix.push(part);
        if fs::symlink_metadata(&prefix)?.file_type().is_symlink() {
            return Err(io::Error::other(
                "Saving through symbolic links is not supported",
            ));
        }
    }
    path.canonicalize()
}

pub fn read_local_file(path: &Path) -> io::Result<(String, LocalFileBaseline)> {
    let path = checked_path(path)?;
    // Check type before opening: never block on a FIFO or read a device.
    let before = FileVersion::read(&fs::symlink_metadata(&path)?)?;
    let mut file = open_regular(&path)?;
    if FileVersion::read(&file.metadata()?)? != before {
        return Err(conflict());
    }
    let mut text = String::new();
    file.read_to_string(&mut text)?;
    if FileVersion::read(&file.metadata()?)? != before
        || FileVersion::read(&fs::symlink_metadata(&path)?)? != before
    {
        return Err(conflict());
    }
    let digest = Sha256::digest(text.as_bytes()).into();
    Ok((
        text,
        LocalFileBaseline {
            path,
            version: before,
            digest,
        },
    ))
}

fn open_regular(path: &Path) -> io::Result<File> {
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        // Refuse a swapped symlink and never block on a swapped FIFO.
        options.custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK);
    }
    let file = options.open(path)?;
    if !file.metadata()?.is_file() {
        return Err(io::Error::other("Not a regular text file"));
    }
    Ok(file)
}

/// Reading a linked source remains supported without granting Save authority.
pub fn read_for_editor(path: &Path) -> io::Result<(String, Option<LocalFileBaseline>)> {
    let canonical = path.canonicalize()?;
    let metadata = fs::metadata(&canonical)?;
    if !metadata.is_file() {
        return Err(io::Error::other("Not a regular text file"));
    }
    let eligible = checked_path(path).is_ok() && FileVersion::read(&metadata).is_ok();
    if eligible {
        read_local_file(path).map(|(text, baseline)| (text, Some(baseline)))
    } else {
        let mut text = String::new();
        open_regular(&canonical)?.read_to_string(&mut text)?;
        Ok((text, None))
    }
}

fn copy_metadata(source: &File, staged: &File) -> io::Result<()> {
    #[cfg(target_os = "macos")]
    {
        use std::os::fd::AsRawFd;
        // Apple's descriptor-based primitive copies ACLs, xattrs and stat
        // metadata without copying content. Both descriptors remain owned here.
        // https://developer.apple.com/library/archive/documentation/System/Conceptual/ManPages_iPhoneOS/man3/copyfile.3.html
        if unsafe {
            libc::fcopyfile(
                source.as_raw_fd(),
                staged.as_raw_fd(),
                std::ptr::null_mut(),
                libc::COPYFILE_METADATA,
            )
        } != 0
        {
            return Err(io::Error::last_os_error());
        }
        staged.set_times(fs::FileTimes::new().set_modified(SystemTime::now()))?;
    }
    #[cfg(target_os = "linux")]
    {
        use std::os::fd::AsRawFd;
        // Linux ACLs are extended attributes. Until metadata copying is
        // implemented here, refuse both source attributes and inherited ones.
        // https://man7.org/linux/man-pages/man2/listxattr.2.html
        for file in [source, staged] {
            let size = unsafe { libc::flistxattr(file.as_raw_fd(), std::ptr::null_mut(), 0) };
            if size < 0 {
                return Err(io::Error::last_os_error());
            }
            if size != 0 {
                return Err(io::Error::other(
                    "Save cannot preserve this file's extended attributes or ACLs on Linux",
                ));
            }
        }
        staged.set_permissions(source.metadata()?.permissions())?;
    }
    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    return Err(io::Error::other(
        "Metadata-safe saving is not implemented on this platform",
    ));
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        let old = source.metadata()?;
        let new = staged.metadata()?;
        if (old.uid(), old.gid(), old.mode()) != (new.uid(), new.gid(), new.mode()) {
            return Err(io::Error::other(
                "Save cannot preserve file ownership, group or mode",
            ));
        }
    }
    Ok(())
}

impl LocalFileBaseline {
    fn check(&self) -> io::Result<()> {
        let (_, now) = read_local_file(&self.path)?;
        if self.version != now.version || self.digest != now.digest {
            return Err(conflict());
        }
        if self.version.readonly {
            return Err(io::Error::other("File is read-only; save refused"));
        }
        Ok(())
    }

    pub fn save(self, text: &str) -> io::Result<Self> {
        self.save_after_staging(text, || {})
    }

    fn save_after_staging(self, text: &str, before_check: impl FnOnce()) -> io::Result<Self> {
        let _writer = LOCAL_WRITER
            .lock()
            .map_err(|_| io::Error::other("Local save writer unavailable"))?;
        self.check()?;
        let source = open_regular(&self.path)?;
        if FileVersion::read(&source.metadata()?)? != self.version {
            return Err(conflict());
        }
        let parent = self
            .path
            .parent()
            .ok_or_else(|| io::Error::other("Missing file directory"))?;
        let staged = parent.join(format!(".harbor-save-{}", uuid::Uuid::new_v4()));
        let mut options = OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options.open(&staged)?;
        // Only this create_new-owned temporary file is ever cleaned up.
        let cleanup = StagedFile(staged.clone());
        file.write_all(text.as_bytes())?;
        copy_metadata(&source, &file)?;
        file.sync_all()?;
        before_check();
        self.check()?;
        // Never truncate the destination. Failure before this point leaves it
        // untouched. After rename, an error is uncertain, NOT a clean receipt.
        fs::rename(&staged, &self.path)?;
        drop(cleanup);
        File::open(parent)?.sync_all()?;
        let (observed, baseline) = read_local_file(&self.path)?;
        if observed != text {
            return Err(conflict());
        }
        Ok(baseline)
    }
}

struct StagedFile(PathBuf);
impl Drop for StagedFile {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.0);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Fixture(PathBuf);
    impl Fixture {
        fn new() -> Self {
            let root = Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("target/editor-save-tests")
                .join(uuid::Uuid::new_v4().to_string());
            fs::create_dir_all(&root).unwrap();
            fs::write(root.join("note.txt"), "original\n").unwrap();
            Self(root)
        }
        fn path(&self) -> PathBuf {
            self.0.join("note.txt")
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            fs::remove_dir_all(&self.0).unwrap();
        }
    }

    #[test]
    fn repeated_save_empty_and_unicode_are_read_back() {
        let f = Fixture::new();
        let (_, baseline) = read_local_file(&f.path()).unwrap();
        let next = baseline.save("Becky’s field notes 🦉\r\n").unwrap();
        assert_eq!(
            fs::read_to_string(f.path()).unwrap(),
            "Becky’s field notes 🦉\r\n"
        );
        next.save("").unwrap();
        assert_eq!(fs::read_to_string(f.path()).unwrap(), "");
        assert_eq!(fs::read_dir(&f.0).unwrap().count(), 1);
    }

    #[test]
    fn external_change_before_save_or_after_staging_is_preserved() {
        for during_staging in [false, true] {
            let f = Fixture::new();
            let (_, baseline) = read_local_file(&f.path()).unwrap();
            if !during_staging {
                fs::write(f.path(), "external").unwrap();
            }
            assert!(baseline
                .save_after_staging("editor", || {
                    if during_staging {
                        fs::write(f.path(), "external").unwrap();
                    }
                })
                .is_err());
            assert_eq!(fs::read_to_string(f.path()).unwrap(), "external");
            assert_eq!(fs::read_dir(&f.0).unwrap().count(), 1);
        }
    }

    #[test]
    fn replacement_with_identical_bytes_is_not_the_opened_file() {
        let f = Fixture::new();
        let (_, baseline) = read_local_file(&f.path()).unwrap();
        let other = f.0.join("other");
        fs::write(&other, "original\n").unwrap();
        fs::rename(other, f.path()).unwrap();
        assert!(baseline.save("editor").is_err());
        assert_eq!(fs::read_to_string(f.path()).unwrap(), "original\n");
    }

    #[test]
    fn missing_and_non_regular_targets_are_refused() {
        let f = Fixture::new();
        assert!(read_local_file(&f.0).is_err());
        let (_, baseline) = read_local_file(&f.path()).unwrap();
        fs::remove_file(f.path()).unwrap();
        assert!(baseline.save("editor").is_err());
        assert!(!f.path().exists());
    }

    #[test]
    fn two_views_of_one_file_cannot_both_publish_the_same_baseline() {
        let f = Fixture::new();
        let (_, first) = read_local_file(&f.path()).unwrap();
        let (_, second) = read_local_file(&f.0.join("./note.txt")).unwrap();
        let (staged_tx, staged_rx) = std::sync::mpsc::channel();
        let (release_tx, release_rx) = std::sync::mpsc::channel();
        let a = std::thread::spawn(move || {
            first.save_after_staging("first view", || {
                assert!(
                    matches!(
                        LOCAL_WRITER.try_lock(),
                        Err(std::sync::TryLockError::WouldBlock)
                    ),
                    "publication must still hold the process-local writer admission"
                );
                staged_tx.send(()).unwrap();
                release_rx.recv().unwrap();
            })
        });
        staged_rx.recv().unwrap();
        let (attempt_tx, attempt_rx) = std::sync::mpsc::channel();
        let b = std::thread::spawn(move || {
            attempt_tx.send(()).unwrap();
            second.save("second view")
        });
        attempt_rx.recv().unwrap();
        release_tx.send(()).unwrap();
        assert!(a.join().unwrap().is_ok());
        assert!(b.join().unwrap().is_err());
        assert_eq!(fs::read_to_string(f.path()).unwrap(), "first view");
    }

    #[cfg(any(target_os = "macos", target_os = "linux"))]
    #[test]
    fn extended_attributes_are_preserved_or_save_is_refused() {
        use std::os::fd::AsRawFd;
        let f = Fixture::new();
        let file = File::open(f.path()).unwrap();
        let key = c"user.harbor-save-test";
        let value = b"retained";
        #[cfg(target_os = "macos")]
        let result = unsafe {
            libc::fsetxattr(
                file.as_raw_fd(),
                key.as_ptr(),
                value.as_ptr().cast(),
                value.len(),
                0,
                0,
            )
        };
        #[cfg(target_os = "linux")]
        let result = unsafe {
            libc::fsetxattr(
                file.as_raw_fd(),
                key.as_ptr(),
                value.as_ptr().cast(),
                value.len(),
                0,
            )
        };
        assert_eq!(
            result,
            0,
            "fixture must support xattrs: {}",
            io::Error::last_os_error()
        );
        let (_, baseline) = read_local_file(&f.path()).unwrap();
        let saved = baseline.save("edited");
        #[cfg(target_os = "macos")]
        assert!(saved.is_ok(), "{saved:?}");
        #[cfg(target_os = "linux")]
        assert!(saved.is_err());
        let file = File::open(f.path()).unwrap();
        let mut observed = [0u8; 8];
        #[cfg(target_os = "macos")]
        let count = unsafe {
            libc::fgetxattr(
                file.as_raw_fd(),
                key.as_ptr(),
                observed.as_mut_ptr().cast(),
                observed.len(),
                0,
                0,
            )
        };
        #[cfg(target_os = "linux")]
        let count = unsafe {
            libc::fgetxattr(
                file.as_raw_fd(),
                key.as_ptr(),
                observed.as_mut_ptr().cast(),
                observed.len(),
            )
        };
        assert_eq!(count, 8);
        assert_eq!(&observed, value);
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn macos_acl_is_preserved_on_the_replacement_file() {
        let f = Fixture::new();
        assert!(std::process::Command::new("/bin/chmod")
            .args(["+a", "everyone allow read"])
            .arg(f.path())
            .status()
            .unwrap()
            .success());
        let acl = || {
            let output = std::process::Command::new("/bin/ls")
                .arg("-le")
                .arg(f.path())
                .output()
                .unwrap();
            assert!(output.status.success());
            String::from_utf8(output.stdout)
                .unwrap()
                .lines()
                .skip(1)
                .collect::<Vec<_>>()
                .join("\n")
        };
        let before = acl();
        // Sandboxed directory services may render the principal as its UUID.
        assert!(
            before.contains("allow read"),
            "missing fixture ACL: {before:?}"
        );
        let (_, baseline) = read_local_file(&f.path()).unwrap();
        baseline.save("edited").unwrap();
        assert_eq!(acl(), before);
    }

    #[cfg(unix)]
    #[test]
    fn links_and_readonly_files_are_not_overwritten() {
        use std::os::unix::fs::{symlink, PermissionsExt};
        let f = Fixture::new();
        let alias = f.0.join("alias");
        symlink(f.path(), &alias).unwrap();
        assert!(read_local_file(&alias).is_err());
        fs::hard_link(f.path(), f.0.join("hardlink")).unwrap();
        assert!(read_local_file(&f.path()).is_err());
        fs::remove_file(f.0.join("hardlink")).unwrap();
        fs::set_permissions(f.path(), fs::Permissions::from_mode(0o400)).unwrap();
        let (_, baseline) = read_local_file(&f.path()).unwrap();
        assert!(baseline.save("editor").is_err());
        assert_eq!(fs::read_to_string(f.path()).unwrap(), "original\n");
    }
}
