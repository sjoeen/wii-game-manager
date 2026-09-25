# Changelog

## 3.0.0 — folder-first release

- Replaced the main ZIP channel with Open SD / USB while preserving the Wii-style menu and library UI.
- Added metadata-only existing-folder inventory and staged disk plans without the whole-library ZIP32 cap.
- Added 4 MiB bounded game copies, read-back CRC32/size verification, FAT32-safe limits, contiguous oversized-WBFS splitting, and explicit oversized-ISO conversion guidance.
- Added review/acknowledgement, final user-gesture write permission, same-origin apply lock, pending Undo/Discard, Refresh, cancellation, operation report and journal-based recovery.
- Added disk-backed replacement rollback and persistent tracked-package originals; folder-mode package ZIPs are limited to 256 MiB compressed/uncompressed.
- Removed Start empty library, empty-card demo downloads and blank-card installer workflow. Existing homebrew cards with zero games still work.
- Narrowed game deletion to main files and matching split companions; unrelated adjacent notes/saves are preserved.
- Retained small-ZIP import/export as a clearly limited fallback and kept safe explicit Information dialog exits.
- Added real large-file disk tests, simulated mutation-boundary disconnect sweep and current browser UI coverage.
- Updated all publishing, user, privacy, recovery and developer documentation for repository `wii-game-manager`.

### Important limits

Native browser picker / physical SD-card / Wii gameplay acceptance was not available in the release environment. Current UI tests use simulated directory APIs; actual large byte copies use a separate real-disk Node adapter. Interrupted multi-file operations are not fully atomic, and some ambiguous recovery windows intentionally require manual review. No claim of unlimited storage or perfect recovery is made.

## Previous releases

2.x introduced the Wii-menu UI, explicit Information dialog exits, game/hack/ZIP management, zero-game inventory handling and upload help. Those versions were **in-memory ZIP editors**, not large-card folder managers. Old test counts and screenshot bundles are not reused as proof for this release.
