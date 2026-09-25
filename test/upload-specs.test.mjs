import test from 'node:test';
import assert from 'node:assert/strict';
import {UPLOAD_SPECS, validateUploadSelection} from '../upload-specs.js';

const file = (name, size = 32, type = '') => ({name, size, type});

test('one folder and three explicit upload inputs have formats, examples, and required hints', () => {
  assert.deepEqual(Object.keys(UPLOAD_SPECS), ['folder', 'sd', 'game', 'hack']);
  for (const spec of Object.values(UPLOAD_SPECS)) {
    for (const field of ['label','formats','choose','summary','hint','exampleTitle','example','after']) {
      assert.ok(spec[field].length > 0, field);
    }
    assert.ok(spec.paragraphs.length >= 3);
  }
});
test('only games permit selecting several files', () => {
  assert.equal(UPLOAD_SPECS.game.multiple, true);
  assert.equal(UPLOAD_SPECS.sd.multiple, false);
  assert.equal(UPLOAD_SPECS.hack.multiple, false);
});
test('SD ZIP validation accepts uppercase and generic MIME metadata', () => {
  const files = [file('Card.ZIP', 22, 'application/octet-stream')];
  assert.deepEqual(validateUploadSelection('sd', files), files);
});
test('valid empty-ZIP metadata is not confused with a zero-byte file', () => {
  assert.equal(validateUploadSelection('sd', [file('Empty.zip', 22)]).length, 1);
  assert.throws(() => validateUploadSelection('sd', [file('Empty.zip', 0)]), /not a valid ZIP.*existing homebrew/s);
});
test('SD selection rejects other formats and gives the correct route', () => {
  for (const ext of ['rar','7z','img','sd','iso','wbfs','wad','txt']) {
    assert.throws(() => validateUploadSelection('sd', [file(`Card.${ext}`)]), /Choose one \.zip.*zero games are OK/s);
  }
});
test('SD and hack selection both reject multiple archives', () => {
  for (const kind of ['sd','hack']) {
    assert.throws(() => validateUploadSelection(kind, [file('A.zip'),file('B.zip')]), /one \.zip at a time/);
  }
});
test('a missing selection has an actionable error for each input', () => {
  for (const kind of ['sd','game','hack']) {
    assert.throws(() => validateUploadSelection(kind, []), /No file selected/);
  }
});
test('unknown inputs do not silently fall back to an unrelated picker', () => {
  assert.throws(() => validateUploadSelection('unknown', [file('A.zip')]), /Unknown upload type/);
});
test('missing file names are rejected as bad selections', () => {
  for (const value of [null, {}, {name:''}, {name:7}]) {
    assert.throws(() => validateUploadSelection('sd', [value]), /Select a file/);
  }
});
test('game selection accepts files in either supported main format', () => {
  for (const name of ['A.wbfs','B.iso','A.WBFS','B.ISO']) {
    assert.equal(validateUploadSelection('game', [file(name)]).length, 1);
  }
});
test('game names do not need an invented ID to pass file selection', () => {
  assert.equal(validateUploadSelection('game', [file('My Game.wbfs')]).length, 1);
  assert.ok(UPLOAD_SPECS.game.paragraphs.some(p => p.includes('ID is optional')));
});
test('split game files are accepted together, including later numbered parts', () => {
  const files = ['A.wbfs','A.wbf1','A.wbf2','A.wbf10'].map(name => file(name));
  assert.equal(validateUploadSelection('game', files).length, 4);
  // The model, not this metadata precheck, rejects a sequence with missing parts.
});
test('split parts by themselves point to the matching WBFS', () => {
  assert.throws(() => validateUploadSelection('game', [file('A.wbf1')]), /together with their matching \.wbfs/);
});
test('game selection rejects compressed archives without silently skipping them', () => {
  for (const ext of ['zip','rar','7z']) {
    assert.throws(() => validateUploadSelection('game', [file(`My Game.${ext}`)]), /Extract ZIP\/RAR\/7z game packages first/);
  }
});
test('mixed game and wrong-format selection is rejected atomically', () => {
  assert.throws(() => validateUploadSelection('game', [file('Valid.iso'),file('Wrong.bps')]), /Wrong.bps/);
});
test('other platform ROMs, patches and executables are not Add Game files', () => {
  for (const ext of ['wad','elf','dol','bps','ips','xdelta','gba','n64','nes','rvz','wbf0']) {
    assert.throws(() => validateUploadSelection('game', [file(`A.${ext}`)]), /Choose Wii \.wbfs or \.iso files directly/);
  }
});
test('hack file selection accepts a real ZIP filename', () => {
  assert.equal(validateUploadSelection('hack', [file('My-Mod.zip')]).length, 1);
  assert.equal(validateUploadSelection('hack', [file('My-Mod.ZIP')]).length, 1);
});
test('hack raw patch selection explains that it cannot apply patches', () => {
  for (const ext of ['bps','ips','xdelta','wad','xml']) {
    assert.throws(() => validateUploadSelection('hack', [file(`Patch.${ext}`)]), /Raw \.bps\/\.ips\/\.xdelta patches are not applied/);
  }
});
test('a ready-patched image selected as a hack points to Add Game', () => {
  for (const ext of ['wbfs','iso']) {
    assert.throws(() => validateUploadSelection('hack', [file(`Ready.${ext}`)]), /belongs in Add Game/);
  }
});
test('a zero-byte hack ZIP is not represented as a successful package', () => {
  assert.throws(() => validateUploadSelection('hack', [file('Mod.zip', 0)]), /real SD-ready ROM-hack ZIP/);
});
test('guidance preserves the zero-game workflow and optional folders', () => {
  assert.ok(UPLOAD_SPECS.sd.summary.includes('Zero games is OK'));
  assert.ok(UPLOAD_SPECS.sd.paragraphs.join(' ').includes('keep the existing Wii layout'));
  assert.ok(UPLOAD_SPECS.hack.paragraphs.join(' ').includes('zero games'));
});
test('guidance does not promise patching, conversion or Wii compatibility', () => {
  const game = UPLOAD_SPECS.game.paragraphs.join(' ');
  const hack = UPLOAD_SPECS.hack.paragraphs.join(' ');
  assert.match(game, /does not convert ISO to WBFS/);
  assert.match(game, /verify playability/);
  assert.match(hack, /not a patcher or installer/);
  assert.match(hack, /does not verify compatibility/);
});
