//! Non-blocking-ready Git provenance for the Harbor editor.
//!
//! This module contains no GPUI code. Callers run load on a worker thread
//! and display the result beside (never instead of) Loro line authorship.

use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BlameLine {
    pub commit: String,
    pub author: String,
    pub author_time: i64,
    pub summary: String,
}

impl BlameLine {
    pub fn short_commit(&self) -> &str {
        self.commit.get(..7).unwrap_or(&self.commit)
    }

    /// Whether Git attributed this line only to the current in-memory working
    /// copy rather than to a commit. This is provenance, not a person.
    pub fn is_working_tree(&self) -> bool {
        self.commit == "working"
    }
}

fn is_header(line: &str) -> Option<(&str, usize)> {
    let mut fields = line.split_ascii_whitespace();
    let commit = fields.next()?;
    let _original = fields.next()?.parse::<usize>().ok()?;
    let final_line = fields.next()?.parse::<usize>().ok()?;
    if commit.len() < 7 || !commit.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return None;
    }
    Some((commit, final_line))
}

pub fn parse_porcelain(text: &str) -> Result<Vec<BlameLine>, String> {
    let mut parsed: Vec<(usize, BlameLine)> = Vec::new();
    let mut lines = text.lines().peekable();

    while let Some(header) = lines.next() {
        let Some((commit, final_line)) = is_header(header) else {
            continue;
        };
        let mut author = String::new();
        let mut author_time = 0i64;
        let mut summary = String::new();
        let mut saw_content = false;

        for metadata in lines.by_ref() {
            if metadata.starts_with('\t') {
                saw_content = true;
                break;
            }
            if let Some(value) = metadata.strip_prefix("author ") {
                author = value.to_string();
            } else if let Some(value) = metadata.strip_prefix("author-time ") {
                author_time = value.parse().unwrap_or_default();
            } else if let Some(value) = metadata.strip_prefix("summary ") {
                summary = value.to_string();
            }
        }
        if !saw_content {
            return Err(format!(
                "git blame record for line {final_line} had no content"
            ));
        }
        let working_tree = commit.bytes().all(|byte| byte == b'0');
        parsed.push((
            final_line,
            BlameLine {
                commit: if working_tree {
                    "working".into()
                } else {
                    commit.to_string()
                },
                author: if working_tree && author.is_empty() {
                    "Working tree".into()
                } else {
                    author
                },
                author_time,
                summary: if working_tree && summary.is_empty() {
                    "Uncommitted change".into()
                } else {
                    summary
                },
            },
        ));
    }

    if parsed.is_empty() && !text.trim().is_empty() {
        return Err("git blame returned no readable line records".into());
    }
    parsed.sort_by_key(|(line, _)| *line);
    Ok(parsed.into_iter().map(|(_, line)| line).collect())
}

fn run_git(cwd: &Path, args: &[&str]) -> Result<String, String> {
    let output = Command::new("git")
        .arg("-C")
        .arg(cwd)
        .args(args)
        .output()
        .map_err(|error| format!("could not start git: {error}"))?;
    if !output.status.success() {
        let reason = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if reason.is_empty() {
            format!("git exited with {}", output.status)
        } else {
            reason
        });
    }
    String::from_utf8(output.stdout)
        .map_err(|error| format!("git returned non-UTF-8 text: {error}"))
}

pub fn load(path: &Path) -> Result<Vec<BlameLine>, String> {
    let absolute = if path.is_absolute() {
        path.to_path_buf()
    } else {
        std::env::current_dir()
            .map_err(|error| format!("could not resolve current directory: {error}"))?
            .join(path)
    };
    let parent = absolute
        .parent()
        .ok_or_else(|| "file has no parent directory".to_string())?;
    let root = PathBuf::from(run_git(parent, &["rev-parse", "--show-toplevel"])?.trim());
    let relative = absolute.strip_prefix(&root).map_err(|_| {
        format!(
            "{} is outside Git worktree {}",
            absolute.display(),
            root.display()
        )
    })?;
    let relative = relative
        .to_str()
        .ok_or_else(|| "Git blame does not support this non-UTF-8 path yet".to_string())?;
    let output = run_git(&root, &["blame", "--line-porcelain", "--", relative])?;
    parse_porcelain(&output)
}

/// Blame the editor's current in-memory text without writing it to disk.
/// Git marks changed lines as uncommitted while retaining committed provenance
/// for unchanged lines, so the returned rows stay aligned with the Loro view.
pub fn load_with_contents(path: &Path, contents: &str) -> Result<Vec<BlameLine>, String> {
    let absolute = if path.is_absolute() {
        path.to_path_buf()
    } else {
        std::env::current_dir()
            .map_err(|error| format!("could not resolve current directory: {error}"))?
            .join(path)
    };
    let parent = absolute
        .parent()
        .ok_or_else(|| "file has no parent directory".to_string())?;
    let root = PathBuf::from(run_git(parent, &["rev-parse", "--show-toplevel"])?.trim());
    let relative = absolute
        .strip_prefix(&root)
        .map_err(|_| {
            format!(
                "{} is outside Git worktree {}",
                absolute.display(),
                root.display()
            )
        })?
        .to_str()
        .ok_or_else(|| "Git blame does not support this non-UTF-8 path yet".to_string())?
        .to_string();

    let mut child = Command::new("git")
        .arg("-C")
        .arg(&root)
        .args(["blame", "--line-porcelain", "--contents", "-", "--"])
        .arg(&relative)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("could not start git: {error}"))?;
    child
        .stdin
        .take()
        .ok_or_else(|| "git blame stdin was unavailable".to_string())?
        .write_all(contents.as_bytes())
        .map_err(|error| format!("could not send editor text to git blame: {error}"))?;
    let output = child
        .wait_with_output()
        .map_err(|error| format!("could not wait for git blame: {error}"))?;
    if !output.status.success() {
        let reason = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if reason.is_empty() {
            format!("git blame exited with {}", output.status)
        } else {
            reason
        });
    }
    let output = String::from_utf8(output.stdout)
        .map_err(|error| format!("git returned non-UTF-8 text: {error}"))?;
    parse_porcelain(&output)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_commit_author_time_and_summary_per_line() {
        let input = concat!(
            "0123456789abcdef 1 1 1\n",
            "author Ada Lovelace\n",
            "author-time 1700000000\n",
            "summary Add engine\n",
            "filename src/lib.rs\n",
            "\tfn engine() {}\n",
            "fedcba9876543210 2 2 1\n",
            "author Grace Hopper\n",
            "author-time 1700000001\n",
            "summary Wire console\n",
            "filename src/lib.rs\n",
            "\tconsole();\n",
        );
        let lines = parse_porcelain(input).expect("valid porcelain");
        assert_eq!(lines.len(), 2);
        assert_eq!(lines[0].short_commit(), "0123456");
        assert_eq!(lines[0].author, "Ada Lovelace");
        assert_eq!(lines[0].author_time, 1_700_000_000);
        assert_eq!(lines[1].summary, "Wire console");
    }

    #[test]
    fn labels_uncommitted_lines_as_working_tree() {
        let input = concat!(
            "0000000000000000000000000000000000000000 1 1 1\n",
            "author Not Committed Yet\n",
            "author-time 0\n",
            "summary Version of file.rs from file.rs\n",
            "filename file.rs\n",
            "\tchanged\n",
        );
        let lines = parse_porcelain(input).expect("valid working-tree blame");
        assert_eq!(lines[0].commit, "working");
        assert_eq!(lines[0].short_commit(), "working");
        assert!(lines[0].is_working_tree());
    }

    #[test]
    fn rejects_truncated_records() {
        let error = parse_porcelain("0123456789abcdef 1 1 1\nauthor Ada\nsummary truncated\n")
            .expect_err("missing content line must fail");
        assert!(error.contains("no content"));
    }

    #[test]
    fn loads_a_tracked_file_from_the_current_worktree() {
        let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("Cargo.toml");
        let lines = load(&path).expect("tracked manifest should have blame provenance");
        assert!(!lines.is_empty());
        assert!(lines.iter().all(|line| !line.commit.is_empty()));
    }

    #[test]
    fn in_memory_changes_are_marked_working_without_touching_disk() {
        let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("Cargo.toml");
        let disk = std::fs::read_to_string(&path).expect("manifest is readable");
        let changed = format!("# local Loro line\n{disk}");
        let lines = load_with_contents(&path, &changed).expect("git can blame in-memory contents");
        assert_eq!(lines.len(), changed.lines().count());
        assert_eq!(lines[0].commit, "working");
    }
}
