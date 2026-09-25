# Security and data safety

This application can modify/delete files in a folder you authorize. Test on a copy and maintain an independent backup. It is not an emulator, installer, formatter, recovery utility for damaged media or source of games.

## Safeguards in this release

- User-selected directory handles; read first, explicit reviewed write permission on Apply.
- No background apply, automatic folder reopening or server uploads.
- Strict relative-path validation, case-collision checks and protection of manager-owned paths from mod packages.
- Exact main/split game removal paths, never recursive game-folder deletion.
- Preflight file-count/size/modification checks and same-origin Web Lock coordination.
- Bounded 4 MiB game-copy buffers, awaited writes and output size/CRC32 checks.
- Journal-first operations, disk-backed replacement rollback and conservative interrupted-operation recovery.
- A final deletion checkpoint: applied deletes are permanent, not inaccurately advertised as undoable.
- ZIP parser/structure/limits checks, maximum folder-mode mod package size, escaped file names and no execution of archive content.

These are risk reductions, not guarantees against malicious local edits, disk failure or every power-loss window. Native writers may need extra temporary space. CRC32 checks accidental corruption, not authenticity. Metadata conflict checks cannot prevent all same-size/timestamp races. The same-origin Web Lock does not lock other applications or other websites. Corrupt/missing journals and unknown files can require manual backup-based recovery.

## Reporting a problem

Report the version, browser/OS, folder vs ZIP mode, exact action, error text and a minimal synthetic reproduction. Include a redacted operation report when useful. Do not upload copyrighted game data, personal saves, credentials, whole card images or unredacted journals. For a security issue with real private data or exploit detail, contact the repository owner privately instead of posting that information publicly; no security contact address is invented in this package.

Preserve the card and recovery folder before experimenting with cleanup. Do not delete `.wii-game-manager` blindly: it may contain originals needed to restore a package. Read [Safety and recovery](docs/SAFETY-AND-RECOVERY.md) and [Test report](TEST-REPORT.md).
