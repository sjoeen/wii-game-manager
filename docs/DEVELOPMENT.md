# Development and verification

## Build and preview

Node 22+; the build and Node tests have no npm dependencies. JSZip is vendored, not fetched at runtime.

```sh
npm run build
npm run verify
npm run start:pages
```

`build.mjs` deterministically combines the source modules into two identical self-contained pages (`index.html`, `Wii-SD-Manager.html`), writes a relative-module `dev.html`, generates `UPLOAD-GUIDE.md` from shared requirements, and retains `.nojekyll`. `check:build` compares bytes and fails rather than silently publishing a stale entry page. Source changes belong in the modules/template, not generated HTML.

## Architecture

The app has two storage models with a shared inventory/edit interface:

- `ArchiveModel` in `model.js`: legacy JSZip editor. Full output is accumulated; its combined ZIP32/safety and memory limits still apply. Never remove those checks and present it as a streaming solution.
- `FolderModel` in `folder-model.js`: current files + original snapshot + lazy source handles. Staged changes clone maps, not game data. `plan()` enumerates exact writes/deletes and space estimates. No combined 4 GiB cap. Metadata is scanned serially for predictability; games are not decompressed/read at listing time. Directory enumeration has a 200,000-entry guard, not a game-size budget.
- `disk-io.js`: maximum 4 MiB copy/checksum buffers, awaited writes for backpressure, read-back size/CRC32, explicit file-only deletes, durable journals, disk-backed replacement rollback, conservative recovery. Journal maximum: 16 MiB / 50,000 combined operations per Apply; apply huge file counts in smaller batches.
- `app.js`: UI owns selection, pending changes, busy state, dialogs, native permission requests on final user activation and same-origin Web Lock. It always rereads the real folder after an operation and blocks stale/recovery views. Errors never turn a partial operation into success.
- `core.js`: path normalization, detection, manifests, and ZIP/game helpers. Game grouping intentionally excludes neighboring notes/saves.

The document's feature check requires a secure context, `showDirectoryPicker` and `navigator.locks`. OS read/write permissions are requested, not bypassed. A folder name is not proof of console-side homebrew installation. The controller has no blank-library constructor/entry point, although internal empty-archive regression tests remain useful for ZIP edge cases.

### Byte splitting

A source WBFS over the FAT32 per-file maximum is represented by lazy source slices of at most 2 GiB. The source is not mutated. Numbered parts are raw byte-contiguous ranges; concatenating in `.wbfs`, `.wbf1`, `.wbf2` order must hash identically to the source. The implementation checks WBFS magic for this oversized path but is **not a full game-image validator or ISO converter**. GameCount, good CRC or header magic alone do not establish a playable game.

### Package behavior

The small package ZIP path remains JSZip-based. Folder mode limits compressed file and uncompressed package totals to 256 MiB. Outputs/backup entries are lazy until copy; each package entry may still be inflated as a Blob, unlike the bounded game path. Manifest/backups retain compatibility with tracked older ZIP archives. Reserved manager metadata cannot be supplied by a mod ZIP.

### Transaction caveats

No multi-file atomicity, full-card free-space API, applied-delete Undo or operating-system-wide lock exists here. `size + lastModified` checks are best effort, not tamper resistance. Native writers can require temporary storage. Read-back CRC32 is for accidental copy corruption. Recovery stops on unidentifiable targets/corrupt journals instead of forcing cleanup. See [Safety and recovery](SAFETY-AND-RECOVERY.md).

## Test suites

### Node/model/site

```sh
npm run verify
```

Covers ZIP parser/CRC/limits, path safety, scanner/manifest behavior, zero-detected-game edge cases, upload requirements, UI source wiring, folder plans/streaming/error injection and actual static HTTP responses under both `/` and `/wii-game-manager/`. It also rebuilds in a fresh temporary directory to catch omitted modules or stale output. These tests use synthetic files, not playable content.

### Browser interaction

```sh
python -m pip install -r requirements-test.txt
python -m playwright install chromium
npm run test:browser
```

Set `CHROMIUM_PATH` to an installed executable when needed. The suite loads the exact production HTML through `set_content`. A **test-only** MemoryFS supplies directory/file handles, user-permission outcomes and Web Locks; a test feature flag and UUID helper account for its non-secure blank test document. This does not grant native filesystem permissions or change browser policies. Input file selectors, dialogs, events, Blob ZIP output, downloads and layout run in real Chromium. The simulated disk API means these tests are **not native folder-picker integration coverage**.

`docs/test-results/browser-v3.json` records scenario names and errors/network requests. The screenshots use synthetic test entries; `folder-large-library.png` depicts simulated 3 GiB inventory, not copyrighted game files.

### Native launch probe

```sh
npm run test:launch
```

Attempts actual HTTP/`file://` navigation without feature mocks or policy changes. On an unrestricted machine it checks startup and actual API availability (not OS chooser interaction). Policy-blocked attempts are recorded explicitly and exit with a non-success status. The release environment blocked direct navigation; this is not reported as a passing native integration test. Use the manual checklist below on a normal desktop.

### Actual large-file disk suite

```sh
npm run test:large
```

Runs Node with a **192 MiB JavaScript heap ceiling**. Requires roughly **8 GiB temporary disk space**; do not point it at a real card. Uses OS temporary paths, creates synthetic sparse source files and deletes its temporary directory in `finally`.

It scans eight 3 GiB sparse files (24 GiB logical inventory), streams an actual 2.03125 GiB file, and splits/copies an actual 5 GiB WBFS-shaped file into 2+2+1 GiB outputs. Outputs are read back for CRC32 by the app; an independent SHA-256 pass checks source/output equality, including ordered concatenation of split parts. Reports maximum write size, sampled process RSS and timing. The data are synthetic and do not test gameplay or a native FAT32 card.

The test-only Node adapter uses positional bounded reads and temp-file replacement to exercise the same production engine through a File System Access-shaped interface. Node's `fs.openAsBlob` returned a truncated size for a 5 GiB sparse file in this environment, so the adapter deliberately does not use it. This is not a claim about browser File objects. Sparse-file enumeration is metadata-only; the copy scenarios actually transfer every byte and materialize output bytes on disk.

### Mutation-boundary disconnect sweep

```sh
npm run test:faults
```

Runs the same mixed add/replace/remove operation with a simulated disconnect at each recorded filesystem mutation boundary, including journal creation/writes/cleanup. Reconnects and attempts recorded recovery. It checks unrelated saves/apps/notes remain intact and originals/new data match the appropriate outcome. Manual-review stops for ambiguous new-file identity or absent initial journals are intentional safeguards, recorded individually. This test adapter is not proof of OS fsync or actual device power-loss behavior.

## Manual native-folder acceptance checklist

Use a normal supported desktop browser, the top-level HTTPS site or localhost, and **a copied card/test directory** only.

1. Extract `demo/Demo-SD-card.zip` into a normal test folder. Those are placeholders, not actual homebrew/games; do not put them on a Wii.
2. Open SD / USB. Verify the native chooser appears and selects that folder. Check that no file changed and the inventory appears.
3. Add the two `New-Game [DEME03]` files together. Review/cancel once and check the directory is still untouched.
4. Apply, grant native write permission, wait for verification/report, then independently compare output bytes in your file manager/hash tool.
5. Remove the new game, review/apply, and confirm only its main/split files disappeared. Original config/app files remain.
6. Add/remove `Demo-add-on.zip` and confirm `config/keep-me.txt` is restored. Keep/remove outer folder exactly as previewed.
7. Test Cancel on a disposable large local source and verify no success claim or missing unrelated file. Do **not** intentionally unplug a valuable card to test recovery.
8. Only then repeat on a backup of your real game library, check actual loader behavior on the Wii, and preserve originals until satisfied.

## CI and maintenance

`.github/workflows/checks.yml` runs `npm run verify` and the fault sweep with read-only repository permissions. It does not deploy Pages, handle SD data or need secrets. A manual workflow option can run large temporary-disk tests. Browser installation/testing is optional locally; no Playwright/runtime dependency is shipped into the public app.

After source changes, rebuild, run relevant tests, update the test report with actual results and regenerate release checksums. Do not carry old passing reports forward as proof of a new build. Test output generation may change report files; the release checksum list describes packaged bytes, not a mutable dev checkout.
