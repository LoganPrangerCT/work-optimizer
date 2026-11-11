# Add and manage tasks

Edit these two files in the `data/` folder:

- **`active-tasks.json`**: all current tasks, in one JSON array.
- **`completed-tasks.json`**: completed and deleted tasks, in one JSON array. Deleted records have a `deletedAt` timestamp.

The app creates them on first start, carrying over your existing tasks and completion history. An empty file must contain `[]`. These are private local files and are ignored by Git. No import batch, database editor, or AI connection is needed to add a personal task.

## Add a task in a minute

1. Stop the server (Ctrl+C in its console). Close and reopen both JSON files from disk to discard stale editor buffers. Keep the server stopped throughout editing.
2. Open `active-tasks.json` and add an object inside the existing `[...]`, separated from the previous object by a comma. Keep the existing tasks.
3. Save both files, run `npm run tasks:check`, and fix any errors before restarting with `npm start`. Reload the dashboard to verify your edits. The AI **Refresh** button checks connected sources; it is not needed here.

The smallest task is:

```json
{ "id": "write-proposal", "title": "Write the project proposal" }
```

For priority and position, use this complete example. Copy the object into your existing array; do not replace the file with this example unless you want to remove its other tasks.

```json
[
  {
    "id": "write-proposal",
    "title": "Write the project proposal",
    "priority": 4,
    "rank": 1,
    "context": "BUS 310",
    "due": "2026-11-10",
    "time": "11:59 PM",
    "estimate": 120,
    "reason": "A major deliverable needs two work sessions."
  }
]
```

Use double quotes, plain numbers, and no comments or trailing commas. Each task ID must be unique across **both** files. Keep an ID unchanged when renaming a task so its browser notes and focus selection stay attached. Use letters, numbers, hyphens, or underscores, starting with a letter or number.

## Priority and rank

**Priority is importance/urgency to act. Higher is more critical.** It is separate from the time estimate.

| Value | Meaning | When to use it |
| --- | --- | --- |
| `5` | Critical | Immediate action protects an important deadline or unblocks consequential work. |
| `4` | High | A substantial deliverable or dependency needs progress and advance planning. |
| `3` | Standard | Normal scheduled work with enough time. This is the default. |
| `2` | Low | Work can comfortably wait. |
| `1` | Minor | Optional or very low urgency work. |

**Rank is queue position. Lower numbers come first.** To put a task first, give it `"rank": 1` and increase the other ranks. For predictable ordering, use distinct ranks `1, 2, 3, ...` across current tasks. If omitted, rank defaults to that object's position in the file. Equal ranks keep file order. Editing ranks can put a lower-priority task ahead of a higher-priority task deliberately.

The app writes ranks back as consecutive positions when saving. Dragging cards updates the file too. The next successful AI refresh reorders the queue by priority (`5` first), then breaks ties using its review. It preserves the priority and estimate you entered for personal tasks. Source tasks may have their priority/estimate updated from evidence. File order and drag order last until that refresh; rank is not a permanent pin.

## Personal-task fields

| Field | Required? | Format / default |
| --- | --- | --- |
| `id` | Yes | Stable unique name, e.g. `write-proposal`; maximum 100 characters. |
| `title` | Yes | What to do; maximum 300 characters. |
| `priority` | No | Integer `1`–`5`; defaults to `3`. |
| `rank` | No | Positive integer; defaults to position in the file. |
| `context` | No | Course, project, or category; maximum 300 characters. |
| `due` | No | Real calendar date `YYYY-MM-DD`, or `null` for no deadline. |
| `time` | No | Display text, e.g. `"5:00 PM ET"`; not used to calculate order. |
| `estimate` | No | Estimated minutes, integer `1`–`10080`, or `null`. |
| `reason` | No | Why it has this priority; defaults to `"Added by you."`; max 500 characters. |
| `excerpt` | No | Description/instructions; defaults to title; max 3000 characters. |
| `from` | No | Who requested it; defaults to empty text. |
| `url` | No | HTTPS reference link, or `null`; personal tasks can link to any HTTPS host. |
| `actual` | No | Logged minutes, integer `1`–`1440`, or `null`. Retained on restore. |
| `completedAt` | Old tasks only | Completion timestamp with timezone, e.g. `"2026-11-04T17:00:00Z"`. |

Omit `source` for personal tasks. The app treats them as **Manual**, without requiring fabricated emails or coursework evidence. The app may expand the saved object with optional fields and defaults.

Imported Blackboard, Gmail and Outlook tasks live in these same files. Keep their existing `source`, `externalId`, `actionKey`, `observedAt`, `url`, and other evidence fields intact. Their internal `id` is derived from source identity; do not change those identity fields to rename them. You can edit their title, priority, estimate and rank. Provider URLs remain restricted to supported mail and school hosts. `sample: true` entries are old demo records, not real work; they are hidden once real tasks exist.

Hidden tasks have `"hidden": true` in the active file and return to the queue 10 days before their due date. Existing browser-only hidden preferences migrate when that browser opens the dashboard.

## Finish, restore, or remove

- **Recommended:** check off a task in the dashboard. It moves from `active-tasks.json` to `completed-tasks.json`, with a completion timestamp and any logged actual minutes. **Restore** moves it back.
- **In files:** move the entire object to `completed-tasks.json`, add `completedAt`, and remove it from `active-tasks.json`. For imported tasks also change `sourceStatus` to `"completed"`. To restore, move it back, remove `completedAt`, and set any `sourceStatus` to `"active"`. Save both files before reloading. Keep the server stopped throughout the move, validate both files, then restart.
- **Delete in the dashboard:** a record with `deletedAt` moves to `completed-tasks.json`, where refresh can use it to prevent the task returning. To restore a deleted task, recover its full task from a backup and place it in `active-tasks.json`; the matching deleted record will be removed. Removing a record directly from the JSON cannot create a deletion record.

## Check your edits

```bash
npm run tasks:check
```

If PowerShell blocks npm scripts, use `npm.cmd run tasks:check` instead.

This validates both files without changing either. Errors name the file and task number, including unknown fields, duplicate IDs, bad dates, priorities, ranks, durations and unsafe links. Fix the error and save again. Invalid files are left untouched, no partial task list is imported, and task updates pause until the files are valid. Do not delete one file; use `[]` for an empty list.

Before editing, stop the server and reopen both files from disk so an older editor buffer does not replace recent app changes. Save and validate with `npm run tasks:check` before restarting. The app enforces one server writer per workspace using an OS-released SQLite lock; a second process reports that the workspace is already open. File versions are checked before commit and publication. Divergent edits pause publication instead of being replayed over. Before replacing a file, the app appends its previous bytes to `data/backups/backups.jsonl`. External editors do not participate in the lock: stop the server before editing to avoid a save racing the final version check and rename. Older UUID `.backup` files remain available separately.

To inspect the backup log, run `node scripts/backup-tasks.mjs`. To extract an entry, run `node scripts/backup-tasks.mjs 1 data/backups/restored.json`, replacing `1` with its listed number and choosing a new destination. The command never overwrites an existing file. Review the extracted file before using it. The log grows over time; archive it separately if you no longer need all its entries.

Dashboard completion, restore, and logged-time changes also check the displayed workspace revision. If another tab or a file edit changed the workspace, the save is rejected without changing history. Choose **Reload current task / keep my input** inside the dialog, review the current completion and minutes, then save if needed. The entered duration and unsaved note remain in the dialog. An uncertain create also offers **Reload tasks / keep my input** and retries with the same task identity. A task dialog keeps the revision it displayed when opened, even if background polling updates the queue.

The app still uses `data/work.sqlite` internally for transactional updates, refresh state, and recovery if writing the two files is interrupted. The two JSON files are the editable task lists; you never need to edit SQLite. Back up both files together. A full application backup also includes `data/` for refresh and recovery metadata.

If the server stops during a save, restart before editing the files. A committed outbox resumes only when each file matches its pre-save bytes or the committed bytes (including a half-published pair). If a later external edit differs, startup/save reports **Database saved; task files are not published** and preserves both the edit on disk and the committed database/outbox. This is a committed operation, not a rejected save. Do not blindly repeat the operation.

For a publication conflict, stop the server, close all task editors, and follow this recovery sequence in PowerShell:

1. Copy the entire `data/` directory to a separate private backup, including both JSON files, the backup log and any older `.backup` files. Keep that backup until verification finishes.
2. Export all three versions without changing them:
   `node scripts/recover-tasks.mjs data/work.sqlite data/backups/recovery`
   Use a new destination if it already exists. It contains `disk-*` (later edits), `committed-*` (saved app state), `before-*` (pre-save files), and `pending.json`. Missing `before-*` means the file did not exist; see the null entry in pending.expected.
3. Restore the exact pre-save pair from `before-active-tasks.json` and `before-completed-tasks.json` to the data folder (remove a data file only if its corresponding expected entry is null). Start the server to replay the committed save, then stop it. This retains the database completion events and minutes.
4. Compare the recovered data files with `disk-*`. Merge later additions/edits by stable ID into the appropriate root list. Keep each ID in exactly one list; preserve committed completedAt and actual minutes unless intentionally changing them. Do not copy the whole old active list over committed completions.
5. Run `npm run tasks:check`, restart, and inspect both Priority queue and Completed. Verify every competing ID/title, active/completed counts, completion dates and logged minutes. Keep the private backup until all agree.

The regression test executes this export/replay/manual-merge sequence after a 53-minute committed completion and a later external addition. It requires two final tasks (one active, one completed), 53 minutes, and exactly one completion event. Automatic conflict merging is intentionally unavailable.
