# Privacy

Application code has no upload endpoint, analytics, remote game database, telemetry or runtime network requests. It does not execute games, ROM hacks or homebrew files. The public page is static; after its ordinary page request, selected file data is processed locally.

## Folder mode

The browser only exposes a folder selected by the user. Opening reads inventory/manager metadata. Staging retains file handles or File references in the current tab, not a server. Write permission is requested after an explicit review and final Apply click. Applying edits **does write to the selected folder**; it does not upload the data.

The app writes recovery journals and, for tracked packages, manifest/backups under `.wii-game-manager` in that selected folder. Journals and the optional downloaded operation report include relative paths, sizes, checksums, timestamps and folder names. They can reveal personal file names. Keep them private and redact them before sharing a bug report.

The app does not persist folder handles in browser storage or automatically reopen/apply in a future session. The browser may separately remember permissions under its own settings. Unapplied plans are lost when the tab is closed/reloaded. Manager metadata on disk intentionally survives as needed for package removal/recovery.

## Small-ZIP fallback

Files/archives are read locally into browser memory. Export produces a downloadable Blob ZIP. The original selected ZIP is not edited. Blob download links are revoked when replaced/closed. Memory release timing depends on the browser. No SD/game files are committed to GitHub by using the website.

## Hosting and local previews

GitHub Pages (or another host) receives normal page requests and can log visitor metadata under its own policy. “No upload” refers to application behavior, not a promise that a hosting service receives no network request. The local development server serves static files only and binds to localhost.

Test/demo files contain synthetic placeholders. Never upload real game dumps, card backups, saves, tokens or personal operation reports into a public repository. Browser extensions, other software and modified website code are outside this app's privacy guarantees. Trust and review a deployment before giving it write access to a valuable folder.
