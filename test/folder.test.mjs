import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {MemoryFS} from './fake-fs.mjs';
import {FolderModel,scanFolder,hasWiiLayout,assertDiskPath,FAT32_FILE_LIMIT,WBFS_SPLIT_SIZE,MAX_HACK_PACKAGE} from '../folder-model.js';
import {COPY_CHUNK,TRANSACTIONS_ROOT,sourceFromFile,streamCopy,checksumBlob,findRecoveries,recoverTransaction,validateJournal} from '../disk-io.js';
import {ArchiveModel} from '../model.js';
const require=createRequire(import.meta.url),JSZip=require('../vendor/jszip.min.js');
const B={ 'apps/loader/boot.dol':'APP','config/keep.txt':'SETTINGS','wbfs/First [GAME01]/GAME01.wbfs':'GAME','wbfs/First [GAME01]/GAME01.wbf1':'PART','wbfs/First [GAME01]/notes.txt':'PRESERVE','saves/keep.bin':'SAVE' };
const file=(name,text='WBFSdemo')=>new File([text],name,{lastModified:1234});
const fixture=async entries=>{const fs=new MemoryFS(entries||B);return {fs,model:await FolderModel.open(fs.root)};};
const pack=async entries=>{const z=new JSZip();for(const [p,t] of Object.entries(entries))z.file(p,t,{createFolders:false});return ArchiveModel.load(await z.generateAsync({type:'uint8array'}),'pack.zip',JSZip);};
const assertNoJournal=async fs=>assert.equal((await findRecoveries(fs.root)).length,0);

test('existing Wii folder opens by metadata, without reading game bytes',async()=>{
 const {fs,model}=await fixture();assert.equal(model.summary().games.length,1);assert.equal(fs.readBytes,0);assert.equal(fs.fullReads,0);assert.equal(model.kind,'folder');
});
test('24 GiB inventory has no combined ZIP32 cap and reads no game data',async()=>{
 const entries={'apps/loader/boot.dol':'APP'};
 for(let i=0;i<8;i++)entries[`wbfs/Game ${i} [GM000${i}]/GM000${i}.wbfs`]={virtualSize:3*1024**3,header:'WBFS'};
 const {fs,model}=await fixture(entries);assert.equal(model.summary().games.length,8);assert.ok(model.summary().total>24*1024**3);model.checkBudget();assert.equal(fs.readBytes,0);
});
test('existing apps-only card works but an empty folder is rejected',async()=>{
 const {model}=await fixture({'apps/loader/boot.dol':'APP'});assert.equal(model.summary().games.length,0);
 await assert.rejects(FolderModel.open(new MemoryFS().root),/existing Wii card/);
});
test('wrong parent folder and apps subfolder get an actionable rejection',async()=>{
 await assert.rejects(FolderModel.open(new MemoryFS({'Card/apps/loader/boot.dol':'app'}).root),/root containing/);
 await assert.rejects(FolderModel.open(new MemoryFS({'loader/boot.dol':'app'}).root),/not an empty folder/);
});
test('OS metadata folders are skipped and not touched',async()=>{
 const {fs,model}=await fixture({...B,'System Volume Information/index.dat':'OS','.Trashes/old':'trash'});
 assert.equal(model.skipped.length,2);assert.equal(model.entries().some(f=>f.path.startsWith('System')),false);assert.equal(await fs.text('System Volume Information/index.dat'),'OS');
});
test('case-colliding card paths are refused before edits',async()=>{
 await assert.rejects(FolderModel.open(new MemoryFS({'apps/a/boot.dol':'a','apps/A/boot.dol':'b'}).root),/Case-conflicting/);
});
test('unsafe and nonportable disk paths are refused',()=>{
 for(const path of ['../evil','/outside','apps/../x','wbfs/a?/x','CON/file','wbfs/A. /x','a\\b','apps/NUL.txt'])assert.throws(()=>assertDiskPath(path));
});
test('adding a game stages lazy sources with no disk writes',async()=>{
 const {fs,model}=await fixture();const next=await model.addGames([file('Next [GAME02].wbfs')]);
 assert.equal(fs.writes.length,0);assert.equal(model.summary().games.length,1);assert.equal(next.summary().games.length,2);assert.equal(next.plan().writes.length,1);assert.equal(next.dirty,true);
});
test('adding then removing an uncommitted game leaves no pending disk change',async()=>{
 const {model}=await fixture();const next=await model.addGames([file('Next [GAME02].wbfs')]);const removed=await next.removeItem(next.summary().games.find(g=>g.id==='GAME02'));
 assert.equal(removed.plan().writes.length,0);assert.equal(removed.plan().deletes.length,0);assert.equal(removed.dirty,false);
});
test('staged game removal includes split companions, not unrelated files in its folder',async()=>{
 const {fs,model}=await fixture();const next=await model.removeItem(model.summary().games[0]);
 assert.deepEqual(next.plan().deletes.map(p=>p.path).sort(),['wbfs/First [GAME01]/GAME01.wbf1','wbfs/First [GAME01]/GAME01.wbfs']);
 assert.equal(next.entries().some(p=>p.path.endsWith('notes.txt')),true);assert.equal(await fs.text('wbfs/First [GAME01]/GAME01.wbfs'),'GAME');
});
test('duplicate IDs and destination files are rejected atomically',async()=>{
 const {model}=await fixture();await assert.rejects(model.addGames([file('Other [GAME01].iso')]),/already/);
 await assert.rejects(model.addGames([file('New.wbfs'),file('New.wbfs')]),/already exists/);assert.equal(model.dirty,false);
});
test('split files must include main and consecutive parts',async()=>{
 const {model}=await fixture();await assert.rejects(model.addGames([file('New.wbf1')]),/Select/);
 await assert.rejects(model.addGames([file('New.wbfs'),file('New.wbf2')]),/gaps/);
 await assert.rejects(model.addGames([file('New.wbfs'),file('Wrong.wbf1')]),/Missing matching/);
 const n=await model.addGames([file('New.wbfs'),file('New.wbf1')]);assert.equal(n.plan().writes.length,2);
});
test('large WBFS is sliced into FAT32-sized sources without buffering its contents',async()=>{
 const {model}=await fixture();let headerReads=0;
 const big={name:'Big [GAME04].wbfs',size:5*1024**3,lastModified:1,slice(start,end){headerReads++;assert.equal(start,0);assert.equal(end,4);return new Blob(['WBFS']);}};
 const next=await model.addGames([big]);assert.equal(headerReads,1);assert.equal(next.plan().writes.length,3);
 assert.deepEqual(next.plan().writes.map(p=>p.size).sort((a,b)=>b-a),[WBFS_SPLIT_SIZE,WBFS_SPLIT_SIZE,1024**3]);assert.equal(next.summary().games.find(g=>g.id==='GAME04').size,5*1024**3);
});
test('oversized ISO and fake renamed WBFS are rejected with conversion advice',async()=>{
 const {model}=await fixture();await assert.rejects(model.addGames([{name:'Big.iso',size:FAT32_FILE_LIMIT+1}]),/Convert.*WBFS/);
 await assert.rejects(model.addGames([{name:'Big.wbfs',size:FAT32_FILE_LIMIT+1,slice:()=>new Blob(['FAKE'])}]),/Renaming/);
});
test('existing uppercase WBFS directory is reused, never duplicated',async()=>{
 const {model}=await fixture({'Apps/a/boot.dol':'app','WBFS/Old [GAME01]/GAME01.wbfs':'g'});
 const next=await model.addGames([file('New [GAME02].wbfs')]);assert.match(next.plan().writes[0].path,/^WBFS\//);
});
test('a blocking file or existing empty folder prevents a game destination',async()=>{
 const {model}=await fixture({...B,'wbfs/New':'BLOCK'});await assert.rejects(model.addGames([file('New.wbfs')]),/blocks/);
 const {model:other}=await fixture({...B,'wbfs/New/New.wbfs/':''});await assert.rejects(other.addGames([file('New.wbfs')]),/directory blocks/);
});
test('real apply writes exact bytes and keeps apps/settings/saves and source unchanged',async()=>{
 const {fs,model}=await fixture();const input=file('Next [GAME02].wbfs','WBFS\x00\x01unique');const next=await model.addGames([input]);
 const result=await next.apply();assert.equal(result.status,'completed');assert.equal(await fs.text('wbfs/Next [GAME02]/GAME02.wbfs'),await input.text());
 assert.equal(await fs.text('config/keep.txt'),'SETTINGS');assert.equal(await fs.text('saves/keep.bin'),'SAVE');await assertNoJournal(fs);
 const reopened=await FolderModel.open(fs.root);assert.equal(reopened.summary().games.length,2);assert.equal(reopened.dirty,false);
});
test('removal-only apply does not copy or read whole game backups',async()=>{
 const {fs,model}=await fixture();const next=await model.removeItem(model.summary().games[0]);const result=await next.apply();
 assert.equal(result.status,'completed');assert.equal(result.removed,2);assert.equal(fs.paths().includes('wbfs/First [GAME01]/GAME01.wbfs'),false);
 assert.equal(fs.writes.some(p=>p.path.includes('/old/')),false);assert.equal(await fs.text('wbfs/First [GAME01]/notes.txt'),'PRESERVE');await assertNoJournal(fs);
});
test('removing and adding at the same original game path requires separate Apply',async()=>{
 const {model}=await fixture();const next=await model.removeItem(model.summary().games[0]);
 await assert.rejects(next.addGames([file('First [GAME01].wbfs')]),/Apply the removal/);
});
test('writes are verified before any confirmed removals start',async()=>{
 const {fs,model}=await fixture();let next=await model.removeItem(model.summary().games[0]);next=await next.addGames([file('Next [GAME02].wbfs')]);
 const order=[];fs.hook=(event,path)=>{if(path.includes('GAME02')&&event==='read')order.push('verify-new');if(path.includes('GAME01')&&event==='remove')order.push('remove-old');};
 assert.equal((await next.apply()).status,'completed');assert.ok(order.indexOf('verify-new')<order.indexOf('remove-old'));
});
test('source bytes are copied with bounded chunks and backpressure',async()=>{
 const fs=new MemoryFS({'apps/a/boot.dol':'app','copy.bin':''});const size=COPY_CHUNK*2+777,src=new Blob([new Uint8Array(size)]);
 const result=await streamCopy(sourceFromFile(src),fs.handle('copy.bin'));
 assert.equal(result.size,size);assert.deepEqual(fs.writes.filter(w=>w.path==='copy.bin').map(w=>w.size),[COPY_CHUNK,COPY_CHUNK,777]);
});
test('CRC32 implementation matches the standard reference vector',async()=>{
 assert.equal(await checksumBlob(new Blob(['123456789'])),0xcbf43926);
});
test('metadata changes before apply abort before creating a journal or modifying games',async()=>{
 const {fs,model}=await fixture();const next=await model.addGames([file('Next [GAME02].wbfs')]);fs.seed('config/keep.txt','OUTSIDE EDIT');
 await assert.rejects(next.apply(),/changed/);assert.equal(fs.writes.length,0);await assertNoJournal(fs);
});
test('new outside files before apply trigger a refresh rather than overwrite',async()=>{
 const {fs,model}=await fixture();const next=await model.addGames([file('Next [GAME02].wbfs')]);fs.seed('new-outside.bin','keep');
 await assert.rejects(next.apply(),/folder changed/);assert.equal(await fs.text('new-outside.bin'),'keep');
});
test('write permission failure cannot produce a success result',async()=>{
 const {fs,model}=await fixture();const next=await model.addGames([file('Next [GAME02].wbfs')]);fs.permission='denied';await assert.rejects(next.apply(),/permission|journal/);assert.equal(await fs.text('config/keep.txt'),'SETTINGS');
});
test('out-of-space on new game rolls back and never starts reviewed removals',async()=>{
 const {fs,model}=await fixture();let next=await model.removeItem(model.summary().games[0]);next=await next.addGames([file('Next [GAME02].wbfs')]);
 fs.hook=(event,path)=>{if(event==='write'&&path.includes('GAME02'))throw new DOMException('Disk full','QuotaExceededError');};
 const result=await next.apply();assert.equal(result.status,'rolled-back');assert.match(result.message,/free space/);assert.equal(await fs.text('wbfs/First [GAME01]/GAME01.wbfs'),'GAME');assert.equal(fs.paths().some(p=>p.includes('GAME02')),false);await assertNoJournal(fs);
});
test('cancellation between chunks removes new placeholders and keeps old files',async()=>{
 const {fs,model}=await fixture();const next=await model.addGames([file('Next [GAME02].wbfs','123456')]);const controller=new AbortController();
 fs.hook=(event,path)=>{if(event==='write'&&path.includes('GAME02'))controller.abort();};
 const result=await next.apply({signal:controller.signal});assert.equal(result.status,'cancelled');assert.equal(fs.paths().some(p=>p.includes('GAME02')),false);await assertNoJournal(fs);
});
test('cancel before start performs zero writes',async()=>{
 const {fs,model}=await fixture();const next=await model.addGames([file('Next.wbfs')]);const c=new AbortController();c.abort();
 await assert.rejects(next.apply({signal:c.signal}),{name:'AbortError'});assert.equal(fs.writes.length,0);
});
test('corrupted copied bytes are detected and rolled back, not called success',async()=>{
 const {fs,model}=await fixture();const next=await model.addGames([file('Next [GAME02].wbfs')]);let corrupted=false;
 fs.hook=(event,path)=>{if(event==='closed'&&path.includes('GAME02')&&!corrupted){corrupted=true;fs.seed(path,'CORRUPTED');}};
 const result=await next.apply();assert.equal(result.status,'rolled-back');assert.match(result.message,/verification failed/);assert.equal(fs.paths().some(p=>p.includes('GAME02')),false);
});
test('drive loss after commit leaves a journal and reopens into explicit rollback recovery',async()=>{
 const {fs,model}=await fixture();const next=await model.addGames([file('Next [GAME02].wbfs')]);let lost=false;
 fs.hook=(event,path)=>{if(!lost&&event==='closed'&&path.includes('GAME02')){lost=true;fs.online=false;}};
 const result=await next.apply();assert.equal(result.status,'recovery-needed');fs.online=true;fs.hook=()=>{};
 const reopened=await FolderModel.open(fs.root);assert.equal(reopened.recoveries.length,1);await assert.rejects(reopened.addGames([file('More.wbfs')]),/interrupted/);
 await recoverTransaction(fs.root,reopened.recoveries[0]);assert.equal(fs.paths().some(p=>p.includes('GAME02')),false);assert.equal(await fs.text('config/keep.txt'),'SETTINGS');await assertNoJournal(fs);
});
test('drive loss during permanent deletion offers roll-forward, not imaginary undo',async()=>{
 const {fs,model}=await fixture();const next=await model.removeItem(model.summary().games[0]);let lost=false;
 fs.hook=(event,path)=>{if(!lost&&event==='removed'&&path.includes('GAME01')){lost=true;fs.online=false;}};
 const result=await next.apply();assert.equal(result.status,'recovery-needed');fs.online=true;fs.hook=()=>{};
 const [journal]=await findRecoveries(fs.root);assert.equal(journal.phase,'deleting');const recovery=await recoverTransaction(fs.root,journal);assert.equal(recovery.status,'completed');await assertNoJournal(fs);assert.equal(await fs.text('wbfs/First [GAME01]/notes.txt'),'PRESERVE');
});
test('recovery refuses to remove a new outside replacement at a journal path',async()=>{
 const {fs,model}=await fixture();const next=await model.addGames([file('Next [GAME02].wbfs')]);let lost=false;
 fs.hook=(event,path)=>{if(!lost&&event==='closed'&&path.includes('GAME02')){lost=true;fs.online=false;}};
 await next.apply();fs.online=true;fs.hook=()=>{};fs.seed('wbfs/Next [GAME02]/GAME02.wbfs','USER REPLACED THIS');
 const [j]=await findRecoveries(fs.root);await assert.rejects(recoverTransaction(fs.root,j),/unexpected contents/);assert.equal(await fs.text('wbfs/Next [GAME02]/GAME02.wbfs'),'USER REPLACED THIS');
});
test('invalid recovery JSON is blocked, not executed',async()=>{
 const fs=new MemoryFS({...B,[`${TRANSACTIONS_ROOT}/txn-bad/journal.json`]:'{"version":1,"id":"txn-bad","phase":"deleting","writes":[],"deletes":[{"path":"../escape","before":{"size":1,"lastModified":1},"status":"planned"}]}'});
 await assert.rejects(FolderModel.open(fs.root),/Unsafe/);
});
test('reserved or duplicate journal paths and mismatched backup paths are blocked',()=>{
 const base={version:1,id:'txn-x',phase:'writing',writes:[],deletes:[]};
 assert.throws(()=>validateJournal({...base,writes:[{path:'x',size:1,before:null,status:'planned',backupPath:'elsewhere',checksum:null}]},'txn-x'),/invalid/);
 assert.throws(()=>validateJournal({...base,deletes:[{path:TRANSACTIONS_ROOT+'/x',before:{size:1,lastModified:1},status:'planned'}]},'txn-x'),/invalid/);
});
test('orphan recovery directory gives explicit manual-inspection advice',async()=>{
 const fs=new MemoryFS({...B,[`${TRANSACTIONS_ROOT}/txn-orphan/`]:''});await assert.rejects(FolderModel.open(fs.root),/has no journal/);
});
test('folder hack add/apply/reopen/remove restores exact original configuration',async()=>{
 const {fs,model}=await fixture();const packageModel=await pack({'Package/config/keep.txt':'PATCHED','Package/riivolution/New.xml':'<xml/>'});
 const next=await model.addHack(packageModel,'Example',true);assert.equal(fs.writes.length,0);
 assert.equal((await next.apply()).status,'completed');assert.equal(await fs.text('config/keep.txt'),'PATCHED');
 const reopened=await FolderModel.open(fs.root);const removed=await reopened.removeItem(reopened.summary().hacks.find(h=>h.manifestId));
 assert.equal((await removed.apply()).status,'completed');assert.equal(await fs.text('config/keep.txt'),'SETTINGS');assert.deepEqual(fs.paths(),Object.keys(B).sort());
});
test('hack write failure restores replaced originals using on-disk rollback',async()=>{
 const {fs,model}=await fixture();const next=await model.addHack(await pack({'config/keep.txt':'PATCHED','riivolution/z.xml':'<xml/>'}),'Fail');
 fs.hook=(event,path)=>{if(event==='write'&&path==='riivolution/z.xml')throw new DOMException('full','QuotaExceededError');};
 const result=await next.apply();assert.equal(result.status,'rolled-back');assert.equal(await fs.text('config/keep.txt'),'SETTINGS');await assertNoJournal(fs);assert.deepEqual(fs.paths(),Object.keys(B).sort());
});
test('tracked packages cannot overlap or replace manager metadata',async()=>{
 const {model}=await fixture();const packageModel=await pack({'riivolution/new.xml':'<xml/>'});const next=await model.addHack(packageModel,'One');
 assert.throws(()=>next.packagePlan(packageModel),/already owns/);
 assert.throws(()=>model.packagePlan({summary:()=>({total:1}),outerFolder:()=>'',entries:()=>[{path:'.wii-game-manager/manifest.json',size:1}]}),/metadata/);
});
test('missing persistent hack backup blocks removal before any disk mutation',async()=>{
 const {fs,model}=await fixture();const next=await model.addHack(await pack({'config/keep.txt':'patched'}),'Missing');await next.apply();
 const reopened=await FolderModel.open(fs.root);const b=reopened.manifest.hacks[0].backups[0];reopened.files.delete(b.backupPath);
 await assert.rejects(reopened.removeItem(reopened.summary().hacks[0]),/required backup is missing/);
});
test('mod ZIP package cap is separate from total card size',async()=>{
 const {model}=await fixture();assert.throws(()=>model.packagePlan({summary:()=>({total:MAX_HACK_PACKAGE+1})}),/256 MiB/);assert.ok(model.plan().extraSpaceEstimate>0);
});
test('two game files in one directory remain distinct; unrelated notes stay',async()=>{
 const {model}=await fixture({'apps/l/boot.dol':'app','wbfs/Mixed/AAAA01.wbfs':'a','wbfs/Mixed/BBBB02.iso':'b','wbfs/Mixed/notes.txt':'keep'});
 assert.equal(model.summary().games.length,2);const next=await model.removeItem(model.summary().games[0]);assert.equal(next.plan().deletes.length,1);assert.equal(next.entries().some(p=>p.path.endsWith('notes.txt')),true);
});
