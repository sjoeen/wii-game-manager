import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
import {APP_MANIFEST, assertArchivePath, normalizePath, extractGameId, gameDestination, shouldStripPackageRoot, detectGames, detectRiivolutionHacks, validateManifest, humanSize} from '../core.js';
import {ArchiveModel, makeDemo, inspectZip} from '../model.js';
const require=createRequire(import.meta.url), JSZip=require('../vendor/jszip.min.js');
const file=(name,text='test data')=>{const b=Buffer.from(text);b.name=name;b.size=b.length;b.lastModified=1710000000000;return b;};
async function archive(files={},options={}) {
  const zip=new JSZip();
  for(const [path,data] of Object.entries(files))zip.file(path,data,{createFolders:false,...options});
  const bytes=await zip.generateAsync({type:'nodebuffer',compression:'DEFLATE',platform:options.unixPermissions?'UNIX':'DOS'});
  return ArchiveModel.load(bytes,'test.zip',JSZip);
}
async function allBytes(model) {
  return Object.fromEntries(await Promise.all(model.entries().map(async f=>[f.path,Buffer.from(await model.zip.file(f.path).async('uint8array')).toString('hex')])));
}
async function reimport(model) { return ArchiveModel.load(await model.exportBlob(()=>{},'nodebuffer'),'edited.zip',JSZip); }
const basic=()=>archive({'wbfs/Orbit [DEME01]/DEME01.wbfs':'game','wbfs/Orbit [DEME01]/DEME01.wbf1':'part','config/keep.txt':'keep','apps/sample/boot.dol':'app'});

test('normalization retains legitimate names and rejects traversal',()=>{
 assert.equal(normalizePath('wbfs//A/./A.wbfs'),'wbfs/A/A.wbfs');
 assert.equal(normalizePath('wbfs/../system'),null);assert.equal(normalizePath('C:/data'),null);
 assert.equal(normalizePath('mods/café.txt'),'mods/café.txt');
});
for(const path of ['../evil.txt','/absolute.txt','C:/drive.txt','apps/../../evil','apps\\file.txt','apps/.. /evil','apps//file','apps/.hidden/../evil','a\0b','apps/trailing./file'])test(`reject unsafe archive path ${JSON.stringify(path)}`,()=>assert.throws(()=>assertArchivePath(path)));

test('does not mistake six-letter game titles for IDs',()=>{
 assert.equal(extractGameId('Super Mario Galaxy.wbfs'),'');assert.equal(extractGameId('Arcade Games.iso'),'');
 assert.equal(extractGameId('Game [RMCE01].wbfs'),'RMCE01');assert.equal(extractGameId('RMCE01.wbfs'),'RMCE01');
});
test('destination keeps conventional ID-based layout',()=>assert.deepEqual(gameDestination('Orbit Racers [DEME01].wbfs'),{path:'wbfs/Orbit Racers [DEME01]/DEME01.wbfs',title:'Orbit Racers',id:'DEME01'}));
test('wrapper detection never strips a real apps folder',()=>{
 assert.equal(shouldStripPackageRoot(['SD/wbfs/A/A.wbfs','SD/apps/a/boot.dol']),'SD');
 assert.equal(shouldStripPackageRoot(['apps/riivolution/boot.dol']),'');
});
test('size labels use binary units',()=>{assert.equal(humanSize(1024),'1.0 KiB');assert.equal(humanSize(0),'0 B');});
test('detects flat and folder games with split companions',()=>{
 const result=detectGames([{path:'wbfs/A [DEME01]/DEME01.wbfs',size:4},{path:'wbfs/A [DEME01]/DEME01.wbf1',size:2},{path:'wbfs/DEME02.iso',size:3},{path:'other/DEME03.iso',size:5}]);
 assert.equal(result.length,2);assert.equal(result.find(x=>x.id==='DEME01').paths.length,2);
});
test('Riivolution config files are not misidentified as hacks',()=>{
 const result=detectRiivolutionHacks([{path:'riivolution/Test.xml',size:1},{path:'riivolution/Test/patch.bin',size:2},{path:'riivolution/config/RMCE01.xml',size:3}]);
 assert.equal(result.length,1);assert.equal(result[0].paths.length,2);
});
test('demo includes exactly 2 games and 1 hack, with no real game data',async()=>{
 const model=await makeDemo(JSZip), s=model.summary();assert.equal(s.games.length,2);assert.equal(s.hacks.length,1);assert.equal(s.files.length,8);assert.equal(model.isDemo,true);assert.ok(s.total<2048);
});
test('model clone retains the JSZip prototype and independent file map',async()=>{
 const model=await basic(), clone=model.clone();assert.equal(typeof clone.zip.generateAsync,'function');assert.equal(typeof clone.zip.file,'function');clone.drop('config/keep.txt');assert.ok(model.zip.file('config/keep.txt'));
});
test('unmodified ZIP round-trip preserves every file byte',async()=>{
 const model=await basic();assert.deepEqual(await allBytes(await reimport(model)),await allBytes(model));
});
test('empty ZIP is valid and can accept games',async()=>{
 const model=await archive();assert.equal(model.entries().length,0);assert.equal(model.addGames([file('New [DEME02].wbfs')]).summary().games.length,1);
});
test('added game size is correct before export',async()=>{
 const model=await archive(), next=model.addGames([file('New [DEME02].wbfs','123456789')]);assert.equal(next.summary().games[0].size,9);assert.equal(model.entries().length,0);
});
test('adds complete split-WBFS set and removes all its parts',async()=>{
 const model=await archive(), next=model.addGames([file('New [DEME02].wbfs','game'),file('New [DEME02].wbf1','part1'),file('New [DEME02].wbf2','part2')]);
 assert.equal(next.summary().games[0].paths.length,3);assert.equal((await next.removeItem(next.summary().games[0])).summary().games.length,0);
});
test('rejects orphan split parts without editing original',async()=>{
 const model=await basic(), before=await allBytes(model);assert.throws(()=>model.addGames([file('Wrong.wbf1')]),/matching/);assert.deepEqual(await allBytes(model),before);
});
test('rejects gaps in split-WBFS numbering',async()=>{
 const model=await basic();assert.throws(()=>model.addGames([file('New [DEME02].wbfs'),file('New [DEME02].wbf2')]),/no missing/);
});
test('rejects duplicate game ID instead of silently overwriting',async()=>{
 const model=await basic();assert.throws(()=>model.addGames([file('Different Title [DEME01].iso')]),/already/);
});
test('batch add is atomic when a later game is invalid',async()=>{
 const model=await basic(), before=await allBytes(model);assert.throws(()=>model.addGames([file('New [DEME02].iso'),file('Duplicate [DEME01].wbfs')]),/already/);assert.deepEqual(await allBytes(model),before);
});
test('rejects unsupported or empty game input',async()=>{
 const model=await basic();assert.throws(()=>model.addGames([file('Game.exe')]),/Select/);assert.throws(()=>model.addGames([file('New [DEME02].iso','')]),/empty/);
});
test('game removal preserves unrelated app and configuration bytes',async()=>{
 const model=await basic(), next=await model.removeItem(model.summary().games[0]);assert.equal(next.entries().length,2);assert.equal(await next.zip.file('config/keep.txt').async('string'),'keep');assert.equal(model.summary().games.length,1);
});
test('untracked hack removal leaves external mod directories alone',async()=>{
 const model=await archive({'riivolution/Example.xml':'xml','riivolution/Example/a.bin':'same-name','external-patches/shared.bin':'shared','riivolution/config/RMCE01.xml':'settings'});
 const next=await model.removeItem(model.summary().hacks[0]);assert.equal(next.entries().length,2);assert.ok(next.zip.file('external-patches/shared.bin'));assert.ok(next.zip.file('riivolution/config/RMCE01.xml'));
});
test('managed hack install/export/reimport/remove restores exact original bytes',async()=>{
 const model=await basic(), before=await allBytes(model), pack=await archive({'Pack/config/keep.txt':'replaced','Pack/riivolution/New.xml':'xml','Pack/riivolution/New/palette.bin':Buffer.from([0,255,1,50])});
 const added=await model.addHack(pack,'New Pack',true);assert.equal(await added.zip.file('config/keep.txt').async('string'),'replaced');assert.equal(added.manifest.hacks.length,1);
 const loaded=await reimport(added),removed=await loaded.removeItem(loaded.summary().hacks.find(h=>h.manifestId));assert.deepEqual(await allBytes(removed),before);assert.deepEqual(await allBytes(model),before);
});
test('case-insensitive replacement uses original path and restores it',async()=>{
 const model=await archive({'config/KEEP.txt':'original'}),pack=await archive({'config/keep.txt':'updated'}), added=await model.addHack(pack,'Case test');
 assert.equal(added.entries().filter(f=>f.path.toLowerCase()==='config/keep.txt').length,1);assert.ok(added.zip.file('config/KEEP.txt'));
 const removed=await added.removeItem(added.summary().hacks[0]);assert.deepEqual(await allBytes(removed),await allBytes(model));
});
test('tracked package overlap is blocked',async()=>{
 const model=await archive(),pack=await archive({'mods/a.bin':'a'}),added=await model.addHack(pack,'First');assert.throws(()=>added.packagePlan(pack),/overlaps/);
});
test('missing backup aborts removal transaction',async()=>{
 const model=await basic(),pack=await archive({'config/keep.txt':'overwritten'}),added=await model.addHack(pack,'Test');added.drop(added.manifest.hacks[0].backups[0].backupPath);
 await assert.rejects(()=>added.removeItem(added.summary().hacks[0]),/backup is missing/);assert.equal(await added.zip.file('config/keep.txt').async('string'),'overwritten');
});
test('failed mid-package data read does not partially modify archive',async()=>{
 const model=await basic(),before=await allBytes(model),pack=await archive({'mods/a.bin':'one','mods/b.bin':'two'});
 pack.zip.file('mods/b.bin').async=async()=>{throw new Error('Simulated read failure');};
 await assert.rejects(()=>model.addHack(pack,'Fail'),/Simulated/);assert.deepEqual(await allBytes(model),before);
});
test('package cannot overwrite manager metadata',async()=>{
 const model=await basic(),pack=await archive({'.wii-game-manager/secret.txt':'oops'});assert.throws(()=>model.packagePlan(pack),/cannot replace/);
});
test('cannot remove game paths owned by a tracked package',async()=>{
 const model=await basic(),pack=await archive({'wbfs/Orbit [DEME01]/DEME01.wbfs':'patched'}),added=await model.addHack(pack,'Patch');await assert.rejects(()=>added.removeItem(added.summary().games[0]),/Remove the package first/);
});
test('package cannot place a file over an existing directory',async()=>{
 const model=await basic(),pack=await archive({'config':'wrong'});assert.throws(()=>model.packagePlan(pack),/folder already exists/);
});
test('package cannot place a folder under an existing file',async()=>{
 const model=await basic(),pack=await archive({'config/keep.txt/child':'wrong'});assert.throws(()=>model.packagePlan(pack),/blocks/);
});
test('wrapper stripping preserves content and reads the nested manifest',async()=>{
 const model=await archive({'SD/wbfs/A [DEME01]/DEME01.wbfs':'game','SD/apps/a/boot.dol':'app'});assert.equal(model.summary().games.length,0);
 const next=await model.stripOuterFolder('SD');assert.equal(next.summary().games.length,1);assert.equal(next.dirty,true);assert.ok(next.zip.file('apps/a/boot.dol'));assert.ok(model.zip.file('SD/apps/a/boot.dol'));
});
test('actual ZIP traversal is rejected using unsafeOriginalName',async()=>{
 await assert.rejects(()=>archive({'../evil.txt':'bad'}),/Unsafe/);
});
test('case-colliding ZIP entries are rejected',async()=>{
 await assert.rejects(()=>archive({'mods/A.txt':'a','mods/a.txt':'b'}),/Case-conflicting/);
});
test('file/folder collisions inside a ZIP are rejected',async()=>{
 await assert.rejects(()=>archive({'mods':'a','mods/file.bin':'b'}),/conflicts with a folder/);
});
test('ZIP symbolic links are rejected',async()=>{
 await assert.rejects(()=>archive({'link':'target'},{unixPermissions:0o120777}),/Symbolic/);
});
test('malformed archive is rejected',async()=>{
 await assert.rejects(()=>ArchiveModel.load(Buffer.from('not a zip'),'bad.zip',JSZip));
});
test('small archive CRC corruption is rejected',async()=>{
 const zip=new JSZip();zip.file('x.txt','ORIGINAL DATA');const bytes=await zip.generateAsync({type:'nodebuffer',compression:'STORE'});
 const at=bytes.indexOf(Buffer.from('ORIGINAL DATA'));assert.ok(at>=0);bytes[at]^=255;
 await assert.rejects(()=>ArchiveModel.load(bytes,'corrupt.zip',JSZip),/CRC32/);
});
test('invalid or malicious manifest backup paths are rejected',()=>{
 assert.throws(()=>validateManifest({version:2,hacks:[]}));
 assert.throws(()=>validateManifest({version:1,hacks:[{id:'x',name:'Bad',paths:['mods/a'],backups:[{path:'mods/a',backupPath:'apps/boot.dol'}]}]}),/backup path/);
});
test('oversized declared archive is stopped without allocating game data',async()=>{
 const model=await basic();model.zip.file('config/keep.txt')._data.uncompressedSize=0xffffffff;
 assert.throws(()=>inspectZip(model.zip),/Unsupported size/);
});
test('UTF-8 names, binary content, and empty directories survive round-trip',async()=>{
 const zip=new JSZip();zip.file('mods/café 日本.bin',Buffer.from([0,255,254,13,10]));zip.folder('empty');
 const model=await ArchiveModel.load(await zip.generateAsync({type:'nodebuffer'}),'unicode.zip',JSZip),next=await reimport(model);
 assert.deepEqual(await allBytes(next),await allBytes(model));assert.equal(next.zip.files['empty/'].dir,true);
});
test('all builds have unique element IDs and no external assets',async()=>{
 const html=await readFile(new URL('../index.html',import.meta.url),'utf8');
 const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
 // Ignore demo XML quoted inside inline JS by limiting the scan to the HTML portion.
 const body=html.slice(0,html.indexOf('<script>'));
 const domIds=[...body.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);assert.equal(new Set(domIds).size,domIds.length);
 assert.ok(!/<(?:script|link)[^>]+(?:src|href)="https?:/i.test(html));assert.ok(!html.includes('type="module"'));assert.ok(html.includes('[hidden]{display:none!important}'));
});
