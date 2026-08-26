type: fixed

- **Fleet no longer opens unvalidated stacked pull requests.** An ideation ship may still publish an advisory proposal when its sandbox is unavailable or its tests fail, but GitHub branch and pull-request mutation now requires an executed, passing sandbox run; this closes the path that produced the invalid #9863 artifact.
