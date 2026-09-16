type: fixed

- **Merge commits check authored paths against every parent.** Coordination Guard excludes unchanged contributions from both the current branch and incoming merge parents, while retaining genuine resolutions, new paths, deletions and rename resolutions. Git-native filenames stay exact through staged ownership checks; unresolved indexes and unreadable merge evidence fail explicitly instead of looking unclaimed or empty.
