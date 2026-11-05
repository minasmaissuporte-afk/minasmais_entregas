---
name: Protected git mutations in the workspace
description: How the workspace shell guards commands that modify .git.
---

**Rule:** For a user-requested commit or push, prefix mutating Git commands with `DANGEROUSLY_ALLOW_GIT=1` if the shell guard blocks them. Check whether `.git/index.lock` actually exists before treating the message as a stale lock.

**Why:** The shell guard can report `.git/index.lock` even when no lock file or active Git process exists.

**How to apply:** Use this only after the user has authorized the Git operation; it does not authorize unrelated repository changes.
