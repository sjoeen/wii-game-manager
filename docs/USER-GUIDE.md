# User guide — folder-first Wii Game Manager v3

## What the tool is

This website manages files for an **existing** Wii setup. It does not emulate the Wii, install homebrew, install WADs/channels, format a card, download games, apply raw binary patches, or prove that your console has the right loader/cIOS. Use files you are entitled to use and instructions appropriate to your existing setup.

The Wii-style home menu is the entry screen. After opening a folder/ZIP, the site switches to a separate game-library screen. The Games tab displays detected Wii games; ROM Hacks displays recognized Riivolution/tracked packages; All Files is a read-only inventory. Unknown files are not discarded just because the scanner does not understand them.

## Select the correct folder

Connect your card to the computer. Make a separate backup first. Click **Open SD / USB**, then choose the root that directly contains your Wii folders, for example:

```text
Wii-card-backup/
  apps/
    usbloader_gx/
      boot.dol
  wbfs/
    My Game [ABCE01]/
      ABCE01.wbfs
      ABCE01.wbf1
  config/
  private/
```

Choose `Wii-card-backup`, not its parent and not only `apps`. It is equally possible to select the actual removable card when the browser allows it. A normal computer backup folder is safer for initial tests. The app only sees the handle you selected, not arbitrary paths elsewhere on the computer.

The Start empty library feature is removed. A blank or obviously unrelated folder is refused. **Existing homebrew/app/loader folders with zero games are supported**, because adding a first game is a normal use of an already-prepared card. Recognizing folder names is not proof of homebrew installation on the console.

## Inventory and pending edits

Opening the folder reads names, sizes and file metadata, not all game bytes. The size shown is the sum of visible files, not a measurement of the card's total/free capacity. The app cannot reliably query remaining free space on the selected SD card. Known OS-maintained folders are skipped explicitly and not edited.

Games are detected under `/wbfs` from `.wbfs`/`.iso` names. A folder or filename with its correct six-character ID makes naming clearer, for example `My Game [ABCE01].wbfs`. There is no game database lookup or cover-art download. A main game file and its matching `.wbf1`, `.wbf2` parts are grouped together. Unrelated notes and saves in the same directory are not grouped for deletion.

After Add/Remove, the library is a preview of the **pending plan**. The badge says Pending · not applied. The disk is not changed yet. Undo reverses the most recent pending edit only. Discard staged asks for confirmation, rereads the folder and discards all pending edits. Closing or reloading loses an unapplied plan; the app warns before leaving. Source files must remain available until copying completes.

## Add a game

Select actual Wii `.wbfs` or `.iso` files with Add game; not an archive. For an existing split game, select the main `.wbfs` plus **every matching part at once**, numbered consecutively from `.wbf1`. Gaps, duplicate IDs/paths and missing main files are rejected rather than silently overwritten.

New files are staged under a `wbfs/<title [ID]>/` path. The destination is shown in the review before copying. Existing capitalization is respected. A newly added game clears the previous search filter so the game cannot appear to be missing merely because of an old search.

The current write policy targets FAT32-compatible files even on a computer/USB folder with a different filesystem. The maximum single-file write is 4,294,967,295 bytes. **This is a per-file rule, not a cap on the whole library.**

An oversized single `.wbfs` with a WBFS header is copied as contiguous parts of at most **2 GiB**: main `.wbfs`, then `.wbf1`, `.wbf2`, etc. The source is unchanged. For a 5 GiB source, the parts are 2 + 2 + 1 GiB. This is splitting bytes of an existing WBFS file, not creating a WBFS image from an ISO or validating gameplay. Loader compatibility and a real game on your Wii still need checking.

An oversized `.iso` is refused with a clear explanation. It must first be converted to an appropriate WBFS image using a suitable external tool. Changing the extension or zipping the ISO is not conversion. This release does not implement ISO-to-WBFS conversion, filesystem formatting or exFAT/NTFS-specific policies.

## Remove a game

Click Remove on the game card. Review the listed files and confirm. They are now pending removals, not yet deleted. Undo can restore the pending entry before Apply.

Apply removes only the explicit main/companion paths, never recursively removes the game directory. Empty directories may remain, which is harmless and avoids accidentally deleting neighboring content. **Applied removals do not go through the app's Undo or a guaranteed Recycle Bin.** They require your backup to restore.

## Apply changes

Click Apply changes or Review & apply. Check the selected folder name, relative write/removal paths, count, size and estimated extra disk space. The estimate is deliberately conservative; it is not actual free-space detection. Replacing files and browser temporary writes require extra space.

Check the acknowledgement and click Apply to selected folder. Grant write permission. The app rereads the inventory and stops if files changed since selection. It acquires a same-origin Web Lock so two tabs of this manager do not apply at once. This cannot coordinate other applications—do not edit the same folder elsewhere during Apply.

A recovery journal is written first. Existing targets that will be replaced are backed up on disk. The app copies game bytes in bounded chunks and reads each output back to verify its size and CRC32. Only after the write phase succeeds and deletion targets are rechecked does permanent removal begin.

Cancel copy & roll back is available during reversible copying. Cancellation stops at a safe asynchronous boundary, rolls back writes and skips reviewed removals. After the deletion checkpoint the cancel control is hidden; interrupting then cannot resurrect files already removed. Wait for the operation report, not just a 100% progress bar. Save operation report produces a local JSON record of that reviewed operation.

On a nearly full card, new copies may need room **before** removed files free space. Apply a removal-only batch separately when necessary, after confirming you have a backup. Even removal-only work needs a small recovery journal and is not guaranteed on a completely full/unwritable card.

## ROM hacks

Add ROM hack takes one complete **SD-ready ZIP**, not a raw `.bps`, `.ips` or `.xdelta` patch. Review outer-folder stripping and each destination/replacement. In folder mode both the compressed input and uncompressed package are capped at **256 MiB**. Large ready-patched Wii games belong in Add game instead. The package ZIP path still uses memory; it is intentionally separate from the large-game copy path.

Tracked packages record all owned paths and keep originals under `.wii-game-manager/backups`. Removing that package stages restoration of those original files and removal of the package's additions/backups. Overlapping managed packages are refused. Do not manually delete the manager manifest/backups while you still need tracked removals.

Untracked Riivolution recognition is deliberately conservative: its XML and an obvious same-name folder can be removed, but assets elsewhere remain. The website does not infer every modpack's dependencies or uninstall arbitrary app setups. A hack can be added when there are no game cards, but it may still need an original disc/base game and appropriate loader to run.

## Recovery and errors

A lost drive, permission error, quota failure or failed checksum is reported as an error/cancel/rollback/recovery—not success. Reopen or Refresh the same folder after reconnecting. Normal editing is blocked while a recorded recovery is unresolved. Review its explanation and paths before running recovery.

During an unfinished write phase recovery tries to restore originals/remove verified new copies. After the deletion checkpoint it finishes the already-reviewed removals; it cannot undo those already made. If a file changed externally, a journal is corrupt, or a newly created file cannot be safely identified, recovery stops for manual inspection. Never blindly delete `.wii-game-manager` or a conflicting game file. [Detailed safety and manual recovery](SAFETY-AND-RECOVERY.md).

## ZIP fallback

Open small ZIP instead accepts one ZIP containing an existing card layout. A wrapper folder can be removed after confirmation. The editor keeps the original ZIP unchanged and exports a new edited archive. Unlike folder mode, all content must fit below approximately **4 GiB combined**, and memory can fail well below that.

Use it for small mod/homebrew archives, not a whole 32 GB collection. Simply copying an exported ZIP's contents over the old card **will not delete files removed in the manager**. Extract separately and reconcile deliberately. ZIP import and folder mode cannot be mixed in the same open library.

Try ZIP demo uses non-playable placeholder files. The downloadable demo files are test fixtures, not games or working homebrew. Do not put them on a real Wii.

## Supported scope

The UI is responsive, but responsive layout is not a promise of native SD-folder support on every phone. The site feature-detects the required APIs and should be opened directly via HTTPS in a supported browser. Unsupported browsers retain the small-ZIP interface. No user data is uploaded by application code. A hosted page still makes the ordinary initial page request to its hosting service; see [privacy](../PRIVACY.md).

## Technical references

The FAT32 per-file/volume distinction is documented by Microsoft: https://learn.microsoft.com/en-us/windows/win32/fileio/filesystem-functionality-comparison

Browser selection/streaming/permissions: https://developer.chrome.com/docs/capabilities/web-apis/file-system-access and https://developer.mozilla.org/en-US/docs/Web/API/Window/showDirectoryPicker
