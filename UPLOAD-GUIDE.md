# Wii SD Manager v3.0.0 — which files to choose

Everything is processed on your device. The controls accept different inputs. Renaming a file does not convert its format.

## Open SD / USB folder: Folder

Select the root folder of your existing homebrew SD/USB card, or a backup of that folder. Do not ZIP it.

Use a browser with directory-picker support, such as a current desktop Chrome or Edge, on HTTPS or localhost. The app checks support and permissions. A browser permission prompt is separate from the app’s final Apply confirmation.

Folder mode lists filenames and sizes without reading the whole game library. Additions are streamed in **4 MiB chunks**, then read back for CRC32 verification. There is no combined 4 GiB limit on this mode.

Choose the card’s root, **not the apps or wbfs subfolder**. A root containing homebrew but no games works. This manager does not set up a blank card or install homebrew.

Edits are pending until **Review &amp; apply → Apply to selected folder**. Pending edits can be discarded; applied removals are permanent. Keep a separate backup and do not unplug the drive. Small-ZIP mode below is a separate memory-limited fallback.

**Select the existing Wii SD or USB root (a backup folder also works)**

```text
Wii SD card/  ← select this folder
├── apps/
│   └── your-loader/
│       └── boot.dol
├── wbfs/
│   └── My Game [RMCE01]/
│       └── RMCE01.wbfs
└── riivolution/
```

Folder markers identify a plausible Wii layout, not proof that homebrew is installed or a game will run. No card is formatted and no Wii system software is changed.

## Open small SD-card ZIP: .zip

One .zip containing your SD-card files and folders. Zero games is OK.

Make a ZIP of the **files and folders on your SD card**, keeping their layout. There is no special “SD file” to upload. Your card may contain `apps/`, `wbfs/`, `riivolution/`, and other folders; **keep the existing Wii layout**.

Existing Wii games are listed when their `.wbfs` or `.iso` files are inside `wbfs/`. An SD ZIP with no games still opens a usable library. Other files are kept, even when the manager does not recognize them.

Put the SD folders at the ZIP’s root. A recognizable outer folder such as `SD-card/apps/` triggers a **Use folder contents** prompt. Review that choice rather than rearranging a mod’s internal folders.

Choose a real `.zip`, not a `.rar`, `.7z`, or raw card image such as `.img`. Nested ZIPs are kept as files, not automatically unpacked. A zero-byte file renamed `.zip` is not an empty ZIP. For full cards, open the existing folder directly instead of making a ZIP.

**Example only — keep your existing card layout**

```text
SD-card.zip
├── apps/
│   └── your-app/
│       ├── boot.dol
│       └── meta.xml
├── wbfs/
│   └── My Game [RMCE01]/
│       └── RMCE01.wbfs
└── riivolution/
    └── YourMod.xml
```

No games, apps, loaders, or system software are installed just by opening a library.

## Add Game: .wbfs / .iso

Select Wii .wbfs or .iso files directly. For split WBFS, select the .wbfs and every matching numbered part together.

Choose one or more **Wii game backup files** already in `.wbfs` or `.iso` format. Select the game files themselves, **not a ZIP, RAR, folder, or website link**. Extract a compressed game package on your computer first.

For a split WBFS, select the main `.wbfs` and **every matching part in the same selection**. Names before the extension must match, and part numbers must start at `.wbf1` with no gaps. A numbered part on its own is not a complete game. The picker lists `.wbf1` through `.wbf9`; use its “All files” option for later parts when available.

Prefer a filename like `My Game [RMCE01].wbfs`, using **your game’s actual six-character ID**. The ID is optional, but names and IDs come from filenames, not game-header parsing. It creates the destination under `wbfs/` for you; you do not need that folder beforehand.

Folder mode splits an oversized WBFS with a WBFS signature into byte-contiguous parts of at most 2 GiB for FAT32. It does not convert ISO to WBFS, apply patches, or verify playability. Oversized ISOs need conversion outside this tool first; ZIP fallback does not split files. A patched game already in `.wbfs` or `.iso` goes here too. Emulator ROMs, `.wad`, and homebrew `.dol`/`.elf` files are not Add Game inputs.

**One game, or its matching split set**

```text
My Game [RMCE01].wbfs
My Game [RMCE01].wbf1  ← only if supplied
My Game [RMCE01].wbf2  ← only if supplied

Or select an unsplit Wii image:
My Game [RMCE01].iso
```

The names and ID above are illustrations, not game files. Use your own files and do not invent or copy an ID just to make it appear valid.

## Add ROM Hack: .zip

One SD-ready .zip package: files and folders already arranged as the mod’s author says to copy them onto the SD card.

Choose **one SD-ready ZIP package**: the mod’s complete files, already arranged in the folders its author says to put on the SD card. A Riivolution package normally includes its XML configuration and the files it references. The manager previews the destination paths before you confirm.

Keep the mod’s own filenames and layout. The example below is illustrative, **not a folder structure to impose on every hack**. Only remove an outer download folder when the preview shows the intended SD-root paths. A ZIP with no files cannot be added as a hack.

This is a **file merger, not a patcher or installer**. Raw `.bps`, `.ips`, or `.xdelta` patches are not applied, and `.wad` files are not installed—even if you put them inside a ZIP. Follow the author’s patching/setup instructions outside this tool first. A ready-patched `.wbfs` or `.iso` belongs in **Add Game**.

Adding a package works with zero games in the library. It does not supply a base game, disc, loader, or homebrew setup. The mod can still require those, a particular game region/version, and additional setup on your Wii; this editor does not verify compatibility.

**Illustrative SD-ready layout — follow the mod’s own instructions**

```text
My-Mod.zip
├── riivolution/
│   └── My-Mod.xml
└── My-Mod/
    └── (files referenced by the XML)
```

Check every Add / Replace path before confirming. Replaced files are backed up in the selected storage for removal/restoration later. Folder-mode mod ZIPs have separate 256 MiB compressed-input and uncompressed-package limits; use Add Game for large patched games.

## Size and export limits

Folder mode streams game files in 4 MiB chunks and has no combined 4 GiB limit. FAT32 per-file restrictions still apply; oversized WBFS can be split and oversized ISO requires conversion outside the app. Folder-mode hack ZIPs are limited to 256 MiB uncompressed. Only the ZIP fallback is limited to below approximately 4 GiB combined and may exhaust memory earlier. Folder Apply writes to the selected storage; ZIP Export only creates a new archive. Keep a separate backup. See docs/SAFETY-AND-RECOVERY.md.
