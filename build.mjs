/**
 * Dependency-free, deterministic build.
 * The public entry page is self-contained so a GitHub Pages deployment has no
 * runtime package install, CDN, module-path, or asset-base configuration.
 * Edit the source files, not the generated HTML; run `npm run build` afterward.
 */
import {readFile, writeFile} from 'node:fs/promises';
import {UPLOAD_SPECS} from './upload-specs.js';

const read = name => readFile(new URL(name, import.meta.url), 'utf8');
const args = process.argv.slice(2);
if (args.some(arg => arg !== '--check')) throw new Error('Usage: node build.mjs [--check]');
const check = args.includes('--check');
const {version} = JSON.parse(await read('package.json'));
function replaceOnce(text, marker, value) {
  if (text.split(marker).length !== 2) throw new Error(`Build marker missing or duplicated: ${marker}`);
  return text.replace(marker, () => value);
}
const blank = '<div class="channel-slot" aria-hidden="true"><div class="channel empty-channel"></div></div>';
let template = await read('template.html');
template = replaceOnce(template, '<!-- EMPTY_CHANNELS -->', blank.repeat(10));
template = replaceOnce(template, '<!-- EXTRA_PAGES -->', [2,3,4].map(n =>
  `<div class="channel-page" id="channelPage${n}" role="group" aria-label="Menu page ${n} of 4" hidden>${blank.repeat(12)}</div>`).join('\n'));
// These modules use simple named exports and static imports only.
const strip = source => source.replace(/^import[^;]+;\s*/gm, '').replace(/^export /gm, '');
const js = (await Promise.all(['core.js','model.js','disk-io.js','folder-model.js','upload-specs.js','app.js'].map(read))).map(strip).join('\n\n');
const [css, vendor, notices] = await Promise.all(['styles.css','vendor/jszip.min.js','vendor/THIRD-PARTY-NOTICES.txt'].map(read));
const escapeScript = source => source.replace(/<\/script/gi, '<\\/script');
let single = replaceOnce(template, '<link rel="stylesheet" href="styles.css">', `<style>\n${css}\n</style>`);
single = replaceOnce(single, '<script src="vendor/jszip.min.js"></script>', `<script>\n/*!\n${notices}\n*/\n${escapeScript(vendor)}\n</script>`);
single = replaceOnce(single, '<script type="module" src="app.js"></script>', `<script>\n(()=>{\n'use strict';\n${escapeScript(js)}\n})();\n</script>`);
const markdown = html => html.replace(/<strong>(.*?)<\/strong>/g, '**$1**').replace(/<code>(.*?)<\/code>/g, '`$1`');
const guide = `# Wii SD Manager v${version} — which files to choose\n\nEverything is processed on your device. The controls accept different inputs. Renaming a file does not convert its format.\n\n` +
  Object.values(UPLOAD_SPECS).map(spec => `## ${spec.label}: ${spec.formats}\n\n${spec.summary}\n\n${spec.paragraphs.map(markdown).join('\n\n')}\n\n**${spec.exampleTitle}**\n\n\`\`\`text\n${spec.example}\n\`\`\`\n\n${spec.after}\n`).join('\n') +
  '\n## Size and export limits\n\nFolder mode streams game files in 4 MiB chunks and has no combined 4 GiB limit. FAT32 per-file restrictions still apply; oversized WBFS can be split and oversized ISO requires conversion outside the app. Folder-mode hack ZIPs are limited to 256 MiB uncompressed. Only the ZIP fallback is limited to below approximately 4 GiB combined and may exhaust memory earlier. Folder Apply writes to the selected storage; ZIP Export only creates a new archive. Keep a separate backup. See docs/SAFETY-AND-RECOVERY.md.\n';
const outputs = new Map([
  ['index.html', single],
  ['Wii-SD-Manager.html', single],
  ['dev.html', template],
  ['UPLOAD-GUIDE.md', guide],
  ['.nojekyll', ''],
]);
let stale = false;
for (const [name, content] of outputs) {
  if (check) {
    const current = await read(name).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    if (current !== content) { console.error(`Out of date or missing: ${name}`); stale = true; }
  } else await writeFile(new URL(name, import.meta.url), content);
}
if (stale) {
  console.error('Run npm run build, then commit the generated files together with the source.');
  process.exitCode = 1;
} else console.log(`${check ? 'Verified' : 'Built'} ${outputs.size} generated files; index.html is ${Buffer.byteLength(single).toLocaleString()} bytes and needs no external assets.`);
