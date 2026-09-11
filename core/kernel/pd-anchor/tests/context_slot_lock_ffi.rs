#![cfg(unix)]

use pd_anchor::ffi::{pd_context_slot_try_lock, pd_context_slot_unlock};
use std::fs::{create_dir_all, remove_file, OpenOptions};
use std::os::fd::AsRawFd;
use std::path::PathBuf;

fn lock_path() -> PathBuf {
    let root = std::env::current_dir()
        .unwrap()
        .join("target")
        .join("pd-anchor-lock-tests");
    create_dir_all(&root).unwrap();
    root.join(format!(
        "context-slot-{}-{}.lock",
        std::process::id(),
        std::thread::current().name().unwrap_or("unnamed")
    ))
}

#[test]
fn one_inode_has_one_kernel_lease_and_close_releases_it() {
    let path = lock_path();
    let _ = remove_file(&path);
    let first = OpenOptions::new()
        .create(true)
        .read(true)
        .write(true)
        .open(&path)
        .unwrap();
    let second = OpenOptions::new()
        .read(true)
        .write(true)
        .open(&path)
        .unwrap();

    assert_eq!(pd_context_slot_try_lock(first.as_raw_fd()), 0);
    assert_eq!(pd_context_slot_try_lock(second.as_raw_fd()), 1);
    assert_eq!(pd_context_slot_unlock(first.as_raw_fd()), 0);
    assert_eq!(pd_context_slot_try_lock(second.as_raw_fd()), 0);
    drop(second);

    let after_close = OpenOptions::new()
        .read(true)
        .write(true)
        .open(&path)
        .unwrap();
    assert_eq!(pd_context_slot_try_lock(after_close.as_raw_fd()), 0);
    assert_eq!(pd_context_slot_unlock(after_close.as_raw_fd()), 0);
    drop(after_close);
    drop(first);
    remove_file(path).unwrap();
}

#[test]
fn invalid_descriptor_fails_closed() {
    assert_eq!(pd_context_slot_try_lock(-1), -2);
    assert_eq!(pd_context_slot_unlock(-1), -2);
}
