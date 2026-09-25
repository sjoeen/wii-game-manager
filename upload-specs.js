/**
 * File requirements used by the landing page, library, information panel,
 * pickers, and upload validation. This describes what the editor accepts;
 * it does NOT claim to validate Wii compatibility or game integrity.
 * HTML in the copy below is developer-authored, never archive content.
 */
export const UPLOAD_SPECS = {
  folder: {
    label: 'Open SD / USB folder', formats: 'Folder', input: null, choose: 'Choose existing Wii folder',
    summary: 'Select the root folder of your existing homebrew SD/USB card, or a backup of that folder. Do not ZIP it.',
    hint: 'Open the folder containing apps, wbfs, or your loader files. This is not an empty-card installer.',
    paragraphs: [
      'Use a browser with directory-picker support, such as a current desktop Chrome or Edge, on HTTPS or localhost. The app checks support and permissions. A browser permission prompt is separate from the app’s final Apply confirmation.',
      'Folder mode lists filenames and sizes without reading the whole game library. Additions are streamed in <strong>4 MiB chunks</strong>, then read back for CRC32 verification. There is no combined 4 GiB limit on this mode.',
      'Choose the card’s root, <strong>not the apps or wbfs subfolder</strong>. A root containing homebrew but no games works. This manager does not set up a blank card or install homebrew.',
      'Edits are pending until <strong>Review &amp; apply → Apply to selected folder</strong>. Pending edits can be discarded; applied removals are permanent. Keep a separate backup and do not unplug the drive. Small-ZIP mode below is a separate memory-limited fallback.'
    ],
    exampleTitle: 'Select the existing Wii SD or USB root (a backup folder also works)',
    example: 'Wii SD card/  ← select this folder\n├── apps/\n│   └── your-loader/\n│       └── boot.dol\n├── wbfs/\n│   └── My Game [RMCE01]/\n│       └── RMCE01.wbfs\n└── riivolution/',
    after: 'Folder markers identify a plausible Wii layout, not proof that homebrew is installed or a game will run. No card is formatted and no Wii system software is changed.'
  },
  sd: {
    label: 'Open small SD-card ZIP',
    formats: '.zip',
    input: 'zipInput',
    choose: 'Choose SD-card ZIP',
    accept: '.zip,application/zip',
    multiple: false,
    summary: 'One .zip containing your SD-card files and folders. Zero games is OK.',
    hint: 'Choose one .zip of your SD-card contents—not an individual game. Existing apps/settings archives with no games work too. For full libraries, use Open SD / USB folder.',
    paragraphs: [
      'Make a ZIP of the <strong>files and folders on your SD card</strong>, keeping their layout. There is no special “SD file” to upload. Your card may contain <code>apps/</code>, <code>wbfs/</code>, <code>riivolution/</code>, and other folders; <strong>keep the existing Wii layout</strong>.',
      'Existing Wii games are listed when their <code>.wbfs</code> or <code>.iso</code> files are inside <code>wbfs/</code>. An SD ZIP with no games still opens a usable library. Other files are kept, even when the manager does not recognize them.',
      'Put the SD folders at the ZIP’s root. A recognizable outer folder such as <code>SD-card/apps/</code> triggers a <strong>Use folder contents</strong> prompt. Review that choice rather than rearranging a mod’s internal folders.',
      'Choose a real <code>.zip</code>, not a <code>.rar</code>, <code>.7z</code>, or raw card image such as <code>.img</code>. Nested ZIPs are kept as files, not automatically unpacked. A zero-byte file renamed <code>.zip</code> is not an empty ZIP. For full cards, open the existing folder directly instead of making a ZIP.'
    ],
    exampleTitle: 'Example only — keep your existing card layout',
    example: 'SD-card.zip\n├── apps/\n│   └── your-app/\n│       ├── boot.dol\n│       └── meta.xml\n├── wbfs/\n│   └── My Game [RMCE01]/\n│       └── RMCE01.wbfs\n└── riivolution/\n    └── YourMod.xml',
    after: 'No games, apps, loaders, or system software are installed just by opening a library.'
  },
  game: {
    label: 'Add Game',
    formats: '.wbfs / .iso',
    input: 'gameInput',
    choose: 'Choose game files',
    accept: '.wbfs,.iso,.wbf1,.wbf2,.wbf3,.wbf4,.wbf5,.wbf6,.wbf7,.wbf8,.wbf9',
    multiple: true,
    summary: 'Select Wii .wbfs or .iso files directly. For split WBFS, select the .wbfs and every matching numbered part together.',
    hint: 'Wii .wbfs or .iso files, not ZIPs. Split game? Select its .wbfs + matching .wbf1, .wbf2, … together.',
    paragraphs: [
      'Choose one or more <strong>Wii game backup files</strong> already in <code>.wbfs</code> or <code>.iso</code> format. Select the game files themselves, <strong>not a ZIP, RAR, folder, or website link</strong>. Extract a compressed game package on your computer first.',
      'For a split WBFS, select the main <code>.wbfs</code> and <strong>every matching part in the same selection</strong>. Names before the extension must match, and part numbers must start at <code>.wbf1</code> with no gaps. A numbered part on its own is not a complete game. The picker lists <code>.wbf1</code> through <code>.wbf9</code>; use its “All files” option for later parts when available.',
      'Prefer a filename like <code>My Game [RMCE01].wbfs</code>, using <strong>your game’s actual six-character ID</strong>. The ID is optional, but names and IDs come from filenames, not game-header parsing. It creates the destination under <code>wbfs/</code> for you; you do not need that folder beforehand.',
      'Folder mode splits an oversized WBFS with a WBFS signature into byte-contiguous parts of at most 2 GiB for FAT32. It does not convert ISO to WBFS, apply patches, or verify playability. Oversized ISOs need conversion outside this tool first; ZIP fallback does not split files. A patched game already in <code>.wbfs</code> or <code>.iso</code> goes here too. Emulator ROMs, <code>.wad</code>, and homebrew <code>.dol</code>/<code>.elf</code> files are not Add Game inputs.'
    ],
    exampleTitle: 'One game, or its matching split set',
    example: 'My Game [RMCE01].wbfs\nMy Game [RMCE01].wbf1  ← only if supplied\nMy Game [RMCE01].wbf2  ← only if supplied\n\nOr select an unsplit Wii image:\nMy Game [RMCE01].iso',
    after: 'The names and ID above are illustrations, not game files. Use your own files and do not invent or copy an ID just to make it appear valid.'
  },
  hack: {
    label: 'Add ROM Hack',
    formats: '.zip',
    input: 'hackInput',
    choose: 'Choose ROM-hack ZIP',
    accept: '.zip,application/zip',
    multiple: false,
    summary: 'One SD-ready .zip package: files and folders already arranged as the mod’s author says to copy them onto the SD card.',
    hint: 'One SD-ready .zip package with the mod’s complete files and folders. This merges files; it does not apply raw patches.',
    paragraphs: [
      'Choose <strong>one SD-ready ZIP package</strong>: the mod’s complete files, already arranged in the folders its author says to put on the SD card. A Riivolution package normally includes its XML configuration and the files it references. The manager previews the destination paths before you confirm.',
      'Keep the mod’s own filenames and layout. The example below is illustrative, <strong>not a folder structure to impose on every hack</strong>. Only remove an outer download folder when the preview shows the intended SD-root paths. A ZIP with no files cannot be added as a hack.',
      'This is a <strong>file merger, not a patcher or installer</strong>. Raw <code>.bps</code>, <code>.ips</code>, or <code>.xdelta</code> patches are not applied, and <code>.wad</code> files are not installed—even if you put them inside a ZIP. Follow the author’s patching/setup instructions outside this tool first. A ready-patched <code>.wbfs</code> or <code>.iso</code> belongs in <strong>Add Game</strong>.',
      'Adding a package works with zero games in the library. It does not supply a base game, disc, loader, or homebrew setup. The mod can still require those, a particular game region/version, and additional setup on your Wii; this editor does not verify compatibility.'
    ],
    exampleTitle: 'Illustrative SD-ready layout — follow the mod’s own instructions',
    example: 'My-Mod.zip\n├── riivolution/\n│   └── My-Mod.xml\n└── My-Mod/\n    └── (files referenced by the XML)',
    after: 'Check every Add / Replace path before confirming. Replaced files are backed up in the selected storage for removal/restoration later. Folder-mode mod ZIPs have separate 256 MiB compressed-input and uncompressed-package limits; use Add Game for large patched games.'
  }
};

/** Lightweight picker validation; ArchiveModel still validates ZIP data/paths and game grouping. */
export function validateUploadSelection(kind, selected) {
  const spec = UPLOAD_SPECS[kind];
  if (!spec) throw new Error('Unknown upload type.');
  if (!spec.input) throw new Error('Choose an existing folder using the directory picker, or a supported file input.');
  const files = Array.from(selected || []);
  if (!files.length) throw new Error(`No file selected. ${spec.summary}`);
  if (!spec.multiple && files.length !== 1) throw new Error(`${spec.label}: choose one .zip at a time.`);
  if (files.some(file => !file || typeof file.name !== 'string' || !file.name)) {
    throw new Error('Select a file from your device, not a folder or link.');
  }
  if (kind === 'game') {
    const unsupported = files.filter(file => !/\.(?:wbfs|iso|wbf[1-9]\d*)$/i.test(file.name));
    if (unsupported.length) {
      const names = unsupported.slice(0, 3).map(file => `“${file.name}”`).join(', ');
      throw new Error(`Add Game cannot use ${names}. Choose Wii .wbfs or .iso files directly, plus matching split .wbf1/.wbf2 parts. Extract ZIP/RAR/7z game packages first. Use Open SD / USB folder for an existing card or full-card backup folder, or Add ROM Hack for an SD-ready mod ZIP. Renaming a file does not convert it.`);
    }
    if (!files.some(file => /\.(?:wbfs|iso)$/i.test(file.name))) {
      throw new Error('Select a .wbfs or .iso game. Split .wbf1/.wbf2 parts must be selected together with their matching .wbfs file.');
    }
  } else {
    const file = files[0];
    if (!/\.zip$/i.test(file.name)) {
      const advice = kind === 'sd'
        ? 'Choose one .zip containing the files and folders from your SD card. RAR, 7z, individual games, and raw SD-card images are not SD ZIPs. Existing homebrew cards with zero games are OK. For full libraries use Open SD / USB folder.'
        : 'Choose one SD-ready ROM-hack .zip with the complete mod layout. Raw .bps/.ips/.xdelta patches are not applied, and .wad files are not installed. A ready-patched .wbfs or .iso belongs in Add Game.';
      throw new Error(`Cannot open “${file.name}” here. ${advice} Renaming an extension does not convert a file.`);
    }
    if (file.size === 0) {
      throw new Error(`“${file.name}” is a zero-byte file, not a valid ZIP. ${kind === 'sd' ? 'Choose a real ZIP of your existing homebrew SD-card contents, or use direct folder mode.' : 'Choose a real SD-ready ROM-hack ZIP containing the mod’s files.'}`);
    }
  }
  return files;
}
