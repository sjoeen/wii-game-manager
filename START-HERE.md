# Start here — publish/update Wii Game Manager v3

**Repository name:** `wii-game-manager`  
**Expected website:** https://sjoeen.github.io/wii-game-manager/

This is a ready-built static site. Nothing has been published or changed on your GitHub account by creating this package.

## Replace the earlier version

Extract the delivered ZIP. Inside it is a folder named `wii-game-manager`. Upload **the contents of that folder** to the root of your `sjoeen/wii-game-manager` repository, replacing the earlier website files. Do not upload the ZIP as your homepage and do not put another `wii-game-manager` folder between the repository root and `index.html`.

Include subfolders and hidden files, especially `.nojekyll` and `.github/workflows/checks.yml`. GitHub Desktop or Git is easiest for preserving hidden files. For a browser upload that omits `.nojekyll`, use Add file → Create new file to create `.nojekyll` at the root. Its contents can be empty. Keep private SD/game files outside the repository.

If starting a new repo, create it under `sjoeen` named exactly `wii-game-manager`; the package already supplies its README and Git files. If you previously created `sjoeen.github.io` just for this app, rename that repo or use a separate project repo. Back up any existing unrelated site before replacing files.

## Enable Pages

In repository **Settings → Pages → Build and deployment**:

| Setting | Value |
| --- | --- |
| Source | Deploy from a branch |
| Branch | main |
| Folder | /(root) |

Save. Wait for the Pages deployment to finish, then use **Visit site**. Keep HTTPS enabled. The checks workflow is validation only: do not select GitHub Actions as the Pages publishing source for this package. If you use a differently named default branch, select that branch and adjust the checks workflow as needed.

No `npm install`, build command, custom domain, API key or backend is required to publish the already-built files. Future source changes require `npm run build` before committing.

## First use of the new folder mode

1. Open the published page itself in current desktop Chrome or Edge, not inside an attachment/iframe preview.
2. First select **a backup copy of your existing Wii card folder** with **Open SD / USB**. The root should contain `apps`, `wbfs` or related Wii folders. Do not select a parent containing several backups or a blank folder.
3. Verify the inventory. Add/remove actions are only pending until **Apply changes**.
4. Review every destination/removal path, grant write permission on the final Apply click, and keep the tab and drive available until completion.
5. Keep a separate backup. Undo is for pending edits only. Applied deletions are permanent.

The Start empty library option is removed. An existing homebrew card with no games can still add its first game. This app does not install homebrew or system channels.

## Local preview

Node 22+ is only needed for development/preview:

```sh
npm run start:pages
```

Open the printed local address, normally `http://127.0.0.1:8080/wii-game-manager/`. A local server is treated differently from opening an HTML attachment in a restricted preview. The app still checks actual browser API availability.

A self-contained `Wii-SD-Manager.html` is included, but native folder access depends on how the browser treats the context. Use HTTPS/localhost for the main folder workflow; the portable copy can demonstrate the ZIP UI.

Read [TEST-REPORT.md](TEST-REPORT.md) before trusting a unique card. Real disk copy tests passed, but the supplied browser suite uses simulated folder handles; no physical Wii/card was available for validation.

More: [deployment](docs/DEPLOYMENT.md), [user guide](docs/USER-GUIDE.md), [recovery](docs/SAFETY-AND-RECOVERY.md).
