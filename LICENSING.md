# Licensing and third-party notices

## Application code

This packaging update does not choose an application-wide license on the repository owner's behalf. `package.json` is marked `UNLICENSED` and `private: true` as publishing metadata. That flag is not a website access control; the static files can still be hosted on a public GitHub Pages site.

The repository owner can select an appropriate application license and add a `LICENSE` file before inviting reuse or outside contributions. Publishing and deployment do not require changing the bundled third-party license notices.

## Bundled ZIP library

The repository contains the existing JSZip 3.10.1 distribution in `vendor/jszip.min.js`. Its original notices are preserved. `vendor/THIRD-PARTY-NOTICES.txt` includes the bundled distribution's MIT-option notices for JSZip and its included components. The same notices are embedded in both generated standalone pages. Keep those notices when redistributing the bundled code.

Upstream source: https://github.com/Stuk/jszip/tree/v3.10.1

## Artwork and samples

The supplied interface uses CSS and vector UI elements. No Nintendo game files, original channel artwork, console font files or sound effects are included. The archives and game-extension files in `demo/` contain only small synthetic, non-playable samples.

"Wii" describes the target system. This project is not affiliated with or endorsed by Nintendo. No ownership of Nintendo's names or branding is asserted.
