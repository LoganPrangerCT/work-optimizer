# Ingestion and recovery

For adding or editing individual tasks, use **[tasks.md](tasks.md)** and the two task files, `active-tasks.json` and `completed-tasks.json`. The batch protocol below is for source refreshes and advanced recovery. Manual tasks belong in ranking.order with their existing Manual identity, but never in the source-task update array.

Configure optional AI refresh as described in the README. The normal route is the visible Refresh button. It calls POST /api/refresh, creates a durable request, and starts the hidden CLI worker. GET /api/state reports the result. Pending UI polling only observes this one requested job; it does not schedule source reviews.

## Assistant bridge

If a refresh needs manual investigation, read current context:

    node scripts/bridge.mjs context

This returns task identities, evidence, completion/actual time, current revision, source scope/status, and pending request. Avoid printing unrelated source mail or storing broad inbox exports. Use connected read-only Gmail/Outlook tools and controlled browser-tab APIs for Blackboard (no native desktop computer use). Never obtain cookies or session credentials. Follow refresh/instructions.md. No mail/coursework modifications and no Teams access.

Import a JSON batch through stdin or a local file:

    node scripts/bridge.mjs import -
    node scripts/bridge.mjs import path-to-batch.json

The batch follows refresh/output.schema.json, plus these parent-owned fields:

- baseRevision: exact integer revision from the latest snapshot.
- requestId: pending refresh id, when completing a request.

Each task has source, externalId, stable actionKey, title, context, due (YYYY-MM-DD or null), time, estimated minutes (or null), concise priority reason, minimal excerpt, from/source label, observedAt ISO timestamp, exact observed HTTPS source URL, and sourceStatus active/completed. Existing tasks retain their stable identities. Reimporting active evidence cannot reopen a task completed by the user. Preserve the canonical Blackboard identity for coursework also mentioned by mail. Do not create active work from submission receipts.

ranking.order contains every active real task exactly once, including unchanged existing work, using {source, externalId, actionKey} or existing database ids. Exclude completed tasks and demo/sample records. Upstream completion evidence can close a task, but its actual duration remains user-provided. Never infer a deadline, completion state, or source scope without evidence. Partial source reviews preserve unseen tasks. The source notes should state the reviewed scope and any login/pagination limits.

A failed revision check requires rereading context and reviewing order/history again. Never override the user's completion to force an import through. Validation and revision failures before the SQLite commit roll back as a unit. A file publication failure after commit returns HTTP 503 with `committed: true` and ?Database saved; task files are not published?. The database/outbox already contains the import; do not treat this as rejection or blindly repeat it. Restart replays a matching file pair. Divergent external edits remain untouched and require the export/replay/merge procedure in [tasks.md](tasks.md).

Direct HTTP task updates (`POST /api/tasks/:id`) require `baseRevision` from `GET /api/state`, alongside `action` (`complete` or `restore`) and optional `actual` minutes. Missing revisions return 400; stale revisions return 409 without adding history events. Read state again before retrying. This protects completion and time edits across browser tabs as well as file imports.

To explicitly fail a pending request with concise non-sensitive feedback:

    node scripts/bridge.mjs fail REQUEST_ID "Blackboard needs sign-in; retry after login."

Source or validation failures retain prior successful data. A post-commit publication failure retains the newly committed database state and pending outbox. Start a new refresh after the previous one finishes or fails. The worker has a 12-minute ceiling. Restarting the server marks an unfinished request as interrupted.

Browser preference: Blackboard uses controlled browser tabs only. Native Windows/Zen automation and cookie extraction are excluded. If browser-tab access is unavailable, the source is blocked.
