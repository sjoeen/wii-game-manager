# Wii Game Manager v3.0.0 — release verification

Date: 2026-09-25. Repository target: `sjoeen/wii-game-manager`.

## What was verified

| Suite | Result | What it actually exercises |
| --- | --- | --- |
| `npm run verify` | **159 passed, 0 failed** | Deterministic built bytes, shared/ZIP/folder models, validation, staging, failure paths, and real Node HTTP responses under root and project paths. |
| `npm run test:browser` | **46 passed, 0 failed** | Exact production HTML in Chromium 144.0.7559.96; DOM/dialog/file-input/download behavior and responsive UI. Directory handles, picker, permissions and lock outcomes are **simulated test APIs**. |
| `npm run test:large` | **3 scenarios passed** | Actual temporary-disk metadata inventory and complete multi-GiB byte copies through a Node File System Access-shaped adapter. |
| `npm run test:faults` | **147 disconnect boundaries checked** | Simulated disconnect/recovery at every mutation boundary of one mixed operation. Unrelated data preserved; ambiguous states conservatively stopped. |
| Native launch probe | **2 blocked, not passed** | HTTP project URL and portable `file://` startup were blocked by this environment's administrator policy. No policy was bypassed. |

The browser suite recorded **zero uncaught JavaScript errors and zero HTTP(S) requests** while exercising the loaded application. The initial hosted-page request is not part of that set-content test; the real website naturally requires a page request to its host.

## Actual large files, not just fake size counters

The separate disk suite ran Node v22.16.0 with `--max-old-space-size=192` and production copy/plan code through a test-only native disk adapter:

- Scanned **eight actual sparse files of 3 GiB each** (24 GiB logical library), by metadata. Sparse files make inventory testing practical; this scenario did not read 24 GiB of game bytes.
- Copied **2,181,038,080 bytes (2.03125 GiB)** to a new destination, including production read-back CRC32 verification. Independent SHA-256 of the source and output matched.
- Copied **5,368,709,120 bytes (5 GiB)** into `.wbfs`, `.wbf1`, `.wbf2` of **2 + 2 + 1 GiB**. Independent SHA-256 of the ordered concatenation matched the source.

The copy scenarios transferred all source bytes in chunks and wrote actual output files; they were not virtual-size-only assertions. Sources were sparse synthetic data with a WBFS-shaped header/tail marker, **not valid playable games**. Original/source files remained separate from outputs.

Maximum observed write: **4,194,304 bytes (4 MiB)**. Sampled peak **Node process RSS: 103,444,480 bytes (98.7 MiB)**. Latest run duration: **75.23 seconds** on this environment. These numbers are not browser RAM measurements or an SD-card speed promise. Actual browser/OS temporary-file behavior can differ. The test removed its temporary directories afterward.

Raw report and independent hashes: [large-files.json](docs/test-results/large-files.json).

## Browser interaction coverage

The 46 named scenarios cover the preserved Wii menu, all Information exits/focus/Escape/backdrop, menu navigation, file requirements, existing homebrew-only cards, rejected blank/unrelated folders, unavailable/cancelled picker, read-only open, staged additions/removals, review acknowledgement/cancel, Apply, one-step Undo/Discard, exact split grouping, unrelated saves/notes, permissions, simulated quota/cancel/disconnect, recovery review, changed-file preflight, second-tab locking, mod originals restoration, ZIP round-trip downloads independently opened in Python, unsafe ZIP paths, escaped filenames, and desktop/360/390/414 px layouts.

Large folder counters and the oversized-WBFS plan in the browser suite use simulated sizes. The actual-byte tests above are separate. Screenshots show the running production interface with synthetic fixtures; `folder-large-library.png` is not a screenshot of an actual user's game collection.

The compiled page is loaded with `set_content`, because direct navigation is blocked here. Test-only APIs expose a MemoryFS, fake permission responses, a lock stub and a secure-context feature flag/UUID helper. They do not grant native disk access or change browser policy. Thus these tests **do not establish that the native OS directory chooser or browser permission UI works on a physical machine**. A manual native-folder acceptance checklist is included in [Development](docs/DEVELOPMENT.md).

Raw scenario results: [browser-v3.json](docs/test-results/browser-v3.json). Actual navigation outcomes: [launch-probe.json](docs/test-results/launch-probe.json).

## Failure/recovery tests and intentional manual stops

The Node folder cases include content verification, quota/permission failures, cancellation before and during copy, external file changes, missed/malformed journal data, package ownership conflicts and backup restoration. Game removal includes only main/split paths, not unrelated neighbors.

The additional mutation sweep tested **147 simulated interruption points**. After reconnecting: **111** rolled back the reversible phase; **19** finished the reviewed deletion phase; **4** had no remaining journal; **11** intentionally stopped for manual review. Those manual stops involve an absent/incomplete initial journal or a newly created target whose identity had not yet been durably recorded. The app refused to guess ownership and delete a potentially unrelated file. Original settings remained valid and unrelated saves/apps/notes remained unchanged in every tested cut.

This is **not** a claim that every interrupted Apply auto-recovers. Whole operations cannot be atomic; applied removals are permanent; journal/drive failure can require backup-based manual reconciliation. See [Safety and recovery](docs/SAFETY-AND-RECOVERY.md). The sweep is a fake-filesystem event test, not real device power-cut testing.

Raw boundary outcomes: [fault-sweep.json](docs/test-results/fault-sweep.json).

## Changes and fixes checked during this update

- Folder mode does not use the ZIP model's total-library budget or accumulate full game files.
- The empty-card creation feature/demo downloads are absent, while existing homebrew cards with no games work.
- A staged removal cannot recursively erase adjacent notes/saves; multiple main files in one folder remain independent cards.
- Unknown folder changes stop Apply instead of silently replacing the current inventory.
- No file is permanently removed before the copy/read-back phase completes and the deletion checkpoint is committed.
- Failed/partial writes show rollback/recovery states rather than success; recovered inventory is refreshed.
- Information dialog exits still use explicit button handlers, not sandbox-sensitive form submission.
- Published/offline pages rebuild from the included source and use no remote runtime assets.

The first browser-suite run exposed **test-harness errors**, not app failures: a mock-picker assignment was being invoked by Playwright, and two expected size labels used GB rather than the app's GiB. Those expectations/fixture setup were corrected and the complete suite was rerun. A Node large-file adapter also required positional bounded reads rather than `fs.openAsBlob`, which returned a truncated 5 GiB size in this environment. That workaround is confined to test code, not browser production code.

## Not verified / remaining limits

No physical SD/USB card, native FAT32 filesystem, real Wii loader/gameplay, Safari/Firefox implementation, low-memory phone or native directory picker integration was available. No actual GitHub Pages deployment was performed. Standalone `file://` folder support can differ by browser and policy; use top-level HTTPS/localhost for primary testing.

The largest complete copy tested was 5 GiB; metadata scanning covered a 24 GiB library. Larger collections follow the same per-file streaming path, but this is not proof for every card, filesystem, browser or library size. Folder mode still has per-file, entry-count and per-operation journal guards and needs free space. Oversized ISO conversion is not implemented. Mod ZIPs remain capped at 256 MiB compressed/uncompressed, and ZIP fallback remains below approximately 4 GiB combined and potentially much more limited by RAM.

Start on **a separate copy** of your existing card. Do not trust the only copy of saves/games to a tool without an independent backup and native-machine acceptance checks.
