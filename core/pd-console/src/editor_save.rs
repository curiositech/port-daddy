//! Device-local editor saving. A saved file is not a shared Harbor acknowledgement.
//! The witness refuses ordinary external edits and target replacement; the final
//! check plus rename is not an OS-wide compare-and-swap against other writers.

use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::Command;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FileWitness {
    #[cfg(unix)]
    device: u64,
    #[cfg(unix)]
    inode: u64,
    len: u64,
    bytes: Vec<u8>,
}

impl FileWitness {
    fn read(path: &Path) -> Result<Self, String> {
        let entry =
            fs::symlink_metadata(path).map_err(|e| format!("cannot inspect editor target: {e}"))?;
        if !entry.file_type().is_file() || entry.file_type().is_symlink() {
            return Err("editor save requires an existing regular file, not a link".into());
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::MetadataExt;
            if entry.nlink() != 1 {
                return Err("editor save refuses a file with hard links".into());
            }
        }
        let mut file = File::open(path).map_err(|e| format!("cannot open editor target: {e}"))?;
        let opened = file
            .metadata()
            .map_err(|e| format!("cannot inspect opened target: {e}"))?;
        if !same_file(&entry, &opened) {
            return Err("editor target changed while opening".into());
        }
        let mut bytes = Vec::new();
        file.read_to_end(&mut bytes)
            .map_err(|e| format!("cannot read editor target: {e}"))?;
        let after =
            fs::symlink_metadata(path).map_err(|e| format!("editor target disappeared: {e}"))?;
        if !same_file(&opened, &after)
            || opened.len() != bytes.len() as u64
            || opened.modified().ok() != after.modified().ok()
        {
            return Err("editor target changed while reading".into());
        }
        Ok(Self {
            #[cfg(unix)]
            device: device(&opened),
            #[cfg(unix)]
            inode: inode(&opened),
            len: bytes.len() as u64,
            bytes,
        })
    }
}

#[cfg(unix)]
fn device(metadata: &fs::Metadata) -> u64 {
    use std::os::unix::fs::MetadataExt;
    metadata.dev()
}
#[cfg(unix)]
fn inode(metadata: &fs::Metadata) -> u64 {
    use std::os::unix::fs::MetadataExt;
    metadata.ino()
}
pub(super) fn same_file(a: &fs::Metadata, b: &fs::Metadata) -> bool {
    #[cfg(unix)]
    {
        device(a) == device(b) && inode(a) == inode(b)
    }
    #[cfg(not(unix))]
    {
        a.len() == b.len() && a.modified().ok() == b.modified().ok()
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct ParentWitness {
    #[cfg(unix)]
    device: u64,
    #[cfg(unix)]
    inode: u64,
}

impl ParentWitness {
    fn read(parent: &Path) -> Result<Self, String> {
        let metadata = fs::symlink_metadata(parent)
            .map_err(|e| format!("cannot inspect editor parent: {e}"))?;
        if !metadata.file_type().is_dir() || metadata.file_type().is_symlink() {
            return Err("editor parent is not a real directory".into());
        }
        Ok(Self {
            #[cfg(unix)]
            device: device(&metadata),
            #[cfg(unix)]
            inode: inode(&metadata),
        })
    }
}

#[derive(Clone, Debug)]
pub struct SaveTarget {
    path: PathBuf,
    worktree: PathBuf,
    parent: ParentWitness,
    witness: FileWitness,
}

impl SaveTarget {
    pub fn open(path: &str, loaded_text: &str) -> Result<Self, String> {
        let path = PathBuf::from(path);
        // HarborBuffer::open reads relative paths from the process directory.
        // Resolve the save target from that same directory, then pin its Git
        // worktree below; using a different root would bind the wrong file.
        let path = if path.is_absolute() {
            path
        } else {
            std::env::current_dir()
                .map_err(|e| format!("cannot resolve relative editor target: {e}"))?
                .join(path)
        };
        let path: PathBuf = path.components().collect();
        let parent = path.parent().ok_or("editor target has no parent")?;
        let canonical_parent = parent
            .canonicalize()
            .map_err(|e| format!("cannot resolve editor parent: {e}"))?;
        if parent != canonical_parent {
            return Err("editor target has a linked or noncanonical parent".into());
        }
        let output = Command::new("git")
            .args([
                "-C",
                parent.to_str().ok_or("non-UTF-8 editor parent")?,
                "rev-parse",
                "--show-toplevel",
            ])
            .output()
            .map_err(|e| format!("cannot identify editor worktree: {e}"))?;
        if !output.status.success() {
            return Err("editor save requires a selected Git worktree".into());
        }
        let root = String::from_utf8(output.stdout).map_err(|_| "non-UTF-8 worktree root")?;
        let worktree = PathBuf::from(root.trim())
            .canonicalize()
            .map_err(|e| format!("cannot resolve editor worktree: {e}"))?;
        if !path.starts_with(&worktree) {
            return Err("editor target is outside its selected worktree".into());
        }
        let parent_witness = ParentWitness::read(parent)?;
        let witness = FileWitness::read(&path)?;
        if witness.bytes != loaded_text.as_bytes() {
            return Err("editor target changed during open; reopen before saving".into());
        }
        Ok(Self {
            path,
            worktree,
            parent: parent_witness,
            witness,
        })
    }

    /// Read-only witness check for Save on an otherwise unchanged buffer.
    pub fn verify(&self) -> Result<Self, String> {
        let parent = self.path.parent().ok_or("editor target has no parent")?;
        let canonical_parent = parent
            .canonicalize()
            .map_err(|e| format!("cannot resolve editor parent: {e}"))?;
        if parent != canonical_parent || !self.path.starts_with(&self.worktree) {
            return Err("editor target left its selected worktree".into());
        }
        if ParentWitness::read(parent)? != self.parent {
            return Err("editor parent directory changed since open".into());
        }
        if FileWitness::read(&self.path)? != self.witness {
            return Err(
                "editor target changed outside this buffer; reopen or resolve the conflict".into(),
            );
        }
        Ok(self.clone())
    }

    pub fn save(&self, bytes: &[u8]) -> Result<Self, String> {
        self.save_with_hook(bytes, |_| Ok(()))
    }

    /// The hook is a deterministic test seam after preparation and before replace.
    /// Production always supplies a no-op; a failed preparation still cleans up.
    pub(super) fn save_with_hook(
        &self,
        bytes: &[u8],
        before_replace: impl FnOnce(&Path) -> Result<(), String>,
    ) -> Result<Self, String> {
        self.verify()?;
        let parent = self.path.parent().ok_or("editor target has no parent")?;
        let temp = parent.join(format!(".pd-editor-save-{}", uuid::Uuid::new_v4()));
        let result = (|| -> Result<(), String> {
            let mut file = OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&temp)
                .map_err(|e| format!("cannot prepare editor save: {e}"))?;
            preserve_metadata(&self.path, &file)?;
            file.write_all(bytes)
                .map_err(|e| format!("cannot write editor save: {e}"))?;
            // A write can clear set-id bits or change security metadata. Verify
            // the completed inode, not only the prepared one.
            verify_metadata(&self.path, &file)?;
            file.sync_all()
                .map_err(|e| format!("cannot sync editor save: {e}"))?;
            before_replace(&temp)?;
            verify_metadata(&self.path, &file)?;
            // This is a best-effort external-change refusal, not an atomic CAS.
            if ParentWitness::read(parent)? != self.parent
                || FileWitness::read(&self.path)? != self.witness
            {
                return Err("editor target changed during save; original preserved".into());
            }
            fs::rename(&temp, &self.path)
                .map_err(|e| format!("cannot replace editor target: {e}"))?;
            if let Ok(dir) = File::open(parent) {
                let _ = dir.sync_all();
            }
            Ok(())
        })();
        if result.is_err() {
            let _ = fs::remove_file(&temp);
        }
        result?;
        let witness = FileWitness::read(&self.path)?;
        if witness.bytes != bytes {
            return Err("saved target no longer matches the requested bytes".into());
        }
        Ok(Self {
            path: self.path.clone(),
            worktree: self.worktree.clone(),
            parent: self.parent.clone(),
            witness,
        })
    }
}

#[cfg(target_os = "macos")]
mod platform_metadata {
    use super::*;
    use std::os::darwin::fs::MetadataExt as DarwinMetadataExt;
    use std::os::fd::AsRawFd;

    const COPYFILE_XATTR: u32 = 1 << 2;
    const COPYFILE_METADATA: u32 = 1 | (1 << 1) | COPYFILE_XATTR;
    const ACL_TYPE_EXTENDED: i32 = 0x100;

    unsafe extern "C" {
        fn fcopyfile(from: i32, to: i32, state: *mut std::ffi::c_void, flags: u32) -> i32;
        fn flistxattr(fd: i32, names: *mut i8, size: usize, options: i32) -> isize;
        fn fgetxattr(
            fd: i32,
            name: *const i8,
            value: *mut std::ffi::c_void,
            size: usize,
            position: u32,
            options: i32,
        ) -> isize;
        fn acl_get_fd_np(fd: i32, acl_type: i32) -> *mut std::ffi::c_void;
        fn acl_to_text(acl: *mut std::ffi::c_void, len: *mut isize) -> *mut i8;
        fn acl_free(pointer: *mut std::ffi::c_void) -> i32;
    }

    fn extended_attributes(file: &File) -> Result<Vec<(Vec<u8>, Vec<u8>)>, String> {
        let fd = file.as_raw_fd();
        let size = unsafe { flistxattr(fd, std::ptr::null_mut(), 0, 0) };
        if size < 0 {
            return Err(format!(
                "cannot inspect editor xattrs: {}",
                std::io::Error::last_os_error()
            ));
        }
        let mut names = vec![0_u8; size as usize];
        if size > 0 && unsafe { flistxattr(fd, names.as_mut_ptr().cast(), names.len(), 0) } != size
        {
            return Err("editor xattrs changed while inspecting".into());
        }
        let mut values = Vec::new();
        for name in names
            .split(|byte| *byte == 0)
            .filter(|name| !name.is_empty())
        {
            let mut c_name = name.to_vec();
            c_name.push(0);
            let length =
                unsafe { fgetxattr(fd, c_name.as_ptr().cast(), std::ptr::null_mut(), 0, 0, 0) };
            if length < 0 {
                return Err(format!(
                    "cannot read editor xattr: {}",
                    std::io::Error::last_os_error()
                ));
            }
            let mut value = vec![0_u8; length as usize];
            if length > 0
                && unsafe {
                    fgetxattr(
                        fd,
                        c_name.as_ptr().cast(),
                        value.as_mut_ptr().cast(),
                        value.len(),
                        0,
                        0,
                    )
                } != length
            {
                return Err("editor xattr changed while inspecting".into());
            }
            values.push((name.to_vec(), value));
        }
        values.sort();
        Ok(values)
    }

    fn acl_text(file: &File) -> Result<Option<Vec<u8>>, String> {
        let acl = unsafe { acl_get_fd_np(file.as_raw_fd(), ACL_TYPE_EXTENDED) };
        if acl.is_null() {
            let error = std::io::Error::last_os_error();
            return if error.raw_os_error() == Some(2) {
                Ok(None)
            } else {
                Err(format!("cannot inspect editor ACL: {error}"))
            };
        }
        let mut length = 0_isize;
        let text = unsafe { acl_to_text(acl, &mut length) };
        let result = if text.is_null() || length < 0 {
            Err(format!(
                "cannot render editor ACL: {}",
                std::io::Error::last_os_error()
            ))
        } else {
            Ok(Some(
                unsafe { std::slice::from_raw_parts(text.cast::<u8>(), length as usize) }.to_vec(),
            ))
        };
        if !text.is_null() {
            unsafe {
                acl_free(text.cast());
            }
        }
        unsafe {
            acl_free(acl);
        }
        result
    }

    fn opened_source(path: &Path) -> Result<File, String> {
        let source = File::open(path).map_err(|e| format!("cannot open metadata source: {e}"))?;
        if !same_file(
            &fs::symlink_metadata(path)
                .map_err(|e| format!("cannot inspect metadata source: {e}"))?,
            &source
                .metadata()
                .map_err(|e| format!("cannot inspect opened metadata source: {e}"))?,
        ) {
            return Err("editor target changed during metadata copy".into());
        }
        Ok(source)
    }

    pub(super) fn preserve_metadata(path: &Path, temp: &File) -> Result<(), String> {
        let source = opened_source(path)?;
        // Apple copyfile(3): METADATA includes POSIX ownership/mode, ACLs and
        // extended attributes. Descriptor form pins both inodes during copy.
        let copied = unsafe {
            fcopyfile(
                source.as_raw_fd(),
                temp.as_raw_fd(),
                std::ptr::null_mut(),
                COPYFILE_METADATA,
            )
        };
        if copied != 0 {
            return Err(format!(
                "cannot preserve editor metadata: {}",
                std::io::Error::last_os_error()
            ));
        }
        verify_metadata(path, temp)
    }

    pub(super) fn verify_metadata(path: &Path, temp: &File) -> Result<(), String> {
        let source = opened_source(path)?;
        let before = source
            .metadata()
            .map_err(|e| format!("cannot inspect source metadata: {e}"))?;
        let after = temp
            .metadata()
            .map_err(|e| format!("cannot inspect prepared metadata: {e}"))?;
        if before.st_uid() != after.st_uid()
            || before.st_gid() != after.st_gid()
            || before.st_mode() != after.st_mode()
            || before.st_flags() != after.st_flags()
        {
            return Err(
                "editor metadata changed or could not be preserved; original preserved".into(),
            );
        }
        if extended_attributes(&source)? != extended_attributes(temp)?
            || acl_text(&source)? != acl_text(temp)?
        {
            return Err(
                "editor ACL or extended attributes changed during save; original preserved".into(),
            );
        }
        Ok(())
    }
}

#[cfg(target_os = "linux")]
mod platform_metadata {
    use super::*;
    use std::os::fd::AsRawFd;
    use std::os::unix::fs::MetadataExt;

    unsafe extern "C" {
        fn flistxattr(fd: i32, list: *mut i8, size: usize) -> isize;
        fn ioctl(fd: i32, request: u64, ...) -> i32;
    }
    const FS_IOC_GETFLAGS: u64 = 0x80086601;
    // ext4 reports this storage-layout flag for ordinary files. A new inode
    // may use different extents without changing the file's policy metadata.
    const FS_EXTENT_FL: i32 = 0x0008_0000;

    fn has_unpreservable_flags(flags: i32) -> bool {
        flags & !FS_EXTENT_FL != 0
    }

    fn plain_file(file: &File) -> Result<(), String> {
        let attrs = unsafe { flistxattr(file.as_raw_fd(), std::ptr::null_mut(), 0) };
        let mut flags: i32 = 0;
        let flag_result = unsafe { ioctl(file.as_raw_fd(), FS_IOC_GETFLAGS, &mut flags) };
        if attrs < 0 || flag_result != 0 {
            return Err("cannot inspect editor extended metadata; original preserved".into());
        }
        if attrs != 0 || has_unpreservable_flags(flags) {
            return Err(
                "editor target has extended metadata this save cannot preserve; original preserved"
                    .into(),
            );
        }
        Ok(())
    }

    #[cfg(test)]
    #[test]
    fn ordinary_extent_layout_is_not_policy_metadata() {
        assert!(!has_unpreservable_flags(0));
        assert!(!has_unpreservable_flags(FS_EXTENT_FL));
        assert!(has_unpreservable_flags(FS_EXTENT_FL | 0x0000_0010)); // immutable
    }

    pub(super) fn preserve_metadata(path: &Path, temp: &File) -> Result<(), String> {
        let source = File::open(path).map_err(|e| format!("cannot open metadata source: {e}"))?;
        plain_file(&source)?;
        temp.set_permissions(source.metadata().map_err(|e| e.to_string())?.permissions())
            .map_err(|e| format!("cannot preserve editor permissions: {e}"))?;
        verify_metadata(path, temp)
    }

    pub(super) fn verify_metadata(path: &Path, temp: &File) -> Result<(), String> {
        let source = File::open(path).map_err(|e| format!("cannot open metadata source: {e}"))?;
        plain_file(&source)?;
        plain_file(temp)?;
        let before = source.metadata().map_err(|e| e.to_string())?;
        let after = temp.metadata().map_err(|e| e.to_string())?;
        if !same_file(
            &fs::symlink_metadata(path).map_err(|e| e.to_string())?,
            &before,
        ) || before.uid() != after.uid()
            || before.gid() != after.gid()
            || before.mode() != after.mode()
        {
            return Err(
                "editor metadata changed or could not be preserved; original preserved".into(),
            );
        }
        Ok(())
    }
}

#[cfg(not(any(target_os = "macos", target_os = "linux")))]
mod platform_metadata {
    use super::*;
    pub(super) fn preserve_metadata(_path: &Path, _temp: &File) -> Result<(), String> {
        Err("editor save cannot preserve target metadata on this platform".into())
    }
    pub(super) fn verify_metadata(_path: &Path, _temp: &File) -> Result<(), String> {
        Err("editor save cannot verify target metadata on this platform".into())
    }
}

use platform_metadata::{preserve_metadata, verify_metadata};

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture(text: &str) -> (PathBuf, PathBuf) {
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("target/editor-save-tests")
            .join(format!("pd-editor-save-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        let path = root.join("document.txt");
        fs::write(&path, text).unwrap();
        (root, path)
    }

    #[test]
    fn saves_unicode_and_reopens_exact_bytes() {
        let (root, path) = fixture("old 🌊\n");
        let target = SaveTarget::open(path.to_str().unwrap(), "old 🌊\n").unwrap();
        let target = target.save("new 船\n".as_bytes()).unwrap();
        assert_eq!(fs::read(&path).unwrap(), "new 船\n".as_bytes());
        assert_eq!(target.witness.bytes, "new 船\n".as_bytes());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn refuses_buffer_content_that_does_not_match_opened_file() {
        let (root, path) = fixture("disk version\n");
        let reason = SaveTarget::open(path.to_str().unwrap(), "stale buffer\n").unwrap_err();
        assert!(reason.contains("changed during open"));
        assert_eq!(fs::read(&path).unwrap(), b"disk version\n");
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn relative_path_uses_same_worktree_file_as_buffer_open() {
        let (root, path) = fixture("opened relative\n");
        let relative = path.strip_prefix(std::env::current_dir().unwrap()).unwrap();
        let target = SaveTarget::open(relative.to_str().unwrap(), "opened relative\n").unwrap();
        assert_eq!(target.path, path);
        target.save(b"saved relative\n").unwrap();
        assert_eq!(fs::read(&path).unwrap(), b"saved relative\n");
        let dot_relative = format!("./{}", relative.display());
        let target = SaveTarget::open(&dot_relative, "saved relative\n").unwrap();
        assert_eq!(target.path, path);
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn preserves_extended_attributes_and_posix_metadata() {
        use std::os::darwin::fs::MetadataExt;
        let (root, path) = fixture("before\n");
        let set = Command::new("xattr")
            .args(["-w", "com.portdaddy.editor-save-test", "metadata-value"])
            .arg(&path)
            .output()
            .unwrap();
        assert!(
            set.status.success(),
            "{}",
            String::from_utf8_lossy(&set.stderr)
        );
        let before = fs::metadata(&path).unwrap();
        let target = SaveTarget::open(path.to_str().unwrap(), "before\n").unwrap();
        target.save(b"after\n").unwrap();
        let after = fs::metadata(&path).unwrap();
        assert_eq!(before.st_uid(), after.st_uid());
        assert_eq!(before.st_gid(), after.st_gid());
        assert_eq!(before.st_mode(), after.st_mode());
        assert_eq!(before.st_flags(), after.st_flags());
        let get = Command::new("xattr")
            .args(["-p", "com.portdaddy.editor-save-test"])
            .arg(&path)
            .output()
            .unwrap();
        assert!(
            get.status.success(),
            "{}",
            String::from_utf8_lossy(&get.stderr)
        );
        assert_eq!(
            String::from_utf8_lossy(&get.stdout).trim(),
            "metadata-value"
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn preserves_mac_acl_before_replacing_file() {
        let (root, path) = fixture("before\n");
        let set = Command::new("chmod")
            .args(["+a", "everyone allow read"])
            .arg(&path)
            .output()
            .unwrap();
        assert!(
            set.status.success(),
            "{}",
            String::from_utf8_lossy(&set.stderr)
        );
        let target = SaveTarget::open(path.to_str().unwrap(), "before\n").unwrap();
        target.save(b"after\n").unwrap();
        let acl = Command::new("ls").arg("-le").arg(&path).output().unwrap();
        assert!(acl.status.success());
        assert!(String::from_utf8_lossy(&acl.stdout).contains("everyone allow read"));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn refuses_metadata_change_before_rename_and_cleans_temp() {
        use std::os::unix::fs::PermissionsExt;
        let (root, path) = fixture("before\n");
        let target = SaveTarget::open(path.to_str().unwrap(), "before\n").unwrap();
        let original_mode = fs::metadata(&path).unwrap().permissions().mode() & 0o7777;
        let changed_mode = original_mode ^ 0o100;
        let mut temp = None;
        let result = target.save_with_hook(b"after\n", |prepared| {
            temp = Some(prepared.to_owned());
            fs::set_permissions(&path, fs::Permissions::from_mode(changed_mode)).unwrap();
            assert_eq!(
                fs::metadata(&path).unwrap().permissions().mode() & 0o7777,
                changed_mode
            );
            Ok(())
        });
        assert!(result.unwrap_err().contains("metadata"));
        assert_eq!(fs::read(&path).unwrap(), b"before\n");
        assert!(!temp.unwrap().exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn refuses_linux_extended_attributes_before_replacement() {
        use std::os::fd::AsRawFd;
        unsafe extern "C" {
            fn fsetxattr(
                fd: i32,
                name: *const i8,
                value: *const std::ffi::c_void,
                size: usize,
                flags: i32,
            ) -> i32;
        }
        let (root, path) = fixture("before\n");
        let file = File::open(&path).unwrap();
        let value = b"protected";
        let result = unsafe {
            fsetxattr(
                file.as_raw_fd(),
                c"user.pd_editor_test".as_ptr(),
                value.as_ptr().cast(),
                value.len(),
                0,
            )
        };
        assert_eq!(result, 0);
        let target = SaveTarget::open(path.to_str().unwrap(), "before\n").unwrap();
        assert!(target
            .save(b"after\n")
            .unwrap_err()
            .contains("extended metadata"));
        assert_eq!(fs::read(&path).unwrap(), b"before\n");
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn refuses_external_edit_and_target_replacement() {
        let (root, path) = fixture("one\n");
        let target = SaveTarget::open(path.to_str().unwrap(), "one\n").unwrap();
        fs::write(&path, "external\n").unwrap();
        assert!(target.save(b"mine\n").unwrap_err().contains("changed"));
        assert_eq!(fs::read(&path).unwrap(), b"external\n");
        let replacement = root.join("replacement.txt");
        fs::write(&replacement, "one\n").unwrap();
        fs::rename(&replacement, &path).unwrap();
        assert!(target.save(b"mine\n").unwrap_err().contains("changed"));
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn refuses_replaced_parent_directory() {
        let (root, path) = fixture("one\n");
        let target = SaveTarget::open(path.to_str().unwrap(), "one\n").unwrap();
        let displaced = root.with_extension("displaced");
        fs::rename(&root, &displaced).unwrap();
        fs::create_dir_all(&root).unwrap();
        fs::write(&path, "one\n").unwrap();
        assert!(target
            .save(b"mine\n")
            .unwrap_err()
            .contains("parent directory changed"));
        assert_eq!(fs::read(&path).unwrap(), b"one\n");
        fs::remove_dir_all(root).unwrap();
        fs::remove_dir_all(displaced).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn refuses_hard_linked_target() {
        let (root, path) = fixture("one\n");
        let other = root.join("linked.txt");
        fs::hard_link(&path, &other).unwrap();
        assert!(SaveTarget::open(path.to_str().unwrap(), "one\n")
            .unwrap_err()
            .contains("hard links"));
        assert_eq!(fs::read(&other).unwrap(), b"one\n");
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn refuses_symlink_substitution() {
        let (root, path) = fixture("one\n");
        let target = SaveTarget::open(path.to_str().unwrap(), "one\n").unwrap();
        let other = root.join("other.txt");
        fs::write(&other, "outside\n").unwrap();
        fs::remove_file(&path).unwrap();
        #[cfg(unix)]
        std::os::unix::fs::symlink(&other, &path).unwrap();
        #[cfg(unix)]
        assert!(target.save(b"mine\n").is_err());
        assert_eq!(fs::read(&other).unwrap(), b"outside\n");
        fs::remove_dir_all(root).unwrap();
    }
}
