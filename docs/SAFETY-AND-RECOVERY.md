# Safety, disk writes and recovery

**Read before applying changes to your only copy of a card.** Prefer a separate copy of the existing card for first use. This manager does not provide full-card backup, atomic multi-file transactions, hardware repair, guaranteed power-loss resilience or Undo for applied deletions.

## What changes when

Open/Refresh reads metadata (and the small manager manifest/recovery journal when present). Staging game operations retains references to selected file data. Staging a small mod ZIP reads its package. No library files are written until you approve the exact plan and grant write permission.

Apply writes only the reviewed destinations, manager journals/backups and explicit removal paths. Game removal is not recursive; unrelated neighboring files remain. Known root OS metadata folders are skipped and untouched. The source game selected for addition is not modified.

The app requests a same-origin Web Lock and checks metadata again before writing. Those are safeguards, not filesystem-wide exclusion. Another app, a different origin or hardware can change files at any time. Stop external sync tools/editors and do not use two managers on the same card. Metadata checks use size and modification time; they are not a cryptographic audit of the whole source card.

## Write phases

1. Preflight rechecks the inventory and target metadata.
2. A complete JSON journal is committed at `.wii-game-manager/transactions/txn-.../journal.json` before library writes start.
3. Files that will be replaced are streamed into verified, disk-backed rollback copies inside that transaction directory.
4. Each new/replacement target is copied in at most 4 MiB chunks. The app computes CRC32 during copying, closes the native writer, rereads the output, and compares size/CRC32. CRC32 detects accidental copy corruption, not malicious substitution or whether a game is valid.
5. Cancellation is checked and every deletion target is rechecked. The journal advances to a **deleting checkpoint**.
6. Explicit removals run. No game-sized backups are made just for removals, so deletion-only plans do not require copying the old library. Applied removals are permanent.
7. The completion state is saved and that unique transaction directory is cleaned up. The live library is rescanned and an operation report shown.

Native writable-file APIs generally use temporary files. A replacement may temporarily occupy space for the original, a rollback copy and the native output. The UI's allowance sums planned copies, replacement backup sizes, the largest write and a journal allowance. It is conservative guidance, not a free-space probe or guarantee. If insufficient space is reported, the reversible phase attempts rollback; on a nearly full card consider a separately reviewed removal-only batch first.

References to native semantics:
- https://developer.mozilla.org/en-US/docs/Web/API/FileSystemFileHandle/createWritable
- https://developer.mozilla.org/en-US/docs/Web/API/FileSystemDirectoryHandle/removeEntry
- https://developer.chrome.com/docs/capabilities/web-apis/file-system-access

## Cancel and failure behavior

Before the deleting checkpoint, Cancel requests cancellation at a chunk boundary and starts rollback. New files belonging to this operation are removed only when their recorded identity/content can be established. Replacements are restored from verified rollback backups. Pending reviewed deletions have not started.

After the checkpoint, the cancel control is disabled/hidden. An interrupted deletion phase cannot restore already-removed game data. Reopening offers to complete the recorded operation, not an inaccurate Undo.

A disconnect can prevent even the error handler from saving a journal or rolling back. The result is a recovery notice, not a success claim. Reconnect and reopen the exact folder; do not add more edits until recovery is reviewed. A locked/read-only/full drive may need to be made writable outside the app first.

## Recovery outcomes

| Recorded phase | Reviewed recovery action |
| --- | --- |
| `writing` / `rolling-back` | Restore the unfinished write phase where original/new contents can be safely identified. No reviewed removals should have started. |
| `deleting` | Verify completed writes and finish remaining already-approved deletions. This cannot resurrect files deleted earlier. |
| `complete` / `rolled-back` | Remove the finished operation's leftover transaction directory. |
| Missing/corrupt journal or conflicting file | Stop. No guessing, blind directory removal or forced overwrite. Inspect manually using the backup. |

**Automatic recovery is not guaranteed in every interruption window.** In particular, native APIs must create a new file handle before the app can durably record that file's identity. A crash between those steps can leave an empty new file which the next session cannot safely distinguish from an unrelated file. The journal may also fail before its first complete commit. The app deliberately stops rather than delete unknown data. The fault-injection report records these conservative manual-stop cases.

## Manual inspection when automatic recovery stops

Leave the affected card alone and preserve/copy its current contents and manager recovery directory to another drive when possible. Read the named relative path and operation journal against your independent pre-edit backup. Do not publish the journal if it reveals personal filenames.

An incomplete initial journal means the app has no reliable complete operation record. A file conflict means current content did not match the recorded original or new output. Recover originals from your independent backup and reconcile the recorded operation as a whole. Only remove a **specific completed/resolved transaction directory** after confirming every affected path; never blanket-delete `.wii-game-manager` or use recursive deletion on game folders.

This document intentionally does not give a one-click forced cleanup command. A forced cleanup can destroy the only backup or erase evidence needed to recover correctly. A damaged card or corrupt underlying filesystem requires appropriate storage recovery outside this app.

## Tracked package backups vs transaction backups

`.wii-game-manager/backups/<hack-id>/...` holds originals for later package removal. These survive a successful package install. `manifest.json` identifies the tracked package and those originals. Keep them together.

`.wii-game-manager/transactions/<transaction-id>/...` is temporary recovery state for an Apply attempt. A normal successful Apply removes that one transaction directory. Persistent package backups are not the same as short-lived transaction backups.

## Boundaries of testing

The release verifies real multi-gigabyte disk copying using a Node adapter, synthetic filesystem disconnections, and browser UI with simulated file handles. These cannot prove native browser fsync durability or physical SD/Wii behavior. Always test on a copy first. Read [TEST-REPORT.md](../TEST-REPORT.md).
