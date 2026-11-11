# Share a clean copy

Every user runs a separate local copy. Share source code, not your task database
or signed-in browser profile.

## Before the first GitHub push

1. Stop the app. Run the checks in the README.
2. Run `git status --short --untracked-files=all` and inspect the changes.
3. Stage the intended source changes with `git add .`. Review
   `git diff --cached --stat` and `git diff --cached` before committing.
4. Check `git ls-files`: it must not contain `data/`, local settings, `.env`,
   credentials, browser profiles, dependencies, generated builds, or logs.
   Do not use `git add -f` on private files.
5. Review existing Git history as well as the latest files. An ignored or
   deleted file can remain in earlier commits. Revoke any published credentials
   before cleaning the history.
6. Commit the reviewed source. Create your GitHub repository, add its remote,
   and push. Confirm the Checks workflow passes before tagging a release.

## Make a source ZIP after committing

From the repository folder:

```sh
git archive --format=zip --output=../work-optimizer-source.zip HEAD
```

This packages **committed files only**, without `.git` or untracked runtime data.
It does not protect you if you have committed private data, and it omits any
changes you have not committed. Inspect the ZIP before sharing. The recipient
extracts it and follows README.md; no database or local settings are required.

The MIT license allows sharing and modification. Keep both LICENSE and
blackboard-mcp/LICENSE with distributed copies.
