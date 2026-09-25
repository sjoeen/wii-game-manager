import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {ArchiveModel} from '../model.js';
const require=createRequire(import.meta.url), JSZip=require('../vendor/jszip.min.js');
const empty=()=>ArchiveModel.createEmpty('Empty-SD.zip',JSZip);
const file=(name,text='NON-PLAYABLE TEST PLACEHOLDER')=>{
  const data=Buffer.from(text);data.name=name;data.size=data.length;data.lastModified=1710000000000;return data;
};
async function load(files={}) {
  const z=new JSZip();
  for(const [name,bytes] of Object.entries(files))z.file(name,bytes,{createFolders:false,dir:name.endsWith('/')});
  return ArchiveModel.load(await z.generateAsync({type:'nodebuffer'}),'Test.zip',JSZip);
}
async function roundTrip(model) {
  return ArchiveModel.load(await model.exportBlob(()=>{},'nodebuffer'),'Export.zip',JSZip);
}
async function bytes(model) {
  return Object.fromEntries(await Promise.all(model.entries().map(async f=>[f.path,Buffer.from(await model.zip.file(f.path).async('uint8array')).toString('hex')])));
}
const directories=model=>Object.values(model.zip.files).filter(f=>f.dir).map(f=>f.name).sort();

test('createEmpty is a real, clean, non-demo archive with zero games and no placeholder files',()=>{
  const model=empty();assert.deepEqual(model.summary(),{files:[],games:[],hacks:[],total:0});
  assert.equal(model.name,'Empty-SD.zip');assert.equal(model.dirty,false);assert.equal(model.isDemo,false);assert.equal(model.crcChecked,true);
  assert.deepEqual(Object.keys(model.zip.files),[]);
});
test('createEmpty allocates independent archives and reports a missing ZIP library',()=>{
  const one=empty(),two=empty();one.put('notes.txt','notes',5);assert.equal(two.entries().length,0);
  assert.throws(()=>ArchiveModel.createEmpty('Test.zip',null),/bundled ZIP library/);
});
test('exporting an untouched empty library produces a valid empty ZIP and reimports cleanly',async()=>{
  const model=empty(),output=await model.exportBlob(()=>{},'nodebuffer');
  assert.equal(output.length,22);assert.equal(output.readUInt32LE(0),0x06054b50);
  const loaded=await ArchiveModel.load(output,'Empty.zip',JSZip);assert.equal(loaded.entries().length,0);assert.equal(loaded.crcChecked,true);
});
test('a valid zero-entry ZIP is accepted, but a zero-byte non-ZIP is still rejected',async()=>{
  const model=await load();assert.equal(model.summary().games.length,0);
  await assert.rejects(()=>ArchiveModel.load(Buffer.alloc(0),'Not-a-ZIP.zip',JSZip));
});
test('the first game creates a conventional wbfs path even without existing folders',async()=>{
  const model=empty(),next=model.addGames([file('First Game [DEME04].wbfs','first game')]);
  assert.equal(model.entries().length,0);assert.equal(next.dirty,true);
  const out=await roundTrip(next);assert.equal(out.summary().games.length,1);
  assert.equal(await out.zip.file('wbfs/First Game [DEME04]/DEME04.wbfs').async('string'),'first game');
});
test('apps-only and settings-only content remains byte-identical after adding the first game',async()=>{
  const model=await load({'apps/loader/boot.dol':Buffer.from([0,255,2,3]),'config/loader.cfg':'unchanged','private/save.dat':'keep'});
  assert.equal(model.summary().games.length,0);const before=await bytes(model);
  const out=await roundTrip(model.addGames([file('First [DEME04].iso')]));
  const after=await bytes(out);for(const [path,value] of Object.entries(before))assert.equal(after[path],value);
  assert.equal(out.summary().games.length,1);assert.deepEqual(await bytes(model),before);
});
test('directory-only archives preserve empty directories through add/remove/export',async()=>{
  const model=await load({'apps/':'','wbfs/':'','config/':'','private/empty/':''});
  assert.equal(model.entries().length,0);assert.equal(model.outerFolder(),'');const before=directories(model);
  const added=model.addGames([file('First [DEME04].wbfs')]);
  const removed=await added.removeItem(added.summary().games[0]),out=await roundTrip(removed);
  assert.equal(out.entries().length,0);assert.deepEqual(directories(out),before);
});
test('recognizes a wrapped SD with only empty known directories',async()=>{
  const model=await load({'SD/':'','SD/wbfs/':'','SD/apps/':'','SD/config/':''});
  assert.equal(model.outerFolder(),'SD');const next=await model.stripOuterFolder('SD');
  assert.equal(next.entries().length,0);assert.deepEqual(directories(next),['apps/','config/','wbfs/']);
  assert.equal(next.outerFolder(),'');assert.equal(model.outerFolder(),'SD');assert.equal(next.dirty,true);
  assert.deepEqual(directories(await roundTrip(next)),directories(next));
});
test('recognizes wrapped empty directories even without an explicit wrapper directory entry',async()=>{
  const model=await load({'Card/apps/':'','Card/wbfs/':''});
  assert.equal(model.outerFolder(),'Card');const next=await model.stripOuterFolder('Card');
  assert.deepEqual(directories(next),['apps/','wbfs/']);
});
test('never strips a real apps or wbfs root when the archive has no game files',async()=>{
  for(const files of [{'apps/':'','apps/loader/':''},{'wbfs/':''},{'apps/loader/boot.dol':'app'}]){
    assert.equal((await load(files)).outerFolder(),'');
  }
});
test('a standalone unknown empty folder is kept, not guessed to be an SD wrapper',async()=>{
  const model=await load({'My SD Card/':''});assert.equal(model.outerFolder(),'');
  assert.deepEqual(directories(await roundTrip(model)),['My SD Card/']);
});
test('extra top-level empty directories prevent destructive wrapper guessing',async()=>{
  const model=await load({'SD/apps/loader/boot.dol':'app','another-folder/':''});
  assert.equal(model.outerFolder(),'');assert.deepEqual(directories(await roundTrip(model)),['another-folder/']);
});
test('an apps-only wrapper can be stripped before adding the first game',async()=>{
  const model=await load({'My Card/':'','My Card/apps/loader/boot.dol':'loader','My Card/config/settings':'keep'});
  assert.equal(model.outerFolder(),'My Card');const next=await model.stripOuterFolder('My Card');
  const out=await roundTrip(next.addGames([file('First [DEME04].wbfs')]));
  assert.equal(out.summary().games.length,1);assert.equal(await out.zip.file('apps/loader/boot.dol').async('string'),'loader');
  assert.ok(!out.entries().some(f=>f.path.startsWith('My Card/')));
});
test('ROM-hack install/remove is allowed with zero games and round-trips back to empty',async()=>{
  const model=empty(),pack=await load({'riivolution/First.xml':'<wiidisc/>','riivolution/First/notes.txt':'test'});
  const added=await model.addHack(pack,'First Hack');assert.equal(added.summary().games.length,0);assert.equal(added.summary().hacks.length,1);
  const loaded=await roundTrip(added),removed=await loaded.removeItem(loaded.summary().hacks[0]);
  assert.deepEqual((await roundTrip(removed)).summary(),{files:[],games:[],hacks:[],total:0});
});
test('after removing the last game the same library can accept another first game',async()=>{
  const added=empty().addGames([file('One [DEME04].iso')]);
  const removed=await added.removeItem(added.summary().games[0]);assert.equal(removed.summary().games.length,0);
  const next=removed.addGames([file('Two [DEME05].wbfs')]);assert.equal(next.summary().games[0].title,'Two');
  assert.equal(added.summary().games[0].title,'One');assert.equal(removed.summary().games.length,0);
});
test('an empty library does not accept empty game files or an empty hack package',async()=>{
  const model=empty();assert.throws(()=>model.addGames([file('First.iso','')]),/empty/);
  await assert.rejects(()=>model.addHack(empty(),'Nothing'),/has no files/);
  assert.equal(model.entries().length,0);assert.equal(model.dirty,false);
});
