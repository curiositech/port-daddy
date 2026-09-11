### Added

- Local Harbor editor undo/redo uses per-replica history, preserves collaborators'
  edits and original authorship, and sends exact operations to the existing mirror.
  Command-Z/Shift-Command-Z on macOS and Ctrl-Z/Shift-Ctrl-Z/Ctrl-Y elsewhere
  are wired in source; native interaction proof remains pending under the halt.
- Disk loading and imported history cannot be undone as local typing. History
  replay waits when another replica holds a claim; ordinary edits retain their
  region checks. A canonical affected-operation preview is still required for
  region-scoped shared undo/redo.
